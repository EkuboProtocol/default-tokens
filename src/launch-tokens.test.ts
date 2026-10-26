import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  fetchLaunches,
  launchPageUrl,
  readLaunchPage,
  type LaunchRecord,
} from "./launch-api";
import {
  addLaunchTokens,
  emptyLaunchTokenDocument,
  existingTokenSources,
  launchJobConfig,
  planLaunchTokens,
  readLaunchAddress,
  readLaunchLogo,
  serializeLaunchTokenDocument,
  validateLaunch,
  validateLaunchTokenDocument,
  type LaunchRejection,
  type LogoRejection,
} from "./launch-tokens";
import { LAUNCH_SOURCE } from "./sources";
import { TokenAccumulator, tokenKey } from "./token-list";
import type { TokenListDocument, TokenProvenance } from "./types";

const root = resolve(import.meta.dir, "..");
const fixtures = resolve(import.meta.dir, "fixtures/launch-tokens");

async function fixture<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(join(fixtures, name), "utf8")) as T;
}

const config = launchJobConfig(["1"]);
const apiResponse = await fixture<unknown>("api-response.json");
const launches = readLaunchPage(apiResponse).launches;
const curated = await fixture<TokenListDocument>("curated-tokens.json");
const provenance = await fixture<TokenProvenance[]>("token-sources.json");
const existing = existingTokenSources(curated.tokens, provenance);
const expected = await fixture<{
  report: unknown;
  launch_tokens: TokenListDocument;
}>("expected-dry-run.json");

function plan(
  records: LaunchRecord[],
  recorded: TokenListDocument = emptyLaunchTokenDocument(),
) {
  return planLaunchTokens({ launches: records, recorded, existing, config });
}

function record(overrides: Partial<LaunchRecord> = {}): LaunchRecord {
  return {
    chainId: "1",
    poolId: `0x${"ab".repeat(32)}`,
    tokenAddress: "0x838047Be0779C59E69610451cCf3Fd71F5fB4A53",
    name: "Zero Seed",
    symbol: "ZERO",
    decimals: 18,
    logoUrl: "",
    status: "trading",
    ...overrides,
  };
}

describe("launch-token dry run over the fixture", () => {
  test("produces the expected report and candidate list", () => {
    const result = plan(launches);
    expect(result.report).toEqual(expected.report as typeof result.report);
    expect(result.document).toEqual(expected.launch_tokens);
    validateLaunchTokenDocument(result.document);
  });

  test("a second run over its own output is a byte-identical no-op", () => {
    const first = plan(launches);
    const firstBytes = serializeLaunchTokenDocument(first.document);
    const second = plan(launches, JSON.parse(firstBytes) as TokenListDocument);

    expect(serializeLaunchTokenDocument(second.document)).toBe(firstBytes);
    expect(second.report.added).toEqual([]);
    expect(second.report.unchanged.map((row) => row.token_address)).toEqual(
      first.report.added.map((row) => row.token_address),
    );
    expect(second.report.skipped).toEqual(first.report.skipped);
    expect(second.report.rejected).toEqual(first.report.rejected);
  });

  test("does not depend on the order the API lists launches in", () => {
    const reversed = plan([...launches].reverse());
    expect(reversed.report).toEqual(plan(launches).report);
    expect(serializeLaunchTokenDocument(reversed.document)).toBe(
      serializeLaunchTokenDocument(plan(launches).document),
    );
  });

  test("never overrides a curated or published row", () => {
    const { report, document } = plan(launches);
    const listed = new Set(
      document.tokens.map((token) =>
        tokenKey(token.chain_id, token.token_address),
      ),
    );
    for (const key of existing.keys()) expect(listed.has(key)).toBe(false);
    expect(report.skipped.map((row) => row.reason).sort()).toEqual([
      "curated",
      "duplicate_record",
      "existing_entry",
    ]);
  });
});

