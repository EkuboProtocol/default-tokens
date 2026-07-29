import { expect, test } from "bun:test";
import { fetchJson } from "./fetch-json";

test("retries a transient source failure and honors Retry-After", async () => {
  let requests = 0;
  const sleeps: number[] = [];
  const result = await fetchJson<{ tokens: unknown[] }>(
    "test list",
    "https://example.com/list.json",
    {
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
      fetch: (async (_input) => {
        requests++;
        if (requests === 1) {
          return new Response(null, {
            status: 429,
            headers: { "retry-after": "2" },
          });
        }
        return Response.json({ tokens: [] });
      }) as typeof fetch,
    },
  );

  expect(result).toEqual({ tokens: [] });
  expect(requests).toBe(2);
  expect(sleeps).toEqual([2_000]);
});

test("retries a transient source network failure", async () => {
  let requests = 0;
  const result = await fetchJson<{ ok: boolean }>(
    "test list",
    "https://example.com/list.json",
    {
      sleep: async () => {},
      fetch: (async (_input) => {
        requests++;
        if (requests === 1) throw new TypeError("network unavailable");
        return Response.json({ ok: true });
      }) as typeof fetch,
    },
  );

  expect(result).toEqual({ ok: true });
  expect(requests).toBe(2);
});

test("does not retry a permanent source response", async () => {
  let requests = 0;
  expect(
    fetchJson("test list", "https://example.com/list.json", {
      sleep: async () => {},
      fetch: (async (_input) => {
        requests++;
        return new Response(null, { status: 403 });
      }) as typeof fetch,
    }),
  ).rejects.toThrow("403");
  expect(requests).toBe(1);
});
