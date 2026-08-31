import type {
  BridgeRelationship,
  NativeCurrency,
  Token,
  TokenProvenance,
} from "./types";

const ADDRESS_REGEX = /^0x[a-fA-F0-9]+$/;
const EVM_NATIVE_TOKEN_ALIASES = new Set([
  0n,
  0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeen,
  0x455448n,
]);
const STARKNET_CHAIN_IDS = new Set([
  0x534e5f4d41494en,
  0x534e5f4d41494fn,
]);

export function parseInteger(value: string, label: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new Error(`${label} must be an integer: ${value}`);
  }
}

export function normalizeTokenAddress(
  address: string,
  chainId: string,
): string | null {
  if (!ADDRESS_REGEX.test(address)) return null;

  const parsedChainId = parseInteger(chainId, "chain ID");
  const parsedAddress = parseInteger(address, "token address");
  if (
    !STARKNET_CHAIN_IDS.has(parsedChainId) &&
    EVM_NATIVE_TOKEN_ALIASES.has(parsedAddress)
  ) {
    return "0x0";
  }
  return address;
}

export function tokenKey(chainId: string, address: string): string {
  return `${parseInteger(chainId, "chain ID")}:${parseInteger(
    address,
    "token address",
  )}`;
}

export function bridgeRelationshipKey(
  relationship: BridgeRelationship,
): string {
  return [
    parseInteger(relationship.source_chain_id, "source chain ID"),
    parseInteger(relationship.source_token_address, "source token address"),
    parseInteger(relationship.dest_chain_id, "destination chain ID"),
  ].join(":");
}

export class TokenAccumulator {
  readonly tokens = new Map<string, Token>();
  readonly provenance = new Map<string, TokenProvenance>();
  readonly logoCandidates = new Map<string, string[]>();
  readonly coinGeckoIds = new Map<string, Set<string>>();

  add(
    token: Token,
    sourceName: string,
    sourceUrl: string,
    coinGeckoId?: string,
  ): boolean {
    const normalizedAddress = normalizeTokenAddress(
      token.token_address,
      token.chain_id,
    );
    if (!normalizedAddress) return false;

    const normalizedToken: Token = {
      ...token,
      token_address: normalizedAddress,
      logo_url: token.logo_url ?? null,
    };
    validateToken(normalizedToken);

    const key = tokenKey(normalizedToken.chain_id, normalizedAddress);
    if (normalizedToken.logo_url) {
      const candidates = this.logoCandidates.get(key) ?? [];
      if (!candidates.includes(normalizedToken.logo_url)) {
        candidates.push(normalizedToken.logo_url);
        this.logoCandidates.set(key, candidates);
      }
    }
    const normalizedCoinGeckoId = coinGeckoId?.trim();
    if (normalizedCoinGeckoId) {
      const coinGeckoIds = this.coinGeckoIds.get(key) ?? new Set<string>();
      coinGeckoIds.add(normalizedCoinGeckoId);
      this.coinGeckoIds.set(key, coinGeckoIds);
    }
    if (this.tokens.has(key)) return false;

    this.tokens.set(key, normalizedToken);
    this.provenance.set(key, {
      chain_id: normalizedToken.chain_id,
      token_address: normalizedAddress,
      source_name: sourceName,
      source_url: sourceUrl,
    });
    return true;
  }
}

// Who the token is: the chain and address that identify it, and the name and
// symbol that render it.
function validateTokenIdentity(token: Token): void {
  parseInteger(token.chain_id, "chain ID");
  if (!normalizeTokenAddress(token.token_address, token.chain_id)) {
    throw new Error(`Invalid token address: ${token.token_address}`);
  }
  if (!token.token_name) throw new Error("Token name cannot be empty");
  if (!token.token_symbol) throw new Error("Token symbol cannot be empty");
  if (token.logo_url != null) {
    new URL(token.logo_url);
  }
}

