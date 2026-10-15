import type { CoinGeckoMarket } from "./coingecko-supply";

export type CoinGeckoMarketCacheEntry = {
  total_supply: number | string | null;
  circulating_supply: number | string | null;
  refreshed_at: string;
};

export type CoinGeckoMarketCache = {
  rotation_slot: number;
  rotation_slots: number;
  markets: Record<string, CoinGeckoMarketCacheEntry>;
};

export const DEFAULT_MARKET_ROTATION_SLOTS = 7;

export function emptyMarketCache(
  rotationSlots: number = DEFAULT_MARKET_ROTATION_SLOTS,
): CoinGeckoMarketCache {
  return { rotation_slot: 0, rotation_slots: rotationSlots, markets: {} };
}

function normalizeCache(cache: CoinGeckoMarketCache): CoinGeckoMarketCache {
  const rotationSlots =
    Number.isInteger(cache?.rotation_slots) && cache.rotation_slots > 0
      ? cache.rotation_slots
      : DEFAULT_MARKET_ROTATION_SLOTS;
  const rotationSlot =
    Number.isInteger(cache?.rotation_slot) && cache.rotation_slot >= 0
      ? cache.rotation_slot % rotationSlots
      : 0;

  return {
    rotation_slot: rotationSlot,
    rotation_slots: rotationSlots,
    markets:
      cache?.markets && typeof cache.markets === "object" ? cache.markets : {},
  };
}

export function selectMarketIdsToRefresh(
  coinIds: readonly string[],
  cache: CoinGeckoMarketCache,
): string[] {
  const normalized = normalizeCache(cache);
  const { rotation_slot: slot, rotation_slots: slots, markets } = normalized;

  return coinIds.filter(
    (coinId, index) => !markets[coinId] || index % slots === slot,
  );
}

export function mergeMarketRefresh({
  cache,
  coinIds,
  refreshedIds,
  markets,
  refreshedAt,
}: {
  cache: CoinGeckoMarketCache;
  coinIds: readonly string[];
  refreshedIds: readonly string[];
  markets: readonly CoinGeckoMarket[];
  refreshedAt: string;
}): CoinGeckoMarketCache {
  const normalized = normalizeCache(cache);
  const refreshed = new Set(refreshedIds);
  const marketsById = new Map(
    markets
      .filter(
        (market): market is CoinGeckoMarket & { id: string } =>
          typeof market.id === "string" && market.id.length > 0,
      )
      .map((market) => [market.id, market]),
  );

  const next: Record<string, CoinGeckoMarketCacheEntry> = {};
  for (const coinId of [...coinIds].sort()) {
    const previous = normalized.markets[coinId];
    if (!refreshed.has(coinId)) {
      if (previous) next[coinId] = previous;
      continue;
    }

    const market = marketsById.get(coinId);
    next[coinId] = {
      total_supply: market?.total_supply ?? null,
      circulating_supply: market?.circulating_supply ?? null,
      refreshed_at: refreshedAt,
    };
  }

  return {
    rotation_slot: (normalized.rotation_slot + 1) % normalized.rotation_slots,
    rotation_slots: normalized.rotation_slots,
    markets: next,
  };
}

export function marketsFromCache(
  cache: CoinGeckoMarketCache,
): CoinGeckoMarket[] {
  const { markets } = normalizeCache(cache);

  return Object.entries(markets)
    .filter(
      ([, entry]) =>
        entry.total_supply != null || entry.circulating_supply != null,
    )
    .map(([id, entry]) => ({
      id,
      total_supply: entry.total_supply,
      circulating_supply: entry.circulating_supply,
    }));
}
