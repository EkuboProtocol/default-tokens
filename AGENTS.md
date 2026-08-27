# AGENTS.md

## Complexity Policy
- Run `bun run lint` before considering a change done. CI runs it on every push and
  pull request, before the tests.
- The only rule is ESLint's `complexity`, capped at 10 per function.
- Ten functions are over the limit today and are recorded in
  `eslint-suppressions.json`. That file is a ratchet, not an amnesty: it stores a
  per-file count, so a *new* function over the limit fails the build even in a file
  that already has entries. Do not raise a count to make the build pass — split the
  function.
- If you simplify one of the recorded functions, the lint run will say there are
  unused suppressions. That is the ratchet working. Run `bun run lint:prune` and
  commit the tightened file.
- The recorded debt, worst first: `main` (34) and `addStandardTokenList` (16) in
  `scripts/update-tokens.ts`; `indexCoinGeckoTokenIds` (20),
  `coinGeckoSupplyToRawInteger` (16) and `enrichCoinGeckoSupplies` (16) in
  `src/coingecko-supply.ts`; `downloadSourceImage` (18), `hostOne` (17) and
  `createCloudflareImages` (15) in `src/cloudflare-images.ts`; `fetchJson` (16) in
  `src/fetch-json.ts`; `validateNativeCurrencies` (11) in `src/token-list.ts`.
