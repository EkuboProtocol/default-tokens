import { expect, test } from "bun:test";
import { databaseTokenRows } from "./sync-database";

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
