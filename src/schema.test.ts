import { expect, test } from "bun:test";
import { validateTokenListSchema } from "./schema";

const validDocument = {
  $schema: "./token-list.schema.json",
  tokens: [
    {
      chain_id: "1",
      token_address: "0x1",
      token_name: "Token",
      token_symbol: "TKN",
      token_decimals: 18,
      total_supply: "1000",
      circulating_supply: "750",
      logo_url: null,
      visibility_priority: 0,
      sort_order: 0,
    },
  ],
  bridge_relationships: [
    {
      source_chain_id: "1",
      source_token_address: "0x1",
      source_bridge_address: null,
      dest_chain_id: "0x2",
      dest_token_address: "0x2",
    },
  ],
};

test("schema accepts tokens and bridge relationships in one document", () => {
  expect(() => validateTokenListSchema(validDocument)).not.toThrow();
});

test("schema rejects unknown token fields", () => {
  const invalid = structuredClone(validDocument);
  Object.assign(invalid.tokens[0]!, { untracked_metadata: true });
  expect(() => validateTokenListSchema(invalid)).toThrow(
    "does not match token-list.schema.json",
  );
});

test("schema rejects negative supplies", () => {
  const invalid = structuredClone(validDocument);
  invalid.tokens[0]!.circulating_supply = "-1";
  expect(() => validateTokenListSchema(invalid)).toThrow(
    "does not match token-list.schema.json",
  );
});

test("schema requires the bridge relationship collection", () => {
  const { bridge_relationships: _, ...invalid } = validDocument;
  expect(() => validateTokenListSchema(invalid)).toThrow(
    "must have required property 'bridge_relationships'",
  );
});
