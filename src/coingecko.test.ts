import { describe, expect, test } from "bun:test";
import {
  validateCoinGeckoAssetPlatforms,
  validateCoinGeckoTokenList,
} from "./coingecko";
import {
  COINGECKO_PRO_API_BASE_URL,
  COINGECKO_PRO_TOKEN_LISTS,
  COINGECKO_SUPPLY_PLATFORMS,
  REMOTE_TOKEN_LISTS,
} from "./sources";
import type { CoinGeckoTokenSource } from "./types";

const source: CoinGeckoTokenSource = {
  name: "CoinGecko Pro Test Token List",
  url: `${COINGECKO_PRO_API_BASE_URL}/token_lists/test/all.json`,
  assetPlatformId: "test",
  expectedChainId: "123",
};

describe("CoinGecko Pro source configuration", () => {
  test("uses unique platform IDs, chain IDs, and URLs", () => {
    expect(
      new Set(
        COINGECKO_PRO_TOKEN_LISTS.map((candidate) => candidate.assetPlatformId),
      ).size,
    ).toBe(COINGECKO_PRO_TOKEN_LISTS.length);
    expect(
      new Set(
        COINGECKO_PRO_TOKEN_LISTS.map(
          (candidate) => candidate.expectedChainId,
        ),
      ).size,
    ).toBe(COINGECKO_PRO_TOKEN_LISTS.length);
    expect(
      new Set(
        COINGECKO_PRO_TOKEN_LISTS.map((candidate) => candidate.url),
      ).size,
    ).toBe(COINGECKO_PRO_TOKEN_LISTS.length);
  });

  test("uses only authenticated Pro token-list endpoints", () => {
    for (const candidate of COINGECKO_PRO_TOKEN_LISTS) {
      expect(candidate.url).toBe(
        `${COINGECKO_PRO_API_BASE_URL}/token_lists/${candidate.assetPlatformId}/all.json`,
      );
    }
  });

  test("uses one reviewed chain mapping per supply platform", () => {
    expect(
      new Set(
        COINGECKO_SUPPLY_PLATFORMS.map(
          (candidate) => candidate.assetPlatformId,
        ),
      ).size,
    ).toBe(COINGECKO_SUPPLY_PLATFORMS.length);
    expect(
      new Set(
        COINGECKO_SUPPLY_PLATFORMS.map((candidate) => candidate.chainId),
      ).size,
    ).toBe(COINGECKO_SUPPLY_PLATFORMS.length);
    for (const source of COINGECKO_PRO_TOKEN_LISTS) {
      expect(
        COINGECKO_SUPPLY_PLATFORMS.some(
          (candidate) =>
            candidate.assetPlatformId === source.assetPlatformId &&
            candidate.chainId === source.expectedChainId,
        ),
      ).toBe(true);
    }
  });

  test("gives every CoinGecko source visibility priority zero", () => {
    const publicSources = REMOTE_TOKEN_LISTS.filter((candidate) =>
      candidate.name.startsWith("CoinGecko"),
    );
    expect(publicSources.length).toBeGreaterThan(0);
    for (const candidate of [
      ...publicSources,
      ...COINGECKO_PRO_TOKEN_LISTS,
    ]) {
      expect(candidate.visibilityPriority).toBe(0);
    }
  });
});

test("validates configured CoinGecko platform chain IDs", () => {
  expect(() =>
    validateCoinGeckoAssetPlatforms(
      [{ id: "test", chain_identifier: 123 }],
      [source],
    ),
  ).not.toThrow();
  expect(() =>
    validateCoinGeckoAssetPlatforms(
      [{ id: "test", chain_identifier: 456 }],
      [source],
    ),
  ).toThrow("resolved to chain 456, expected 123");
  expect(() => validateCoinGeckoAssetPlatforms([], [source])).toThrow(
    "is unavailable",
  );
});

test("rejects tokens returned for the wrong chain", () => {
  expect(() =>
    validateCoinGeckoTokenList(
      {
        tokens: [
          {
            chainId: 123,
            address: "0x1",
            name: "Token",
            symbol: "TKN",
            decimals: 18,
          },
        ],
      },
      source,
    ),
  ).not.toThrow();
  expect(() =>
    validateCoinGeckoTokenList(
      {
        tokens: [
          {
            chainId: 456,
            address: "0x1",
            name: "Token",
            symbol: "TKN",
            decimals: 18,
          },
        ],
      },
      source,
    ),
  ).toThrow("for chain 456, expected 123");
});
