import { expect, test } from "bun:test";
import {
  CloudflareImages,
  FatalCloudflareImagesError,
  hostTokenLogos,
} from "./cloudflare-images";
import type { Token } from "./types";

function cloudflareResponse(
  body: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}

function token(address: string, logoUrl: string): Token {
  return {
    chain_id: "1",
    token_address: address,
    token_name: "Token",
    token_symbol: "TKN",
    token_decimals: 18,
    logo_url: logoUrl,
    visibility_priority: 0,
    sort_order: 0,
  };
}

test("recognizes only the configured Cloudflare Images account", () => {
  const images = new CloudflareImages({
    accountId: "account",
    apiToken: "token",
    deliveryHash: "delivery",
    variant: "logo",
  });

  expect(
    images.isHostedByUs("https://imagedelivery.net/delivery/id/logo"),
  ).toBe(true);
  expect(
    images.isHostedByUs("https://imagedelivery.net/someone-else/id/logo"),
  ).toBe(false);
  expect(
    images.normalizeHostedUrl(
      "https://imagedelivery.net/delivery/id/logo128pad",
    ),
  ).toBe("https://imagedelivery.net/delivery/id/logo");
});

test("uses the deterministic delivery URL without uploading an existing image", async () => {
  let apiRequests = 0;
  const images = new CloudflareImages({
    accountId: "account",
    apiToken: "token",
    deliveryHash: "delivery",
    variant: "logo",
    requestIntervalMs: 0,
    fetch: (async (input) => {
      const url = String(input);
      if (url.startsWith("https://api.cloudflare.com/")) apiRequests++;
      return new Response(null, { status: 200 });
    }) as typeof fetch,
  });

  const hosted = await images.host("https://example.com/token.png");
  expect(hosted).toStartWith(
    "https://imagedelivery.net/delivery/token-logos/",
  );
  expect(hosted).toEndWith("/logo");
  expect(apiRequests).toBe(0);
});

test("downloads and uploads image bytes when Cloudflare cannot fetch the source", async () => {
  const sourceUrl = "https://protected.example/token.webp";
  let urlUploads = 0;
  let fileUploads = 0;
  let sourceDownloads = 0;
  const images = new CloudflareImages({
    accountId: "account",
    apiToken: "token",
    deliveryHash: "delivery",
    variant: "logo",
    requestIntervalMs: 0,
    fetch: (async (input, init) => {
      const url = String(input);
      if (url.startsWith("https://imagedelivery.net/")) {
        return new Response(null, { status: 404 });
      }
      if (url === sourceUrl) {
        sourceDownloads++;
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/webp" },
        });
      }

      const form = init?.body as FormData;
      if (form.get("url")) {
        urlUploads++;
        return cloudflareResponse(
          {
            success: false,
            errors: [{ code: 5454, message: "Error during the fetch: 403" }],
          },
          403,
        );
      }
      expect(form.get("file")).toBeInstanceOf(File);
      fileUploads++;
      return cloudflareResponse({
        success: true,
        result: {
          id: "token-logos/id",
          variants: [
            "https://imagedelivery.net/delivery/token-logos/id/logo",
          ],
        },
      });
    }) as typeof fetch,
  });

  expect(await images.host(sourceUrl)).toBe(
    "https://imagedelivery.net/delivery/token-logos/id/logo",
  );
  expect(urlUploads).toBe(1);
  expect(sourceDownloads).toBe(1);
  expect(fileUploads).toBe(1);
});

test("honors Retry-After and retries a rate-limited upload", async () => {
  let now = 0;
  const sleeps: number[] = [];
  let uploads = 0;
  const images = new CloudflareImages({
    accountId: "account",
    apiToken: "token",
    deliveryHash: "delivery",
    variant: "logo",
    requestIntervalMs: 0,
    now: () => now,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
      now += milliseconds;
    },
    fetch: (async (input) => {
      const url = String(input);
      if (url.startsWith("https://imagedelivery.net/")) {
        return new Response(null, { status: 404 });
      }
      uploads++;
      if (uploads === 1) {
        return cloudflareResponse(
          { success: false, errors: [{ code: 971, message: "throttle" }] },
          429,
          { "retry-after": "1" },
        );
      }
      return cloudflareResponse({
        success: true,
        result: { id: "token-logos/id" },
      });
    }) as typeof fetch,
  });

  await images.host("https://example.com/token.png");
  expect(uploads).toBe(2);
  expect(sleeps).toContain(1_000);
});

