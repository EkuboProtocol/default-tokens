import { describe, expect, test } from "bun:test";
import {
  BridgeCollector,
  bridgeReadLinks,
  crossChainAddressLinks,
  finalizeBridgeLinks,
  issuerLinks,
  nativeEthLinks,
  parseCircleRegistry,
  restorePreviousLinks,
  superchainLinks,
  tokenKeysOf,
  type ProvenancedLink,
} from "./bridges";
import { validateTokenListSchema } from "./schema";
import {
  validateBridgeRelationships,
  validateGeneratedBridgeRelationships,
} from "./token-list";
import type { StandardTokenList, Token } from "./types";

const source = { name: "Test source", url: "https://example.com/list.json" };

function token(chainId: string, address: string): Token {
  return {
    chain_id: chainId,
    token_address: address,
    token_name: "Token",
    token_symbol: "TKN",
    token_decimals: 18,
    logo_url: null,
    visibility_priority: 1,
    sort_order: 0,
  };
}

function link(
  sourceChainId: string,
  sourceToken: string,
  destinationChainId: string,
  destinationToken: string,
  overrides: Partial<ProvenancedLink> = {},
): ProvenancedLink {
  return {
    source_chain_id: sourceChainId,
    source_token_address: sourceToken,
    source_bridge_address: null,
    dest_chain_id: destinationChainId,
    dest_token_address: destinationToken,
    relationship: "canonical_bridge",
    bridge_name: "Test bridge",
    source_name: source.name,
    source_url: source.url,
    ...overrides,
  };
}

describe("BridgeCollector", () => {
  test("keeps the first claim and reports a different later counterpart", () => {
    const collector = new BridgeCollector();
    expect(collector.add(link("1", "0xa", "10", "0xb"))).toBe(true);
    expect(
      collector.add(link("1", "0xA", "10", "0xc", { source_name: "Later" })),
    ).toBe(false);
    expect(collector.add(link("1", "0xa", "0xa", "0xB"))).toBe(false);
    expect(collector.links.size).toBe(1);
    expect(collector.conflicts).toHaveLength(1);
    expect(collector.conflicts[0]?.rejected.source_name).toBe("Later");
  });

  test("drops self-links and links to tokens outside the list", () => {
    const collector = new BridgeCollector(
      tokenKeysOf([token("1", "0xa"), token("10", "0xb")]),
    );
    expect(collector.add(link("1", "0xa", "1", "0xb"))).toBe(false);
    expect(collector.add(link("1", "0xa", "8453", "0xb"))).toBe(false);
    expect(collector.add(link("1", "0xa", "10", "0xb"))).toBe(true);
    expect(collector.selfLinks).toBe(1);
    expect(collector.droppedMissingEndpoint).toEqual({ "Test source": 1 });
  });
});

describe("finalizeBridgeLinks", () => {
  test("mirrors one-directional links and reports competing counterparts", () => {
    const collector = new BridgeCollector();
    collector.add(link("1", "0xa", "10", "0xb"));
    collector.add(link("10", "0xb", "1", "0xa"));
    // Two Optimism tokens both claim to be the canonical copy of 0xa.
    collector.add(link("10", "0xc", "1", "0xa"));
    collector.add(link("1", "0xd", "10", "0xe"));
    const { relationships, report } = finalizeBridgeLinks(collector);
    const mirrored = relationships.find(
      (relationship) =>
        relationship.source_chain_id === "10" &&
        relationship.source_token_address === "0xe",
    );
    expect(mirrored?.inferred_reverse).toBe(true);
    expect(mirrored?.source_bridge_address).toBeNull();
    expect(report.inferredReverses).toBe(1);
    expect(report.nonReciprocal).toBe(1);
    expect(report.competingCounterparts).toHaveLength(1);
    expect(report.competingCounterparts[0]?.source_token_addresses).toEqual([
      "0xb",
      "0xc",
    ]);
  });

  test("does not report a canonical copy beside an issuer deployment", () => {
    const collector = new BridgeCollector();
    collector.add(
      link("10", "0x1", "1", "0xa", {
        relationship: "native_issuer",
      }),
    );
    collector.add(link("10", "0x2", "1", "0xa"));
    expect(finalizeBridgeLinks(collector).report.competingCounterparts).toEqual(
      [],
    );
  });

  test("published links satisfy the generated-list checks and schema", () => {
    const tokens = [token("1", "0xa"), token("10", "0xb")];
    const collector = new BridgeCollector(tokenKeysOf(tokens));
    collector.add(link("1", "0xa", "10", "0xb"));
    const { relationships } = finalizeBridgeLinks(collector);
    validateBridgeRelationships(relationships);
    validateGeneratedBridgeRelationships(relationships, tokens);
    validateTokenListSchema({
      $schema: "./token-list.schema.json",
      tokens,
      bridge_relationships: relationships,
    });
    expect(() =>
      validateGeneratedBridgeRelationships(relationships, tokens.slice(0, 1)),
    ).toThrow("is not in the token list");
    expect(() =>
      validateGeneratedBridgeRelationships(
        [{ ...relationships[0]!, source_name: undefined }],
        tokens,
      ),
    ).toThrow("has no provenance");
  });
});

