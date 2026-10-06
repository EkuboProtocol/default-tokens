// Generates jurisdiction-policy/ekubo-token-jurisdictions-v2.json, the token
// jurisdiction policy (EKU-853, CLO 2026-10-06) vendored byte-for-byte into
// ekubo-mcp-server (src/jurisdiction-policy.json) and the interface
// (src/util/common/jurisdictionPolicy.json). The country lists are a minimum
// product-policy floor, not a legal determination.
//
//   bun scripts/jurisdiction-policy.ts --observed-at <ISO-8601> \
//     --issuer <rhj-assets.json> \
//     --curated <curated-tokens.json> --curated-commit <sha> \
//     [--legacy <file> --legacy-ref <ref>]
//
// Class membership is monotone: every address already classified stays
// classified, with the provenance it was first observed with, so an asset that
// disappears from a source remains restricted until the CLO reclassifies it.
// New issuer-registry or curated listings are added.
//
//   bun scripts/jurisdiction-policy.ts --check [--issuer <file>]
//
// Fetches (or reads) the live issuer registry and exits non-zero when it lists
// a chain-4663 asset the policy does not classify, an asset the policy places
// outside the class, or a deployment on any other chain. That is change
// detection, not a permission: consumers hold unclassified assets.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CLASSIFIED_CHAIN_ID as CHAIN_ID,
  JURISDICTION_POLICY_PATH,
  JURISDICTION_POLICY_VERSION as POLICY_VERSION,
  type Provenance,
  type PolicyEntry,
} from "../src/jurisdiction-policy";

const POLICY_PATH = resolve(import.meta.dir, "..", JURISDICTION_POLICY_PATH);
const ISSUER_REGISTRY_URL = "https://api.robinhood.com/rhj/assets";
const ISSUER_CONTRACTS_PAGE = "https://docs.robinhood.com/chain/contracts";

// EKU-853 (CLO, 2026-10-06). Both sides; no disposal exemption.
const OFFERING_EXCLUSIONS = ["AE", "CA", "CH", "GB", "SG", "US"];
const ISSUER_PROHIBITED_INVESTOR = [
  "BY", "CU", "IR", "KP", "MM", "RU", "SD", "SS", "SY", "UA", "VE",
];

// Exact addresses verified as not RHJ products (contract §2.2). Adding one
// needs on-chain verification and CTO sign-off on the PR.
const NON_CLASS: PolicyEntry[] = [
  {
    address: "0x0000000000000000000000000000000000000000",
    symbol: "ETH",
    provenance: [
      { source: "native", ref: "chain 4663 native currency", observed_at: "2026-10-06" },
    ],
  },
  {
    address: "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
    symbol: "WETH",
    provenance: [
      { source: "issuer-token-contracts-page", ref: ISSUER_CONTRACTS_PAGE, observed_at: "2026-10-06" },
      {
        source: "onchain-verification",
        ref: "rpc.mainnet.chain.robinhood.com block 81631410; artifacts/eku-856/weth-verification.txt",
        observed_at: "2026-10-06T12:30:28Z",
      },
    ],
  },
  {
    address: "0x570c5aa79c798e7a418412cc8399ae5bcce570c5",
    symbol: "STONX",
    provenance: [
      { source: "ekubo-issued", ref: "EKU-853 CLO decision 4f77cad3", observed_at: "2026-10-06" },
    ],
  },
  {
    address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
    symbol: "USDG",
    provenance: [
      { source: "issuer-token-contracts-page", ref: ISSUER_CONTRACTS_PAGE, observed_at: "2026-10-06" },
    ],
  },
];

type Options = Record<string, string | true>;

interface IssuerRegistry {
  assets: Map<string, string>;
  otherChains: string[];
}

interface PolicyFile {
  chains: Record<string, { non_class: PolicyEntry[]; rhj_stock_token: PolicyEntry[] }>;
}

function args(): Options {
  const out: Options = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]!;
    if (!key.startsWith("--")) throw new Error(`unexpected argument ${key}`);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key.slice(2)] = true;
    else out[key.slice(2)] = argv[++i]!;
  }
  return out;
}

const lower = (address: string): string => {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error(`bad address ${address}`);
  return address.toLowerCase();
};

