import {
  CANONICAL_ETH_ROLLUPS,
  CIRCLE_BLOCKCHAIN_CHAIN_IDS,
  ETHEREUM_WETH,
  NATIVE_ETH_BRIDGE_SOURCE_NAME,
  SUPERCHAIN_TOKEN_LIST,
} from "./sources";
import {
  bridgeRelationshipKey,
  normalizeTokenAddress,
  parseInteger,
  tokenKey,
} from "./token-list";
import type {
  BridgeLinkLabel,
  BridgeRelationship,
  BridgeRelationshipKind,
  StandardTokenList,
  StandardTokenListToken,
  Token,
  TokenSource,
} from "./types";

const ADDRESS_REGEX = /^0x[a-fA-F0-9]+$/;

export type LinkSource = { name: string; url: string };

export type BridgeConflict = {
  key: string;
  kept: BridgeRelationship;
  rejected: BridgeRelationship;
};

// A link that has every provenance field set.
export type ProvenancedLink = BridgeRelationship &
  Required<Pick<BridgeRelationship, "relationship" | "source_name" | "source_url">>;

function link(
  source: LinkSource,
  label: BridgeLinkLabel,
  fields: Pick<
    BridgeRelationship,
    | "source_chain_id"
    | "source_token_address"
    | "dest_chain_id"
    | "dest_token_address"
  > & { source_bridge_address?: string | null },
): ProvenancedLink {
  return {
    ...fields,
    source_bridge_address: fields.source_bridge_address ?? null,
    relationship: label.relationship,
    bridge_name: label.bridgeName,
    source_name: source.name,
    source_url: source.url,
  };
}

function sameToken(
  chainId: string,
  left: string,
  right: string,
): boolean {
  return tokenKey(chainId, left) === tokenKey(chainId, right);
}

/**
 * Collects directed links. One link per source token and destination chain;
 * the first source to claim that key wins, and a later claim naming a
 * different counterpart is recorded as a conflict instead of overwriting it.
 */
export class BridgeCollector {
  readonly links = new Map<string, ProvenancedLink>();
  readonly conflicts: BridgeConflict[] = [];
  readonly droppedMissingEndpoint: Record<string, number> = {};
  selfLinks = 0;

  // With `tokenKeys`, a link is accepted only when both of its tokens are in
  // the list, so a link to an unlisted token cannot win a key over a later,
  // usable claim.
  constructor(private readonly tokenKeys?: Set<string>) {}

  add(candidate: ProvenancedLink): boolean {
    const normalized = normalizeLink(candidate);
    if (!normalized) return false;
    if (
      parseInteger(normalized.source_chain_id, "chain ID") ===
      parseInteger(normalized.dest_chain_id, "chain ID")
    ) {
      this.selfLinks += 1;
      return false;
    }
    if (!this.hasEndpoints(normalized)) {
      this.droppedMissingEndpoint[normalized.source_name] =
        (this.droppedMissingEndpoint[normalized.source_name] ?? 0) + 1;
      return false;
    }
    const key = bridgeRelationshipKey(normalized);
    const existing = this.links.get(key);
    if (!existing) {
      this.links.set(key, normalized);
      return true;
    }
    if (
      !sameToken(
        existing.dest_chain_id,
        existing.dest_token_address,
        normalized.dest_token_address,
      )
    ) {
      this.conflicts.push({ key, kept: existing, rejected: normalized });
    }
    return false;
  }

  private hasEndpoints(relationship: BridgeRelationship): boolean {
    if (!this.tokenKeys) return true;
    return (
      this.tokenKeys.has(
        tokenKey(relationship.source_chain_id, relationship.source_token_address),
      ) &&
      this.tokenKeys.has(
        tokenKey(relationship.dest_chain_id, relationship.dest_token_address),
      )
    );
  }

  addAll(candidates: Iterable<ProvenancedLink>): number {
    let added = 0;
    for (const candidate of candidates) added += Number(this.add(candidate));
    return added;
  }
}

