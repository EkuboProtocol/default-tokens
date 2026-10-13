import { expect, test } from "bun:test";
import {
  assertPruneWithinLimit,
  databaseBridgeRows,
  databaseTokenRows,
  MAX_PRUNE_FRACTION,
} from "./sync-database";

test("normalizes both supply fields for database insertion", () => {
  const [rowWithSupplies, rowWithoutSupplies] = databaseTokenRows([
    {
      chain_id: "0x1",
      token_address: "0x10",
      token_name: "Token",
      token_symbol: "TKN",
      token_decimals: 6,
      total_supply: "1000000",
      circulating_supply: "750000",
      logo_url: null,
      visibility_priority: 1,
      sort_order: 0,
    },
    {
      chain_id: "2",
      token_address: "0x20",
      token_name: "Unknown supply",
      token_symbol: "NONE",
      token_decimals: 18,
      logo_url: null,
      visibility_priority: 0,
      sort_order: 0,
    },
  ]);

  expect(rowWithSupplies).toMatchObject({
    chain_id: "1",
    token_address: "16",
    total_supply: "1000000",
    circulating_supply: "750000",
  });
  expect(rowWithoutSupplies).toMatchObject({
    chain_id: "2",
    token_address: "32",
    total_supply: null,
    circulating_supply: null,
  });
});

test("normalizes bridge relationships to decimal database keys", () => {
  expect(
    databaseBridgeRows([
      {
        source_chain_id: "0x1",
        source_token_address: "0x10",
        source_bridge_address: null,
        dest_chain_id: "8453",
        dest_token_address: "0x20",
        relationship: "native_issuer",
      },
    ]),
  ).toEqual([
    {
      source_chain_id: "1",
      source_token_address: "16",
      source_bridge_address: null,
      dest_chain_id: "8453",
      dest_token_address: "32",
    },
  ]);
});

test("allows pruning up to the per-sync limit", () => {
  expect(() => assertPruneWithinLimit(3_668, 0, 0)).not.toThrow();
  expect(() => assertPruneWithinLimit(3_668, 372, 3_296)).not.toThrow();
  expect(() =>
    assertPruneWithinLimit(1_000, 1_000 * MAX_PRUNE_FRACTION, 900),
  ).not.toThrow();
});

test("refuses large or list-emptying prunes", () => {
  expect(() => assertPruneWithinLimit(1_000, 201, 799)).toThrow(/limit/);
  expect(() => assertPruneWithinLimit(10, 1, 0)).toThrow(/has none/);
});