describe("fixture provenance", () => {
  const word = (data: string, index: number) =>
    data.slice(2 + 64 * index, 2 + 64 * (index + 1));
  const packOne = (hex: string) => {
    const bytes = Buffer.from(hex, "hex");
    return bytes.subarray(1, 1 + (bytes[0] ?? 0)).toString("utf8");
  };
  const logo = (data: string) => {
    const offset = Number(BigInt(`0x${word(data, 16)}`)) / 32;
    const length = Number(BigInt(`0x${word(data, offset)}`));
    return Buffer.from(
      data.slice(2 + 64 * (offset + 1), 2 + 64 * (offset + 1) + 2 * length),
      "hex",
    ).toString("utf8");
  };

  test("the first launch is the frozen LaunchCreated log, decoded", async () => {
    const events = await fixture<{
      LaunchCreated: { logo: string; topics: string[]; data: string }[];
    }>("zero-seed-launch-events.json");
    const [empty, withLogo] = events.LaunchCreated;
    if (!empty || !withLogo) throw new Error("missing frozen events");
    const first = launches[0];

    expect(first?.poolId).toBe(empty.topics[1]);
    expect(String(first?.tokenAddress).toLowerCase()).toBe(
      `0x${empty.topics[2]?.slice(26)}`,
    );
    expect(first?.name).toBe(packOne(word(empty.data, 5)));
    expect(first?.symbol).toBe(packOne(word(empty.data, 6)));
    // The API serves the emitted empty logoUrl as null.
    expect([logo(empty.data), first?.logoUrl]).toEqual(["", null]);
    expect(logo(empty.data)).toBe(empty.logo);
    expect(logo(withLogo.data)).toBe(withLogo.logo);
    expect(launches[1]?.logoUrl).toBe(withLogo.logo);
  });

  test("the replay of the first launch keeps an empty-string logo", () => {
    expect(launches[3]).toEqual({
      ...launches[0],
      logoUrl: "",
    } as LaunchRecord);
  });
});