function normalizeLink(candidate: ProvenancedLink): ProvenancedLink | null {
  const sourceAddress = normalizeTokenAddress(
    candidate.source_token_address,
    candidate.source_chain_id,
  );
  const destinationAddress = normalizeTokenAddress(
    candidate.dest_token_address,
    candidate.dest_chain_id,
  );
  if (!sourceAddress || !destinationAddress) return null;
  try {
    parseInteger(candidate.source_chain_id, "chain ID");
    parseInteger(candidate.dest_chain_id, "chain ID");
  } catch {
    return null;
  }
  const bridge = candidate.source_bridge_address;
  return {
    ...candidate,
    source_token_address: sourceAddress,
    dest_token_address: destinationAddress,
    source_bridge_address: bridge && ADDRESS_REGEX.test(bridge) ? bridge : null,
  };
}

function listTokens(list: StandardTokenList): StandardTokenListToken[] {
  return Array.isArray(list?.tokens) ? list.tokens : [];
}

// Standard `extensions.bridgeInfo`: destination chain ID -> { tokenAddress }.
export function standardBridgeInfoLinks(
  list: StandardTokenList,
  source: TokenSource & { bridgeInfo: BridgeLinkLabel },
): ProvenancedLink[] {
  const links: ProvenancedLink[] = [];
  for (const token of listTokens(list)) {
    for (const [destinationChainId, info] of Object.entries(
      token.extensions?.bridgeInfo ?? {},
    )) {
      if (typeof info !== "object" || !info?.tokenAddress) continue;
      links.push(
        link(source, source.bridgeInfo, {
          source_chain_id: String(token.chainId),
          source_token_address: token.address,
          source_bridge_address: info.originBridgeAddress ?? null,
          dest_chain_id: destinationChainId,
          dest_token_address: info.tokenAddress,
        }),
      );
    }
  }
  return links;
}

const INTEROPERABILITY_PROTOCOLS = [
  "layerzero",
  "wormhole",
  "chainlink ccip",
  "hyperlane",
  "axelar",
  "m0 portal",
];

// The Monad list names the protocol a token moves over in
// `bridgeInfo.protocol`. Every protocol it uses is an interoperability
// protocol; a token without one gives no hint, so its links are `unknown`.
export function crossChainLabel(token: StandardTokenListToken): BridgeLinkLabel {
  const protocol = token.extensions?.bridgeInfo?.protocol;
  if (typeof protocol !== "string" || !protocol.trim()) {
    return { relationship: "unknown", bridgeName: null };
  }
  const normalized = protocol.trim().toLowerCase();
  const relationship: BridgeRelationshipKind = INTEROPERABILITY_PROTOCOLS.some(
    (name) => normalized.startsWith(name),
  )
    ? "interoperability"
    : "unknown";
  return { relationship, bridgeName: protocol.trim() };
}

// `extensions.crossChainAddresses`: chain ID -> { address }.
export function crossChainAddressLinks(
  list: StandardTokenList,
  source: LinkSource,
): ProvenancedLink[] {
  const links: ProvenancedLink[] = [];
  for (const token of listTokens(list)) {
    const label = crossChainLabel(token);
    for (const [destinationChainId, counterpart] of Object.entries(
      token.extensions?.crossChainAddresses ?? {},
    )) {
      if (!counterpart?.address) continue;
      links.push(
        link(source, label, {
          source_chain_id: String(token.chainId),
          source_token_address: token.address,
          dest_chain_id: destinationChainId,
          dest_token_address: counterpart.address,
        }),
      );
    }
  }
  return links;
}

function bothDirections(
  forward: ProvenancedLink,
  reverseBridge: string | null,
): ProvenancedLink[] {
  return [
    forward,
    {
      ...forward,
      source_chain_id: forward.dest_chain_id,
      source_token_address: forward.dest_token_address,
      source_bridge_address: reverseBridge,
      dest_chain_id: forward.source_chain_id,
      dest_token_address: forward.source_token_address,
    },
  ];
}

function superchainBridgeFor(
  token: StandardTokenListToken,
): { prefix: string; address: string } | null {
  for (const prefix of Object.keys(SUPERCHAIN_TOKEN_LIST.chainIdsByPrefix)) {
    const address = token.extensions?.[`${prefix}BridgeAddress`];
    if (typeof address === "string" && ADDRESS_REGEX.test(address)) {
      if (SUPERCHAIN_TOKEN_LIST.chainIdsByPrefix[prefix] === String(token.chainId)) {
        return { prefix, address };
      }
    }
  }
  return null;
}

