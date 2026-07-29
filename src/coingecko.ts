import type {
  CoinGeckoTokenSource,
  StandardTokenList,
} from "./types";

export type CoinGeckoAssetPlatform = {
  id?: string;
  chain_identifier?: number | null;
};

export function validateCoinGeckoAssetPlatforms(
  platforms: CoinGeckoAssetPlatform[],
  sources: CoinGeckoTokenSource[],
): void {
  if (!Array.isArray(platforms)) {
    throw new Error("CoinGecko Pro asset platforms did not return an array");
  }

  const platformsById = new Map(
    platforms
      .filter(
        (
          platform,
        ): platform is CoinGeckoAssetPlatform & {
          id: string;
        } => typeof platform.id === "string",
      )
      .map((platform) => [platform.id, platform]),
  );

  for (const source of sources) {
    const platform = platformsById.get(source.assetPlatformId);
    if (!platform) {
      throw new Error(
        `CoinGecko asset platform ${source.assetPlatformId} is unavailable`,
      );
    }
    if (String(platform.chain_identifier) !== source.expectedChainId) {
      throw new Error(
        `CoinGecko asset platform ${source.assetPlatformId} resolved to chain ${String(platform.chain_identifier)}, expected ${source.expectedChainId}`,
      );
    }
  }
}

export function validateCoinGeckoTokenList(
  list: StandardTokenList,
  source: CoinGeckoTokenSource,
): void {
  if (!Array.isArray(list.tokens)) {
    throw new Error(`${source.name} did not return a token list`);
  }

  const mismatchedToken = list.tokens.find(
    (token) => String(token.chainId) !== source.expectedChainId,
  );
  if (mismatchedToken) {
    throw new Error(
      `${source.name} returned token ${mismatchedToken.address} for chain ${String(mismatchedToken.chainId)}, expected ${source.expectedChainId}`,
    );
  }
}
