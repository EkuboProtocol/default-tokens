// Read canonical bridge mappings from the bridges themselves and write them
// to bridge-reads.json, which the token-list build reads as a link source.
//
// The daily build runs without an RPC endpoint, so these reads are a reviewed
// snapshot: rerun this script to refresh it. Every listed, selectable token on
// a supported chain is asked which Ethereum token it was minted from:
//
// - Arbitrum One and Robinhood Chain (Arbitrum gateway): the L2 token's
//   `l1Address()`, accepted only when the Ethereum gateway router's
//   `calculateL2TokenAddress` maps that token back to it.
// - Polygon PoS: the Ethereum RootChainManager's `childToRootToken`.
// - OP Stack chains: the token's `remoteToken()` and `bridge()` (or the legacy
//   `l1Token()` and `l2Bridge()`), accepted only when the bridge is the
//   standard bridge predeploy. Anyone can deploy a token that the standard
//   bridge accepts, so an Ethereum token claimed by two listed tokens on one
//   chain is recorded as ambiguous instead of linked.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { BridgeRead } from "../src/bridges";
import { tokenKey } from "../src/token-list";
import type { Token, TokenListDocument } from "../src/types";
import { BRIDGE_READ_CHAINS, type BridgeReadChain } from "../src/sources";

const root = resolve(import.meta.dir, "..");
const ETHEREUM_RPC = "https://ethereum-rpc.publicnode.com";
const BATCH_SIZE = 20;
const REQUEST_INTERVAL_MS = 300;
const OP_STANDARD_BRIDGE = "0x4200000000000000000000000000000000000010";
const SELECTORS = {
  remoteToken: "0xd6c0b2c4",
  bridge: "0xe78cea92",
  l1Token: "0xc01e1bd6",
  l2Bridge: "0xae1f6aaf",
  l1Address: "0xc2eeeebd",
  calculateL2TokenAddress: "0xa7e28d48",
  childToRootToken: "0x6e86b770",
};

type Call = { to: string; data: string };

type RpcResponse = {
  id: number;
  result?: string;
  error?: { message?: string };
};

function rateLimited(answers: RpcResponse[]): boolean {
  return answers.some((answer) => /rate limit/i.test(answer.error?.message ?? ""));
}

const sleep = (milliseconds: number) =>
  new Promise((done) => setTimeout(done, milliseconds));

// Public endpoints rate limit bursts; pace every request and back off on 429.
async function postWithRetry(
  url: string,
  body: unknown,
): Promise<RpcResponse[]> {
  for (let attempt = 0; ; attempt += 1) {
    await sleep(REQUEST_INTERVAL_MS * 2 ** Math.min(attempt, 6));
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const answers = response.ok
      ? ((await response.json()) as RpcResponse[])
      : null;
    if (answers && !rateLimited(answers)) return answers;
    if ((answers === null && response.status !== 429) || attempt >= 8) {
      throw new Error(`${url} answered ${response.status}`);
    }
  }
}

async function rpcBatch(url: string, calls: Call[]): Promise<(string | null)[]> {
  const results: (string | null)[] = [];
  for (let offset = 0; offset < calls.length; offset += BATCH_SIZE) {
    const chunk = calls.slice(offset, offset + BATCH_SIZE);
    const body = chunk.map((call, index) => ({
      jsonrpc: "2.0",
      id: index,
      method: "eth_call",
      params: [call, "latest"],
    }));
    const answers = await postWithRetry(url, body);
    if (!Array.isArray(answers)) throw new Error(`${url} did not batch`);
    const byId = new Map(answers.map((answer) => [answer.id, answer.result]));
    results.push(...chunk.map((_, index) => byId.get(index) ?? null));
  }
  return results;
}

