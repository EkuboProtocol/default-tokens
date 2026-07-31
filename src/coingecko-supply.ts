import type { CoinGeckoAssetPlatform } from "./coingecko";
import { normalizeTokenAddress, tokenKey } from "./token-list";
import type { CoinGeckoSupplyPlatform, Token } from "./types";

export type CoinGeckoCoin = {
  id?: string;
  platforms?: Record<string, string | null>;
};

export type CoinGeckoMarket = {
  id?: string;
  total_supply?: number | string | null;
  circulating_supply?: number | string | null;
};

export type CoinGeckoTokenIdIndex = {
  idsByToken: Map<string, string>;
  ambiguousTokenKeys: string[];
};

export type CoinGeckoSupplyStats = {
  tokensWithCoinGeckoId: number;
  tokensWithMarketData: number;
  totalSuppliesAdded: number;
  circulatingSuppliesAdded: number;
  invalidSupplyValues: number;
  inconsistentCoinGeckoSupplies: number;
};

function resolveSupplyPlatforms(
  assetPlatforms: CoinGeckoAssetPlatform[],
  supplyPlatforms: CoinGeckoSupplyPlatform[],
): Map<string, CoinGeckoSupplyPlatform & { nativeCoinId?: string }> {
  if (!Array.isArray(assetPlatforms)) {
    throw new Error("CoinGecko asset platforms did not return an array");
  }

  const assetPlatformsById = new Map(
    assetPlatforms
      .filter(
        (
          platform,
        ): platform is CoinGeckoAssetPlatform & { id: string } =>
          typeof platform.id === "string",
      )
      .map((platform) => [platform.id, platform]),
  );
  const resolved = new Map<
    string,
    CoinGeckoSupplyPlatform & { nativeCoinId?: string }
  >();

  for (const source of supplyPlatforms) {
    if (resolved.has(source.assetPlatformId)) {
      throw new Error(
        `Duplicate CoinGecko supply platform ${source.assetPlatformId}`,
      );
    }
    const platform = assetPlatformsById.get(source.assetPlatformId);
    if (!platform) {
      throw new Error(
        `CoinGecko supply platform ${source.assetPlatformId} is unavailable`,
      );
    }
    const actualChainIdentifier = platform.chain_identifier;
    const expectedChainIdentifier = source.expectedChainIdentifier;
    const matches =
      expectedChainIdentifier === null
        ? actualChainIdentifier === null
        : String(actualChainIdentifier) === expectedChainIdentifier;
    if (!matches) {
      throw new Error(
        `CoinGecko supply platform ${source.assetPlatformId} resolved to chain ${String(actualChainIdentifier)}, expected ${String(expectedChainIdentifier)}`,
      );
    }

    resolved.set(source.assetPlatformId, {
      ...source,
      ...(typeof platform.native_coin_id === "string" &&
      platform.native_coin_id
        ? { nativeCoinId: platform.native_coin_id }
        : {}),
    });
  }

  return resolved;
}

export function indexCoinGeckoTokenIds(
  tokens: Token[],
  coins: CoinGeckoCoin[],
  assetPlatforms: CoinGeckoAssetPlatform[],
  supplyPlatforms: CoinGeckoSupplyPlatform[],
  explicitIdsByToken: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
): CoinGeckoTokenIdIndex {
  if (!Array.isArray(coins)) {
    throw new Error("CoinGecko coins list did not return an array");
  }

  const resolvedPlatforms = resolveSupplyPlatforms(
    assetPlatforms,
    supplyPlatforms,
  );
  const trackedTokenKeys = new Set(
    tokens.map((token) => tokenKey(token.chain_id, token.token_address)),
  );
  const candidatesByToken = new Map<string, Set<string>>();

  const addCandidate = (
    chainId: string,
    address: string,
    coinId: string,
  ): void => {
    const normalizedAddress = normalizeTokenAddress(address, chainId);
    if (!normalizedAddress) return;
    const key = tokenKey(chainId, normalizedAddress);
    if (!trackedTokenKeys.has(key)) return;
    const candidates = candidatesByToken.get(key) ?? new Set<string>();
    candidates.add(coinId);
    candidatesByToken.set(key, candidates);
  };

  for (const [key, coinIds] of explicitIdsByToken) {
    if (!trackedTokenKeys.has(key)) continue;
    for (const coinId of coinIds) {
      if (!coinId) continue;
      const candidates = candidatesByToken.get(key) ?? new Set<string>();
      candidates.add(coinId);
      candidatesByToken.set(key, candidates);
    }
  }

  for (const platform of resolvedPlatforms.values()) {
    if (platform.nativeCoinId) {
      addCandidate(platform.chainId, "0x0", platform.nativeCoinId);
    }
  }

  for (const coin of coins) {
    if (typeof coin.id !== "string" || !coin.id) continue;
    for (const [assetPlatformId, address] of Object.entries(
      coin.platforms ?? {},
    )) {
      const platform = resolvedPlatforms.get(assetPlatformId);
      if (!platform || typeof address !== "string" || !address) continue;
      addCandidate(platform.chainId, address, coin.id);
    }
  }

  const idsByToken = new Map<string, string>();
  const ambiguousTokenKeys: string[] = [];
  for (const [key, candidates] of candidatesByToken) {
    if (candidates.size === 1) {
      idsByToken.set(key, candidates.values().next().value!);
    } else {
      ambiguousTokenKeys.push(key);
    }
  }
  ambiguousTokenKeys.sort();

  return { idsByToken, ambiguousTokenKeys };
}

