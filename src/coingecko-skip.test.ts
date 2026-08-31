import { expect, test } from "bun:test";
import { FetchJsonError, fetchJson, isRateLimited } from "./fetch-json";
import {
  TokenAccumulator,
  backfillPreviousTokens,
  restorePreviousSupplies,
} from "./token-list";
import type { Token } from "./types";

function token(overrides: Partial<Token> = {}): Token {
  return {
    chain_id: "1",
    token_address: "0x0000000000000000000000000000000000000001",
    token_name: "Example",
    token_symbol: "EX",
    token_decimals: 18,
    logo_url: null,
    visibility_priority: -1,
    sort_order: 0,
    ...overrides,
  };
}

async function failWith(status: number): Promise<unknown> {
  try {
    await fetchJson("test list", "https://example.com/list.json", {
      maxRetries: 1,
      sleep: async () => {},
      fetch: (async (_input) =>
        new Response(null, { status })) as typeof fetch,
    });
  } catch (error) {
    return error;
  }
  throw new Error("expected the download to fail");
}

test("an exhausted 429 is rate limited; every other failure is not", async () => {
  const rateLimited = await failWith(429);
  expect(rateLimited).toBeInstanceOf(FetchJsonError);
  expect((rateLimited as FetchJsonError).status).toBe(429);
  expect(isRateLimited(rateLimited)).toBe(true);

  expect(isRateLimited(await failWith(500))).toBe(false);
  expect(isRateLimited(await failWith(404))).toBe(false);
  expect(isRateLimited(new Error("boom"))).toBe(false);
});

test("backfill restores skipped tokens without displacing live rows", () => {
  const accumulator = new TokenAccumulator();
  accumulator.add(
    token({ token_symbol: "LIVE", token_name: "Live" }),
    "Live source",
    "https://example.com/live.json",
  );

  const stats = backfillPreviousTokens(
    accumulator,
    [
      token({ token_symbol: "STALE", token_name: "Stale", total_supply: "5" }),
      token({
        token_address: "0x0000000000000000000000000000000000000002",
        token_symbol: "GONE",
        token_name: "Gone",
        circulating_supply: "7",
      }),
    ],
    "Previous generated token list",
    "tokens.json",
  );

  expect(stats).toEqual({ tokensRestored: 1, suppliesRestored: 1 });

  const tokens = [...accumulator.tokens.values()];
  expect(tokens).toHaveLength(2);
  // The live row keeps its own name and symbol, and inherits only the supply
  // the skipped source would have provided.
  const live = tokens.find((entry) => entry.token_symbol === "LIVE");
  expect(live?.total_supply).toBe("5");
  expect(tokens.find((entry) => entry.token_symbol === "GONE")).toBeDefined();
});

test("supply restore fills only the gaps, and matches on normalized addresses", () => {
  const tokens = [
    token({ token_symbol: "A", circulating_supply: "1" }),
    token({
      chain_id: "1",
      token_address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      token_symbol: "ETH",
    }),
  ];
  const accumulator = new TokenAccumulator();
  for (const entry of tokens) {
    accumulator.add(entry, "Live source", "https://example.com/live.json");
  }
  const normalized = [...accumulator.tokens.values()];

  const restored = restorePreviousSupplies(normalized, [
    token({ token_symbol: "A", circulating_supply: "999", total_supply: "3" }),
    token({ token_address: "0x0", token_symbol: "ETH", total_supply: "42" }),
  ]);

  expect(restored).toBe(2);
  const a = normalized.find((entry) => entry.token_symbol === "A");
  expect(a?.circulating_supply).toBe("1");
  expect(a?.total_supply).toBe("3");
  expect(
    normalized.find((entry) => entry.token_symbol === "ETH")?.total_supply,
  ).toBe("42");
});