// The integer columns. `token_decimals` is bounded by the smallint the database
// stores it in, not by anything about tokens.
function validateTokenIntegers(token: Token): void {
  if (
    !Number.isInteger(token.token_decimals) ||
    token.token_decimals < 0 ||
    token.token_decimals > 32767
  ) {
    throw new Error(`Invalid token decimals: ${token.token_decimals}`);
  }
  if (!Number.isInteger(token.visibility_priority)) {
    throw new Error(
      `Invalid visibility priority: ${token.visibility_priority}`,
    );
  }
  if (!Number.isInteger(token.sort_order)) {
    throw new Error(`Invalid sort order: ${token.sort_order}`);
  }
}

// Both supplies are optional, and both are big enough to need bigint parsing.
function validateTokenSupplies(token: Token): void {
  if (token.total_supply != null) {
    const totalSupply = parseInteger(token.total_supply, "total supply");
    if (totalSupply < 0n) throw new Error("Total supply cannot be negative");
  }
  if (token.circulating_supply != null) {
    const circulatingSupply = parseInteger(
      token.circulating_supply,
      "circulating supply",
    );
    if (circulatingSupply < 0n) {
      throw new Error("Circulating supply cannot be negative");
    }
  }
}

export function validateToken(token: Token): void {
  validateTokenIdentity(token);
  validateTokenIntegers(token);
  validateTokenSupplies(token);
}

export function validateTokenList(tokens: Token[]): void {
  const seen = new Set<string>();
  for (const token of tokens) {
    validateToken(token);
    const key = tokenKey(token.chain_id, token.token_address);
    if (seen.has(key)) throw new Error(`Duplicate token: ${key}`);
    seen.add(key);
  }
}

/**
 * Check the native-currency row every listed EVM chain keeps at token address
 * zero, which is where `normalizeTokenAddress` folds every spelling of a
 * native asset.
 *
 * The two documents this runs over are held to different standards. The
 * curated input owns these rows, so a chain missing one is a defect, and a
 * native row for a chain nobody reviewed is one too. The generated document
 * inherits the curated rows on the next update run, and it also collects
 * incidental chains from broad third-party lists; demanding a reviewed native
 * for every chain that drifts in would fail the automated update over a chain
 * this repository never chose to serve. What must hold there is narrower, and
 * it is the point of the check either way: no source may put another asset's
 * name on a listed chain's address zero.
 */
export function validateNativeCurrencies(
  tokens: Token[],
  natives: readonly NativeCurrency[],
  document: "curated" | "generated",
  label: string,
): void {
  const expected = new Map(
    natives.map((native) => [parseInteger(native.chainId, "chain ID"), native]),
  );
  const seen = new Set<bigint>();

  for (const token of tokens) {
    // Every spelling of a native asset, not just the all-zero one: a list is
    // free to write `0xEeee…eEEeE`, and it means the same row.
    if (normalizeTokenAddress(token.token_address, token.chain_id) !== "0x0") {
      continue;
    }
    const chainId = parseInteger(token.chain_id, "chain ID");
    const native = expected.get(chainId);
    if (!native) {
      if (document === "generated") continue;
      throw new Error(
        `${label} holds a token at address zero on unlisted chain ${token.chain_id}; add that chain's native currency to NATIVE_CURRENCIES`,
      );
    }
    if (
      token.token_symbol !== native.symbol ||
      token.token_name !== native.name ||
      token.token_decimals !== native.decimals
    ) {
      throw new Error(
        `${label} names address zero on chain ${token.chain_id} ${token.token_name} (${token.token_symbol}, ${token.token_decimals} decimals); that chain pays gas in ${native.name} (${native.symbol}, ${native.decimals} decimals)`,
      );
    }
    seen.add(chainId);
  }

  if (document === "generated") return;
  for (const [chainId, native] of expected) {
    if (!seen.has(chainId)) {
      throw new Error(
        `${label} has no ${native.symbol} row at address zero for chain ${chainId}`,
      );
    }
  }
}

