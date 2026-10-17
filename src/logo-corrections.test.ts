import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "bun:test";
import { CloudflareImages, hostTokenLogos } from "./cloudflare-images";
import { CURATED_SOURCE, REMOTE_TOKEN_LISTS } from "./sources";
import { TokenAccumulator, tokenKey } from "./token-list";
import type { Token, TokenListDocument } from "./types";

const root = resolve(import.meta.dir, "..");
const curated = JSON.parse(
  readFileSync(resolve(root, "curated-tokens.json"), "utf8"),
) as TokenListDocument;

const ASSET_URL_PREFIX =
  "https://raw.githubusercontent.com/EkuboProtocol/default-tokens/main/";

// Velodrome Finance's VELO on Optimism and the unrelated Velo token on BNB
// Smart Chain share a symbol. The Uniswap default list gives the Optimism token
// CoinGecko's image for the BNB token (coin image 12538); CoinGecko maps the
// Optimism address to Velodrome (coin image 25783).
const OPTIMISM_VELO = {
  chainId: "10",
  address: "0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db",
};
const BNB_VELO = {
  chainId: "56",
  address: "0xf486ad071f3bEE968384D2E39e2D8aF0fCf6fd46",
};
const UNISWAP_OPTIMISM_VELO_LOGO =
  "https://assets.coingecko.com/coins/images/12538/standard/Logo_200x_200.png?1696512350";
const UNISWAP_BNB_VELO_LOGO =
  "https://coin-images.coingecko.com/coins/images/12538/large/Logo_200x_200.png?1696512350";
const BAD_HOSTED_LOGO =
  "https://imagedelivery.net/delivery/token-logos/459addd0d30cec686b2967e17d7e895c90b8e5c0652be432d4499b23ebe24211/logo";

function curatedToken(chainId: string, address: string): Token | undefined {
  const key = tokenKey(chainId, address);
  return curated.tokens.find(
    (token) => tokenKey(token.chain_id, token.token_address) === key,
  );
}

function uniswapToken(
  chainId: string,
  address: string,
  name: string,
  logoUrl: string,
): Token {
  return {
    chain_id: chainId,
    token_address: address,
    token_name: name,
    token_symbol: "VELO",
    token_decimals: 18,
    logo_url: logoUrl,
    visibility_priority: 1,
    sort_order: 0,
  };
}

test("curates Velodrome's own logo for VELO on Optimism", () => {
  const velodrome = curatedToken(OPTIMISM_VELO.chainId, OPTIMISM_VELO.address);
  expect(velodrome?.token_name).toBe("Velodrome Finance");
  expect(velodrome?.token_symbol).toBe("VELO");
  expect(velodrome?.logo_url).toBe(
    `${ASSET_URL_PREFIX}assets/velodrome-velo.png`,
  );
  expect(existsSync(resolve(root, "assets/velodrome-velo.png"))).toBe(true);

  const bnbVelo = curatedToken(BNB_VELO.chainId, BNB_VELO.address);
  expect(bnbVelo?.logo_url ?? null).not.toBe(velodrome?.logo_url);
});

// Tokens whose upstream logo shows a different asset, found by comparing the
// whole list with CoinGecko's own image for each exact chain and address. Each
// is curated with the image CoinGecko assigns to that address.
const COINGECKO_LOGO_CORRECTIONS = [
  {
    // The 1inch list serves Darwinia's RING (Ethereum) image for OneRing.
    chainId: "250",
    address: "0x582423c10c9e83387a96d00a69ba3d11ee47b7b5",
    coinGeckoImageId: "23273",
  },
  {
    // Stader's liquid-staking BNBx, shown with the plain BNB logo upstream.
    chainId: "56",
    address: "0x1bdd3cf7f79cfb8edbb955f20ad99211551ba275",
    coinGeckoImageId: "26842",
  },
  {
    // Binance's staked ETH, shown with the plain ETH logo upstream.
    chainId: "56",
    address: "0x250632378E573c6Be1AC2f97Fcdf00515d0Aa91B",
    coinGeckoImageId: "13804",
  },
];

test.each(COINGECKO_LOGO_CORRECTIONS)(
  "curates CoinGecko's own logo for $chainId:$address",
  ({ chainId, address, coinGeckoImageId }) => {
    expect(curatedToken(chainId, address)?.logo_url).toStartWith(
      `https://coin-images.coingecko.com/coins/images/${coinGeckoImageId}/`,
    );
  },
);

test("keeps the two VELO tokens separate with different logos through hosting", async () => {
  const velodrome = curatedToken(OPTIMISM_VELO.chainId, OPTIMISM_VELO.address);
  if (!velodrome) throw new Error("Velodrome VELO is not curated");
  const uniswap = REMOTE_TOKEN_LISTS[0];
  if (uniswap?.name !== "Uniswap Default Token List") {
    throw new Error("The Uniswap default list is no longer the first source");
  }

  const accumulator = new TokenAccumulator();
  accumulator.add(velodrome, CURATED_SOURCE.name, CURATED_SOURCE.url);
  accumulator.add(
    uniswapToken(
      OPTIMISM_VELO.chainId,
      OPTIMISM_VELO.address,
      "Velodrome Finance",
      UNISWAP_OPTIMISM_VELO_LOGO,
    ),
    uniswap.name,
    uniswap.url,
  );
  accumulator.add(
    uniswapToken(
      BNB_VELO.chainId,
      BNB_VELO.address,
      "Velo",
      UNISWAP_BNB_VELO_LOGO,
    ),
    uniswap.name,
    uniswap.url,
  );

  const optimismKey = tokenKey(OPTIMISM_VELO.chainId, OPTIMISM_VELO.address);
  const bnbKey = tokenKey(BNB_VELO.chainId, BNB_VELO.address);
  expect(optimismKey).not.toBe(bnbKey);
  expect(accumulator.provenance.get(optimismKey)?.source_name).toBe(
    CURATED_SOURCE.name,
  );

  const tokens = [...accumulator.tokens.values()];
  // The previous run's hosted image and the cached Uniswap source both point at
  // the BNB token's artwork; neither may win over the curated logo.
  await hostTokenLogos({
    tokens,
    previousTokens: tokens.map((token) => ({
      ...token,
      logo_url: BAD_HOSTED_LOGO,
    })),
    imageSourceCache: {
      [UNISWAP_OPTIMISM_VELO_LOGO]: BAD_HOSTED_LOGO,
      [UNISWAP_BNB_VELO_LOGO]: BAD_HOSTED_LOGO,
    },
    logoCandidates: accumulator.logoCandidates,
    cloudflare: new CloudflareImages({
      accountId: "account",
      apiToken: "token",
      deliveryHash: "delivery",
      variant: "logo",
      requestIntervalMs: 0,
      fetch: (async (_input) =>
        new Response(null, { status: 200 })) as typeof fetch,
    }),
  });

  const hostedOptimism = accumulator.tokens.get(optimismKey)?.logo_url;
  const hostedBnb = accumulator.tokens.get(bnbKey)?.logo_url;
  expect(hostedOptimism).toStartWith(
    "https://imagedelivery.net/delivery/token-logos/",
  );
  expect(hostedOptimism).not.toBe(BAD_HOSTED_LOGO);
  expect(hostedBnb).toBe(BAD_HOSTED_LOGO);
  expect(hostedOptimism).not.toBe(hostedBnb);
});
