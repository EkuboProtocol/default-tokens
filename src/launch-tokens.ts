import type { LaunchRecord } from "./launch-api";
import { checksumIfConsistent } from "./keccak";
import { validateTokenListSchema } from "./schema";
import {
  LAUNCH_SOURCE,
  NATIVE_CURRENCIES,
  STARKNET_MAINNET_CHAIN_ID,
} from "./sources";
import {
  TokenAccumulator,
  normalizeTokenAddress,
  tokenKey,
  validateTokenList,
} from "./token-list";
import type { Token, TokenListDocument, TokenProvenance } from "./types";

// Every zero-seed launch token has 18 decimals, and its name and symbol are
// Solady `LibString.packOne` bytes32 values: 1 to 31 bytes of content.
export const LAUNCH_TOKEN_DECIMALS = 18;
const MAX_METADATA_BYTES = 31;
// Launches are permissionless, like onchain token registrations, so they are
// listed the same way: searchable, never shown in a picker by default.
export const LAUNCH_VISIBILITY_PRIORITY = -1;
export const LAUNCH_SORT_ORDER = -1;
export const MAX_LOGO_URL_LENGTH = 2048;

const CANONICAL_DECIMAL = /^(0|[1-9][0-9]*)$/;
const POOL_ID = /^0x[0-9a-fA-F]{64}$/;
const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
// Controls, invisible format characters (bidi overrides, zero-width joiners,
// the BOM), private-use and lone surrogate code points, line separators, and
// U+FFFD, which marks bytes that did not decode as UTF-8.
const UNSAFE_TEXT = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}\uFFFD]/u;
const UNSAFE_URL_TEXT = /[\s\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}]/u;
const PRIVATE_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".arpa",
  ".lan",
  ".home",
];

export type LaunchRejection =
  | "invalid_chain_id"
  | "chain_not_enabled"
  | "invalid_pool_id"
  | "invalid_token_address"
  | "invalid_address_checksum"
  | "zero_token_address"
  | "invalid_decimals"
  | "invalid_name"
  | "invalid_symbol"
  | "status_not_listable";

export type LogoRejection =
  | "logo_not_string"
  | "logo_too_long"
  | "logo_unsafe_characters"
  | "logo_not_url"
  | "logo_not_https"
  | "logo_has_credentials"
  | "logo_has_port"
  | "logo_private_host";

export type LaunchJobConfig = {
  chainIds: ReadonlySet<string>;
  listableStatuses: ReadonlySet<string>;
};

export type LaunchCandidate = {
  poolId: string;
  token: Token;
  logoRejection: LogoRejection | null;
};

type Validation =
  | { candidate: LaunchCandidate }
  | { poolId: string | null; rejection: LaunchRejection };

type ReportEntry = {
  chain_id: string;
  token_address: string;
  pool_id: string;
};

export type SkipReason =
  | "curated"
  | "existing_entry"
  | "conflicts_with_recorded"
  | "conflicting_records"
  | "duplicate_record";

export type LaunchReport = {
  added: (ReportEntry & {
    token_name: string;
    token_symbol: string;
    logo_url: string | null;
  })[];
  unchanged: ReportEntry[];
  skipped: (ReportEntry & { reason: SkipReason; source?: string })[];
  rejected: { pool_id: string | null; reason: LaunchRejection }[];
  logo_rejected: (ReportEntry & { reason: LogoRejection })[];
};

export type LaunchPlan = {
  document: TokenListDocument;
  report: LaunchReport;
};

export function launchJobConfig(
  chainIds: readonly string[],
  listableStatuses: readonly string[],
): LaunchJobConfig {
  const listed = new Set(NATIVE_CURRENCIES.map((native) => native.chainId));
  for (const chainId of chainIds) {
    if (!CANONICAL_DECIMAL.test(chainId) || !listed.has(chainId)) {
      throw new Error(
        `Launch chain ${chainId} is not a decimal chain ID in NATIVE_CURRENCIES`,
      );
    }
    if (BigInt(chainId) === STARKNET_MAINNET_CHAIN_ID) {
      throw new Error("Zero-seed launches are EVM only");
    }
  }
  return {
    chainIds: new Set(chainIds),
    listableStatuses: new Set(listableStatuses),
  };
}