test("validation rejects a self-link", () => {
  expect(() =>
    validateBridgeRelationships([link("1", "0xa", "0x1", "0xb")]),
  ).toThrow("to itself");
});

test("restores only the links of skipped sources", () => {
  const collector = new BridgeCollector();
  const restored = restorePreviousLinks(
    collector,
    [
      link("1", "0xa", "10", "0xb", { source_name: "Skipped" }),
      link("1", "0xc", "10", "0xd", { source_name: "Fresh" }),
      { ...link("1", "0xe", "10", "0xf"), source_name: undefined },
    ],
    ["Skipped"],
  );
  expect(restored).toBe(1);
  expect([...collector.links.values()][0]?.source_name).toBe("Skipped");
});

test("Superchain links follow the bridge extension, not the shared id", () => {
  const list: StandardTokenList = {
    tokens: [
      {
        chainId: 1,
        address: "0x1",
        name: "Dai",
        symbol: "DAI",
        decimals: 18,
        extensions: { opTokenId: "DAI", baseBridgeAddress: "0xb1" },
      },
      {
        chainId: 8453,
        address: "0x2",
        name: "Dai",
        symbol: "DAI",
        decimals: 18,
        extensions: {
          opTokenId: "DAI",
          baseBridgeAddress: "0x4200000000000000000000000000000000000010",
        },
      },
      // Same id, no bridge extension: a native deployment, not linked.
      {
        chainId: 10,
        address: "0x3",
        name: "Dai",
        symbol: "DAI",
        decimals: 18,
        extensions: { opTokenId: "DAI" },
      },
    ],
  };
  const links = superchainLinks(list, source);
  expect(links).toHaveLength(2);
  expect(links[0]).toMatchObject({
    source_chain_id: "1",
    source_bridge_address: "0xb1",
    dest_chain_id: "8453",
    dest_token_address: "0x2",
    relationship: "canonical_bridge",
    bridge_name: "Base standard bridge",
  });
  expect(links[1]?.source_chain_id).toBe("8453");
});

test("cross-chain addresses are labelled by their protocol", () => {
  const list: StandardTokenList = {
    tokens: [
      {
        chainId: 143,
        address: "0x1",
        name: "A",
        symbol: "A",
        decimals: 6,
        extensions: {
          bridgeInfo: { protocol: "LayerZero OFT", bridgeAddress: "0x9" },
          crossChainAddresses: { "1": { address: "0x2" } },
        },
      } as never,
      {
        chainId: 143,
        address: "0x3",
        name: "B",
        symbol: "B",
        decimals: 6,
        extensions: { crossChainAddresses: { "8453": { address: "0x4" } } },
      },
    ],
  };
  const links = crossChainAddressLinks(list, source);
  expect(links.map((link) => [link.relationship, link.bridge_name])).toEqual([
    ["interoperability", "LayerZero OFT"],
    ["unknown", null],
  ]);
});

test("Circle's mainnet table becomes issuer links between every pair", () => {
  const markdown = [
    "## Mainnet",
    "| Blockchain | USDC Mainnet Address |",
    "| Ethereum | [`0xA0b8`](https://etherscan.io) |",
    "| Base | [`0x8335`](https://basescan.org) |",
    "| Solana | [`EPjF`](https://solscan.io) |",
    "## Testnet",
    "| Ethereum Sepolia | [`0x1c7D`](https://sepolia.etherscan.io) |",
    "| Base | [`0xdead`](https://basescan.org) |",
  ].join("\n");
  const deployments = parseCircleRegistry(markdown);
  expect([...deployments]).toEqual([
    ["1", "0xA0b8"],
    ["8453", "0x8335"],
  ]);
  const links = issuerLinks(deployments, source, "Circle (USDC)");
  expect(links).toHaveLength(2);
  expect(links.every((link) => link.relationship === "native_issuer")).toBe(
    true,
  );
  expect(() => parseCircleRegistry("## Mainnet\n")).toThrow("no Ethereum");
});

test("native ether links run both ways through each rollup's bridge", () => {
  const links = nativeEthLinks();
  const base = links.filter(
    (link) => link.dest_chain_id === "8453" || link.source_chain_id === "8453",
  );
  expect(base.map((link) => link.dest_token_address)).toEqual([
    "0x0",
    "0x0",
    "0x4200000000000000000000000000000000000006",
    "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  ]);
});

test("bridge reads link both ways and map the native ether placeholder", () => {
  const links = bridgeReadLinks(
    [
      {
        chain_id: "137",
        token_address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
        l1_token_address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        bridge_name: "Polygon PoS bridge",
        method: "childToRootToken",
      },
    ],
    source,
  );
  expect(
    links.map((link) => [
      link.source_chain_id,
      link.source_token_address,
      link.dest_chain_id,
      link.dest_token_address,
      link.relationship,
      link.bridge_name,
    ]),
  ).toEqual([
    [
      "1",
      "0x0",
      "137",
      "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
      "canonical_bridge",
      "Polygon PoS bridge",
    ],
    [
      "137",
      "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
      "1",
      "0x0",
      "canonical_bridge",
      "Polygon PoS bridge",
    ],
  ]);
});
