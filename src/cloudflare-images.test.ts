import { expect, test } from "bun:test";
import { CloudflareImages } from "./cloudflare-images";

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