export function emptyLaunchTokenDocument(): TokenListDocument {
  return {
    $schema: "./token-list.schema.json",
    tokens: [],
    bridge_relationships: [],
  };
}

function isLaunchMetadata(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= MAX_METADATA_BYTES &&
    value.trim() === value &&
    !UNSAFE_TEXT.test(value)
  );
}

function isPrivateHost(hostname: string): boolean {
  return (
    hostname.startsWith("[") ||
    /^[0-9.]+$/.test(hostname) ||
    !hostname.includes(".") ||
    hostname === "localhost" ||
    PRIVATE_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  );
}

function urlRejection(url: URL): LogoRejection | null {
  if (url.protocol !== "https:") return "logo_not_https";
  if (url.username !== "" || url.password !== "") {
    return "logo_has_credentials";
  }
  if (url.port !== "") return "logo_has_port";
  if (isPrivateHost(url.hostname.replace(/\.$/, ""))) {
    return "logo_private_host";
  }
  if (url.href.length > MAX_LOGO_URL_LENGTH) return "logo_too_long";
  return null;
}

/**
 * The launch's logo as a source URL for the existing logo-hosting step, or a
 * reason to drop it. The URL is creator-supplied display data: it is only
 * ever handed to Cloudflare Images (and the runner's download fallback) as an
 * image source, so anything that could reach a local or private address, or
 * smuggle credentials or invisible characters, is refused here.
 */
export function readLaunchLogo(value: unknown): {
  url: string | null;
  rejection: LogoRejection | null;
} {
  if (value === undefined || value === null || value === "") {
    return { url: null, rejection: null };
  }
  if (typeof value !== "string") {
    return { url: null, rejection: "logo_not_string" };
  }
  if (value.length > MAX_LOGO_URL_LENGTH) {
    return { url: null, rejection: "logo_too_long" };
  }
  if (UNSAFE_URL_TEXT.test(value)) {
    return { url: null, rejection: "logo_unsafe_characters" };
  }
  if (!URL.canParse(value)) return { url: null, rejection: "logo_not_url" };
  const url = new URL(value);
  const rejection = urlRejection(url);
  return rejection ? { url: null, rejection } : { url: url.href, rejection };
}

export function readLaunchAddress(
  value: unknown,
): { address: string } | { rejection: LaunchRejection } {
  if (typeof value !== "string" || !HEX_ADDRESS.test(value)) {
    return { rejection: "invalid_token_address" };
  }
  if (normalizeTokenAddress(value, "1") === "0x0") {
    return { rejection: "zero_token_address" };
  }
  const checksummed = checksumIfConsistent(value);
  return checksummed === null
    ? { rejection: "invalid_address_checksum" }
    : { address: checksummed };
}

function chainRejection(
  value: unknown,
  config: LaunchJobConfig,
): LaunchRejection | null {
  if (typeof value !== "string" || !CANONICAL_DECIMAL.test(value)) {
    return "invalid_chain_id";
  }
  return config.chainIds.has(value) ? null : "chain_not_enabled";
}

function metadataRejection(
  record: LaunchRecord,
  config: LaunchJobConfig,
): LaunchRejection | null {
  if (record.decimals !== LAUNCH_TOKEN_DECIMALS) return "invalid_decimals";
  if (!isLaunchMetadata(record.name)) return "invalid_name";
  if (!isLaunchMetadata(record.symbol)) return "invalid_symbol";
  if (
    typeof record.status !== "string" ||
    !config.listableStatuses.has(record.status)
  ) {
    return "status_not_listable";
  }
  return null;
}

export function validateLaunch(
  record: LaunchRecord,
  config: LaunchJobConfig,
): Validation {
  const poolId =
    typeof record.poolId === "string" && POOL_ID.test(record.poolId)
      ? record.poolId.toLowerCase()
      : null;
  const chainProblem = chainRejection(record.chainId, config);
  if (chainProblem) return { poolId, rejection: chainProblem };
  if (poolId === null) return { poolId, rejection: "invalid_pool_id" };
  const address = readLaunchAddress(record.tokenAddress);
  if ("rejection" in address) return { poolId, ...address };
  const metadataProblem = metadataRejection(record, config);
  if (metadataProblem) return { poolId, rejection: metadataProblem };

  const logo = readLaunchLogo(record.logoUrl);
  return {
    candidate: {
      poolId,
      logoRejection: logo.rejection,
      token: {
        chain_id: record.chainId as string,
        token_address: address.address,
        token_name: record.name as string,
        token_symbol: record.symbol as string,
        token_decimals: LAUNCH_TOKEN_DECIMALS,
        logo_url: logo.url,
        visibility_priority: LAUNCH_VISIBILITY_PRIORITY,
        sort_order: LAUNCH_SORT_ORDER,
      },
    },
  };
}

