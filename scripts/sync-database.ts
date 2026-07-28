import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres, { type TransactionSql } from "postgres";
import { validateTokenListSchema } from "../src/schema";
import {
  assertHostedLogos,
  parseInteger,
  validateBridgeRelationships,
  validateTokenList,
} from "../src/token-list";
import type {
  BridgeRelationship,
  Token,
  TokenListDocument,
} from "../src/types";

const root = resolve(import.meta.dir, "..");

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(resolve(root, path), "utf8")) as T;
}

async function syncTokens(
  sql: TransactionSql,
  tokens: Token[],
): Promise<number> {
  if (tokens.length === 0) return 0;
  const rows = tokens.map((token) => ({
    ...token,
    chain_id: parseInteger(token.chain_id, "chain ID").toString(),
    token_address: parseInteger(
      token.token_address,
      "token address",
    ).toString(),
    total_supply: token.total_supply ?? null,
  }));
  let count = 0;
  for (let offset = 0; offset < rows.length; offset += 1_000) {
    const batch = rows.slice(offset, offset + 1_000);
    const result = await sql`
      INSERT INTO erc20_tokens ${sql(batch)}
      ON CONFLICT (chain_id, token_address)
      DO UPDATE SET
        token_name = EXCLUDED.token_name,
        token_symbol = EXCLUDED.token_symbol,
        token_decimals = EXCLUDED.token_decimals,
        logo_url = EXCLUDED.logo_url,
        visibility_priority = EXCLUDED.visibility_priority,
        sort_order = EXCLUDED.sort_order,
        total_supply = EXCLUDED.total_supply
      WHERE erc20_tokens.token_name IS DISTINCT FROM EXCLUDED.token_name
         OR erc20_tokens.token_symbol IS DISTINCT FROM EXCLUDED.token_symbol
         OR erc20_tokens.token_decimals IS DISTINCT FROM EXCLUDED.token_decimals
         OR erc20_tokens.logo_url IS DISTINCT FROM EXCLUDED.logo_url
         OR erc20_tokens.visibility_priority IS DISTINCT FROM EXCLUDED.visibility_priority
         OR erc20_tokens.sort_order IS DISTINCT FROM EXCLUDED.sort_order
         OR erc20_tokens.total_supply IS DISTINCT FROM EXCLUDED.total_supply
    `;
    count += result.count;
  }
  return count;
}

async function syncBridgeRelationships(
  sql: TransactionSql,
  relationships: BridgeRelationship[],
): Promise<number> {
  if (relationships.length === 0) return 0;
  const rows = relationships.map((relationship) => ({
    source_chain_id: parseInteger(
      relationship.source_chain_id,
      "source chain ID",
    ).toString(),
    source_token_address: parseInteger(
      relationship.source_token_address,
      "source token address",
    ).toString(),
    source_bridge_address:
      relationship.source_bridge_address == null
        ? null
        : parseInteger(
            relationship.source_bridge_address,
            "source bridge address",
          ).toString(),
    dest_chain_id: parseInteger(
      relationship.dest_chain_id,
      "destination chain ID",
    ).toString(),
    dest_token_address: parseInteger(
      relationship.dest_token_address,
      "destination token address",
    ).toString(),
  }));
  let count = 0;
  for (let offset = 0; offset < rows.length; offset += 1_000) {
    const batch = rows.slice(offset, offset + 1_000);
    const result = await sql`
      INSERT INTO erc20_tokens_bridge_relationships ${sql(batch)}
      ON CONFLICT (source_chain_id, source_token_address, dest_chain_id)
      DO UPDATE SET
        dest_token_address = EXCLUDED.dest_token_address,
        source_bridge_address = EXCLUDED.source_bridge_address
      WHERE erc20_tokens_bridge_relationships.dest_token_address
              IS DISTINCT FROM EXCLUDED.dest_token_address
         OR erc20_tokens_bridge_relationships.source_bridge_address
              IS DISTINCT FROM EXCLUDED.source_bridge_address
    `;
    count += result.count;
  }
  return count;
}

async function main(): Promise<void> {
  const connectionString = process.env.PG_CONNECTION_STRING;
  if (!connectionString) {
    throw new Error("PG_CONNECTION_STRING is required");
  }

  const tokenList = await readJson<TokenListDocument>("tokens.json");
  validateTokenListSchema(tokenList, "tokens.json");
  const { tokens, bridge_relationships: relationships } = tokenList;
  validateTokenList(tokens);
  validateBridgeRelationships(relationships);
  assertHostedLogos(
    tokens,
    process.env.CLOUDFLARE_IMAGES_DELIVERY_HASH,
    process.env.CLOUDFLARE_IMAGES_VARIANT ?? "logo",
  );

  const sql = postgres(connectionString, { connect_timeout: 10 });
  try {
    const result = await sql.begin(async (transaction) => ({
      tokens: await syncTokens(transaction, tokens),
      relationships: await syncBridgeRelationships(
        transaction,
        relationships,
      ),
    }));
    console.log(
      `Synchronized ${result.tokens} token rows and ${result.relationships} bridge-relationship rows`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error("Database token sync failed", error);
  process.exitCode = 1;
});