function word(address: string): string {
  return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

function decodeAddress(result: string | null): string | null {
  if (!result || result.length !== 66) return null;
  const address = `0x${result.slice(26)}`;
  return BigInt(address) === 0n ? null : address;
}

function sameAddress(left: string | null, right: string): boolean {
  return left !== null && BigInt(left) === BigInt(right);
}

function readAddresses(
  url: string,
  targets: string[],
  data: (target: string) => Call,
): Promise<(string | null)[]> {
  return rpcBatch(url, targets.map(data)).then((results) =>
    results.map(decodeAddress),
  );
}

async function readArbitrumGateway(
  chain: BridgeReadChain,
  tokens: string[],
): Promise<BridgeRead[]> {
  const l1Tokens = await readAddresses(chain.rpc, tokens, (to) => ({
    to,
    data: SELECTORS.l1Address,
  }));
  const candidates = tokens.flatMap((token, index) => {
    const l1 = l1Tokens[index];
    return l1 ? [{ token, l1 }] : [];
  });
  const mapped = await readAddresses(
    ETHEREUM_RPC,
    candidates.map(({ l1 }) => l1),
    (l1) => ({
      to: chain.l1Contract!,
      data: `${SELECTORS.calculateL2TokenAddress}${word(l1)}`,
    }),
  );
  return candidates.flatMap(({ token, l1 }, index) =>
    sameAddress(mapped[index] ?? null, token)
      ? [read(chain, token, l1, "l1Address + calculateL2TokenAddress")]
      : [],
  );
}

async function readPolygonPos(
  chain: BridgeReadChain,
  tokens: string[],
): Promise<BridgeRead[]> {
  const roots = await readAddresses(ETHEREUM_RPC, tokens, (child) => ({
    to: chain.l1Contract!,
    data: `${SELECTORS.childToRootToken}${word(child)}`,
  }));
  return tokens.flatMap((token, index) => {
    const rootToken = roots[index];
    return rootToken ? [read(chain, token, rootToken, "childToRootToken")] : [];
  });
}

async function readOpStackPair(
  chain: BridgeReadChain,
  tokens: string[],
  remoteSelector: string,
  bridgeSelector: string,
): Promise<(string | null)[]> {
  const [remotes, bridges] = await Promise.all([
    readAddresses(chain.rpc, tokens, (to) => ({ to, data: remoteSelector })),
    readAddresses(chain.rpc, tokens, (to) => ({ to, data: bridgeSelector })),
  ]);
  return remotes.map((remote, index) =>
    sameAddress(bridges[index] ?? null, OP_STANDARD_BRIDGE) ? remote : null,
  );
}

async function readOpStack(
  chain: BridgeReadChain,
  tokens: string[],
): Promise<BridgeRead[]> {
  const current = await readOpStackPair(
    chain,
    tokens,
    SELECTORS.remoteToken,
    SELECTORS.bridge,
  );
  const legacy = await readOpStackPair(
    chain,
    tokens,
    SELECTORS.l1Token,
    SELECTORS.l2Bridge,
  );
  return tokens.flatMap((token, index) => {
    const l1 = current[index] ?? legacy[index];
    return l1 ? [read(chain, token, l1, "remoteToken + bridge")] : [];
  });
}

function read(
  chain: BridgeReadChain,
  token: string,
  l1: string,
  method: string,
): BridgeRead {
  return {
    chain_id: chain.chainId,
    token_address: token,
    l1_token_address: l1,
    bridge_name: chain.bridgeName,
    method,
  };
}

const READERS = {
  arbitrum_gateway: readArbitrumGateway,
  polygon_pos: readPolygonPos,
  op_standard_bridge: readOpStack,
};

// An Ethereum token claimed by more than one listed token on a chain.
function splitAmbiguous(reads: BridgeRead[]): {
  links: BridgeRead[];
  ambiguous: BridgeRead[];
} {
  const claims = new Map<string, number>();
  const claimKey = (entry: BridgeRead) =>
    `${entry.chain_id}:${tokenKey("1", entry.l1_token_address)}`;
  for (const entry of reads) {
    claims.set(claimKey(entry), (claims.get(claimKey(entry)) ?? 0) + 1);
  }
  return {
    links: reads.filter((entry) => claims.get(claimKey(entry)) === 1),
    ambiguous: reads.filter((entry) => claims.get(claimKey(entry))! > 1),
  };
}

function selectableTokens(tokens: Token[], chainId: string): string[] {
  return tokens
    .filter(
      (token) =>
        token.chain_id === chainId &&
        token.visibility_priority >= 0 &&
        BigInt(token.token_address) !== 0n,
    )
    .map((token) => token.token_address);
}

const document = JSON.parse(
  await readFile(resolve(root, "tokens.json"), "utf8"),
) as TokenListDocument;
const ethereumTokens = new Set(
  document.tokens
    .filter((token) => token.chain_id === "1")
    .map((token) => tokenKey("1", token.token_address)),
);
// `--chains 57073,480` rereads only those chains and keeps the rest of the
// existing snapshot.
const onlyChains = process.argv.includes("--chains")
  ? new Set(process.argv[process.argv.indexOf("--chains") + 1]!.split(","))
  : null;
const reads: BridgeRead[] = [];
if (onlyChains) {
  const previous = JSON.parse(
    await readFile(resolve(root, "bridge-reads.json"), "utf8"),
  ) as { links: BridgeRead[]; ambiguous: BridgeRead[] };
  reads.push(
    ...[...previous.links, ...previous.ambiguous].filter(
      (entry) => !onlyChains.has(entry.chain_id),
    ),
  );
}
for (const chain of BRIDGE_READ_CHAINS) {
  if (onlyChains && !onlyChains.has(chain.chainId)) continue;
  const tokens = selectableTokens(document.tokens, chain.chainId);
  let found: BridgeRead[];
  try {
    found = await READERS[chain.kind](chain, tokens);
  } catch (error) {
    // A chain that cannot be read is left out of this snapshot; say so.
    console.warn(`Skipping ${chain.bridgeName}: ${String(error)}`);
    continue;
  }
  console.log(
    `${chain.bridgeName}: ${found.length} of ${tokens.length} selectable tokens map to an Ethereum token`,
  );
  reads.push(...found);
}
const { links, ambiguous } = splitAmbiguous(reads);
const listed = links.filter((entry) =>
  ethereumTokens.has(tokenKey("1", entry.l1_token_address)) ||
  BigInt(entry.l1_token_address) === 0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeen,
);
await writeFile(
  resolve(root, "bridge-reads.json"),
  `${JSON.stringify(
    { read_at: new Date().toISOString(), links: listed, ambiguous },
    null,
    2,
  )}\n`,
);
console.log(
  `Wrote ${listed.length} bridge reads (${links.length - listed.length} to unlisted Ethereum tokens skipped, ${ambiguous.length} ambiguous)`,
);
