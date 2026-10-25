import type {
  CoinGeckoSupplyPlatform,
  CoinGeckoTokenSource,
  NativeCurrency,
  TokenSource,
} from "./types";

export function sourceVisibilityPriority(
  source: TokenSource,
  chainId: string,
): number {
  return (
    source.visibilityPriorityByChainId?.[chainId] ??
    source.visibilityPriority ??
    -1
  );
}

export const COINGECKO_PRO_API_BASE_URL =
  "https://pro-api.coingecko.com/api/v3";

export const STARKNET_MAINNET_CHAIN_ID = 0x534e5f4d41494en;

// Public IPFS gateway used to resolve `ipfs://` logo sources. ipfs.io is
// retired (it answers 429 with a sunset notice), so this must stay a gateway
// that serves raw content over plain HTTPS.
export const IPFS_GATEWAY_BASE_URL = "https://gateway.pinata.cloud";

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

// Tokens of zero-seed launches, written by `bun run update-launch-tokens
// --write` from the Ekubo API's launch list. Second in precedence, after the
// curated tokens and before everything else.
export const LAUNCH_TOKENS_SOURCE = {
  name: "Ekubo zero-seed launches",
  url: "launch-tokens.json",
} as const;

export const TOKEN_REGISTRY_SOURCE = {
  name: "Ekubo onchain token registrations",
  url: "latest_token_registrations_view",
} as const;

export const LAUNCH_SOURCE = {
  name: "Ekubo zero-seed launches",
  url: "launch-tokens.json",
} as const;

// Chains whose zero-seed launch deployment the launch-token job reads. Empty
// until the launch contracts are deployed: with no chain enabled the job
// fetches nothing. `EKUBO_LAUNCH_CHAIN_IDS` overrides it for a run.
export const LAUNCH_CHAIN_IDS: readonly string[] = [];

export const PREVIOUS_OUTPUT_SOURCE = {
  name: "Previous generated token list",
  url: "tokens.json",
} as const;