describe("launch validation", () => {
  test("lists an empty or missing logo as null", () => {
    for (const logoUrl of ["", null, undefined]) {
      const result = validateLaunch(record({ logoUrl }), config);
      expect("candidate" in result && result.candidate.token.logo_url).toBe(
        null,
      );
    }
  });

  test("keeps the launch metadata and fixes decimals at 18", () => {
    const result = validateLaunch(record(), config);
    if (!("candidate" in result)) throw new Error("rejected");
    expect(result.candidate.token).toEqual({
      chain_id: "1",
      token_address: "0x838047Be0779C59E69610451cCf3Fd71F5fB4A53",
      token_name: "Zero Seed",
      token_symbol: "ZERO",
      token_decimals: 18,
      logo_url: null,
      visibility_priority: -1,
      sort_order: -1,
    });
  });

  test.each([
    [{ chainId: 1 }, "invalid_chain_id"],
    [{ chainId: "01" }, "invalid_chain_id"],
    [{ chainId: "10" }, "chain_not_enabled"],
    [{ poolId: "0x1234" }, "invalid_pool_id"],
    [{ tokenAddress: "0x1234" }, "invalid_token_address"],
    [
      { tokenAddress: "0x0000000000000000000000000000000000000000" },
      "zero_token_address",
    ],
    [
      { tokenAddress: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" },
      "zero_token_address",
    ],
    [
      { tokenAddress: "0x838047be0779C59E69610451cCf3Fd71F5fB4A53" },
      "invalid_address_checksum",
    ],
    [{ decimals: 6 }, "invalid_decimals"],
    [{ decimals: "18" }, "invalid_decimals"],
    [{ name: "" }, "invalid_name"],
    [{ name: null }, "invalid_name"],
    [{ name: " Zero" }, "invalid_name"],
    [{ name: "a".repeat(32) }, "invalid_name"],
    [{ name: "Ze\u200Bro" }, "invalid_name"],
    [{ name: "Zero\uFFFD" }, "invalid_name"],
    [{ symbol: "ZE\nRO" }, "invalid_symbol"],
    [{ symbol: "\u202EORZ" }, "invalid_symbol"],
    [{ status: "final" }, "invalid_status"],
    [{ status: "pending" }, "invalid_status"],
    [{ status: undefined }, "invalid_status"],
  ] as [Partial<LaunchRecord>, LaunchRejection][])(
    "rejects %o as %s",
    (overrides, reason) => {
      const result = validateLaunch(record(overrides), config);
      expect("rejection" in result && result.rejection).toBe(reason);
    },
  );

  test("accepts 31 bytes of metadata, counted in UTF-8", () => {
    expect(
      "candidate" in validateLaunch(record({ name: "a".repeat(31) }), config),
    ).toBe(true);
    expect(
      "candidate" in validateLaunch(record({ name: "€".repeat(10) }), config),
    ).toBe(true);
    expect(
      "rejection" in validateLaunch(record({ name: "€".repeat(11) }), config),
    ).toBe(true);
  });

  test("checksums a uniform-case address", () => {
    expect(
      readLaunchAddress("0x838047be0779c59e69610451ccf3fd71f5fb4a53"),
    ).toEqual({ address: "0x838047Be0779C59E69610451cCf3Fd71F5fB4A53" });
  });

  test.each([
    ["https://example.com/logo.png", "https://example.com/logo.png"],
    ["https://Example.COM/a b", null],
    ["https://EXAMPLE.com/logo.svg?v=1", "https://example.com/logo.svg?v=1"],
  ])("normalizes or refuses %s", (input, url) => {
    expect(readLaunchLogo(input).url).toBe(url);
  });

  test.each([
    [42, "logo_not_string"],
    [`https://example.com/${"a".repeat(2048)}`, "logo_too_long"],
    ["https://example.com/\u0000.png", "logo_unsafe_characters"],
    ["https://example.com/\u202E.png", "logo_unsafe_characters"],
    [" https://example.com/logo.png", "logo_unsafe_characters"],
    ["not a url", "logo_unsafe_characters"],
    ["example.com/logo.png", "logo_not_url"],
    ["http://example.com/logo.png", "logo_not_https"],
    ["ipfs://bafy/logo.png", "logo_not_https"],
    ["data:image/svg+xml,<svg/>", "logo_not_https"],
    ["javascript:alert(1)", "logo_not_https"],
    ["https://user:pass@example.com/logo.png", "logo_has_credentials"],
    ["https://example.com:8443/logo.png", "logo_has_port"],
    ["https://localhost/logo.png", "logo_private_host"],
    ["https://127.0.0.1/logo.png", "logo_private_host"],
    ["https://0x7f000001/logo.png", "logo_private_host"],
    ["https://[::1]/logo.png", "logo_private_host"],
    ["https://intranet/logo.png", "logo_private_host"],
    ["https://metadata.google.internal/logo.png", "logo_private_host"],
    ["https://printer.local./logo.png", "logo_private_host"],
  ] as [unknown, LogoRejection][])("refuses logo %p as %s", (input, reason) => {
    expect(readLaunchLogo(input)).toEqual({ url: null, rejection: reason });
  });

  test("an unsafe logo drops the logo, not the token", () => {
    const result = validateLaunch(
      record({ logoUrl: "http://example.com/logo.png" }),
      config,
    );
    if (!("candidate" in result)) throw new Error("rejected");
    expect(result.candidate.token.logo_url).toBeNull();
    expect(result.candidate.logoRejection).toBe("logo_not_https");
  });
});

describe("launch planning", () => {
  test("lists neither of two conflicting records for one token", () => {
    const { report, document } = plan([
      record({ logoUrl: "" }),
      record({ logoUrl: "https://example.com/other.png" }),
    ]);
    expect(document.tokens).toEqual([]);
    expect(report.skipped.map((row) => row.reason)).toEqual([
      "conflicting_records",
      "conflicting_records",
    ]);
  });

  test("keeps a recorded row when the API later disagrees", () => {
    const recorded = plan([record()]).document;
    const { report, document } = plan(
      [record({ logoUrl: "https://example.com/late.png" })],
      recorded,
    );
    expect(document).toEqual(recorded);
    expect(report.skipped[0]?.reason).toBe("conflicts_with_recorded");
  });

  test("a published row from the launch source itself is not a collision", () => {
    const own = existingTokenSources(
      [],
      [
        {
          chain_id: "1",
          token_address: "0x838047Be0779C59E69610451cCf3Fd71F5fB4A53",
          source_name: LAUNCH_SOURCE.name,
          source_url: LAUNCH_SOURCE.url,
        },
      ],
    );
    expect(own.size).toBe(0);
  });

  test("rejects chains outside the list and Starknet", () => {
    expect(() => launchJobConfig(["999999"])).toThrow();
    expect(() => launchJobConfig(["0x1"])).toThrow();
    expect(() => launchJobConfig([String(0x534e5f4d41494en)])).toThrow();
  });
});

describe("launch-tokens.json", () => {
  test("the committed file is a valid, empty launch list", async () => {
    const committed = JSON.parse(
      await readFile(join(root, "launch-tokens.json"), "utf8"),
    ) as unknown;
    validateLaunchTokenDocument(committed);
    expect(committed).toEqual(emptyLaunchTokenDocument());
  });

  test("rejects unsorted, non-18-decimal or unsafe rows", () => {
    const tokens = expected.launch_tokens.tokens;
    const unsorted = {
      ...expected.launch_tokens,
      tokens: [...tokens].reverse(),
    };
    expect(() => validateLaunchTokenDocument(unsorted)).toThrow("sorted");
    for (const change of [
      { token_decimals: 6 },
      { logo_url: "http://example.com/logo.png" },
      { token_symbol: "BAD\u0007" },
      { token_address: tokens[0].token_address.toLowerCase() },
    ]) {
      const document = {
        ...expected.launch_tokens,
        tokens: [{ ...tokens[0], ...change }],
      };
      expect(() => validateLaunchTokenDocument(document)).toThrow();
    }
  });

  test("the token-list update adds launch rows last, logo and all", () => {
    const accumulator = new TokenAccumulator();
    const [first, second] = expected.launch_tokens.tokens;
    accumulator.add(
      { ...first, token_name: "Curated", logo_url: null },
      "curated",
      "curated-tokens.json",
    );
    const withLogo = { ...second, logo_url: "https://example.com/l.png" };

    expect(
      addLaunchTokens(accumulator, {
        ...emptyLaunchTokenDocument(),
        tokens: [first, withLogo],
      }),
    ).toBe(1);
    const firstKey = tokenKey(first.chain_id, first.token_address);
    const secondKey = tokenKey(second.chain_id, second.token_address);
    expect(accumulator.tokens.get(firstKey)?.token_name).toBe("Curated");
    expect(accumulator.logoCandidates.has(firstKey)).toBe(false);
    expect(accumulator.provenance.get(secondKey)?.source_name).toBe(
      LAUNCH_SOURCE.name,
    );
    expect(accumulator.logoCandidates.get(secondKey)).toEqual([
      "https://example.com/l.png",
    ]);
  });
});

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected a rejection");
}