function groupByOpTokenId(
  list: StandardTokenList,
): Map<string, StandardTokenListToken[]> {
  const groups = new Map<string, StandardTokenListToken[]>();
  for (const token of listTokens(list)) {
    const id = token.extensions?.opTokenId;
    if (typeof id !== "string") continue;
    const group = groups.get(id) ?? [];
    group.push(token);
    groups.set(id, group);
  }
  return groups;
}

const OP_STANDARD_BRIDGE = 0x4200000000000000000000000000000000000010n;

function superchainBridgeName(prefix: string, l2Bridge: string): string {
  const chain = prefix[0]!.toUpperCase() + prefix.slice(1);
  return BigInt(l2Bridge) === OP_STANDARD_BRIDGE
    ? `${chain} standard bridge`
    : `${chain} custom bridge`;
}

// Link the Ethereum entry of each Superchain asset to every L2 entry that
// records the bridge it was minted by. L2 entries without a bridge extension
// (USDC, WETH) are native deployments the list does not describe as bridged.
export function superchainLinks(
  list: StandardTokenList,
  source: LinkSource = SUPERCHAIN_TOKEN_LIST,
): ProvenancedLink[] {
  const links: ProvenancedLink[] = [];
  for (const group of groupByOpTokenId(list).values()) {
    const l1 = group.find((token) => String(token.chainId) === "1");
    if (!l1) continue;
    for (const l2 of group) {
      const bridge = superchainBridgeFor(l2);
      if (!bridge) continue;
      const l1Bridge = l1.extensions?.[`${bridge.prefix}BridgeAddress`];
      const forward = link(
        source,
        {
          relationship: "canonical_bridge",
          bridgeName: superchainBridgeName(bridge.prefix, bridge.address),
        },
        {
          source_chain_id: "1",
          source_token_address: l1.address,
          source_bridge_address: typeof l1Bridge === "string" ? l1Bridge : null,
          dest_chain_id: String(l2.chainId),
          dest_token_address: l2.address,
        },
      );
      links.push(...bothDirections(forward, bridge.address));
    }
  }
  return links;
}

export type StarknetBridgeToken = {
  l1_token_address?: string;
  l1_bridge_address?: string | null;
  l2_bridge_address?: string | null;
  l2_token_address?: string;
};

export function starkgateLinks(
  tokens: StarknetBridgeToken[],
  source: LinkSource & { l1ChainId: bigint; l2ChainId: bigint },
): ProvenancedLink[] {
  const links: ProvenancedLink[] = [];
  for (const token of tokens) {
    if (!token.l1_token_address || !token.l2_token_address) continue;
    const forward = link(
      source,
      { relationship: "canonical_bridge", bridgeName: "StarkGate" },
      {
        source_chain_id: source.l1ChainId.toString(),
        source_token_address: token.l1_token_address,
        source_bridge_address: token.l1_bridge_address ?? null,
        dest_chain_id: source.l2ChainId.toString(),
        dest_token_address: token.l2_token_address,
      },
    );
    links.push(...bothDirections(forward, token.l2_bridge_address ?? null));
  }
  return links;
}

