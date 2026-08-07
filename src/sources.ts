import type {
  CoinGeckoSupplyPlatform,
  CoinGeckoTokenSource,
  NativeCurrency,
  TokenSource,
} from "./types";

export const COINGECKO_PRO_API_BASE_URL =
  "https://pro-api.coingecko.com/api/v3";

export const STARKNET_MAINNET_CHAIN_ID = 0x534e5f4d41494en;

function coinGeckoTokenSource(
  assetPlatformId: string,
  expectedChainId: number,
  chainName: string,
): CoinGeckoTokenSource {
  return {
    name: `CoinGecko Pro ${chainName} Token List`,
    url: `${COINGECKO_PRO_API_BASE_URL}/token_lists/${assetPlatformId}/all.json`,
    assetPlatformId,
    expectedChainId: String(expectedChainId),
    visibilityPriority: 0,
  };
}

export const CURATED_SOURCE = {
  name: "Ekubo curated tokens",
  url: "curated-tokens.json",
} as const;

export const TOKEN_REGISTRY_SOURCE = {
  name: "Ekubo onchain token registrations",
  url: "latest_token_registrations_view",
} as const;

export const REMOTE_TOKEN_LISTS: TokenSource[] = [
  {
    name: "Uniswap Default Token List",
    url: "https://ipfs.io/ipns/tokens.uniswap.org",
    visibilityPriority: 1,
  },
  {
    name: "1inch Token List",
    url: "https://tokens.1inch.eth.link",
    visibilityPriority: 0,
  },
  {
    name: "CoinGecko All Token List",
    url: "https://tokens.coingecko.com/uniswap/all.json",
    visibilityPriority: 0,
  },
  {
    name: "Aave Token List",
    url: "https://tokenlist.aave.eth.link",
  },
  {
    name: "Compound Token List",
    url: "https://raw.githubusercontent.com/compound-finance/token-list/master/compound.tokenlist.json",
  },
  {
    name: "Tempo Mainnet Token List",
    url: "https://tokenlist.tempo.xyz/list/4217",
  },
  {
    name: "Tempo Testnet Token List",
    url: "https://tokenlist.tempo.xyz/list/42431",
  },
  {
    name: "MegaETH Token List",
    url: "https://raw.githubusercontent.com/megaeth-labs/mega-tokenlist/refs/heads/main/megaeth.tokenlist.json",
    visibilityPriority: 1,
  },
  {
    name: "Monad Token List",
    url: "https://raw.githubusercontent.com/monad-crypto/token-list/refs/heads/main/tokenlist-mainnet.json",
    visibilityPriority: 1,
  },
];

// Ethereum is already covered by the public CoinGecko list above. These
// mappings are intentionally explicit so a CoinGecko platform change cannot
// silently write tokens to the wrong chain.
export const COINGECKO_PRO_TOKEN_LISTS: CoinGeckoTokenSource[] = [
  coinGeckoTokenSource("optimistic-ethereum", 10, "Optimism"),
  coinGeckoTokenSource("binance-smart-chain", 56, "BNB Smart Chain"),
  coinGeckoTokenSource("xdai", 100, "Gnosis"),
  coinGeckoTokenSource("unichain", 130, "Unichain"),
  coinGeckoTokenSource("polygon-pos", 137, "Polygon"),
  coinGeckoTokenSource("monad", 143, "Monad"),
  coinGeckoTokenSource("x-layer", 196, "X Layer"),
  coinGeckoTokenSource("fantom", 250, "Fantom"),
  coinGeckoTokenSource("zksync", 324, "ZKsync"),
  coinGeckoTokenSource("world-chain", 480, "World Chain"),
  coinGeckoTokenSource("soneium", 1868, "Soneium"),
  coinGeckoTokenSource("megaeth", 4326, "MegaETH"),
  coinGeckoTokenSource("robinhood", 4663, "Robinhood Chain"),
  coinGeckoTokenSource("klay-token", 8217, "Kaia"),
  coinGeckoTokenSource("base", 8453, "Base"),
  coinGeckoTokenSource("arbitrum-one", 42161, "Arbitrum One"),
  coinGeckoTokenSource("celo", 42220, "Celo"),
  coinGeckoTokenSource("avalanche", 43114, "Avalanche"),
  coinGeckoTokenSource("ink", 57073, "Ink"),
  coinGeckoTokenSource("linea", 59144, "Linea"),
  coinGeckoTokenSource("berachain", 80094, "Berachain"),
  coinGeckoTokenSource("blast", 81457, "Blast"),
  coinGeckoTokenSource("zora-network", 7777777, "Zora"),
  coinGeckoTokenSource("aurora", 1313161554, "Aurora"),
];

// The chains the Ekubo wallet MCP server configures on first run, from
// `default_networks()` in `ekubo-wallet-core`. That wallet vendors this
// repository's `tokens.json` as its compiled-in default list, and a chain with
// no source here leaves it rendering bare addresses on an approval screen for
// a network it ships configured. Every entry must be covered by a source
// above; Ethereum comes from the public CoinGecko list in
// `REMOTE_TOKEN_LISTS`, the rest from `COINGECKO_PRO_TOKEN_LISTS`.
export const WALLET_DEFAULT_NETWORK_CHAIN_IDS = [
  "1", // Ethereum Mainnet
  "10", // OP Mainnet
  "100", // Gnosis
  "143", // Monad
  "4326", // MegaETH
  "4663", // Robinhood Chain
  "8453", // Base
  "42161", // Arbitrum One
  "57073", // Ink
  "80094", // Berachain
] as const;

