import { expect, test } from "bun:test";
import {
  coinGeckoSupplyToRawInteger,
  enrichCoinGeckoSupplies,
  indexCoinGeckoTokenIds,
} from "./coingecko-supply";
import type { Token } from "./types";

function token(
  chainId: string,
  address: string,
  decimals = 6,
): Token {
  return {
    chain_id: chainId,
    token_address: address,
    token_name: "Token",
    token_symbol: "TKN",
    token_decimals: decimals,
    logo_url: null,
    visibility_priority: 0,
    sort_order: 0,
  };
}

const supplyPlatforms = [
  {
    assetPlatformId: "ethereum",
    chainId: "1",
    expectedChainIdentifier: "1",
  },
  {
    assetPlatformId: "starknet",
    chainId: "23448594291968334",
    expectedChainIdentifier: null,
  },
];

const assetPlatforms = [
  {
    id: "ethereum",
    chain_identifier: 1,
    native_coin_id: "ethereum",
  },
  {
    id: "starknet",
    chain_identifier: null,
    native_coin_id: "starknet",
  },
];

test("maps exact contracts and native assets to CoinGecko IDs", () => {
  const tokens = [
    token("1", "0xa0"),
    token("1", "0x0", 18),
    token("23448594291968334", "0xb0", 18),
  ];
  const result = indexCoinGeckoTokenIds(
    tokens,
    [
      {
        id: "usd-coin",
        platforms: { ethereum: "0x00a0", starknet: "0xB0" },
      },
      { id: "ethereum", platforms: {} },
    ],
    assetPlatforms,
    supplyPlatforms,
  );

  expect(Object.fromEntries(result.idsByToken)).toEqual({
    "1:0": "ethereum",
    "1:160": "usd-coin",
    "23448594291968334:176": "usd-coin",
  });
  expect(result.ambiguousTokenKeys).toEqual([]);
});

test("skips ambiguous contract mappings", () => {
  const result = indexCoinGeckoTokenIds(
    [token("1", "0xa0")],
    [
      { id: "first", platforms: { ethereum: "0xa0" } },
      { id: "second", platforms: { ethereum: "0x00a0" } },
    ],
    assetPlatforms,
    supplyPlatforms,
  );

  expect(result.idsByToken.size).toBe(0);
  expect(result.ambiguousTokenKeys).toEqual(["1:160"]);
});

test("uses source-provided CoinGecko IDs when contract mapping is absent", () => {
  const result = indexCoinGeckoTokenIds(
    [token("1", "0xc0")],
    [],
    assetPlatforms,
    supplyPlatforms,
    new Map([["1:192", new Set(["explicit-id"])]]),
  );

  expect(result.idsByToken.get("1:192")).toBe("explicit-id");
});

test("rejects a changed CoinGecko platform mapping", () => {
  expect(() =>
    indexCoinGeckoTokenIds(
      [],
      [],
      [{ id: "ethereum", chain_identifier: 2 }],
      [supplyPlatforms[0]!],
    ),
  ).toThrow("resolved to chain 2, expected 1");
});

test("scales decimal and scientific supplies into indivisible units", () => {
  expect(coinGeckoSupplyToRawInteger("32936427353.685", 6)).toBe(
    "32936427353685000",
  );
  expect(coinGeckoSupplyToRawInteger(1e-7, 18)).toBe("100000000000");
  expect(coinGeckoSupplyToRawInteger("1.234", 2)).toBe("123");
  expect(coinGeckoSupplyToRawInteger("1.235", 2)).toBe("124");
  expect(coinGeckoSupplyToRawInteger(-1, 18)).toBeNull();
  expect(coinGeckoSupplyToRawInteger(Number.POSITIVE_INFINITY, 18)).toBeNull();
});

test("fills missing supplies without replacing an authoritative total", () => {
  const first = token("1", "0xa0");
  first.total_supply = "999";
  const second = token("1", "0xb0", 2);
  const stats = enrichCoinGeckoSupplies(
    [first, second],
    new Map([
      ["1:160", "first"],
      ["1:176", "second"],
    ]),
    [
      { id: "first", total_supply: 10, circulating_supply: 8 },
      { id: "second", total_supply: "100.5", circulating_supply: 101 },
    ],
  );

  expect(first.total_supply).toBe("999");
  expect(first.circulating_supply).toBe("8000000");
  expect(second.total_supply).toBe("10050");
  expect(second.circulating_supply).toBe("10100");
  expect(stats).toEqual({
    tokensWithCoinGeckoId: 2,
    tokensWithMarketData: 2,
    totalSuppliesAdded: 1,
    circulatingSuppliesAdded: 2,
    invalidSupplyValues: 0,
    inconsistentCoinGeckoSupplies: 1,
  });
});
