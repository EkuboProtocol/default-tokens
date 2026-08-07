import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateTokenListSchema } from "../src/schema";
import { NATIVE_CURRENCIES } from "../src/sources";
import {
  assertHostedLogos,
  tokenKey,
  validateBridgeRelationships,
  validateNativeCurrencies,
  validateTokenList,
} from "../src/token-list";
import type {
  TokenListDocument,
  TokenProvenance,
} from "../src/types";

const root = resolve(import.meta.dir, "..");

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(resolve(root, path), "utf8")) as T;
}

const [curated, tokenList, provenance] = await Promise.all([
  readJson<TokenListDocument>("curated-tokens.json"),
  readJson<TokenListDocument>("tokens.json"),
  readJson<TokenProvenance[]>("token-sources.json"),
]);

validateTokenListSchema(curated, "curated-tokens.json");
validateTokenListSchema(tokenList, "tokens.json");
const { tokens, bridge_relationships: relationships } = tokenList;
validateTokenList(curated.tokens);
validateBridgeRelationships(curated.bridge_relationships);
validateNativeCurrencies(
  curated.tokens,
  NATIVE_CURRENCIES,
  "curated",
  "curated-tokens.json",
);
validateTokenList(tokens);
validateBridgeRelationships(relationships);
validateNativeCurrencies(
  tokens,
  NATIVE_CURRENCIES,
  "generated",
  "tokens.json",
);
assertHostedLogos(
  tokens,
  process.env.CLOUDFLARE_IMAGES_DELIVERY_HASH,
  process.env.CLOUDFLARE_IMAGES_VARIANT ?? "logo",
);

const tokenKeys = new Set(
  tokens.map((token) => tokenKey(token.chain_id, token.token_address)),
);
const provenanceKeys = new Set(
  provenance.map((source) => tokenKey(source.chain_id, source.token_address)),
);
if (
  tokenKeys.size !== provenanceKeys.size ||
  provenance.length !== tokenKeys.size
) {
  throw new Error(
    `Expected one provenance record per token; got ${provenance.length} records (${provenanceKeys.size} unique) for ${tokenKeys.size} tokens`,
  );
}
for (const source of provenance) {
  if (!source.source_name || !source.source_url) {
    throw new Error(
      `Incomplete provenance for ${source.chain_id}:${source.token_address}`,
    );
  }
}
for (const key of tokenKeys) {
  if (!provenanceKeys.has(key)) {
    throw new Error(`Missing provenance for token ${key}`);
  }
}

console.log(
  `Validated ${tokens.length} tokens, ${provenance.length} provenance records, and ${relationships.length} bridge relationships`,
);
