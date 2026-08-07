import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "bun:test";
import {
  COINGECKO_PRO_TOKEN_LISTS,
  NATIVE_CURRENCIES,
  WALLET_DEFAULT_NETWORK_CHAIN_IDS,
} from "./sources";
import { validateNativeCurrencies } from "./token-list";
import type { NativeCurrency, Token, TokenListDocument } from "./types";

const root = resolve(import.meta.dir, "..");

function readDocument(path: string): TokenListDocument {
  return JSON.parse(
    readFileSync(resolve(root, path), "utf8"),
  ) as TokenListDocument;
}

function native(overrides: Partial<Token> = {}): Token {
  return {
    chain_id: "80094",
    token_address: "0x0000000000000000000000000000000000000000",
    token_name: "Berachain",
    token_symbol: "BERA",
    token_decimals: 18,
    logo_url: null,
    visibility_priority: 3,
    sort_order: 3,
    ...overrides,
  };
}

const BERACHAIN: NativeCurrency = {
  chainId: "80094",
  name: "Berachain",
  symbol: "BERA",
  decimals: 18,
};

test("lists one reviewed native currency per chain", () => {
  expect(
    new Set(NATIVE_CURRENCIES.map((currency) => currency.chainId)).size,
  ).toBe(NATIVE_CURRENCIES.length);
  for (const currency of NATIVE_CURRENCIES) {
    expect(currency.symbol).not.toBe("");
    expect(currency.name).not.toBe("");
    expect(Number.isInteger(currency.decimals)).toBe(true);
  }
});

test("names the native currency of every chain a list is fetched for", () => {
  const listed = new Set(
    NATIVE_CURRENCIES.map((currency) => currency.chainId),
  );
  for (const chainId of WALLET_DEFAULT_NETWORK_CHAIN_IDS) {
    expect(listed.has(chainId)).toBe(true);
  }
  for (const source of COINGECKO_PRO_TOKEN_LISTS) {
    expect(listed.has(source.expectedChainId)).toBe(true);
  }
});

test("curates a native row for every listed chain", () => {
  const curated = readDocument("curated-tokens.json");
  validateNativeCurrencies(
    curated.tokens,
    NATIVE_CURRENCIES,
    "curated",
    "curated-tokens.json",
  );
});

test("keeps the generated list free of relabeled native currencies", () => {
  const generated = readDocument("tokens.json");
  validateNativeCurrencies(
    generated.tokens,
    NATIVE_CURRENCIES,
    "generated",
    "tokens.json",
  );
});

test("rejects another asset's name at address zero", () => {
  for (const document of ["curated", "generated"] as const) {
    expect(() =>
      validateNativeCurrencies(
        [native({ token_name: "Ether", token_symbol: "ETH" })],
        [BERACHAIN],
        document,
        "list",
      ),
    ).toThrow(/Berachain \(BERA, 18 decimals\)/);
  }
});

test("rejects a native alias address that contradicts the chain", () => {
  expect(() =>
    validateNativeCurrencies(
      [
        native({
          token_address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
          token_decimals: 9,
        }),
      ],
      [BERACHAIN],
      "generated",
      "list",
    ),
  ).toThrow(/18 decimals/);
});

test("requires a curated row but lets the generated list catch up", () => {
  expect(() =>
    validateNativeCurrencies([], [BERACHAIN], "curated", "curated"),
  ).toThrow(/no BERA row at address zero for chain 80094/);
  expect(() =>
    validateNativeCurrencies([], [BERACHAIN], "generated", "generated"),
  ).not.toThrow();
});

test("admits an unreviewed chain only where a third-party list put it", () => {
  const drifted = [native({ chain_id: "5000" }), native()];
  expect(() =>
    validateNativeCurrencies(drifted, [BERACHAIN], "generated", "generated"),
  ).not.toThrow();
  expect(() =>
    validateNativeCurrencies(drifted, [BERACHAIN], "curated", "curated"),
  ).toThrow(/unlisted chain 5000/);
});
