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

export function databaseTokenRows(tokens: Token[]) {
  return tokens.map((token) => ({
    ...token,
    chain_id: parseInteger(token.chain_id, "chain ID").toString(),
    token_address: parseInteger(
      token.token_address,
      "token address",
    ).toString(),
    total_supply: token.total_supply ?? null,
    circulating_supply: token.circulating_supply ?? null,
  }));
}

async function syncTokens(
  sql: TransactionSql,
  tokens: Token[],
): Promise<number> {
  if (tokens.length === 0) return 0;
  const rows = databaseTokenRows(tokens);
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
        logo_url = COALESCE(EXCLUDED.logo_url, erc20_tokens.logo_url),
        visibility_priority = EXCLUDED.visibility_priority,
        sort_order = EXCLUDED.sort_order,
        total_supply = EXCLUDED.total_supply,
        circulating_supply = EXCLUDED.circulating_supply
      WHERE erc20_tokens.token_name IS DISTINCT FROM EXCLUDED.token_name
         OR erc20_tokens.token_symbol IS DISTINCT FROM EXCLUDED.token_symbol
         OR erc20_tokens.token_decimals IS DISTINCT FROM EXCLUDED.token_decimals
         OR erc20_tokens.logo_url IS DISTINCT FROM COALESCE(EXCLUDED.logo_url, erc20_tokens.logo_url)
         OR erc20_tokens.visibility_priority IS DISTINCT FROM EXCLUDED.visibility_priority
         OR erc20_tokens.sort_order IS DISTINCT FROM EXCLUDED.sort_order
         OR erc20_tokens.total_supply IS DISTINCT FROM EXCLUDED.total_supply
         OR erc20_tokens.circulating_supply IS DISTINCT FROM EXCLUDED.circulating_supply
    `;
    count += result.count;
  }
  return count;
}

export type BridgeRelationshipRow = {
  source_chain_id: string;
  source_token_address: string;
  source_bridge_address: string | null;
  dest_chain_id: string;
  dest_token_address: string;
  relationship: string | null;
  bridge_name: string | null;
  source_name: string | null;
  source_url: string | null;
  inferred_reverse: boolean;
};

export function databaseBridgeRows(
  relationships: BridgeRelationship[],
): BridgeRelationshipRow[] {
  return relationships.map((relationship) => ({
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
    relationship: relationship.relationship ?? null,
    bridge_name: relationship.bridge_name ?? null,
    source_name: relationship.source_name ?? null,
    source_url: relationship.source_url ?? null,
    inferred_reverse: relationship.inferred_reverse ?? false,
  }));
}

// The reviewed list is the only writer of bridge links, so rows it no longer
// contains are stale. A sudden large removal more likely means a broken build
// than a real change, so it is refused: upserts still commit, nothing is
// deleted, and the sync exits with an error.
export const MAX_PRUNE_FRACTION = 0.2;

export function assertPruneWithinLimit(
  existingRows: number,
  staleRows: number,
  reviewedRows: number,
): void {
  if (staleRows === 0) return;
  if (reviewedRows === 0) {
    throw new Error(
      `Refusing to delete ${staleRows} bridge relationships: the reviewed list has none`,
    );
  }
  if (staleRows > existingRows * MAX_PRUNE_FRACTION) {
    throw new Error(
      `Refusing to delete ${staleRows} of ${existingRows} bridge relationships ` +
        `(limit ${MAX_PRUNE_FRACTION * 100}% per sync)`,
    );
  }
}

async function syncBridgeRelationships(
  sql: TransactionSql,
  relationships: BridgeRelationship[],
): Promise<{ upserted: number; deleted: number; refusal?: string }> {
  const rows = databaseBridgeRows(relationships);
  let upserted = 0;
  for (let offset = 0; offset < rows.length; offset += 1_000) {
    const batch = rows.slice(offset, offset + 1_000);
    const result = await sql`
      INSERT INTO erc20_tokens_bridge_relationships ${sql(batch)}
      ON CONFLICT (source_chain_id, source_token_address, dest_chain_id)
      DO UPDATE SET
        dest_token_address = EXCLUDED.dest_token_address,
        source_bridge_address = EXCLUDED.source_bridge_address,
        relationship = EXCLUDED.relationship,
        bridge_name = EXCLUDED.bridge_name,
        source_name = EXCLUDED.source_name,
        source_url = EXCLUDED.source_url,
        inferred_reverse = EXCLUDED.inferred_reverse
      WHERE (
        erc20_tokens_bridge_relationships.dest_token_address,
        erc20_tokens_bridge_relationships.source_bridge_address,
        erc20_tokens_bridge_relationships.relationship,
        erc20_tokens_bridge_relationships.bridge_name,
        erc20_tokens_bridge_relationships.source_name,
        erc20_tokens_bridge_relationships.source_url,
        erc20_tokens_bridge_relationships.inferred_reverse
      ) IS DISTINCT FROM (
        EXCLUDED.dest_token_address,
        EXCLUDED.source_bridge_address,
        EXCLUDED.relationship,
        EXCLUDED.bridge_name,
        EXCLUDED.source_name,
        EXCLUDED.source_url,
        EXCLUDED.inferred_reverse
      )
    `;
    upserted += result.count;
  }

  const reviewed = sql`
    SELECT *
    FROM unnest(
      ${rows.map((row) => row.source_chain_id)}::int8[],
      ${rows.map((row) => row.source_token_address)}::numeric[],
      ${rows.map((row) => row.dest_chain_id)}::int8[]
    ) AS reviewed(source_chain_id, source_token_address, dest_chain_id)
  `;
  // Only links the API serves, those whose source token is a token row, are
  // pruned. Rows for tokens outside the table are invisible and left alone.
  const served = sql`
    EXISTS (
      SELECT 1 FROM erc20_tokens t
      WHERE t.chain_id = br.source_chain_id
        AND t.token_address = br.source_token_address
    )
  `;
  const stale = sql`
    ${served} AND NOT EXISTS (
      SELECT 1 FROM (${reviewed}) AS reviewed
      WHERE reviewed.source_chain_id = br.source_chain_id
        AND reviewed.source_token_address = br.source_token_address
        AND reviewed.dest_chain_id = br.dest_chain_id
    )
  `;
  const [counts] = await sql<{ existing: number; stale: number }[]>`
    SELECT
      COUNT(*)::int AS existing,
      (COUNT(*) FILTER (WHERE ${stale}))::int AS stale
    FROM erc20_tokens_bridge_relationships br
    WHERE ${served}
  `;
  try {
    assertPruneWithinLimit(counts!.existing, counts!.stale, rows.length);
  } catch (error) {
    return { upserted, deleted: 0, refusal: (error as Error).message };
  }
  if (counts!.stale === 0) return { upserted, deleted: 0 };

  const deleted = await sql<BridgeRelationshipRow[]>`
    DELETE FROM erc20_tokens_bridge_relationships br
    WHERE ${stale}
    RETURNING
      source_chain_id::text,
      source_token_address::text,
      source_bridge_address::text,
      dest_chain_id::text,
      dest_token_address::text
  `;
  // Printed in full so a removal can be restored by re-inserting these rows.
  for (const row of deleted) {
    console.log(`Deleted stale bridge relationship ${JSON.stringify(row)}`);
  }
  return { upserted, deleted: deleted.length };
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
      `Synchronized ${result.tokens} token rows and ${result.relationships.upserted} bridge-relationship rows; ` +
        `deleted ${result.relationships.deleted} stale bridge-relationship rows`,
    );
    if (result.relationships.refusal) {
      console.error(result.relationships.refusal);
      process.exitCode = 1;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("Database token sync failed", error);
    process.exitCode = 1;
  });
}
