import { describe, expect, test } from "bun:test";
import {
  TokenAccumulator,
  assertHostedLogos,
  normalizeTokenAddress,
  tokenKey,
  validateBridgeRelationships,
} from "./token-list";

describe("token normalization", () => {
  test("normalizes EVM native-token aliases", () => {
    expect(
      normalizeTokenAddress(
        "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
        "1",
      ),
    ).toBe("0x0");
    expect(normalizeTokenAddress("0x455448", "8453")).toBe("0x0");
  });

  test("does not normalize Starknet addresses as EVM aliases", () => {
    expect(normalizeTokenAddress("0x455448", "0x534e5f4d41494e")).toBe(
      "0x455448",
    );
  });

  test("uses numeric identity for deduplication", () => {
    expect(tokenKey("0x1", "0x0a")).toBe(tokenKey("1", "0xA"));
  });
});

test("the first source wins while preserving provenance", () => {
  const accumulator = new TokenAccumulator();
  const token = {
    chain_id: "1",
    token_address: "0x1",
    token_name: "First",
    token_symbol: "ONE",
    token_decimals: 18,
    logo_url: null,
    visibility_priority: 1,
    sort_order: 0,
  };

  expect(accumulator.add(token, "curated", "curated-tokens.json")).toBe(true);
  expect(
    accumulator.add(
      { ...token, token_name: "Second" },
      "remote",
      "https://example.com/list.json",
    ),
  ).toBe(false);
  expect([...accumulator.tokens.values()][0]?.token_name).toBe("First");
  expect([...accumulator.provenance.values()][0]?.source_name).toBe("curated");
});

test("rejects duplicate bridge relationship identities", () => {
  const relationship = {
    source_chain_id: "1",
    source_token_address: "0x1",
    source_bridge_address: null,
    dest_chain_id: "2",
    dest_token_address: "0x2",
  };
  expect(() =>
    validateBridgeRelationships([
      relationship,
      { ...relationship, source_bridge_address: "0x3" },
    ]),
  ).toThrow("Duplicate bridge relationship");
});

test("requires every non-null logo to use the configured delivery account", () => {
  const token = {
    chain_id: "1",
    token_address: "0x1",
    token_name: "Token",
    token_symbol: "TKN",
    token_decimals: 18,
    logo_url: "https://imagedelivery.net/account/image/logo",
    visibility_priority: 0,
    sort_order: 0,
  };
  expect(() => assertHostedLogos([token], "account")).not.toThrow();
  expect(() => assertHostedLogos([token], "different-account")).toThrow(
    "non-Cloudflare logo",
  );
});
