import type { TokenSource } from "./types";

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

export const STARKNET_MAINNET_CHAIN_ID = 0x534e5f4d41494en;
