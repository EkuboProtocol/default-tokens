# AGENTS.md

## Checks

- Run `bun run format:check` (`bun run format` fixes it), `bun run lint`,
  `bun run typecheck` and `bun test` before considering a change done. CI runs
  them, and `bun run validate`, on every push and pull request.
- The typecheck is TypeScript 7, `tsc -b` over every project in `tsconfig.json`
  (`tsconfig.app.json` covers `src/` and `scripts/`). A new directory of
  TypeScript needs to be in a project, or neither the typecheck nor the
  type-aware lint rules see it correctly.
- Formatting is oxfmt (`.oxfmtrc.json`). Generated and policy data files
  (`tokens.json`, `jurisdiction-policy/` and the other data JSON) are not
  formatted.

## Complexity and lint policy

- Lint is oxlint (`.oxlintrc.json`), run through `scripts/lint.ts`. It enforces
  `complexity`, capped at 10 per function, and the type-aware rules from
  typescript-eslint's recommended-type-checked set, which oxlint runs through
  `oxlint-tsgolint`. Warnings fail too.
- Nine functions are over the complexity limit today, and some files have
  violations of the type-aware rules. They are recorded in
  `lint-suppressions.json`. That file is a ratchet, not an amnesty: it stores a
  per-file, per-rule count, so a _new_ violation fails the build even in a file
  that already has entries. Do not raise a count to make the build pass; split
  the function or fix the code.
- If you fix a recorded violation, the lint run will say the suppression is
  outdated. That is the ratchet working. Run `bun run lint:prune` and commit the
  tightened file.
- The recorded debt, worst first: `main` (34) in `scripts/update-tokens.ts`; `indexCoinGeckoTokenIds` (20),
  `coinGeckoSupplyToRawInteger` (16) and `enrichCoinGeckoSupplies` (16) in
  `src/coingecko-supply.ts`; `downloadSourceImage` (18), `hostOne` (17) and
  `createCloudflareImages` (15) in `src/cloudflare-images.ts`; `fetchJson` (16) in
  `src/fetch-json.ts`; `validateNativeCurrencies` (11) in `src/token-list.ts`.
