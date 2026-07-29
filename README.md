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
  token-list documents.
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
4. AVNU's Starknet lists.

The updater starts from the curated inputs each time. Removed remote tokens do
not linger merely because they appeared in an older generated file. Git commits
show every metadata, provenance, bridge, and hosted-logo change.

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