function compareTokens(
  a: { chain_id: string; token_address: string },
  b: { chain_id: string; token_address: string },
): number {
  const chain = BigInt(a.chain_id) - BigInt(b.chain_id);
  if (chain !== 0n) return chain < 0n ? -1 : 1;
  const address = BigInt(a.token_address) - BigInt(b.token_address);
  if (address !== 0n) return address < 0n ? -1 : 1;
  return 0;
}

function compareEntries(a: ReportEntry, b: ReportEntry): number {
  return (
    compareTokens(a, b) ||
    a.pool_id.localeCompare(b.pool_id) ||
    JSON.stringify(a).localeCompare(JSON.stringify(b))
  );
}

function entry(candidate: LaunchCandidate): ReportEntry {
  return {
    chain_id: candidate.token.chain_id,
    token_address: candidate.token.token_address,
    pool_id: candidate.poolId,
  };
}

function sameToken(a: Token, b: Token): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Who already lists each chain and address, keyed like `tokenKey`. Curated
 * rows and published rows from any source but the launch file itself take
 * precedence over a launch.
 */
export function existingTokenSources(
  curated: Token[],
  provenance: TokenProvenance[],
): Map<string, string> {
  const sources = new Map<string, string>();
  for (const token of curated) {
    sources.set(tokenKey(token.chain_id, token.token_address), "curated");
  }
  for (const record of provenance) {
    const key = tokenKey(record.chain_id, record.token_address);
    if (record.source_name === LAUNCH_SOURCE.name || sources.has(key)) {
      continue;
    }
    sources.set(key, record.source_name);
  }
  return sources;
}

function groupCandidates(
  candidates: LaunchCandidate[],
): Map<string, LaunchCandidate[]> {
  const groups = new Map<string, LaunchCandidate[]>();
  for (const candidate of candidates) {
    const key = tokenKey(
      candidate.token.chain_id,
      candidate.token.token_address,
    );
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }
  return groups;
}

function emptyReport(): LaunchReport {
  return {
    added: [],
    unchanged: [],
    skipped: [],
    rejected: [],
    logo_rejected: [],
  };
}

type PlanState = {
  report: LaunchReport;
  tokens: Map<string, Token>;
  recorded: Map<string, Token>;
  existing: Map<string, string>;
};

function placeCandidate(
  state: PlanState,
  key: string,
  candidate: LaunchCandidate,
): void {
  const recorded = state.recorded.get(key);
  if (recorded) {
    if (sameToken(recorded, candidate.token)) {
      state.report.unchanged.push(entry(candidate));
    } else {
      state.report.skipped.push({
        ...entry(candidate),
        reason: "conflicts_with_recorded",
      });
    }
    return;
  }
  const source = state.existing.get(key);
  if (source === "curated") {
    state.report.skipped.push({ ...entry(candidate), reason: "curated" });
    return;
  }
  if (source !== undefined) {
    state.report.skipped.push({
      ...entry(candidate),
      reason: "existing_entry",
      source,
    });
    return;
  }
  state.tokens.set(key, candidate.token);
  state.report.added.push({
    ...entry(candidate),
    token_name: candidate.token.token_name,
    token_symbol: candidate.token.token_symbol,
    logo_url: candidate.token.logo_url,
  });
  if (candidate.logoRejection) {
    state.report.logo_rejected.push({
      ...entry(candidate),
      reason: candidate.logoRejection,
    });
  }
}

function placeGroup(
  state: PlanState,
  key: string,
  group: LaunchCandidate[],
): void {
  const identities = new Set(
    group.map((candidate) => JSON.stringify(candidate)),
  );
  if (identities.size > 1) {
    for (const candidate of group) {
      state.report.skipped.push({
        ...entry(candidate),
        reason: "conflicting_records",
      });
    }
    return;
  }
  const [first, ...replays] = group;
  if (!first) return;
  for (const replay of replays) {
    state.report.skipped.push({ ...entry(replay), reason: "duplicate_record" });
  }
  placeCandidate(state, key, first);
}