export function coinGeckoSupplyToRawInteger(
  value: unknown,
  decimals: number,
): string | null {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 32767) {
    return null;
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  if (typeof value !== "number" && typeof value !== "string") return null;

  const input = String(value).trim();
  const match = input.match(/^\+?(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
  if (!match) return null;

  const [, whole, fraction = "", exponentText = "0"] = match;
  const coefficient = BigInt(`${whole}${fraction}`);
  if (coefficient === 0n) return "0";

  const exponent = Number(exponentText);
  if (!Number.isSafeInteger(exponent)) return null;
  const scale = decimals + exponent - fraction.length;
  if (Math.abs(scale) > 131072) return null;

  if (scale >= 0) {
    return (coefficient * 10n ** BigInt(scale)).toString();
  }

  const divisor = 10n ** BigInt(-scale);
  const quotient = coefficient / divisor;
  const remainder = coefficient % divisor;
  return (remainder * 2n >= divisor ? quotient + 1n : quotient).toString();
}

export function enrichCoinGeckoSupplies(
  tokens: Token[],
  idsByToken: Map<string, string>,
  markets: CoinGeckoMarket[],
): CoinGeckoSupplyStats {
  if (!Array.isArray(markets)) {
    throw new Error("CoinGecko markets did not return an array");
  }

  const marketsById = new Map(
    markets
      .filter(
        (market): market is CoinGeckoMarket & { id: string } =>
          typeof market.id === "string" && market.id.length > 0,
      )
      .map((market) => [market.id, market]),
  );
  const stats: CoinGeckoSupplyStats = {
    tokensWithCoinGeckoId: idsByToken.size,
    tokensWithMarketData: 0,
    totalSuppliesAdded: 0,
    circulatingSuppliesAdded: 0,
    invalidSupplyValues: 0,
    inconsistentCoinGeckoSupplies: 0,
  };

  for (const token of tokens) {
    const coinId = idsByToken.get(
      tokenKey(token.chain_id, token.token_address),
    );
    if (!coinId) continue;
    const market = marketsById.get(coinId);
    if (!market) continue;
    stats.tokensWithMarketData++;

    const totalSupply = coinGeckoSupplyToRawInteger(
      market.total_supply,
      token.token_decimals,
    );
    const circulatingSupply = coinGeckoSupplyToRawInteger(
      market.circulating_supply,
      token.token_decimals,
    );
    if (market.total_supply != null && totalSupply === null) {
      stats.invalidSupplyValues++;
    }
    if (market.circulating_supply != null && circulatingSupply === null) {
      stats.invalidSupplyValues++;
    }
    if (
      totalSupply !== null &&
      circulatingSupply !== null &&
      BigInt(circulatingSupply) > BigInt(totalSupply)
    ) {
      stats.inconsistentCoinGeckoSupplies++;
    }

    if (token.total_supply == null && totalSupply !== null) {
      token.total_supply = totalSupply;
      stats.totalSuppliesAdded++;
    }
    if (token.circulating_supply == null && circulatingSupply !== null) {
      token.circulating_supply = circulatingSupply;
      stats.circulatingSuppliesAdded++;
    }
  }

  return stats;
}