// Rows of Circle's mainnet table: | Blockchain | [`0x…`](explorer) |
const CIRCLE_ROW = /^\|\s*([^|]+?)\s*\|\s*\[?`(0x[0-9a-fA-F]+)`/;

export function parseCircleRegistry(markdown: string): Map<string, string> {
  const mainnet = markdown.split(/^## Testnet/m)[0] ?? "";
  const deployments = new Map<string, string>();
  for (const line of mainnet.split("\n")) {
    const match = CIRCLE_ROW.exec(line);
    if (!match) continue;
    const chainId = CIRCLE_BLOCKCHAIN_CHAIN_IDS[match[1]!];
    if (chainId) deployments.set(chainId, match[2]!);
  }
  if (!deployments.has("1")) {
    throw new Error("Circle registry has no Ethereum mainnet row");
  }
  return deployments;
}

// The issuer's own deployments are the same asset on every pair of chains.
export function issuerLinks(
  deployments: Map<string, string>,
  source: LinkSource,
  issuer: string,
): ProvenancedLink[] {
  const links: ProvenancedLink[] = [];
  const label: BridgeLinkLabel = {
    relationship: "native_issuer",
    bridgeName: issuer,
  };
  for (const [sourceChainId, sourceAddress] of deployments) {
    for (const [destinationChainId, destinationAddress] of deployments) {
      if (sourceChainId === destinationChainId) continue;
      links.push(
        link(source, label, {
          source_chain_id: sourceChainId,
          source_token_address: sourceAddress,
          dest_chain_id: destinationChainId,
          dest_token_address: destinationAddress,
        }),
      );
    }
  }
  return links;
}

export function nativeEthLinks(): ProvenancedLink[] {
  const links: ProvenancedLink[] = [];
  for (const rollup of CANONICAL_ETH_ROLLUPS) {
    const source = { name: NATIVE_ETH_BRIDGE_SOURCE_NAME, url: rollup.evidence };
    const label: BridgeLinkLabel = {
      relationship: "canonical_bridge",
      bridgeName: rollup.bridge,
    };
    const fields = {
      source_chain_id: "1",
      source_token_address: "0x0",
      dest_chain_id: rollup.chainId,
      dest_token_address: "0x0",
    };
    links.push(...bothDirections(link(source, label, fields), null));
    if (rollup.wrappedEth) {
      const wrapped = {
        ...fields,
        source_token_address: ETHEREUM_WETH,
        dest_token_address: rollup.wrappedEth,
      };
      links.push(...bothDirections(link(source, label, wrapped), null));
    }
  }
  return links;
}

export function linksFromTokenList(
  list: StandardTokenList,
  source: TokenSource,
): ProvenancedLink[] {
  const links: ProvenancedLink[] = [];
  if (source.bridgeInfo) {
    links.push(
      ...standardBridgeInfoLinks(list, {
        ...source,
        bridgeInfo: source.bridgeInfo,
      }),
    );
  }
  if (source.crossChainAddresses) {
    links.push(...crossChainAddressLinks(list, source));
  }
  return links;
}

// Links whose source was skipped this run come back from the previous output
// so an outage does not delete them, as with skipped token sources.
export function restorePreviousLinks(
  collector: BridgeCollector,
  previous: BridgeRelationship[],
  skippedSourceNames: string[],
): number {
  const skipped = new Set(skippedSourceNames);
  let restored = 0;
  for (const relationship of previous) {
    if (!relationship.source_name || !skipped.has(relationship.source_name)) {
      continue;
    }
    restored += Number(collector.add(relationship as ProvenancedLink));
  }
  return restored;
}

export type BridgeQualityReport = {
  links: number;
  droppedMissingEndpoint: Record<string, number>;
  selfLinksDropped: number;
  inferredReverses: number;
  nonReciprocal: number;
  byRelationship: Record<string, number>;
  conflicts: BridgeConflict[];
  competingCounterparts: CompetingCounterparts[];
};

export type CompetingCounterparts = {
  relationship: BridgeRelationshipKind;
  source_chain_id: string;
  dest_chain_id: string;
  dest_token_address: string;
  source_token_addresses: string[];
};

function reverseKey(relationship: BridgeRelationship): string {
  return bridgeRelationshipKey({
    ...relationship,
    source_chain_id: relationship.dest_chain_id,
    source_token_address: relationship.dest_token_address,
    dest_chain_id: relationship.source_chain_id,
  });
}

function isReciprocated(
  relationship: BridgeRelationship,
  links: Map<string, ProvenancedLink>,
): boolean {
  const reverse = links.get(reverseKey(relationship));
  return (
    reverse !== undefined &&
    sameToken(
      relationship.source_chain_id,
      reverse.dest_token_address,
      relationship.source_token_address,
    )
  );
}

// Every kind of link describes the same asset in both directions, so a link
// whose reverse key is free gets the mirrored link, marked as inferred.
function addInferredReverses(links: Map<string, ProvenancedLink>): number {
  let added = 0;
  for (const relationship of [...links.values()]) {
    const key = reverseKey(relationship);
    if (links.has(key)) continue;
    links.set(key, {
      ...relationship,
      source_chain_id: relationship.dest_chain_id,
      source_token_address: relationship.dest_token_address,
      source_bridge_address: null,
      dest_chain_id: relationship.source_chain_id,
      dest_token_address: relationship.source_token_address,
      inferred_reverse: true,
    });
    added += 1;
  }
  return added;
}

// Two different tokens on one chain that both claim, with the same
// canonical or issuer relationship, to be the counterpart of one token on
// another chain. A canonical copy beside an issuer deployment (USDC.e beside
// USDC) is expected and not reported.
export function findCompetingCounterparts(
  links: Iterable<ProvenancedLink>,
): CompetingCounterparts[] {
  const groups = new Map<string, CompetingCounterparts>();
  for (const relationship of links) {
    if (
      relationship.relationship !== "canonical_bridge" &&
      relationship.relationship !== "native_issuer"
    ) {
      continue;
    }
    const key = [
      relationship.relationship,
      parseInteger(relationship.source_chain_id, "chain ID"),
      tokenKey(relationship.dest_chain_id, relationship.dest_token_address),
    ].join(":");
    const group = groups.get(key) ?? {
      relationship: relationship.relationship,
      source_chain_id: relationship.source_chain_id,
      dest_chain_id: relationship.dest_chain_id,
      dest_token_address: relationship.dest_token_address,
      source_token_addresses: [],
    };
    group.source_token_addresses.push(relationship.source_token_address);
    groups.set(key, group);
  }
  return [...groups.values()].filter(
    (group) => group.source_token_addresses.length > 1,
  );
}

function countBy(
  links: Iterable<ProvenancedLink>,
  field: (link: ProvenancedLink) => string,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const relationship of links) {
    const value = field(relationship);
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

/**
 * Turn collected links into the published list: mirror one-directional
 * links, and report what was dropped and what remains unreciprocated or
 * contested.
 */
export function finalizeBridgeLinks(collector: BridgeCollector): {
  relationships: ProvenancedLink[];
  report: BridgeQualityReport;
} {
  const links = new Map(collector.links);
  const inferredReverses = addInferredReverses(links);
  const relationships = [...links.values()].sort(compareLinks);
  return {
    relationships,
    report: {
      links: relationships.length,
      droppedMissingEndpoint: collector.droppedMissingEndpoint,
      selfLinksDropped: collector.selfLinks,
      inferredReverses,
      nonReciprocal: relationships.filter(
        (relationship) => !isReciprocated(relationship, links),
      ).length,
      byRelationship: countBy(relationships, (link) => link.relationship),
      conflicts: collector.conflicts,
      competingCounterparts: findCompetingCounterparts(relationships),
    },
  };
}

function compareLinks(left: BridgeRelationship, right: BridgeRelationship): number {
  const leftKey = bridgeRelationshipKey(left).split(":").map(BigInt);
  const rightKey = bridgeRelationshipKey(right).split(":").map(BigInt);
  for (let index = 0; index < leftKey.length; index += 1) {
    if (leftKey[index]! !== rightKey[index]!) {
      return leftKey[index]! < rightKey[index]! ? -1 : 1;
    }
  }
  return 0;
}

export function logBridgeReport(report: BridgeQualityReport): void {
  console.log(
    `Bridge links: ${report.links} published (${JSON.stringify(report.byRelationship)}), ${report.inferredReverses} inferred reverses, ${report.nonReciprocal} without a reciprocal link, ${report.selfLinksDropped} self-links dropped`,
  );
  console.log(
    `Bridge links dropped because an endpoint is not in the list: ${JSON.stringify(report.droppedMissingEndpoint)}`,
  );
  for (const conflict of report.conflicts) {
    console.warn(
      `Bridge conflict on ${conflict.key}: kept ${conflict.kept.dest_token_address} from ${conflict.kept.source_name}, rejected ${conflict.rejected.dest_token_address} from ${conflict.rejected.source_name}`,
    );
  }
  for (const group of report.competingCounterparts) {
    console.warn(
      `Competing ${group.relationship} counterparts on chain ${group.source_chain_id} for ${group.dest_chain_id}:${group.dest_token_address}: ${group.source_token_addresses.join(", ")}`,
    );
  }
}

export function tokenKeysOf(tokens: Token[]): Set<string> {
  return new Set(
    tokens.map((token) => tokenKey(token.chain_id, token.token_address)),
  );
}
