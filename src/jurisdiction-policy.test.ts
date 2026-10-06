import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  JURISDICTION_POLICY_PATH,
  assertClassified,
  type JurisdictionPolicy,
  unclassifiedTokens,
} from "./jurisdiction-policy";
import type { Token, TokenListDocument } from "./types";

// Pinned in ekubo-mcp-server and the interface too; change all three together.
const POLICY_SHA256 =
  "0712ad8b08b487646cb1b574cfa7e2e927596fe2c8d2bec915107934988c8af1";

const root = resolve(import.meta.dir, "..");
const policyBytes = readFileSync(resolve(root, JURISDICTION_POLICY_PATH));
const policy = JSON.parse(policyBytes.toString("utf8")) as JurisdictionPolicy;
const curated = JSON.parse(
  readFileSync(resolve(root, "curated-tokens.json"), "utf8"),
) as TokenListDocument;

function token(chainId: string, address: string, symbol = "X"): Token {
  return {
    chain_id: chainId,
    token_address: address,
    token_name: symbol,
    token_symbol: symbol,
    token_decimals: 18,
    logo_url: null,
    visibility_priority: 0,
    sort_order: 0,
  };
}

describe("jurisdiction policy v2", () => {
  test("vendored file matches the pinned digest", () => {
    expect(createHash("sha256").update(policyBytes).digest("hex")).toBe(
      POLICY_SHA256,
    );
    expect(policy.policy_version).toBe("ekubo-token-jurisdictions-v2");
  });

  test("class has 200 addresses and the four outside-class tokens", () => {
    const chain = policy.chains["4663"]!;
    expect(chain.unclassified).toBe("hold");
    expect(chain.rhj_stock_token).toHaveLength(200);
    expect(chain.outside_class.map((entry) => entry.symbol).sort()).toEqual([
      "ETH",
      "STONX",
      "USDG",
      "WETH",
    ]);
  });

  test("every curated chain-4663 row is classified", () => {
    expect(unclassifiedTokens(curated.tokens, policy)).toEqual([]);
    expect(() =>
      assertClassified(curated.tokens, policy, "curated-tokens.json"),
    ).not.toThrow();
  });

  test("an unclassified chain-4663 row fails validation", () => {
    const spoof = token(
      "4663",
      "0x1111111111111111111111111111111111111111",
      "AMC",
    );
    expect(() =>
      assertClassified([...curated.tokens, spoof], policy, "curated-tokens.json"),
    ).toThrow(
      "curated-tokens.json: unclassified chain-4663 token; classify under EKU-853 policy before listing: AMC 0x1111111111111111111111111111111111111111",
    );
  });

  test("identity is chain ID and numeric address, not symbol", () => {
    const amc = policy.chains["4663"]!.rhj_stock_token.find(
      (entry) => entry.symbol === "AMC",
    )!;
    expect(
      unclassifiedTokens([token("0x1237", amc.address.toUpperCase().replace("0X", "0x"))], policy),
    ).toEqual([]);
    expect(unclassifiedTokens([token("1", "0x1111111111111111111111111111111111111111")], policy)).toEqual([]);
  });

  test("rejects a policy with the wrong version", () => {
    expect(() =>
      assertClassified([], { ...policy, policy_version: "ekubo-token-jurisdictions-v1" }, "x"),
    ).toThrow("expected ekubo-token-jurisdictions-v2");
  });
});
