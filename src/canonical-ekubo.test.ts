import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { tokenKey } from "./token-list";
import type { TokenListDocument, TokenProvenance } from "./types";

const root = resolve(import.meta.dir, "..");
const ethereumEkubo = "0x04C46E830Bb56ce22735d5d8Fc9CB90309317d0f";
const documents = ["curated-tokens.json", "tokens.json"].map(
  (name) =>
    JSON.parse(readFileSync(resolve(root, name), "utf8")) as TokenListDocument,
);
const provenance = JSON.parse(
  readFileSync(resolve(root, "token-sources.json"), "utf8"),
) as TokenProvenance[];

const routes = [
  {
    chainId: "42161",
    token: "0x0A08E175c0350dF6119d21e32FE628799F804179",
    l1Bridge: "0xa3A7B6F88361F48403514059F1F16C8E78d60EeC",
    l2Bridge: "0x09e9222E96E7B4AE2a407B98d48e330053351EEe",
  },
  {
    chainId: "4663",
    token: "0x9bdf2327e1EA6EDDF1adD2048d4c9dF2cc8C7cc6",
    l1Bridge: "0x85001CC4867C5e1C22dA4B79BB8852B9e2a06da0",
    l2Bridge: "0xfd9b17206278C16DdaacF6AC8f05dBf97EdCb31e",
  },
  {
    chainId: "8453",
    token: "0x5db2469C0D07Efd371AE0A774537ABb1D68485Bf",
    l1Bridge: "0x3154Cf16ccdb4C6d922629664174b904d80F2C35",
    l2Bridge: "0x4200000000000000000000000000000000000010",
  },
];

interface DepositProof {
  dest_chain_id: string;
  dest_token_address: string;
  amount: string;
  l1_bridge_address: string;
  l2_bridge_address: string;
  l1_transaction_hash: string;
  l2_transaction_hash: string;
  verified_l1_token: string;
  decimals: number;
}

interface BridgeProof {
  source_chain_id: string;
  source_token_address: string;
  acquisition: { amount: string };
  deposits: DepositProof[];
}

describe("canonical EKUBO deployments", () => {
  test("curated and generated lists keep one verified token per route", () => {
    for (const document of documents) {
      const ethereum = document.tokens.find(
        (token) =>
          tokenKey(token.chain_id, token.token_address) ===
          tokenKey("1", ethereumEkubo),
      )!;
      for (const route of routes) {
        const matches = document.tokens.filter(
          (token) =>
            tokenKey(token.chain_id, token.token_address) ===
            tokenKey(route.chainId, route.token),
        );
        expect(matches).toHaveLength(1);
        expect(matches[0]).toMatchObject({
          token_name: "Ekubo Protocol",
          token_symbol: "EKUBO",
          token_decimals: 18,
          logo_url: ethereum.logo_url,
          visibility_priority: 3,
          sort_order: 2,
        });
      }
    }
  });

  test("both directions identify the actual bridge, not its router", () => {
    for (const document of documents) {
      for (const route of routes) {
        const forward = document.bridge_relationships.find(
          (link) =>
            link.source_chain_id === "1" &&
            BigInt(link.source_token_address) === BigInt(ethereumEkubo) &&
            link.dest_chain_id === route.chainId,
        );
        const reverse = document.bridge_relationships.find(
          (link) =>
            link.source_chain_id === route.chainId &&
            BigInt(link.source_token_address) === BigInt(route.token) &&
            link.dest_chain_id === "1",
        );
        expect(forward).toMatchObject({
          dest_token_address: route.token,
          source_bridge_address: route.l1Bridge,
          relationship: "canonical_bridge",
        });
        expect(reverse).toMatchObject({
          dest_token_address: ethereumEkubo,
          source_bridge_address: route.l2Bridge,
          relationship: "canonical_bridge",
        });
      }
    }
  });

  test("generated metadata retains curated provenance", () => {
    for (const route of routes) {
      expect(
        provenance.find(
          (source) =>
            tokenKey(source.chain_id, source.token_address) ===
            tokenKey(route.chainId, route.token),
        ),
      ).toMatchObject({
        source_name: "Ekubo curated tokens",
        source_url: "curated-tokens.json",
      });
    }
  });

  test("confirmed deposits account for exactly the acquired 0.01 EKUBO", () => {
    const proof = JSON.parse(
      readFileSync(
        resolve(root, "provenance/ekubo-canonical-bridges.json"),
        "utf8",
      ),
    ) as BridgeProof;
    expect(proof.source_chain_id).toBe("1");
    expect(proof.source_token_address).toBe(ethereumEkubo);
    expect(proof.deposits).toHaveLength(routes.length);
    expect(
      proof.deposits.reduce((sum, deposit) => sum + BigInt(deposit.amount), 0n),
    ).toBe(10n ** 16n);
    expect(BigInt(proof.acquisition.amount)).toBe(10n ** 16n);
    for (const route of routes) {
      const deposit = proof.deposits.find(
        (entry) => entry.dest_chain_id === route.chainId,
      )!;
      expect(deposit).toMatchObject({
        dest_token_address: route.token,
        l1_bridge_address: route.l1Bridge,
        l2_bridge_address: route.l2Bridge,
        verified_l1_token: ethereumEkubo,
        decimals: 18,
      });
      expect(deposit.l1_transaction_hash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(deposit.l2_transaction_hash).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });
});
