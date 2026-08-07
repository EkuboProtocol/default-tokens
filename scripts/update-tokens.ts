import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";
import {
  createCloudflareImages,
  hostTokenLogos,
  type ImageSourceCache,
} from "../src/cloudflare-images";
import {
  type CoinGeckoAssetPlatform,
  validateCoinGeckoAssetPlatforms,
  validateCoinGeckoTokenList,
} from "../src/coingecko";
import {
  enrichCoinGeckoSupplies,
  indexCoinGeckoTokenIds,
  type CoinGeckoCoin,
  type CoinGeckoMarket,
} from "../src/coingecko-supply";
import { fetchJson } from "../src/fetch-json";
import {
  COINGECKO_PRO_API_BASE_URL,
  COINGECKO_PRO_TOKEN_LISTS,
  COINGECKO_SUPPLY_PLATFORMS,
  CURATED_SOURCE,
  NATIVE_CURRENCIES,
  REMOTE_TOKEN_LISTS,
  STARKNET_AVNU_TOKEN_SOURCES,
  STARKNET_BRIDGE_TOKEN_LISTS,
  STARKNET_MAINNET_CHAIN_ID,
  TOKEN_REGISTRY_SOURCE,
} from "../src/sources";
import { validateTokenListSchema } from "../src/schema";
import {
  TokenAccumulator,
  assertHostedLogos,
  bridgeRelationshipKey,
  normalizeTokenAddress,
  validateBridgeRelationships,
  validateNativeCurrencies,
  validateTokenList,
} from "../src/token-list";
import type {
  BridgeRelationship,
  StandardTokenList,
  TokenListDocument,
  TokenSource,
} from "../src/types";

const root = resolve(import.meta.dir, "..");
const withoutRegistrations = process.argv.includes("--without-registrations");
const addressRegex = /^0x[a-fA-F0-9]+$/;
const coinGeckoMarketBatchSize = 200;

type AvnuToken = {
  name: string;
  address: string;
  symbol: string;
  decimals: number;
  logoUri?: string;
  extensions?: {
    coingeckoId?: string;
  };
};

type AvnuTokenResponse = {
  content?: AvnuToken[];
};

type StarknetBridgeToken = {
  l1_token_address?: string;
  l1_bridge_address?: string | null;
  l2_bridge_address?: string | null;
  l2_token_address?: string;
};

