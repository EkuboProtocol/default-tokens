export type Token = {
  chain_id: string;
  token_address: string;
  token_name: string;
  token_symbol: string;
  token_decimals: number;
  total_supply?: string | null;
  circulating_supply?: string | null;
  logo_url: string | null;
  visibility_priority: number;
  sort_order: number;
};

export const BRIDGE_RELATIONSHIP_KINDS = [
  "canonical_bridge",
  "native_issuer",
  "interoperability",
  "unknown",
] as const;

export type BridgeRelationshipKind = (typeof BRIDGE_RELATIONSHIP_KINDS)[number];

export type BridgeRelationship = {
  source_chain_id: string;
  source_token_address: string;
  source_bridge_address: string | null;
  dest_chain_id: string;
  dest_token_address: string;
  relationship?: BridgeRelationshipKind;
  bridge_name?: string | null;
  source_name?: string;
  source_url?: string;
  inferred_reverse?: boolean;
};

export type BridgeLinkLabel = {
  relationship: BridgeRelationshipKind;
  bridgeName: string | null;
};

export type TokenProvenance = {
  chain_id: string;
  token_address: string;
  source_name: string;
  source_url: string;
};

export type TokenListDocument = {
  $schema: "./token-list.schema.json";
  tokens: Token[];
  bridge_relationships: BridgeRelationship[];
};

export type TokenSource = {
  name: string;
  url: string;
  visibilityPriority?: number;
  visibilityPriorityByChainId?: Readonly<Record<string, number>>;
  bridgeInfo?: BridgeLinkLabel;
  crossChainAddresses?: boolean;
};

export type CoinGeckoTokenSource = TokenSource & {
  assetPlatformId: string;
  expectedChainId: string;
};

export type NativeCurrency = {
  chainId: string;
  name: string;
  symbol: string;
  decimals: number;
};

export type CoinGeckoSupplyPlatform = {
  assetPlatformId: string;
  chainId: string;
  expectedChainIdentifier: string | null;
};

export type TokenListBridgeInfo = {
  tokenAddress?: string;
  originBridgeAddress?: string | null;
  destBridgeAddress?: string | null;
};

export type StandardTokenListToken = {
  chainId: number | string;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
  extensions?: {
    bridgeInfo?: Record<string, TokenListBridgeInfo | string | undefined>;
    crossChainAddresses?: Record<string, { address?: string } | undefined>;
    coinGeckoId?: string;
    coingeckoId?: string;
    opTokenId?: string;
    [bridgeAddressKey: string]: unknown;
  };
};

export type StandardTokenList = {
  name?: string;
  tokens: StandardTokenListToken[];
};
