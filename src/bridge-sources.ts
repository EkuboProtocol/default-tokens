import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  bridgeReadLinks,
  type BridgeRead,
  BridgeCollector,
  finalizeBridgeLinks,
  issuerLinks,
  logBridgeReport,
  restorePreviousLinks,
  tokenKeysOf,
  linksFromTokenList,
  nativeEthLinks,
  parseCircleRegistry,
  starkgateLinks,
  superchainLinks,
  type ProvenancedLink,
  type StarknetBridgeToken,
} from "./bridges";
import { fetchJson } from "./fetch-json";
import {
  ARBITRUM_BRIDGE_TOKEN_LISTS,
  BRIDGE_READS_SOURCE,
  CIRCLE_ISSUER_REGISTRIES,
  CURATED_SOURCE,
  STARKNET_BRIDGE_TOKEN_LISTS,
  SUPERCHAIN_TOKEN_LIST,
} from "./sources";
import type {
  BridgeRelationship,
  StandardTokenList,
  Token,
} from "./types";

export type CollectedLinks = {
  // In precedence order: earlier batches win a contested key.
  batches: ProvenancedLink[][];
  skippedSources: string[];
};

const BRIDGE_READS_PATH = resolve(import.meta.dir, "..", "bridge-reads.json");

type Loader = { name: string; load: () => Promise<ProvenancedLink[]> };

function loaders(): Loader[] {
  return [
    ...CIRCLE_ISSUER_REGISTRIES.map((registry) => ({
      name: registry.name,
      load: async () =>
        issuerLinks(
          parseCircleRegistry(
            await fetchJson<string>(registry.name, registry.url, {
              parse: (response) => response.text(),
            }),
          ),
          registry,
          registry.issuer,
        ),
    })),
    {
      name: "Ekubo rollup native ether registry",
      load: async () => nativeEthLinks(),
    },
    ...STARKNET_BRIDGE_TOKEN_LISTS.map((source) => ({
      name: source.name,
      load: async () => {
        const tokens = await fetchJson<StarknetBridgeToken[]>(
          source.name,
          source.url,
        );
        if (!Array.isArray(tokens)) {
          throw new Error(`${source.name} did not return an array`);
        }
        return starkgateLinks(tokens, source);
      },
    })),
    {
      name: SUPERCHAIN_TOKEN_LIST.name,
      load: async () =>
        superchainLinks(
          await fetchJson<StandardTokenList>(
            SUPERCHAIN_TOKEN_LIST.name,
            SUPERCHAIN_TOKEN_LIST.url,
          ),
        ),
    },
    ...ARBITRUM_BRIDGE_TOKEN_LISTS.map((source) => ({
      name: source.name,
      load: async () =>
        linksFromTokenList(
          await fetchJson<StandardTokenList>(source.name, source.url),
          source,
        ),
    })),
    {
      name: BRIDGE_READS_SOURCE.name,
      load: async () => {
        const snapshot = JSON.parse(
          await readFile(BRIDGE_READS_PATH, "utf8"),
        ) as { links?: BridgeRead[] };
        if (!Array.isArray(snapshot.links)) {
          throw new Error(`${BRIDGE_READS_SOURCE.url} has no links array`);
        }
        return bridgeReadLinks(snapshot.links, BRIDGE_READS_SOURCE);
      },
    },
  ];
}

/**
 * Fetch every source that is read only for cross-chain links. A source that
 * cannot be read is skipped and reported, like a skipped token source; the
 * caller restores that source's links from the previous output.
 */
export async function collectBridgeSourceLinks(): Promise<CollectedLinks> {
  const batches: ProvenancedLink[][] = [];
  const skippedSources: string[] = [];
  for (const loader of loaders()) {
    try {
      const links = await loader.load();
      if (links.length === 0) throw new Error("returned no links");
      batches.push(links);
      console.log(`Read ${links.length} candidate links from ${loader.name}`);
    } catch (error) {
      skippedSources.push(loader.name);
      console.warn(
        `Skipping ${loader.name}: ${error instanceof Error ? error.message : String(error)}. This run publishes the previous run's links for that source.`,
      );
    }
  }
  return { batches, skippedSources };
}

function curatedLink(relationship: BridgeRelationship): ProvenancedLink {
  return {
    ...relationship,
    relationship: relationship.relationship ?? "unknown",
    bridge_name: relationship.bridge_name ?? null,
    source_name: relationship.source_name ?? CURATED_SOURCE.name,
    source_url: relationship.source_url ?? CURATED_SOURCE.url,
  };
}

/**
 * Build the published links: curated links first, then the bridge-only
 * sources in trust order, then links read from the token lists, then the
 * previous run's links for any source skipped this run. Only links between
 * two tokens in `tokens` are kept.
 */
export function buildBridgeRelationships(options: {
  tokens: Token[];
  curated: BridgeRelationship[];
  batches: ProvenancedLink[][];
  listLinks: ProvenancedLink[];
  previous: BridgeRelationship[];
  skippedSources: string[];
}): ProvenancedLink[] {
  const collector = new BridgeCollector(tokenKeysOf(options.tokens));
  collector.addAll(options.curated.map(curatedLink));
  for (const batch of options.batches) collector.addAll(batch);
  collector.addAll(options.listLinks);
  const restored = restorePreviousLinks(
    collector,
    options.previous,
    options.skippedSources,
  );
  if (restored > 0) {
    console.warn(`Restored ${restored} links from the previous generated list`);
  }
  const { relationships, report } = finalizeBridgeLinks(collector);
  logBridgeReport(report);
  return relationships;
}