describe("launch API adapter", () => {
  const envelope = apiResponse as Record<string, unknown> & { data: unknown[] };
  const page = (data: unknown[], next_offset: number | null) =>
    Response.json({ ...envelope, data, next_offset });

  test("reads the v7 fields, including both statuses and lowercase addresses", () => {
    expect(launches[0]).toEqual({
      chainId: "1",
      poolId:
        "0xfb5475aaf870f1b1fe76ffcb64a34cd6b1c41d22f723a49abf6bab09e5760c91",
      tokenAddress: "0x838047be0779c59e69610451ccf3fd71f5fb4a53",
      name: "Zero Seed",
      symbol: "ZERO",
      decimals: 18,
      logoUrl: null,
      status: "trading",
    });
    expect(launches.map((launch) => launch.status)).toContain("upcoming");
    for (const status of ["upcoming", "trading"]) {
      expect("candidate" in validateLaunch(record({ status }), config)).toBe(
        true,
      );
    }
  });

  test("follows next_offset to the last page", async () => {
    const urls: string[] = [];
    const records = await fetchLaunches({
      baseUrl: "https://api.example.com/",
      chainIds: ["1"],
      fetch: ((url: string) => {
        urls.push(url);
        return Promise.resolve(
          urls.length === 1
            ? page(envelope.data.slice(0, 2), 200)
            : page(envelope.data.slice(2), null),
        );
      }) as typeof fetch,
    });
    expect(records).toEqual(launches);
    expect(urls).toEqual([
      launchPageUrl("https://api.example.com", "1", 0),
      launchPageUrl("https://api.example.com", "1", 200),
    ]);
    expect(urls[1]).toBe(
      "https://api.example.com/launches?chainId=1&status=all&order_by=created&offset=200&limit=200",
    );
  });

  test("fails on an offset that does not advance instead of looping", async () => {
    expect(
      await failure(
        fetchLaunches({
          baseUrl: "https://api.example.com",
          chainIds: ["1"],
          fetch: (() =>
            Promise.resolve(page([], 200))) as unknown as typeof fetch,
        }),
      ),
    ).toContain("did not advance");
    expect(
      await failure(
        fetchLaunches({
          baseUrl: "https://api.example.com",
          chainIds: ["1"],
          fetch: (() =>
            Promise.resolve(page([], 100_200))) as unknown as typeof fetch,
        }),
      ),
    ).toContain("more than 100000");
  });

  test("fails the whole read when a page fails", async () => {
    expect(
      await failure(
        fetchLaunches({
          baseUrl: "https://api.example.com",
          chainIds: ["1"],
          fetch: (() =>
            Promise.resolve(
              new Response("nope", { status: 404 }),
            )) as unknown as typeof fetch,
        }),
      ),
    ).toContain("404");
  });

  test("refuses a plain-http base URL and a malformed page", async () => {
    expect(
      await failure(
        fetchLaunches({ baseUrl: "http://api.example.com", chainIds: ["1"] }),
      ),
    ).toContain("https");
    for (const version of [
      "zero-seed-launch-api/v5",
      "zero-seed-launch-api/v6",
    ])
      expect(() =>
        readLaunchPage({ ...envelope, schema_version: version }),
      ).toThrow("schema_version");
    expect(() => readLaunchPage({ data: [], next_offset: null })).toThrow(
      "schema_version",
    );
    expect(() => readLaunchPage({ ...envelope, data: undefined })).toThrow(
      "data array",
    );
    for (const next_offset of ["200", 0, -1, 1.5, undefined]) {
      expect(() => readLaunchPage({ ...envelope, next_offset })).toThrow(
        "next_offset",
      );
    }
  });
});