export const REMOTE_TOKEN_LISTS: TokenSource[] = [
  {
    name: "Uniswap Default Token List",
    url: "https://tokens.uniswap.org",
    visibilityPriority: 1,
    visibilityPriorityByChainId: {
      // Uniswap's Unichain entries are generated mirrors of its Ethereum list:
      // about 300 canonical-bridge addresses, nearly all with little or no
      // supply on Unichain. At priority 1 they filled the interface's default
      // Unichain token picker with tokens nobody can trade there. Keep them
      // searchable instead; curated Unichain tokens stay prominent.
      "130": 0,
    },
    bridgeInfo: { relationship: "unknown", bridgeName: null },
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
    name: "MegaETH Token List",
    url: "https://raw.githubusercontent.com/megaeth-labs/mega-tokenlist/refs/heads/main/megaeth.tokenlist.json",
    visibilityPriority: 1,
  },
  {
    name: "Monad Token List",
    url: "https://raw.githubusercontent.com/monad-crypto/token-list/refs/heads/main/tokenlist-mainnet.json",
    visibilityPriority: 1,
    crossChainAddresses: true,
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
// Tempo (4217) is deliberately absent. It has no native currency; gas there is
// paid in stablecoins, so nothing belongs at address zero.
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
  { chainId: "57073", name: "Ether", symbol: "ETH", decimals: 18 },
  { chainId: "59144", name: "Ether", symbol: "ETH", decimals: 18 },
  { chainId: "80094", name: "Berachain", symbol: "BERA", decimals: 18 },
  { chainId: "81457", name: "Ether", symbol: "ETH", decimals: 18 },
  { chainId: "7777777", name: "Ether", symbol: "ETH", decimals: 18 },
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
] as const;

// Sources read only for cross-chain links, in the order they are trusted. A
// link is keyed by its source token and destination chain; the first source to
// claim a key wins, and a later source naming a different counterpart for it is
// reported as a conflict. Issuer registries come first because the issuer is
// the authority on its own deployments; they never compete with a canonical
// bridge copy for the same key unless the two disagree, which is reported.
// Links from the token lists in `REMOTE_TOKEN_LISTS` are added after all of
// these.

export const CIRCLE_ISSUER_REGISTRIES = [
  {
    name: "Circle USDC contract addresses",
    url: "https://developers.circle.com/stablecoins/usdc-contract-addresses.md",
    issuer: "Circle (USDC)",
  },
  {
    name: "Circle EURC contract addresses",
    url: "https://developers.circle.com/stablecoins/eurc-contract-addresses.md",
    issuer: "Circle (EURC)",
  },
] as const;

export const CIRCLE_BLOCKCHAIN_CHAIN_IDS: Record<string, string> = {
  Arbitrum: "42161",
  "Avalanche C-Chain": "43114",
  Base: "8453",
  Celo: "42220",
  Ethereum: "1",
  Ink: "57073",
  Linea: "59144",
  Monad: "143",
  "OP Mainnet": "10",
  "Polygon PoS": "137",
  Starknet: STARKNET_MAINNET_CHAIN_ID.toString(),
  Unichain: "130",
  "World Chain": "480",
  "X Layer": "196",
  "ZKsync Era": "324",
};

export const CANONICAL_ETH_ROLLUPS = [
  {
    chainId: "10",
    bridge: "OP Mainnet standard bridge",
    evidence: "https://l2beat.com/scaling/projects/op-mainnet",
    wrappedEth: "0x4200000000000000000000000000000000000006",
  },
  {
    chainId: "130",
    bridge: "Unichain standard bridge",
    evidence: "https://l2beat.com/scaling/projects/unichain",
    wrappedEth: "0x4200000000000000000000000000000000000006",
  },
  {
    chainId: "8453",
    bridge: "Base standard bridge",
    evidence: "https://l2beat.com/scaling/projects/base",
    wrappedEth: "0x4200000000000000000000000000000000000006",
  },
  {
    chainId: "57073",
    bridge: "Ink standard bridge",
    evidence: "https://l2beat.com/scaling/projects/ink",
    wrappedEth: "0x4200000000000000000000000000000000000006",
  },
  {
    chainId: "480",
    bridge: "World Chain standard bridge",
    evidence: "https://l2beat.com/scaling/projects/world",
    wrappedEth: "0x4200000000000000000000000000000000000006",
  },
  {
    chainId: "1868",
    bridge: "Soneium standard bridge",
    evidence: "https://l2beat.com/scaling/projects/soneium",
    wrappedEth: "0x4200000000000000000000000000000000000006",
  },
  {
    chainId: "7777777",
    bridge: "Zora standard bridge",
    evidence: "https://l2beat.com/scaling/projects/zora",
    wrappedEth: "0x4200000000000000000000000000000000000006",
  },
  {
    chainId: "42161",
    bridge: "Arbitrum One canonical bridge",
    evidence: "https://l2beat.com/scaling/projects/arbitrum",
    wrappedEth: null,
  },
  {
    chainId: "4663",
    bridge: "Robinhood Chain canonical bridge (Arbitrum Orbit)",
    evidence: "https://docs.robinhood.com/chain/bridging/",
    wrappedEth: null,
  },
  {
    chainId: "324",
    bridge: "ZKsync Era canonical bridge",
    evidence: "https://l2beat.com/scaling/projects/zksync2",
    wrappedEth: null,
  },
  {
    chainId: "59144",
    bridge: "Linea canonical bridge",
    evidence: "https://l2beat.com/scaling/projects/linea",
    wrappedEth: null,
  },
  {
    chainId: "81457",
    bridge: "Blast canonical bridge",
    evidence: "https://l2beat.com/scaling/projects/blast",
    wrappedEth: null,
  },
  {
    chainId: "4326",
    bridge: "MegaETH canonical bridge",
    evidence: "https://l2beat.com/scaling/projects/megaeth",
    wrappedEth: null,
  },
] as const;

export const ETHEREUM_WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

export const SUPERCHAIN_TOKEN_LIST = {
  name: "Superchain Token List",
  url: "https://static.optimism.io/optimism.tokenlist.json",
  chainIdsByPrefix: {
    optimism: "10",
    base: "8453",
    unichain: "130",
    ink: "57073",
    soneium: "1868",
    worldchain: "480",
    celo: "42220",
    lisk: "1135",
    mode: "34443",
    metall2: "1750",
    redstone: "690",
  } as Record<string, string>,
} as const;

export const ARBITRUM_BRIDGE_TOKEN_LISTS: TokenSource[] = [
  "arbed_arb_whitelist_era",
  "arbed_uniswap_labs",
  "arbed_coingecko",
].map((list) => ({
  name: `Arbitrum ${list} token list`,
  url: `https://tokenlist.arbitrum.io/ArbTokenLists/${list}.json`,
  bridgeInfo: {
    relationship: "canonical_bridge",
    bridgeName: "Arbitrum One canonical bridge",
  },
}));

export const NATIVE_ETH_BRIDGE_SOURCE_NAME =
  "Ekubo rollup native ether registry";

export type BridgeReadChain = {
  chainId: string;
  kind: "arbitrum_gateway" | "polygon_pos" | "op_standard_bridge";
  bridgeName: string;
  rpc: string;
  l1Contract?: string;
};

export const BRIDGE_READ_CHAINS: BridgeReadChain[] = [
  {
    chainId: "42161",
    kind: "arbitrum_gateway",
    bridgeName: "Arbitrum One canonical bridge",
    rpc: "https://arbitrum-one-rpc.publicnode.com",
    l1Contract: "0x72Ce9c846789fdB6fC1f34aC4AD25Dd9ef7031ef",
  },
  {
    // Gateway router from https://docs.robinhood.com/chain/protocol-contracts
    chainId: "4663",
    kind: "arbitrum_gateway",
    bridgeName: "Robinhood Chain canonical bridge (Arbitrum Orbit)",
    rpc: "https://rpc.mainnet.chain.robinhood.com",
    l1Contract: "0x6a2E3a1e16FC29f27Ce61429746D558d656975bB",
  },
  {
    chainId: "137",
    kind: "polygon_pos",
    bridgeName: "Polygon PoS bridge",
    rpc: "https://polygon-bor-rpc.publicnode.com",
    l1Contract: "0xA0c68C638235ee32657e8f720a23ceC1bFc77C77",
  },
  ...(
    [
      ["10", "OP Mainnet", "https://optimism-rpc.publicnode.com"],
      ["8453", "Base", "https://mainnet.base.org"],
      ["130", "Unichain", "https://unichain-rpc.publicnode.com"],
      ["57073", "Ink", "https://rpc-gel.inkonchain.com"],
      ["480", "World Chain", "https://worldchain-mainnet.g.alchemy.com/public"],
      ["1868", "Soneium", "https://rpc.soneium.org"],
    ] as const
  ).map(([chainId, name, rpc]) => ({
    chainId,
    kind: "op_standard_bridge" as const,
    bridgeName: `${name} standard bridge`,
    rpc,
  })),
];

export const BRIDGE_READS_SOURCE = {
  name: "Ekubo bridge contract reads",
  url: "https://github.com/EkuboProtocol/default-tokens/blob/main/bridge-reads.json",
} as const;

export const USDT0_DEPLOYMENTS_SOURCE = {
  name: "USDT0 Network deployments",
  url: "https://docs.usdt0.to/api/deployments",
} as const;

// The Ethereum token each USDT0 Network OFT adapter locks, from
// https://docs.usdt0.to/technical-documentation/developer. Products without
// an entry here are not linked.
export const USDT0_ETHEREUM_SOURCE_TOKENS: Record<string, string> = {
  usdt0: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  xaut0: "0x68749665FF8D2d112Fa859AA293F07A622782F38",
};

export const TETHER_ISSUER_REGISTRY = {
  name: "Tether supported protocols",
  url: "https://tether.to/en/supported-protocols/",
} as const;

export const TETHER_EXPLORER_CHAIN_IDS: Record<string, string> = {
  "etherscan.io": "1",
  "snowtrace.io": "43114",
  "bscscan.com": "56",
  "celoscan.io": "42220",
  "www.kaiascan.io": "8217",
  "kaiascan.io": "8217",
};

export const AVALANCHE_BRIDGE_SOURCE = {
  name: "Avalanche Bridge token list",
  url: "https://raw.githubusercontent.com/ava-labs/avalanche-bridge-resources/main/token_list.json",
  avalancheUrl:
    "https://raw.githubusercontent.com/ava-labs/avalanche-bridge-resources/main/avalanche_contract_address.json",
} as const;