export function validateBridgeRelationships(
  relationships: BridgeRelationship[],
): void {
  const seen = new Set<string>();
  for (const relationship of relationships) {
    parseInteger(relationship.source_chain_id, "source chain ID");
    if (
      !normalizeTokenAddress(
        relationship.source_token_address,
        relationship.source_chain_id,
      )
    ) {
      throw new Error(
        `Invalid source token address: ${relationship.source_token_address}`,
      );
    }
    parseInteger(relationship.dest_chain_id, "destination chain ID");
    if (
      !normalizeTokenAddress(
        relationship.dest_token_address,
        relationship.dest_chain_id,
      )
    ) {
      throw new Error(
        `Invalid destination token address: ${relationship.dest_token_address}`,
      );
    }
    if (
      relationship.source_bridge_address != null &&
      !ADDRESS_REGEX.test(relationship.source_bridge_address)
    ) {
      throw new Error(
        `Invalid source bridge address: ${relationship.source_bridge_address}`,
      );
    }

    const key = bridgeRelationshipKey(relationship);
    if (seen.has(key)) throw new Error(`Duplicate bridge relationship: ${key}`);
    seen.add(key);
  }
}

export function assertHostedLogos(
  tokens: Token[],
  deliveryHash?: string,
  variant = "logo",
): void {
  const prefix = deliveryHash
    ? `https://imagedelivery.net/${deliveryHash}/`
    : "https://imagedelivery.net/";
  for (const token of tokens) {
    if (token.logo_url != null && !token.logo_url.startsWith(prefix)) {
      throw new Error(
        `${token.chain_id}:${token.token_address} has a non-Cloudflare logo: ${token.logo_url}`,
      );
    }
    if (token.logo_url != null && !token.logo_url.endsWith(`/${variant}`)) {
      throw new Error(
        `${token.chain_id}:${token.token_address} does not use the ${variant} Cloudflare variant: ${token.logo_url}`,
      );
    }
  }
}

export type BackfillStats = {
  tokensRestored: number;
  suppliesRestored: number;
};

// Keep the supply fields a live source cannot supply. Mutating in place is
// safe: the accumulator owns these rows and nothing else holds a reference.
function restoreSupplies(current: Token, previous: Token): boolean {
  let restored = false;
  if (current.total_supply == null && previous.total_supply != null) {
    current.total_supply = previous.total_supply;
    restored = true;
  }
  if (
    current.circulating_supply == null &&
    previous.circulating_supply != null
  ) {
    current.circulating_supply = previous.circulating_supply;
    restored = true;
  }
  return restored;
}

// Fold the previous generated list back in when a source was skipped, so a
// degraded run publishes the last known good rows rather than deleting them.
// `TokenAccumulator.add` is first-wins, so calling this after every source has
// run leaves fresher rows untouched and only fills the gaps.
export function backfillPreviousTokens(
  accumulator: TokenAccumulator,
  previousTokens: Token[],
  sourceName: string,
  sourceUrl: string,
): BackfillStats {
  const stats: BackfillStats = { tokensRestored: 0, suppliesRestored: 0 };

  for (const previous of previousTokens) {
    const address = normalizeTokenAddress(
      previous.token_address,
      previous.chain_id,
    );
    if (!address) continue;

    const existing = accumulator.tokens.get(tokenKey(previous.chain_id, address));
    if (!existing) {
      if (accumulator.add(previous, sourceName, sourceUrl)) {
        stats.tokensRestored++;
      }
      continue;
    }
    if (restoreSupplies(existing, previous)) stats.suppliesRestored++;
  }

  return stats;
}

// Fill only the supplies, for a run where every token was collected live but
// the CoinGecko supply refresh was skipped.
export function restorePreviousSupplies(
  tokens: Token[],
  previousTokens: Token[],
): number {
  const previousByKey = new Map<string, Token>();
  for (const previous of previousTokens) {
    const address = normalizeTokenAddress(
      previous.token_address,
      previous.chain_id,
    );
    if (address) previousByKey.set(tokenKey(previous.chain_id, address), previous);
  }

  let restored = 0;
  for (const token of tokens) {
    const previous = previousByKey.get(
      tokenKey(token.chain_id, token.token_address),
    );
    if (previous && restoreSupplies(token, previous)) restored++;
  }
  return restored;
}