describe("launch-token job command", () => {
  async function run(directory: string, args: string[], chains = "1") {
    const child = Bun.spawn(
      [
        "bun",
        join(root, "scripts/launch-tokens.ts"),
        "--root",
        directory,
        "--fixture",
        join(fixtures, "api-response.json"),
        "--report",
        join(directory, "report.json"),
        ...args,
      ],
      {
        env: { ...process.env, EKUBO_LAUNCH_CHAIN_IDS: chains },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [code, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ]);
    expect(code).toBe(0);
    return stderr;
  }

  test("dry run by default, idempotent write", async () => {
    const directory = await mkdtemp(join(tmpdir(), "launch-tokens-"));
    try {
      await copyFile(
        join(fixtures, "curated-tokens.json"),
        join(directory, "curated-tokens.json"),
      );
      await copyFile(
        join(fixtures, "token-sources.json"),
        join(directory, "token-sources.json"),
      );
      const launchFile = join(directory, "launch-tokens.json");
      const empty = serializeLaunchTokenDocument(emptyLaunchTokenDocument());
      await writeFile(launchFile, empty);
      const expectedBytes = serializeLaunchTokenDocument(
        expected.launch_tokens,
      );

      await run(directory, ["--candidate", join(directory, "candidate.json")]);
      expect(await readFile(launchFile, "utf8")).toBe(empty);
      expect(await readFile(join(directory, "candidate.json"), "utf8")).toBe(
        expectedBytes,
      );
      expect(
        JSON.parse(await readFile(join(directory, "report.json"), "utf8")),
      ).toEqual(expected.report);

      await run(directory, ["--write"]);
      expect(await readFile(launchFile, "utf8")).toBe(expectedBytes);
      expect(await run(directory, ["--write"])).toContain("already current");
      expect(await readFile(launchFile, "utf8")).toBe(expectedBytes);

      expect(await run(directory, ["--write"], "")).toContain(
        "No launch chains are enabled",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