function sortReport(report: LaunchReport): void {
  report.added.sort(compareEntries);
  report.unchanged.sort(compareEntries);
  report.skipped.sort(compareEntries);
  report.logo_rejected.sort(compareEntries);
  report.rejected.sort(
    (a, b) =>
      (a.pool_id ?? "~").localeCompare(b.pool_id ?? "~") ||
      a.reason.localeCompare(b.reason),
  );
}

/**
 * The launch-token document after this batch of launches, and what happened
 * to each launch. Rows already recorded are kept byte for byte, a launch is
 * never listed over a curated or otherwise published row, and the output is
 * sorted by chain and address, so replaying the same launches is a no-op.
 */
export function planLaunchTokens(options: {
  launches: LaunchRecord[];
  recorded: TokenListDocument;
  existing: Map<string, string>;
  config: LaunchJobConfig;
}): LaunchPlan {
  const state: PlanState = {
    report: emptyReport(),
    tokens: new Map(),
    recorded: new Map(
      options.recorded.tokens.map((token) => [
        tokenKey(token.chain_id, token.token_address),
        token,
      ]),
    ),
    existing: options.existing,
  };
  for (const [key, token] of state.recorded) state.tokens.set(key, token);

  const candidates: LaunchCandidate[] = [];
  for (const record of options.launches) {
    const result = validateLaunch(record, options.config);
    if ("candidate" in result) candidates.push(result.candidate);
    else {
      state.report.rejected.push({
        pool_id: result.poolId,
        reason: result.rejection,
      });
    }
  }
  for (const [key, group] of groupCandidates(candidates)) {
    placeGroup(state, key, group);
  }
  sortReport(state.report);

  return {
    report: state.report,
    document: {
      ...emptyLaunchTokenDocument(),
      tokens: [...state.tokens.values()].sort(compareTokens),
    },
  };
}

export function serializeLaunchTokenDocument(
  document: TokenListDocument,
): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function validateLaunchRow(token: Token, label: string): void {
  const where = `${label} ${token.chain_id}:${token.token_address}`;
  const address = readLaunchAddress(token.token_address);
  if (!("address" in address) || address.address !== token.token_address) {
    throw new Error(`${where} is not a checksummed launch token address`);
  }
  if (token.token_decimals !== LAUNCH_TOKEN_DECIMALS) {
    throw new Error(`${where} must have ${LAUNCH_TOKEN_DECIMALS} decimals`);
  }
  if (!isLaunchMetadata(token.token_name)) {
    throw new Error(`${where} has an invalid name`);
  }
  if (!isLaunchMetadata(token.token_symbol)) {
    throw new Error(`${where} has an invalid symbol`);
  }
  if (readLaunchLogo(token.logo_url).url !== token.logo_url) {
    throw new Error(`${where} has an unsafe logo URL`);
  }
}

export function validateLaunchTokenDocument(
  document: unknown,
  label = LAUNCH_SOURCE.url,
): asserts document is TokenListDocument {
  validateTokenListSchema(document, label);
  validateTokenList(document.tokens);
  if (document.bridge_relationships.length > 0) {
    throw new Error(`${label} must not hold bridge relationships`);
  }
  for (const token of document.tokens) validateLaunchRow(token, label);
  const sorted = [...document.tokens].sort(compareTokens);
  if (sorted.some((token, index) => token !== document.tokens[index])) {
    throw new Error(`${label} must be sorted by chain ID and token address`);
  }
}

/**
 * Add the recorded launch tokens with the lowest precedence: a chain and
 * address that any other source already lists is left entirely to it, logo
 * included.
 */
export function addLaunchTokens(
  accumulator: TokenAccumulator,
  document: TokenListDocument,
): number {
  let added = 0;
  for (const token of document.tokens) {
    if (accumulator.tokens.has(tokenKey(token.chain_id, token.token_address))) {
      continue;
    }
    added += Number(
      accumulator.add(token, LAUNCH_SOURCE.name, LAUNCH_SOURCE.url),
    );
  }
  return added;
}
