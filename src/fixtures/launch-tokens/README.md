# Launch-token job fixtures

- `zero-seed-launch-events.json` is copied unchanged from the frozen
  zero-seed launch contract source, commit
  `853b608ec26d4c80bdad6e394cb8ba686e1ae615`,
  `test/vectors/zero-seed-launch-events.json`, SHA-256
  `24dd5883ce242ec523517c9f38cfd5e8ca29740974aeded5740ac3608e1e7066`. It holds
  the raw `LaunchCreated` logs of one local launch created with an empty and
  with a nonempty logo URL. It was never deployed.
- `api-response.json` is one launch-list page. Its first record (and the
  replay of it) is the launch in those logs, decoded: pool ID, token address,
  `packOne` name and symbol, and the empty logo. The second record carries the
  nonempty logo string from the logs on another token. The remaining records
  use addresses and pool IDs derived as `keccak256("launch-fixture:token:" +
  label)` and `keccak256("launch-fixture:pool:" + label)`; they exercise the
  curated and published collisions and each rejection.
- `curated-tokens.json` is the chain 1 WBTC row of the repository's curated
  list; `token-sources.json` claims one fixture address for another source.
- `expected-dry-run.json` is the job's dry-run report and candidate
  `launch-tokens.json` for those inputs, starting from an empty launch file.
