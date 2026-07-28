import { createHash } from "node:crypto";
import type { Token, TokenProvenance } from "./types";
import { tokenKey } from "./token-list";

type CloudflareImage = {
  id?: string;
  variants?: string[];
};

type CloudflareResponse = {
  success: boolean;
  result?: CloudflareImage;
  errors?: { code?: number; message?: string }[];
};

export type ImageSourceCache = Record<string, string>;

type CloudflareImagesConfig = {
  accountId: string;
  apiToken: string;
  deliveryHash: string;
  variant: string;
};

function responseError(response: CloudflareResponse): string {
  return (
    response.errors
      ?.map(({ code, message }) => `${code ?? "unknown"}: ${message ?? ""}`)
      .join(", ") || "unknown Cloudflare Images error"
  );
}

export class CloudflareImages {
  readonly deliveryPrefix: string;

  constructor(private readonly config: CloudflareImagesConfig) {
    this.deliveryPrefix = `https://imagedelivery.net/${config.deliveryHash}/`;
  }

  isHostedByUs(url: string): boolean {
    return url.startsWith(this.deliveryPrefix);
  }

  normalizeHostedUrl(url: string): string {
    if (!this.isHostedByUs(url)) return url;
    const path = url.slice(this.deliveryPrefix.length);
    const variantSeparator = path.lastIndexOf("/");
    if (variantSeparator === -1) return url;
    return `${this.deliveryPrefix}${path.slice(0, variantSeparator)}/${this.config.variant}`;
  }

  private imageId(sourceUrl: string): string {
    const digest = createHash("sha256").update(sourceUrl).digest("hex");
    return `token-logos/${digest}`;
  }

  private deliveryUrl(imageId: string, variants?: string[]): string {
    const configuredVariant = `/${this.config.variant}`;
    return (
      variants?.find((url) => url.endsWith(configuredVariant)) ??
      `${this.deliveryPrefix}${imageId}/${this.config.variant}`
    );
  }

  private async get(imageId: string): Promise<CloudflareImage | null> {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.config.accountId}/images/v1/${encodeURIComponent(imageId)}`,
      {
        headers: {
          Authorization: `Bearer ${this.config.apiToken}`,
        },
      },
    );
    if (response.status === 404) return null;

    const body = (await response.json()) as CloudflareResponse;
    if (!response.ok || !body.success || !body.result) {
      throw new Error(
        `Cloudflare image lookup failed (${response.status}): ${responseError(body)}`,
      );
    }
    return body.result;
  }

  private async create(
    imageId: string,
    sourceUrl: string,
  ): Promise<CloudflareImage> {
    const form = new FormData();
    form.set("url", sourceUrl);
    form.set("id", imageId);
    form.set("requireSignedURLs", "false");
    form.set(
      "metadata",
      JSON.stringify({
        source: sourceUrl,
        managedBy: "EkuboProtocol/default-tokens",
      }),
    );

    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.config.accountId}/images/v1`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiToken}`,
        },
        body: form,
      },
    );
    const body = (await response.json()) as CloudflareResponse;
    if (!response.ok || !body.success || !body.result) {
      // A concurrent run may have created the deterministic ID.
      const existing = await this.get(imageId);
      if (existing) return existing;
      throw new Error(
        `Cloudflare image upload failed (${response.status}): ${responseError(body)}`,
      );
    }
    return body.result;
  }

  async host(sourceUrl: string): Promise<string> {
    if (this.isHostedByUs(sourceUrl)) {
      return this.normalizeHostedUrl(sourceUrl);
    }

    const parsed = new URL(sourceUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error(`Unsupported image URL protocol: ${sourceUrl}`);
    }

    const imageId = this.imageId(sourceUrl);
    const existing = await this.get(imageId);
    const image = existing ?? (await this.create(imageId, sourceUrl));
    return this.deliveryUrl(imageId, image.variants);
  }
}

export async function hostTokenLogos({
  tokens,
  provenance,
  previousTokens,
  imageSourceCache,
  cloudflare,
}: {
  tokens: Token[];
  provenance: TokenProvenance[];
  previousTokens: Token[];
  imageSourceCache: ImageSourceCache;
  cloudflare: CloudflareImages;
}): Promise<ImageSourceCache> {
  const previousByKey = new Map(
    previousTokens.map((token) => [
      tokenKey(token.chain_id, token.token_address),
      token,
    ]),
  );
  const provenanceByKey = new Map(
    provenance.map((source) => [
      tokenKey(source.chain_id, source.token_address),
      source,
    ]),
  );
  const pendingBySource = new Map<string, Promise<string>>();
  let nextIndex = 0;

  async function hostOne(token: Token): Promise<void> {
    const sourceUrl = token.logo_url;
    if (!sourceUrl) return;
    if (cloudflare.isHostedByUs(sourceUrl)) {
      token.logo_url = cloudflare.normalizeHostedUrl(sourceUrl);
      return;
    }

    const cached = imageSourceCache[sourceUrl];
    if (cached && cloudflare.isHostedByUs(cached)) {
      token.logo_url = cloudflare.normalizeHostedUrl(cached);
      return;
    }

    try {
      let pending = pendingBySource.get(sourceUrl);
      if (!pending) {
        pending = cloudflare.host(sourceUrl);
        pendingBySource.set(sourceUrl, pending);
      }
      const hosted = await pending;
      imageSourceCache[sourceUrl] = hosted;
      token.logo_url = hosted;
      console.log(`Hosted token logo: ${sourceUrl} -> ${hosted}`);
    } catch (error) {
      const key = tokenKey(token.chain_id, token.token_address);
      const previousLogo = previousByKey.get(key)?.logo_url;
      if (previousLogo && cloudflare.isHostedByUs(previousLogo)) {
        const normalizedPreviousLogo =
          cloudflare.normalizeHostedUrl(previousLogo);
        console.warn(
          `Could not refresh ${sourceUrl}; retaining ${normalizedPreviousLogo}`,
          error,
        );
        token.logo_url = normalizedPreviousLogo;
        return;
      }

      const source = provenanceByKey.get(key);
      if (source?.source_url === "curated-tokens.json") {
        throw new Error(
          `Could not host curated logo for ${token.chain_id}:${token.token_address}`,
          { cause: error },
        );
      }

      console.warn(
        `Could not host ${sourceUrl}; omitting the unhosted logo`,
        error,
      );
      token.logo_url = null;
    }
  }

  const workerCount = Math.min(10, tokens.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < tokens.length) {
        const token = tokens[nextIndex++];
        if (token) await hostOne(token);
      }
    }),
  );

  return Object.fromEntries(
    Object.entries(imageSourceCache).sort(([a], [b]) => a.localeCompare(b)),
  );
}
