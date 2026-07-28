export type Token = {
  chain_id: string;
  token_address: string;
  token_name: string;
  token_symbol: string;
  token_decimals: number;
  total_supply?: string | null;
  logo_url: string | null;
  visibility_priority: number;
  sort_order: number;
};

export type BridgeRelationship = {
  source_chain_id: string;
  source_token_address: string;
  source_bridge_address: string | null;
  dest_chain_id: string;
  dest_token_address: string;
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
    bridgeInfo?: Record<string, TokenListBridgeInfo>;
  };
};

export type StandardTokenList = {
  name?: string;
  tokens: StandardTokenListToken[];
};
