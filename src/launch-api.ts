import { fetchJson } from "./fetch-json";

// The only module that knows the Ekubo API's launch-list shape, response
// contract `zero-seed-launch-api/v6`: `GET /launches?chainId=&status=all&
// order_by=created&offset=&limit=` answers `{ schema_version, data, total,
// totals, next_offset, evaluated_at, heads }`, newest first, paged by offset.
// Every field the launch-token job reads is mapped here, so a renamed field is
// a change to this file alone. Values stay `unknown`: they are untrusted and
// `src/launch-tokens.ts` validates each one.

export type LaunchRecord = {
  chainId: unknown;
  poolId: unknown;
  tokenAddress: unknown;
  name: unknown;
  symbol: unknown;
  decimals: unknown;
  logoUrl: unknown;
  status: unknown;
};

export type LaunchPage = {
  launches: LaunchRecord[];
  nextOffset: number | null;
};

export const LAUNCH_API_SCHEMA_VERSION = "zero-seed-launch-api/v6";
export const LAUNCH_LIST_PATH = "/launches";
export const LAUNCH_PAGE_LIMIT = 200;
// The API refuses offsets above 100000.
export const MAX_LAUNCH_OFFSET = 100_000;

function field(value: unknown, name: string): unknown {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)[name]
    : undefined;
}

export function readLaunchRecord(raw: unknown): LaunchRecord {
  const token = field(raw, "token");
  return {
    chainId: field(raw, "chain_id"),
    poolId: field(raw, "pool_id"),
    tokenAddress: field(token, "address"),
    name: field(token, "name"),
    symbol: field(token, "symbol"),
    decimals: field(token, "decimals"),
    logoUrl: field(raw, "logo_url"),
    status: field(raw, "status"),
  };
}

export function readLaunchPage(raw: unknown): LaunchPage {
  const version = field(raw, "schema_version");
  if (version !== LAUNCH_API_SCHEMA_VERSION) {
    throw new Error(
      `Launch list schema_version must be ${LAUNCH_API_SCHEMA_VERSION}, got ${JSON.stringify(version)}`,
    );
  }
  const data = field(raw, "data");
  if (!Array.isArray(data)) {
    throw new Error("Launch list response has no data array");
  }
  const nextOffset = field(raw, "next_offset");
  if (
    nextOffset !== null &&
    !(Number.isSafeInteger(nextOffset) && (nextOffset as number) > 0)
  ) {
    throw new Error(
      "Launch list next_offset must be a positive integer or null",
    );
  }
  return {
    launches: data.map(readLaunchRecord),
    nextOffset: nextOffset as number | null,
  };
}

export function launchPageUrl(
  baseUrl: string,
  chainId: string,
  offset: number,
): string {
  const url = new URL(`${baseUrl.replace(/\/+$/, "")}${LAUNCH_LIST_PATH}`);
  url.searchParams.set("chainId", chainId);
  url.searchParams.set("status", "all");
  url.searchParams.set("order_by", "created");
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("limit", String(LAUNCH_PAGE_LIMIT));
  return url.toString();
}

// Offsets over a newest-first list: a launch created mid-read shifts later
// rows down, so a row may repeat on the next page (the planner skips repeats
// as duplicate_record) but none is skipped.
async function fetchChainLaunches(
  baseUrl: string,
  chainId: string,
  fetch?: typeof globalThis.fetch,
): Promise<LaunchRecord[]> {
  const launches: LaunchRecord[] = [];
  let offset = 0;
  for (;;) {
    const response = await fetchJson<unknown>(
      `Ekubo launches on chain ${chainId}`,
      launchPageUrl(baseUrl, chainId, offset),
      { fetch },
    );
    const { launches: pageLaunches, nextOffset } = readLaunchPage(response);
    launches.push(...pageLaunches);
    if (nextOffset === null) return launches;
    if (nextOffset <= offset) {
      throw new Error(
        `Launch list on chain ${chainId} did not advance its offset`,
      );
    }
    if (nextOffset > MAX_LAUNCH_OFFSET) {
      throw new Error(
        `Launch list on chain ${chainId} has more than ${MAX_LAUNCH_OFFSET} launches`,
      );
    }
    offset = nextOffset;
  }
}

/**
 * Every launch the API lists on the given chains, following each chain's
 * offset to the end. Any page failure fails the whole read, so a partial
 * list is never mistaken for the complete one.
 */
export async function fetchLaunches(options: {
  baseUrl: string;
  chainIds: readonly string[];
  fetch?: typeof globalThis.fetch;
}): Promise<LaunchRecord[]> {
  const parsed = new URL(options.baseUrl);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    throw new Error("EKUBO_LAUNCH_API_URL must be an https URL");
  }
  const launches: LaunchRecord[] = [];
  for (const chainId of options.chainIds) {
    launches.push(
      ...(await fetchChainLaunches(options.baseUrl, chainId, options.fetch)),
    );
  }
  return launches;
}
