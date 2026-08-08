import { describe, expect, test } from "bun:test";
import {
  emptyMarketCache,
  marketsFromCache,
  mergeMarketRefresh,
  selectMarketIdsToRefresh,
  type CoinGeckoMarketCache,
} from "./coingecko-markets";

const REFRESHED_AT = "2026-08-08T00:00:00.000Z";

function cacheOf(
  ids: string[],
  { rotation_slot = 0, rotation_slots = 7 } = {},
): CoinGeckoMarketCache {
  return {
    rotation_slot,
    rotation_slots,
    markets: Object.fromEntries(
      ids.map((id) => [
        id,
        {
          total_supply: 100,
          circulating_supply: 50,
          refreshed_at: "2026-08-01T00:00:00.000Z",
        },
      ]),
    ),
  };
}

describe("selectMarketIdsToRefresh", () => {
  test("refreshes every coin when nothing is cached", () => {
    const coinIds = ["a", "b", "c"];

    expect(selectMarketIdsToRefresh(coinIds, emptyMarketCache())).toEqual(
      coinIds,
    );
  });

  test("refreshes only the current slice of cached coins", () => {
    const coinIds = ["a", "b", "c", "d", "e", "f"];
    const cache = cacheOf(coinIds, { rotation_slot: 1, rotation_slots: 3 });

    expect(selectMarketIdsToRefresh(coinIds, cache)).toEqual(["b", "e"]);
  });

  test("always refreshes coins the cache has never seen", () => {
    const coinIds = ["a", "b", "c", "d"];
    const cache = cacheOf(["a", "b", "c"], {
      rotation_slot: 0,
      rotation_slots: 4,
    });

    expect(selectMarketIdsToRefresh(coinIds, cache)).toEqual(["a", "d"]);
  });

  test("covers every coin exactly once across a full rotation", () => {
    const coinIds = ["a", "b", "c", "d", "e", "f", "g"];
    let cache = cacheOf(coinIds, { rotation_slot: 0, rotation_slots: 3 });
    const seen: string[] = [];

    for (let run = 0; run < 3; run++) {
      const refreshedIds = selectMarketIdsToRefresh(coinIds, cache);
      seen.push(...refreshedIds);
      cache = mergeMarketRefresh({
        cache,
        coinIds,
        refreshedIds,
        markets: [],
        refreshedAt: REFRESHED_AT,
      });
    }

    expect(seen.sort()).toEqual([...coinIds].sort());
  });
});

describe("mergeMarketRefresh", () => {
  test("stores refreshed supplies and advances the rotation", () => {
    const result = mergeMarketRefresh({
      cache: emptyMarketCache(3),
      coinIds: ["a"],
      refreshedIds: ["a"],
      markets: [{ id: "a", total_supply: 10, circulating_supply: "5" }],
      refreshedAt: REFRESHED_AT,
    });

    expect(result.markets.a).toEqual({
      total_supply: 10,
      circulating_supply: "5",
      refreshed_at: REFRESHED_AT,
    });
    expect(result.rotation_slot).toBe(1);
    expect(result.rotation_slots).toBe(3);
  });

  test("wraps the rotation cursor back to zero", () => {
    const result = mergeMarketRefresh({
      cache: { rotation_slot: 2, rotation_slots: 3, markets: {} },
      coinIds: [],
      refreshedIds: [],
      markets: [],
      refreshedAt: REFRESHED_AT,
    });

    expect(result.rotation_slot).toBe(0);
  });

  test("keeps supplies for coins that were not refreshed this run", () => {
    const result = mergeMarketRefresh({
      cache: cacheOf(["a", "b"]),
      coinIds: ["a", "b"],
      refreshedIds: ["a"],
      markets: [{ id: "a", total_supply: 999, circulating_supply: 1 }],
      refreshedAt: REFRESHED_AT,
    });

    expect(result.markets.a.total_supply).toBe(999);
    expect(result.markets.b).toEqual({
      total_supply: 100,
      circulating_supply: 50,
      refreshed_at: "2026-08-01T00:00:00.000Z",
    });
  });

  test("records a refreshed coin CoinGecko returned nothing for as empty", () => {
    const result = mergeMarketRefresh({
      cache: cacheOf(["a"]),
      coinIds: ["a"],
      refreshedIds: ["a"],
      markets: [],
      refreshedAt: REFRESHED_AT,
    });

    // Recorded rather than dropped, so it is not retried on every later run.
    expect(result.markets.a).toEqual({
      total_supply: null,
      circulating_supply: null,
      refreshed_at: REFRESHED_AT,
    });
    expect(selectMarketIdsToRefresh(["a"], result)).toEqual([]);
  });

  test("drops coins no token references any more", () => {
    const result = mergeMarketRefresh({
      cache: cacheOf(["a", "stale"]),
      coinIds: ["a"],
      refreshedIds: [],
      markets: [],
      refreshedAt: REFRESHED_AT,
    });

    expect(Object.keys(result.markets)).toEqual(["a"]);
  });

  test("writes coins in sorted order so the artifact diff stays readable", () => {
    const result = mergeMarketRefresh({
      cache: emptyMarketCache(),
      coinIds: ["c", "a", "b"],
      refreshedIds: ["c", "a", "b"],
      markets: [],
      refreshedAt: REFRESHED_AT,
    });

    expect(Object.keys(result.markets)).toEqual(["a", "b", "c"]);
  });
});

describe("marketsFromCache", () => {
  test("returns cached supplies as markets", () => {
    expect(marketsFromCache(cacheOf(["a"]))).toEqual([
      { id: "a", total_supply: 100, circulating_supply: 50 },
    ]);
  });

  test("omits coins recorded as having no supply", () => {
    const cache: CoinGeckoMarketCache = {
      rotation_slot: 0,
      rotation_slots: 7,
      markets: {
        a: {
          total_supply: null,
          circulating_supply: null,
          refreshed_at: REFRESHED_AT,
        },
        b: {
          total_supply: null,
          circulating_supply: 5,
          refreshed_at: REFRESHED_AT,
        },
      },
    };

    expect(marketsFromCache(cache).map((market) => market.id)).toEqual(["b"]);
  });
});

test("a malformed cache file falls back to a full refresh", () => {
  const cache = {} as CoinGeckoMarketCache;

  expect(selectMarketIdsToRefresh(["a", "b"], cache)).toEqual(["a", "b"]);
  expect(marketsFromCache(cache)).toEqual([]);
});
