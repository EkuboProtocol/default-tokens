import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildBridgeRelationships,
  collectBridgeSourceLinks,
} from "../src/bridge-sources";
import { linksFromTokenList, type ProvenancedLink } from "../src/bridges";
import { fetchJson } from "../src/fetch-json";
import { validateTokenListSchema } from "../src/schema";
import { REMOTE_TOKEN_LISTS } from "../src/sources";
import {
  validateBridgeRelationships,
  validateGeneratedBridgeRelationships,
} from "../src/token-list";
import type { StandardTokenList, TokenListDocument } from "../src/types";

const root = resolve(import.meta.dir, "..");

async function readDocument(path: string): Promise<TokenListDocument> {
  const document = JSON.parse(
    await readFile(resolve(root, path), "utf8"),
  ) as unknown;
  validateTokenListSchema(document, path);
  return document;
}

async function tokenListLinks(): Promise<{
  links: ProvenancedLink[];
  skipped: string[];
}> {
  const links: ProvenancedLink[] = [];
  const skipped: string[] = [];
  for (const source of REMOTE_TOKEN_LISTS) {
    if (!source.bridgeInfo && !source.crossChainAddresses) continue;
    try {
      const list = await fetchJson<StandardTokenList>(source.name, source.url);
      const found = linksFromTokenList(list, source);
      console.log(`Read ${found.length} candidate links from ${source.name}`);
      links.push(...found);
    } catch (error) {
      skipped.push(source.name);
      console.warn(`Skipping ${source.name}: ${String(error)}`);
    }
  }
  return { links, skipped };
}

const [curated, previous] = await Promise.all([
  readDocument("curated-tokens.json"),
  readDocument("tokens.json"),
]);
const bridgeSources = await collectBridgeSourceLinks();
const listLinks = await tokenListLinks();
const relationships = buildBridgeRelationships({
  tokens: previous.tokens,
  curated: curated.bridge_relationships,
  batches: bridgeSources.batches,
  listLinks: listLinks.links,
  previous: previous.bridge_relationships,
  skippedSources: [...bridgeSources.skippedSources, ...listLinks.skipped],
});
validateBridgeRelationships(relationships);
validateGeneratedBridgeRelationships(relationships, previous.tokens);
const document = { ...previous, bridge_relationships: relationships };
validateTokenListSchema(document, "tokens.json");
await writeFile(
  resolve(root, "tokens.json"),
  `${JSON.stringify(document, null, 2)}\n`,
);
console.log(`Wrote ${relationships.length} bridge relationships`);
