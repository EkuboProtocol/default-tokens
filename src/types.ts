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

// What a link between two tokens on different chains means. See the README.
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
  // Additive metadata, also written to the database by the sync.
  relationship?: BridgeRelationshipKind;
  bridge_name?: string | null;
  source_name?: string;
  source_url?: string;
  inferred_reverse?: boolean;
};

// How links read from a token list's extensions are labelled.
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
  // Per-chain overrides of `visibilityPriority`, keyed by decimal chain ID.
  visibilityPriorityByChainId?: Readonly<Record<string, number>>;
  // Read standard `extensions.bridgeInfo` entries, labelled this way.
  bridgeInfo?: BridgeLinkLabel;
  // Read `extensions.crossChainAddresses`, labelled by `bridgeInfo.protocol`.
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
    // The standard shape maps a chain ID to a counterpart. The Monad list
    // instead uses `{ protocol, bridgeAddress }` and names counterparts in
    // `crossChainAddresses`.
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
