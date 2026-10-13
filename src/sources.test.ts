import { describe, expect, test } from "bun:test";
import { REMOTE_TOKEN_LISTS, sourceVisibilityPriority } from "./sources";

describe("sourceVisibilityPriority", () => {
  const source = {
    name: "Test list",
    url: "https://example.com/list.json",
    visibilityPriority: 1,
    visibilityPriorityByChainId: { "130": 0 },
  };

  test("uses a chain's override when it has one", () => {
    expect(sourceVisibilityPriority(source, "130")).toBe(0);
  });

  test("falls back to the source priority, then -1", () => {
    expect(sourceVisibilityPriority(source, "1")).toBe(1);
    expect(sourceVisibilityPriority({ name: "x", url: "y" }, "1")).toBe(-1);
  });

  test("keeps Uniswap's Unichain mirrors out of the default picker", () => {
    const uniswap = REMOTE_TOKEN_LISTS.find(
      (candidate) => candidate.url === "https://tokens.uniswap.org",
    );
    expect(uniswap).toBeDefined();
    expect(sourceVisibilityPriority(uniswap!, "130")).toBe(0);
    expect(sourceVisibilityPriority(uniswap!, "1")).toBe(1);
  });
});