// The asset gas is paid in on each EVM chain in this list, recorded at token
// address zero. `normalizeTokenAddress` folds `0x0`, `0xEeee…eEEeE`, and
// `0x455448` into one address, so a chain has exactly one native row, and
// `curated-tokens.json` carries it: a wallet rendering a native transfer
// should not depend on a third-party list continuing to publish the row.
// Names, symbols, and decimals are taken from each chain's own published
// profile and pinned here so a remote list cannot relabel a native asset —
// putting ETH on Berachain, say — without failing validation.
//
// Tempo (4217, 42431) is deliberately absent. It has no native currency; gas
// there is paid in stablecoins, so nothing belongs at address zero.
export const NATIVE_CURRENCIES: NativeCurrency[] = [
  { chainId: "1", name: "Ether", symbol: "ETH", decimals: 18 },
  { chainId: "10", name: "Ether", symbol: "ETH", decimals: 18 },
  { chainId: "56", name: "BNB", symbol: "BNB", decimals: 18 },
  { chainId: "100", name: "xDAI", symbol: "xDAI", decimals: 18 },
  { chainId: "130", name: "Ether", symbol: "ETH", decimals: 18 },
  {
    chainId: "137",
    name: "Polygon Ecosystem Token",
    symbol: "POL",
    decimals: 18,
  },
  { chainId: "143", name: "Monad", symbol: "MON", decimals: 18 },
  { chainId: "196", name: "OKB", symbol: "OKB", decimals: 18 },
  { chainId: "250", name: "Fantom Token", symbol: "FTM", decimals: 18 },
  { chainId: "324", name: "Ether", symbol: "ETH", decimals: 18 },
  { chainId: "480", name: "Ether", symbol: "ETH", decimals: 18 },
  { chainId: "1868", name: "Ether", symbol: "ETH", decimals: 18 },
  { chainId: "4326", name: "Ether", symbol: "ETH", decimals: 18 },
  { chainId: "4663", name: "Ether", symbol: "ETH", decimals: 18 },
  { chainId: "8217", name: "Kaia", symbol: "KAIA", decimals: 18 },
  { chainId: "8453", name: "Ether", symbol: "ETH", decimals: 18 },
  { chainId: "42161", name: "Ether", symbol: "ETH", decimals: 18 },
  { chainId: "42220", name: "Celo", symbol: "CELO", decimals: 18 },
  { chainId: "43114", name: "Avalanche", symbol: "AVAX", decimals: 18 },
  { chainId: "46630", name: "Ether", symbol: "ETH", decimals: 18 },
  { chainId: "57073", name: "Ether", symbol: "ETH", decimals: 18 },
  { chainId: "59144", name: "Ether", symbol: "ETH", decimals: 18 },
  { chainId: "80094", name: "Berachain", symbol: "BERA", decimals: 18 },
  { chainId: "81457", name: "Ether", symbol: "ETH", decimals: 18 },
  { chainId: "84532", name: "Ether", symbol: "ETH", decimals: 18 },
  { chainId: "421614", name: "Ether", symbol: "ETH", decimals: 18 },
  { chainId: "7777777", name: "Ether", symbol: "ETH", decimals: 18 },
  { chainId: "11155111", name: "Ether", symbol: "ETH", decimals: 18 },
  { chainId: "1313161554", name: "Ether", symbol: "ETH", decimals: 18 },
];

export const COINGECKO_SUPPLY_PLATFORMS: CoinGeckoSupplyPlatform[] = [
  {
    assetPlatformId: "ethereum",
    chainId: "1",
    expectedChainIdentifier: "1",
  },
  ...COINGECKO_PRO_TOKEN_LISTS.map((source) => ({
    assetPlatformId: source.assetPlatformId,
    chainId: source.expectedChainId,
    expectedChainIdentifier: source.expectedChainId,
  })),
  {
    assetPlatformId: "starknet",
    chainId: STARKNET_MAINNET_CHAIN_ID.toString(),
    expectedChainIdentifier: null,
  },
];

export const STARKNET_AVNU_TOKEN_SOURCES = [
  {
    name: "AVNU Starknet tokens",
    url: "https://starknet.api.avnu.fi/v1/starknet/tokens?page=0&size=200&tag=AVNU",
    visibilityPriority: 1,
    skipIfTracked: false,
  },
  {
    name: "AVNU verified Starknet tokens",
    url: "https://starknet.api.avnu.fi/v1/starknet/tokens?page=0&size=200&tag=Verified",
    visibilityPriority: 0,
    skipIfTracked: true,
  },
] as const;

export const STARKNET_BRIDGE_TOKEN_LISTS = [
  {
    name: "Starknet mainnet bridged tokens",
    url: "https://raw.githubusercontent.com/starknet-io/starknet-addresses/refs/heads/master/bridged_tokens/mainnet.json",
    l1ChainId: 1n,
    l2ChainId: 0x534e5f4d41494en,
  },
  {
    name: "Starknet Sepolia bridged tokens",
    url: "https://raw.githubusercontent.com/starknet-io/starknet-addresses/refs/heads/master/bridged_tokens/sepolia.json",
    l1ChainId: 11155111n,
    l2ChainId: 0x534e5f4d41494fn,
  },
] as const;
