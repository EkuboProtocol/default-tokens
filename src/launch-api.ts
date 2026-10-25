import { fetchJson } from "./fetch-json";

// The only module that knows the Ekubo API's launch-list shape. Every field
// the launch-token job reads is mapped here, so a renamed field or cursor is
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
  nextCursor: string | null;
};

export const LAUNCH_LIST_PATH = "/launches";
export const LAUNCH_PAGE_LIMIT = 200;
const MAX_PAGES_PER_CHAIN = 500;

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
  const data = field(raw, "data");
  if (!Array.isArray(data)) {
    throw new Error("Launch list response has no data array");
  }
  const nextCursor = field(raw, "next_cursor") ?? null;
  if (nextCursor !== null && typeof nextCursor !== "string") {
    throw new Error("Launch list next_cursor must be a string or null");
  }
  return {
    launches: data.map(readLaunchRecord),
    nextCursor: nextCursor === "" ? null : nextCursor,
  };
}

export function launchPageUrl(
  baseUrl: string,
  chainId: string,
  cursor: string | null,
): string {
  const url = new URL(`${baseUrl.replace(/\/+$/, "")}${LAUNCH_LIST_PATH}`);
  url.searchParams.set("chainId", chainId);
  url.searchParams.set("limit", String(LAUNCH_PAGE_LIMIT));
  if (cursor !== null) url.searchParams.set("before_event_id", cursor);
  return url.toString();
}

async function fetchChainLaunches(
  baseUrl: string,
  chainId: string,
  fetch?: typeof globalThis.fetch,
): Promise<LaunchRecord[]> {
  const launches: LaunchRecord[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES_PER_CHAIN; page++) {
    const response = await fetchJson<unknown>(
      `Ekubo launches on chain ${chainId}`,
      launchPageUrl(baseUrl, chainId, cursor),
      { fetch },
    );
    const { launches: pageLaunches, nextCursor } = readLaunchPage(response);
    launches.push(...pageLaunches);
    if (nextCursor === null) return launches;
    if (seenCursors.has(nextCursor)) {
      throw new Error(`Launch list on chain ${chainId} repeated a cursor`);
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
  throw new Error(
    `Launch list on chain ${chainId} has more than ${MAX_PAGES_PER_CHAIN} pages`,
  );
}

/**
 * Every launch the API lists on the given chains, following each chain's
 * cursor to the end. Any page failure fails the whole read, so a partial
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
