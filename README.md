# Ekubo token list

This repository is the authoritative, auditable source for the token metadata
written to Ekubo's database. The database synchronization command reads only
committed files from this repository; it never downloads third-party token
lists.

## Files

- `curated-tokens.json` is the human-maintained, highest-precedence input. Its
  document can contain both curated token rows and curated bridge mappings.
- `tokens.json` is the complete generated document consumed by the database
  sync. Its top-level `tokens` and `bridge_relationships` arrays keep both kinds
  of authoritative metadata in one reviewable file.
- `token-list.schema.json` is the JSON Schema for both curated and generated
  token-list documents, including nullable raw `total_supply` and
  `circulating_supply` values.
- `token-sources.json` records the winning source for every generated token.
- `image-sources.json` records upstream-to-Cloudflare logo migrations so
  repeated runs do not upload the same image again.
- `src/sources.ts` is the reviewable catalog of every remote token source.

Bridge relationships are directed. `source_bridge_address` identifies the
escrow or bridge contract on the source chain; `null` means the asset is minted
natively on both chains.

Generation uses first-source-wins precedence:

1. Ekubo's curated tokens.
2. Tokens registered through Ekubo's onchain token registry.
3. The standard token lists in their declared order in `src/sources.ts`.
4. CoinGecko Pro token lists for explicitly mapped production chains.
5. AVNU's Starknet lists.

The explicit CoinGecko Pro mappings cover every chain the Ekubo wallet MCP
server configures on first run, because that wallet vendors `tokens.json` as
its compiled-in default token list and a missing chain leaves it showing bare
addresses on an approval screen. `WALLET_DEFAULT_NETWORK_CHAIN_IDS` in
`src/sources.ts` pins that set, and a test fails if one of those chains loses
its source.

The updater starts from the curated inputs each time. Removed remote tokens do
not linger merely because they appeared in an older generated file. Git commits
show every metadata, provenance, bridge, and hosted-logo change.

After token discovery, the updater combines CoinGecko IDs declared by an input
source with exact chain-and-contract mappings from
`/coins/list?include_platform=true`, then reads
`total_supply` and `circulating_supply` from batched `/coins/markets` requests.
The reviewed platform mappings in `src/sources.ts` are checked against
CoinGecko's `/asset_platforms` response before enrichment. Ambiguous contract
mappings are skipped. Existing curated or onchain-registered total supply wins;
CoinGecko fills missing totals and circulating supply. CoinGecko reports supply
in whole-token units, so the updater converts it to an integer in the token's
indivisible units before writing JSON.

Supply is best-effort market metadata, not an onchain accounting invariant.
CoinGecko may report a global economic supply for an asset deployed on multiple
chains, and circulating supply can change between six-hour updates. A missing,
invalid, ambiguous, or unavailable value remains `null`. Consumers compute FDV
and market cap as `usd_price * raw_supply / 10 ^ token_decimals` and should
preserve the distinction between unknown and zero.

## Automation

`Update authoritative token list` runs every six hours and can be started with
`workflow_dispatch`. It fetches all declared sources, reads onchain
registrations through a read-only database connection, hosts every available
external logo in Cloudflare Images, validates the result, and commits changed
generated files to `main`. JSON Schema validation runs before a generated
document can be committed.

`Sync authoritative token list to database` is a separate workflow. It runs
after a human push that changes the list, after a successful update workflow,
every 30 minutes as a reconciliation guard, and through `workflow_dispatch`.
The sync validates and then upserts both collections from `tokens.json` in one
transaction.
The `workflow_run` trigger is intentional: pushes made with GitHub's automation
token do not trigger a second ordinary push workflow.

Configure these repository secrets:

- `PG_CONNECTION_STRING`: the single Postgres connection used to read
  `latest_token_registrations_view` while generating the list and to write the
  committed list during database synchronization.
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account containing Ekubo Images.
- `CLOUDFLARE_API_TOKEN`: token with Cloudflare Images Write permission.
- `COINGECKO_API_KEY`: CoinGecko Pro API key. The updater sends it only in the
  `x-cg-pro-api-key` request header. It is used for token lists, exact contract
  mapping, and batched market-supply enrichment.

Configure these repository variables:

- `CLOUDFLARE_IMAGES_DELIVERY_HASH`: the account delivery hash used in
  `https://imagedelivery.net/<hash>/...`.
- `CLOUDFLARE_IMAGES_VARIANT`: the public token-logo variant; defaults to
  `logo`.
- `CLOUDFLARE_IMAGES_REQUEST_INTERVAL_MS`: minimum delay between Cloudflare
  Images API requests when the batch API is unavailable; defaults to `300`
  milliseconds to stay below the global API limit.

Cloudflare uploads use a deterministic custom ID derived from the upstream URL.
That makes retries idempotent and lets tokens on multiple chains share a hosted
image. The updater checks that deterministic delivery URL before uploading,
uses Cloudflare's batch upload API when available, paces its fallback API
requests, and honors rate-limit retry headers. If Cloudflare cannot fetch an
upstream URL, the runner downloads the image and uploads its bytes. IPFS image
sources are resolved through an HTTP gateway. Every generated URL is normalized
to the configured variant. A failed refresh retains the token's previously
hosted image; otherwise an unreachable logo is recorded as `null` without
failing the entire token-list update.

CoinGecko enrichment first checks `/asset_platforms` against the explicit
platform-to-chain mappings in `src/sources.ts`, then downloads each mapped
chain's standard token list from `/token_lists/{asset_platform_id}/all.json`.
The updater rejects a source if CoinGecko changes the mapping or returns a token
for another chain. Supply enrichment uses one complete `/coins/list` request
and bounded batches of up to 200 coin IDs per `/coins/markets` request; it never
makes one request per token. Requests are sequential and use the shared retry
and rate-limit handling.

Alchemy's ERC-20 Token API is intentionally not used for this enrichment. Its
token metadata response provides name, symbol, decimals, and logo, while its
other fungible-token endpoints are wallet balance and allowance queries. It
does not currently provide ERC-20 circulating supply, total supply, or holder
count. NFT owner endpoints are not applicable to fungible tokens.

The indexer migration that adds `erc20_tokens.circulating_supply` must be
applied before this repository's database sync is deployed. The sync writes
both supply columns and deliberately fails instead of silently dropping the new
field when the target schema is stale.

## Local development

Install and validate:

```sh
bun install
bun test
bun run typecheck
bun run validate
```

Regenerate the list by exporting the workflow environment variables and
running:

```sh
bun run update-tokens
```

For source-processing development without a token-registry database, pass
`--without-registrations` directly:

```sh
bun scripts/update-tokens.ts --without-registrations
```

Synchronize the committed list by setting `PG_CONNECTION_STRING` and running
`bun run sync-database`.