const sha256 = (bytes: Buffer | string): string =>
  createHash("sha256").update(bytes).digest("hex");

function parseIssuer(bytes: Buffer): IssuerRegistry {
  const parsed = JSON.parse(bytes.toString("utf8")) as {
    assets?: {
      tokenSymbol: string;
      deployments?: { chainId: string | number; contractAddress: string }[];
    }[];
  };
  if (!Array.isArray(parsed.assets)) throw new Error("issuer registry: no assets array");
  const deployments = parsed.assets.flatMap((asset) =>
    (asset.deployments ?? []).map((deployment) => ({
      chainId: String(deployment.chainId),
      address: lower(deployment.contractAddress),
      symbol: asset.tokenSymbol,
    })),
  );
  return {
    assets: new Map(
      deployments
        .filter((deployment) => deployment.chainId === CHAIN_ID)
        .map((deployment) => [deployment.address, deployment.symbol]),
    ),
    otherChains: deployments
      .filter((deployment) => deployment.chainId !== CHAIN_ID)
      .map((deployment) => `${deployment.symbol} ${deployment.chainId}:${deployment.address}`),
  };
}

async function readIssuer(path: string | true | undefined): Promise<Buffer> {
  if (typeof path === "string") return readFileSync(path);
  const response = await fetch(ISSUER_REGISTRY_URL);
  if (!response.ok) throw new Error(`issuer registry: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

// A missing file starts an empty class; a file that exists but does not parse
// must stop generation, or the monotone carry-over would silently drop members.
function existingPolicy(): PolicyFile | undefined {
  if (!existsSync(POLICY_PATH)) return undefined;
  return JSON.parse(readFileSync(POLICY_PATH, "utf8")) as PolicyFile;
}

async function check(options: Options): Promise<void> {
  const chain = existingPolicy()?.chains[CHAIN_ID];
  if (!chain) throw new Error(`${POLICY_PATH} has no chain ${CHAIN_ID}`);
  const classified = new Set(chain.rhj_stock_token.map((entry) => entry.address));
  const nonClass = new Set(chain.non_class.map((entry) => entry.address));
  const issuer = parseIssuer(await readIssuer(options.issuer));
  const problems = [
    ...[...issuer.assets]
      .filter(([address]) => !classified.has(address) && !nonClass.has(address))
      .map(([address, symbol]) => `unclassified issuer listing: ${symbol} ${address}`),
    ...[...issuer.assets.keys()]
      .filter((address) => nonClass.has(address))
      .map((address) => `issuer lists an address the policy places in non_class: ${address}`),
    ...issuer.otherChains.map((entry) => `issuer deployment outside chain ${CHAIN_ID}: ${entry}`),
  ];
  for (const problem of problems) console.log(problem);
  console.log(
    `issuer registry: ${issuer.assets.size} chain-${CHAIN_ID} assets; policy class: ${chain.rhj_stock_token.length}`,
  );
  if (problems.length > 0) process.exit(1);
}

function requireString(options: Options, name: string): string {
  const value = options[name];
  if (typeof value !== "string") throw new Error(`--${name} is required`);
  return value;
}

// Lines are "<address> [symbol]"; the symbol is used only when no other source
// names the asset. The v1 list is a one-time seed: once it is in the policy
// file, the monotone carry-over keeps it.
function readLegacy(path: string | true | undefined): [string, string | undefined][] {
  if (typeof path !== "string") return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter(([address]) => address)
    .map(([address, symbol]) => [lower(address!), symbol]);
}

interface Observation {
  provenance: Provenance;
  entries: [string, string | undefined][];
}

class ClassBuilder {
  private readonly members = new Map<
    string,
    { symbol: string | undefined; provenance: Map<string, Provenance> }
  >();
  private readonly nonClass = new Set(NON_CLASS.map((entry) => entry.address));

  carry(previous: readonly PolicyEntry[]): void {
    for (const entry of previous) {
      for (const provenance of entry.provenance) {
        this.add(entry.address, entry.symbol, provenance);
      }
    }
  }

  observe({ provenance, entries }: Observation): void {
    for (const [address, symbol] of entries) this.add(address, symbol, provenance);
  }

  build(preferredSymbol: (address: string) => string | undefined): PolicyEntry[] {
    return [...this.members]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([address, entry]) => {
        const symbol = preferredSymbol(address) ?? entry.symbol;
        if (symbol === undefined) throw new Error(`no symbol for ${address}`);
        return {
          address,
          symbol,
          provenance: [...entry.provenance.values()].sort((a, b) =>
            a.source < b.source ? -1 : 1,
          ),
        };
      });
  }

  // The first observation of a source is kept, so regenerating with newer
  // inputs does not rewrite when an address entered the class.
  private add(address: string, symbol: string | undefined, provenance: Provenance): void {
    if (this.nonClass.has(address)) {
      if (provenance.source === "issuer-registry") {
        throw new Error(`issuer registry lists ${address}, which is configured as non_class`);
      }
      return;
    }
    const entry = this.members.get(address) ?? { symbol, provenance: new Map() };
    entry.symbol ??= symbol;
    if (!entry.provenance.has(provenance.source)) {
      entry.provenance.set(provenance.source, provenance);
    }
    this.members.set(address, entry);
  }
}

function readCurated(path: string): { bytes: Buffer; tokens: Map<string, string> } {
  const bytes = readFileSync(path);
  const document = JSON.parse(bytes.toString("utf8")) as {
    tokens: { chain_id: string; token_address: string; token_symbol: string }[];
  };
  const tokens = new Map(
    document.tokens
      .filter((token) => String(token.chain_id) === CHAIN_ID)
      .map((token) => [lower(token.token_address), token.token_symbol] as const),
  );
  return { bytes, tokens };
}

async function generate(options: Options): Promise<void> {
  const observedAt = requireString(options, "observed-at");
  const curatedCommit = requireString(options, "curated-commit");
  const issuerBytes = await readIssuer(requireString(options, "issuer"));
  const issuer = parseIssuer(issuerBytes);
  const curated = readCurated(requireString(options, "curated"));
  const nonClass = new Set(NON_CLASS.map((entry) => entry.address));

  const builder = new ClassBuilder();
  builder.carry(existingPolicy()?.chains[CHAIN_ID]?.rhj_stock_token ?? []);
  builder.observe({
    provenance: {
      source: "v1-list",
      ref: typeof options["legacy-ref"] === "string" ? options["legacy-ref"] : "ekubo-token-jurisdictions-v1",
      observed_at: observedAt,
    },
    entries: readLegacy(options.legacy),
  });
  builder.observe({
    provenance: {
      source: "issuer-registry",
      ref: `${ISSUER_REGISTRY_URL} sha256:${sha256(issuerBytes)}`,
      observed_at: observedAt,
    },
    entries: [...issuer.assets],
  });
  builder.observe({
    provenance: {
      source: "curated-tokens",
      ref: `EkuboProtocol/default-tokens@${curatedCommit}:curated-tokens.json sha256:${sha256(curated.bytes)}`,
      observed_at: observedAt,
    },
    entries: [...curated.tokens].filter(([address]) => !nonClass.has(address)),
  });
  const members = builder.build(
    (address) => issuer.assets.get(address) ?? curated.tokens.get(address),
  );

  const policy = {
    policy_version: POLICY_VERSION,
    decision: "EKU-853 (CLO, 2026-10-06)",
    note: "A minimum product-policy floor, not a legal determination.",
    classes: {
      rhj_stock_token: {
        description:
          "Robinhood Assets (Jersey) Limited Stock Tokens: tokenised debt securities tracking equities or ETFs, identified by chain ID and exact contract address.",
        sides: ["buy", "sell"],
        offering_exclusions: OFFERING_EXCLUSIONS,
        issuer_prohibited_investor: ISSUER_PROHIBITED_INVESTOR,
      },
    },
    chains: {
      [CHAIN_ID]: {
        unknown: "hold",
        non_class: NON_CLASS,
        rhj_stock_token: members,
      },
    },
  };
  const text = `${JSON.stringify(policy, null, 2)}\n`;
  writeFileSync(POLICY_PATH, text);
  console.log(`wrote ${POLICY_PATH}: ${members.length} class members, sha256 ${sha256(text)}`);
}

const options = args();
await (options.check ? check(options) : generate(options));