test("uploads one deterministic image for tokens sharing a logo", async () => {
  const sourceUrl = "https://example.com/shared.png";
  let uploads = 0;
  const images = new CloudflareImages({
    accountId: "account",
    apiToken: "token",
    deliveryHash: "delivery",
    variant: "logo",
    requestIntervalMs: 0,
    fetch: (async (input) => {
      const url = String(input);
      if (url.startsWith("https://imagedelivery.net/")) {
        return new Response(null, { status: 404 });
      }
      uploads++;
      return cloudflareResponse({
        success: true,
        result: { id: "token-logos/id" },
      });
    }) as typeof fetch,
  });
  const tokens = [token("0x1", sourceUrl), token("0x2", sourceUrl)];

  await hostTokenLogos({
    tokens,
    previousTokens: [],
    imageSourceCache: {},
    cloudflare: images,
  });
  expect(uploads).toBe(1);
  expect(tokens[0]?.logo_url).toBe(tokens[1]?.logo_url);
});

test("omits an unreachable individual logo without failing the list", async () => {
  const sourceUrl = "https://protected.example/token.png";
  const images = new CloudflareImages({
    accountId: "account",
    apiToken: "token",
    deliveryHash: "delivery",
    variant: "logo",
    requestIntervalMs: 0,
    fetch: (async (input) => {
      const url = String(input);
      if (url.startsWith("https://imagedelivery.net/")) {
        return new Response(null, { status: 404 });
      }
      if (url === sourceUrl) return new Response(null, { status: 403 });
      return cloudflareResponse(
        {
          success: false,
          errors: [{ code: 5454, message: "Error during the fetch: 403" }],
        },
        403,
      );
    }) as typeof fetch,
  });
  const tokens = [token("0x1", sourceUrl)];

  await hostTokenLogos({
    tokens,
    previousTokens: [],
    imageSourceCache: {},
    cloudflare: images,
  });
  expect(tokens[0]?.logo_url).toBeNull();
});

test("uses an alternate token-list logo when the curated source is blocked", async () => {
  const primaryUrl = "https://protected.example/token.png";
  const fallbackUrl = "https://fallback.example/token.png";
  const images = new CloudflareImages({
    accountId: "account",
    apiToken: "token",
    deliveryHash: "delivery",
    variant: "logo",
    requestIntervalMs: 0,
    fetch: (async (input, init) => {
      const url = String(input);
      if (url.startsWith("https://imagedelivery.net/")) {
        return new Response(null, { status: 404 });
      }
      if (url === primaryUrl) return new Response(null, { status: 403 });

      const form = init?.body as FormData;
      if (form.get("url") === primaryUrl) {
        return cloudflareResponse(
          {
            success: false,
            errors: [{ code: 5454, message: "Error during the fetch: 403" }],
          },
          403,
        );
      }
      expect(form.get("url")).toBe(fallbackUrl);
      return cloudflareResponse({
        success: true,
        result: { id: "token-logos/fallback" },
      });
    }) as typeof fetch,
  });
  const tokens = [token("0x1", primaryUrl)];
  const cache = await hostTokenLogos({
    tokens,
    previousTokens: [],
    imageSourceCache: {},
    logoCandidates: new Map([
      ["1:1", [primaryUrl, fallbackUrl]],
    ]),
    cloudflare: images,
  });

  expect(tokens[0]?.logo_url).toStartWith(
    "https://imagedelivery.net/delivery/token-logos/",
  );
  expect(tokens[0]?.logo_url).toEndWith("/logo");
  expect(cache[primaryUrl]).toBe(cache[fallbackUrl]);
});

test("does not turn an exhausted Cloudflare outage into missing logos", async () => {
  const images = new CloudflareImages({
    accountId: "account",
    apiToken: "token",
    deliveryHash: "delivery",
    variant: "logo",
    requestIntervalMs: 0,
    maxRetries: 0,
    fetch: (async (input) => {
      const url = String(input);
      if (url.startsWith("https://imagedelivery.net/")) {
        return new Response(null, { status: 404 });
      }
      return cloudflareResponse(
        { success: false, errors: [{ code: 971, message: "throttle" }] },
        429,
      );
    }) as typeof fetch,
  });

  expect(
    images.host("https://example.com/token.png"),
  ).rejects.toBeInstanceOf(FatalCloudflareImagesError);
});