async function readJson<T>(path: string, fallback?: T): Promise<T> {
  try {
    return JSON.parse(await readFile(resolve(root, path), "utf8")) as T;
  } catch (error) {
    if (fallback !== undefined) return fallback;
    throw error;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(
    resolve(root, path),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

async function fetchCoinGeckoMarkets(
  coinIds: string[],
  headers: HeadersInit,
): Promise<CoinGeckoMarket[]> {
  const markets: CoinGeckoMarket[] = [];
  for (
    let offset = 0;
    offset < coinIds.length;
    offset += coinGeckoMarketBatchSize
  ) {
    const batch = coinIds.slice(offset, offset + coinGeckoMarketBatchSize);
    const parameters = new URLSearchParams({
      vs_currency: "usd",
      ids: batch.join(","),
      per_page: String(batch.length),
      page: "1",
      sparkline: "false",
      locale: "en",
      precision: "full",
    });
    const response = await fetchJson<CoinGeckoMarket[]>(
      `CoinGecko Pro markets batch ${offset / coinGeckoMarketBatchSize + 1}`,
      `${COINGECKO_PRO_API_BASE_URL}/coins/markets?${parameters}`,
      { headers },
    );
    if (!Array.isArray(response)) {
      throw new Error("CoinGecko Pro markets did not return an array");
    }
    const requestedIds = new Set(batch);
    const unexpectedMarket = response.find(
      (market) =>
        typeof market.id === "string" && !requestedIds.has(market.id),
    );
    if (unexpectedMarket?.id) {
      throw new Error(
        `CoinGecko Pro markets returned unexpected coin ${unexpectedMarket.id}`,
      );
    }
    markets.push(...response);
  }
  return markets;
}

function addRelationship(
  relationships: Map<string, BridgeRelationship>,
  relationship: BridgeRelationship,
  replace = false,
): void {
  const normalizedSourceAddress = normalizeTokenAddress(
    relationship.source_token_address,
    relationship.source_chain_id,
  );
  const normalizedDestinationAddress = normalizeTokenAddress(
    relationship.dest_token_address,
    relationship.dest_chain_id,
  );
  if (!normalizedSourceAddress || !normalizedDestinationAddress) return;

  const normalized = {
    ...relationship,
    source_token_address: normalizedSourceAddress,
    dest_token_address: normalizedDestinationAddress,
    source_bridge_address:
      relationship.source_bridge_address &&
      addressRegex.test(relationship.source_bridge_address)
        ? relationship.source_bridge_address
        : null,
  };
  const key = bridgeRelationshipKey(normalized);
  if (replace || !relationships.has(key)) relationships.set(key, normalized);
}

function addStandardTokenList(
  accumulator: TokenAccumulator,
  relationships: Map<string, BridgeRelationship>,
  source: TokenSource,
  list: StandardTokenList,
): number {
  if (!Array.isArray(list.tokens)) {
    throw new Error(`${source.name} did not return a token list`);
  }

  let added = 0;
  for (const token of list.tokens) {
    try {
      added += Number(
        accumulator.add(
          {
            chain_id: String(token.chainId),
            token_address: token.address,
            token_name: token.name,
            token_symbol: token.symbol,
            token_decimals: token.decimals,
            logo_url: token.logoURI ?? null,
            visibility_priority: source.visibilityPriority ?? -1,
            sort_order: 0,
          },
          source.name,
          source.url,
          token.extensions?.coinGeckoId ?? token.extensions?.coingeckoId,
        ),
      );
    } catch (error) {
      console.warn(
        `Skipping invalid token from ${source.name}: ${token.address}`,
        error,
      );
    }

    const sourceAddress = normalizeTokenAddress(
      token.address,
      String(token.chainId),
    );
    if (!sourceAddress) continue;

    for (const [destinationChainId, info] of Object.entries(
      token.extensions?.bridgeInfo ?? {},
    )) {
      if (!info?.tokenAddress) continue;
      addRelationship(
        relationships,
        {
          source_chain_id: String(token.chainId),
          source_token_address: sourceAddress,
          source_bridge_address: info.originBridgeAddress ?? null,
          dest_chain_id: destinationChainId,
          dest_token_address: info.tokenAddress,
        },
        true,
      );
    }
  }

  return added;
}

async function addRegisteredTokens(
  accumulator: TokenAccumulator,
): Promise<void> {
  const connectionString = process.env.PG_CONNECTION_STRING;
  if (!connectionString) {
    throw new Error(
      "PG_CONNECTION_STRING is required (or pass --without-registrations for a source-only local run)",
    );
  }

  const sql = postgres(connectionString, { connect_timeout: 10 });
  try {
    const tokens = await sql<
      {
        chain_id: bigint;
        token_address: string;
        token_name: string;
        token_symbol: string;
        token_decimals: number;
        total_supply: string;
      }[]
    >`
      SELECT chain_id,
             address AS token_address,
             name AS token_name,
             symbol AS token_symbol,
             decimals AS token_decimals,
             total_supply
      FROM latest_token_registrations_view
    `;

    let added = 0;
    for (const token of tokens) {
      added += Number(
        accumulator.add(
          {
            chain_id: token.chain_id.toString(),
            token_address: `0x${BigInt(token.token_address).toString(16)}`,
            token_name: token.token_name,
            token_symbol: token.token_symbol,
            token_decimals: token.token_decimals,
            total_supply: token.total_supply,
            logo_url: null,
            visibility_priority: -1,
            sort_order: -1,
          },
          TOKEN_REGISTRY_SOURCE.name,
          TOKEN_REGISTRY_SOURCE.url,
        ),
      );
    }
    console.log(`Added ${added} onchain-registered tokens`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main(): Promise<void> {
  const curatedDocument =
    await readJson<TokenListDocument>("curated-tokens.json");
  validateTokenListSchema(curatedDocument, "curated-tokens.json");
  validateNativeCurrencies(
    curatedDocument.tokens,
    NATIVE_CURRENCIES,
    "curated",
    "curated-tokens.json",
  );
  const previousDocument = await readJson<TokenListDocument>(
    "tokens.json",
    curatedDocument,
  );
  validateTokenListSchema(previousDocument, "tokens.json");
  const imageSourceCache = await readJson<ImageSourceCache>(
    "image-sources.json",
    {},
  );

  const accumulator = new TokenAccumulator();
  const relationships = new Map<string, BridgeRelationship>();

  for (const token of curatedDocument.tokens) {
    accumulator.add(token, CURATED_SOURCE.name, CURATED_SOURCE.url);
  }
  for (const relationship of curatedDocument.bridge_relationships) {
    addRelationship(relationships, relationship);
  }
  console.log(`Loaded ${accumulator.tokens.size} curated tokens`);

  if (!withoutRegistrations) await addRegisteredTokens(accumulator);

  for (const source of REMOTE_TOKEN_LISTS) {
    const list = await fetchJson<StandardTokenList>(source.name, source.url);
    const added = addStandardTokenList(
      accumulator,
      relationships,
      source,
      list,
    );
    console.log(`Added ${added} tokens from ${source.name}`);
  }

  const coinGeckoApiKey = process.env.COINGECKO_API_KEY?.trim();
  if (!coinGeckoApiKey) {
    throw new Error(
      "COINGECKO_API_KEY is required to download the CoinGecko Pro token lists",
    );
  }
  const coinGeckoHeaders = {
    "x-cg-pro-api-key": coinGeckoApiKey,
  };
  const coinGeckoPlatforms = await fetchJson<CoinGeckoAssetPlatform[]>(
    "CoinGecko Pro asset platforms",
    `${COINGECKO_PRO_API_BASE_URL}/asset_platforms`,
    { headers: coinGeckoHeaders },
  );
  validateCoinGeckoAssetPlatforms(
    coinGeckoPlatforms,
    COINGECKO_PRO_TOKEN_LISTS,
  );

  for (const source of COINGECKO_PRO_TOKEN_LISTS) {
    const list = await fetchJson<StandardTokenList>(source.name, source.url, {
      headers: coinGeckoHeaders,
    });
    validateCoinGeckoTokenList(list, source);
    const added = addStandardTokenList(
      accumulator,
      relationships,
      source,
      list,
    );
    console.log(`Added ${added} tokens from ${source.name}`);
  }

  const trackedAvnuAddresses = new Set<string>();
  for (const source of STARKNET_AVNU_TOKEN_SOURCES) {
    const response = await fetchJson<AvnuTokenResponse>(source.name, source.url);
    if (!Array.isArray(response.content)) {
      throw new Error(`${source.name} did not return a token page`);
    }

    let added = 0;
    for (const token of response.content) {
      if (
        !token.name ||
        !token.symbol ||
        typeof token.decimals !== "number" ||
        !addressRegex.test(token.address)
      ) {
        continue;
      }
      const addressKey = token.address.toLowerCase();
      if (source.skipIfTracked && trackedAvnuAddresses.has(addressKey)) continue;
      trackedAvnuAddresses.add(addressKey);

      added += Number(
        accumulator.add(
          {
            chain_id: STARKNET_MAINNET_CHAIN_ID.toString(),
            token_address: token.address,
            token_name: token.name,
            token_symbol: token.symbol,
            token_decimals: token.decimals,
            logo_url: token.logoUri ?? null,
            visibility_priority: source.visibilityPriority,
            sort_order: 0,
          },
          source.name,
          source.url,
          token.extensions?.coingeckoId,
        ),
      );
    }
    console.log(`Added ${added} tokens from ${source.name}`);
  }

  for (const source of STARKNET_BRIDGE_TOKEN_LISTS) {
    const bridgeTokens = await fetchJson<StarknetBridgeToken[]>(
      source.name,
      source.url,
    );
    if (!Array.isArray(bridgeTokens)) {
      throw new Error(`${source.name} did not return an array`);
    }

    for (const token of bridgeTokens) {
      if (!token.l1_token_address || !token.l2_token_address) continue;
      addRelationship(
        relationships,
        {
          source_chain_id: source.l1ChainId.toString(),
          source_token_address: token.l1_token_address,
          source_bridge_address: token.l1_bridge_address ?? null,
          dest_chain_id: source.l2ChainId.toString(),
          dest_token_address: token.l2_token_address,
        },
        true,
      );
      addRelationship(
        relationships,
        {
          source_chain_id: source.l2ChainId.toString(),
          source_token_address: token.l2_token_address,
          source_bridge_address: token.l2_bridge_address ?? null,
          dest_chain_id: source.l1ChainId.toString(),
          dest_token_address: token.l1_token_address,
        },
        true,
      );
    }
  }
  console.log(`Discovered ${relationships.size} bridge relationships`);

  const tokens = [...accumulator.tokens.values()];
  const coinGeckoCoins = await fetchJson<CoinGeckoCoin[]>(
    "CoinGecko Pro coins list",
    `${COINGECKO_PRO_API_BASE_URL}/coins/list?include_platform=true`,
    { headers: coinGeckoHeaders },
  );
  const { idsByToken, ambiguousTokenKeys } = indexCoinGeckoTokenIds(
    tokens,
    coinGeckoCoins,
    coinGeckoPlatforms,
    COINGECKO_SUPPLY_PLATFORMS,
    accumulator.coinGeckoIds,
  );
  const coinGeckoMarkets = await fetchCoinGeckoMarkets(
    [...new Set(idsByToken.values())].sort(),
    coinGeckoHeaders,
  );
  const supplyStats = enrichCoinGeckoSupplies(
    tokens,
    idsByToken,
    coinGeckoMarkets,
  );
  const totalSupplyCount = tokens.filter(
    (token) => token.total_supply != null,
  ).length;
  const circulatingSupplyCount = tokens.filter(
    (token) => token.circulating_supply != null,
  ).length;
  console.log(
    [
      `CoinGecko supply enrichment mapped ${supplyStats.tokensWithCoinGeckoId}/${tokens.length} tokens (${ambiguousTokenKeys.length} ambiguous)`,
      `found market data for ${supplyStats.tokensWithMarketData}`,
      `added ${supplyStats.circulatingSuppliesAdded} circulating and ${supplyStats.totalSuppliesAdded} total supplies`,
      `finished with ${circulatingSupplyCount} circulating and ${totalSupplyCount} total supplies`,
      `skipped ${supplyStats.invalidSupplyValues} invalid values`,
      `observed ${supplyStats.inconsistentCoinGeckoSupplies} upstream supply inconsistencies`,
    ].join(", "),
  );

  const cloudflareAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const cloudflareApiToken = process.env.CLOUDFLARE_API_TOKEN;
  const cloudflareDeliveryHash =
    process.env.CLOUDFLARE_IMAGES_DELIVERY_HASH;
  const cloudflareVariant = process.env.CLOUDFLARE_IMAGES_VARIANT ?? "logo";
  const cloudflareRequestIntervalMs = Number(
    process.env.CLOUDFLARE_IMAGES_REQUEST_INTERVAL_MS ?? "300",
  );
  if (
    !cloudflareAccountId ||
    !cloudflareApiToken ||
    !cloudflareDeliveryHash
  ) {
    throw new Error(
      "CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, and CLOUDFLARE_IMAGES_DELIVERY_HASH are required",
    );
  }
  if (
    !Number.isFinite(cloudflareRequestIntervalMs) ||
    cloudflareRequestIntervalMs < 0
  ) {
    throw new Error(
      "CLOUDFLARE_IMAGES_REQUEST_INTERVAL_MS must be a non-negative number",
    );
  }

  const provenance = [...accumulator.provenance.values()];
  const bridgeRelationships = [...relationships.values()];
  const cache = await hostTokenLogos({
    tokens,
    previousTokens: previousDocument.tokens,
    imageSourceCache,
    logoCandidates: accumulator.logoCandidates,
    cloudflare: await createCloudflareImages({
      accountId: cloudflareAccountId,
      apiToken: cloudflareApiToken,
      deliveryHash: cloudflareDeliveryHash,
      variant: cloudflareVariant,
      requestIntervalMs: cloudflareRequestIntervalMs,
    }),
  });

  validateTokenList(tokens);
  validateBridgeRelationships(bridgeRelationships);
  validateNativeCurrencies(
    tokens,
    NATIVE_CURRENCIES,
    "generated",
    "tokens.json",
  );
  assertHostedLogos(tokens, cloudflareDeliveryHash, cloudflareVariant);
  const tokenList = {
    $schema: "./token-list.schema.json",
    tokens,
    bridge_relationships: bridgeRelationships,
  } satisfies TokenListDocument;
  validateTokenListSchema(tokenList);

  await Promise.all([
    writeJson("tokens.json", tokenList),
    writeJson("token-sources.json", provenance),
    writeJson("image-sources.json", cache),
  ]);

  console.log(
    `Wrote ${tokens.length} tokens and ${bridgeRelationships.length} bridge relationships`,
  );
}

main().catch((error) => {
  console.error("Token-list update failed", error);
  process.exitCode = 1;
});
