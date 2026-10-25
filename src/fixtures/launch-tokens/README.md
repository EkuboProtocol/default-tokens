# Launch-token job fixtures

- `zero-seed-launch-events.json` is copied unchanged from the frozen
  zero-seed launch contract source, commit
  `853b608ec26d4c80bdad6e394cb8ba686e1ae615`,
  `test/vectors/zero-seed-launch-events.json`, SHA-256
  `24dd5883ce242ec523517c9f38cfd5e8ca29740974aeded5740ac3608e1e7066`. It holds
  the raw `LaunchCreated` logs of one local launch created with an empty and
  with a nonempty logo URL. It was never deployed.
- `api-response.json` is one launch-list page in the API's
  `zero-seed-launch-api/v6` shape. Every record and the envelope start from
  the `l1` launch and `list` of the API's golden response file
  (`src/routes/launches/fixtures/zero-seed-launch-api-v6.golden.json` at API
  commit `c05481aee2d563a72d02a7c9d13d76ec141a91f8`, SHA-256
  `553dd01d8d4b43b6840c64d8ac6064fdc0623fc068de3542dcd3539475765ba1`), with
  `chain_id`, `pool_id`, `token`, `pool_key.token1`, the packed
  `parameters.name`/`symbol` (when 1 to 31 bytes), `logo_url` and `status`
  replaced per case; addresses are lowercase as the API serves them. Its first
  record is the launch in those logs, decoded: pool ID, token address,
  `packOne` name and symbol, and the empty logo served as null; its replay
  keeps `""`. The second record carries the
  nonempty logo string from the logs on another token. The remaining records
  use addresses and pool IDs derived as `keccak256("launch-fixture:token:" +
  label)` and `keccak256("launch-fixture:pool:" + label)`; they exercise the
  curated and published collisions and each rejection: the mixed-case
  address with a wrong checksum, and a status other than `upcoming` or
  `trading`, are malformed records the API does not serve. The nonempty-logo
  launch is `upcoming`; it is listed like a `trading` one.
- `curated-tokens.json` is the chain 1 WBTC row of the repository's curated
  list; `token-sources.json` claims one fixture address for another source.
- `expected-dry-run.json` is the job's dry-run report and candidate
  `launch-tokens.json` for those inputs, starting from an empty launch file.
