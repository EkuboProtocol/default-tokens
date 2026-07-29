import { createHash } from "node:crypto";
import type { Token } from "./types";
import { tokenKey } from "./token-list";

type CloudflareImage = {
  id?: string;
  variants?: string[];
};

type CloudflareEnvelope<T> = {
  success: boolean;
  result?: T;
  errors?: { code?: number; message?: string }[];
};

type CloudflareResponse = CloudflareEnvelope<CloudflareImage>;

type CloudflareBatchToken = {
  token: string;
  expiresAt?: string;
};

type FetchFunction = typeof globalThis.fetch;

export type ImageSourceCache = Record<string, string>;

export type CloudflareImagesConfig = {
  accountId: string;
  apiToken: string;
  deliveryHash: string;
  variant: string;
  uploadUrl?: string;
  requestIntervalMs?: number;
  batchRequestIntervalMs?: number;
  maxRetries?: number;
  fetch?: FetchFunction;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
};

type NormalizedConfig = Required<CloudflareImagesConfig>;

class CloudflareApiError extends Error {
  constructor(
    readonly status: number,
    readonly response: CloudflareResponse,
    message: string,
  ) {
    super(message);
  }
}

export class FatalCloudflareImagesError extends Error {}

function responseError(response: CloudflareEnvelope<unknown>): string {
  const message =
    response.errors
      ?.map(({ code, message }) => `${code ?? "unknown"}: ${message ?? ""}`)
      .join(", ") || "unknown Cloudflare Images error";
  return message.length > 500 ? `${message.slice(0, 500)}…` : message;
}

async function parseCloudflareResponse<T>(
  response: Response,
): Promise<CloudflareEnvelope<T>> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as unknown;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "success" in parsed &&
      typeof parsed.success === "boolean"
    ) {
      return parsed as CloudflareEnvelope<T>;
    }
  } catch {
    // Fall through to a normalized error response.
  }
  return {
    success: false,
    errors: [{ message: text || response.statusText }],
  };
}

function retryAfterMilliseconds(
  response: Response,
  attempt: number,
  now = Date.now(),
): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.ceil(seconds * 1_000);
    }
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, date - now);
  }
  return Math.min(300_000, 1_000 * 2 ** attempt);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isOriginFetchFailure(error: CloudflareApiError): boolean {
  return (
    error.response.errors?.some(
      ({ code, message }) =>
        code === 5454 || /(?:during the fetch|fetching the image)/i.test(message ?? ""),
    ) ?? false
  );
}

function sourceFilename(sourceUrl: string): string {
  const pathname = new URL(sourceUrl).pathname;
  const candidate = pathname.split("/").pop() || "logo";
  return candidate.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 255) || "logo";
}

function fetchableSourceUrl(sourceUrl: string): string {
  if (/^ipfs:\/\//i.test(sourceUrl)) {
    const ipfsPath = sourceUrl
      .slice(sourceUrl.indexOf("://") + 3)
      .replace(/^ipfs\//i, "");
    if (!ipfsPath) throw new Error(`Invalid IPFS image URL: ${sourceUrl}`);
    return `https://ipfs.io/ipfs/${ipfsPath}`;
  }

  const parsed = new URL(sourceUrl);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Unsupported image URL protocol: ${sourceUrl}`);
  }
  return parsed.toString();
}

export async function createCloudflareImages(
  config: CloudflareImagesConfig,
): Promise<CloudflareImages> {
  const fetchImplementation = config.fetch ?? globalThis.fetch;
  const sleep =
    config.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const maxRetries = Math.min(config.maxRetries ?? 8, 3);
  const batchTokenUrl =
    `https://api.cloudflare.com/client/v4/accounts/${config.accountId}` +
    "/images/v1/batch_token";
  let failure = "unknown response";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response: Response | undefined;
    try {
      response = await fetchImplementation(batchTokenUrl, {
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
        },
        signal: AbortSignal.timeout(30_000),
      });
      const body = await parseCloudflareResponse<CloudflareBatchToken>(
        response,
      );
      if (
        response.ok &&
        body.success &&
        typeof body.result?.token === "string"
      ) {
        console.log("Using the Cloudflare Images batch upload API");
        return new CloudflareImages({
          ...config,
          apiToken: body.result.token,
          uploadUrl: "https://batch.imagedelivery.net/images/v1",
          requestIntervalMs: config.batchRequestIntervalMs ?? 10,
        });
      }

      failure = `${response.status}: ${responseError(body)}`;
      if (
        response.status !== 429 &&
        response.status < 500
      ) {
        break;
      }
    } catch (error) {
      failure = errorMessage(error);
    }

    if (attempt >= maxRetries) break;
    const delay = response
      ? retryAfterMilliseconds(response, attempt)
      : Math.min(30_000, 1_000 * 2 ** attempt);
    console.warn(
      `Could not obtain a Cloudflare Images batch token; retrying in ${Math.ceil(delay / 1_000)}s: ${failure}`,
    );
    await sleep(delay);
  }

  console.warn(
    `Cloudflare Images batch API unavailable; using the paced standard API: ${failure}`,
  );
  return new CloudflareImages(config);
}

export class CloudflareImages {
  readonly deliveryPrefix: string;
  private readonly config: NormalizedConfig;
  private requestGate = Promise.resolve();
  private nextApiRequestAt = 0;
  private apiBlockedUntil = 0;

  constructor(config: CloudflareImagesConfig) {
    this.config = {
      ...config,
      uploadUrl:
        config.uploadUrl ??
        `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/images/v1`,
      requestIntervalMs: config.requestIntervalMs ?? 300,
      batchRequestIntervalMs: config.batchRequestIntervalMs ?? 10,
      maxRetries: config.maxRetries ?? 8,
      fetch: config.fetch ?? globalThis.fetch,
      sleep:
        config.sleep ??
        ((milliseconds) =>
          new Promise((resolve) => setTimeout(resolve, milliseconds))),
      now: config.now ?? Date.now,
    };
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

  private async waitForApiSlot(): Promise<void> {
    let release = () => {};
    const previous = this.requestGate;
    this.requestGate = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      const waitUntil = Math.max(
        this.nextApiRequestAt,
        this.apiBlockedUntil,
      );
      const delay = waitUntil - this.config.now();
      if (delay > 0) await this.config.sleep(delay);
      this.nextApiRequestAt =
        this.config.now() + this.config.requestIntervalMs;
    } finally {
      release();
    }
  }

  private async fetchApi(
    init: RequestInit,
  ): Promise<{ response: Response; body: CloudflareResponse }> {
    for (let attempt = 0; ; attempt++) {
      await this.waitForApiSlot();
      let response: Response;
      try {
        response = await this.config.fetch(this.config.uploadUrl, {
          ...init,
          headers: {
            ...init.headers,
            Authorization: `Bearer ${this.config.apiToken}`,
          },
        });
      } catch (error) {
        if (attempt >= this.config.maxRetries) {
          throw new FatalCloudflareImagesError(
            `Cloudflare Images request failed after ${attempt + 1} attempts: ${errorMessage(error)}`,
            { cause: error },
          );
        }
        const delay = Math.min(300_000, 1_000 * 2 ** attempt);
        console.warn(
          `Cloudflare Images request failed; retrying in ${Math.ceil(delay / 1_000)}s: ${errorMessage(error)}`,
        );
        await this.config.sleep(delay);
        continue;
      }
      const body = await parseCloudflareResponse<CloudflareImage>(response);
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= this.config.maxRetries) {
        return { response, body };
      }

      const delay = retryAfterMilliseconds(
        response,
        attempt,
        this.config.now(),
      );
      if (response.status === 429) {
        this.apiBlockedUntil = Math.max(
          this.apiBlockedUntil,
          this.config.now() + delay,
        );
      } else {
        await this.config.sleep(delay);
      }
      console.warn(
        `Cloudflare Images returned ${response.status}; retrying in ${Math.ceil(delay / 1_000)}s`,
      );
    }
  }

  private async deliveryExists(imageId: string): Promise<boolean> {
    try {
      const response = await this.config.fetch(this.deliveryUrl(imageId), {
        method: "HEAD",
        cache: "no-store",
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private form(
    imageId: string,
    sourceUrl: string,
    image: { url: string } | { file: File },
  ): FormData {
    const form = new FormData();
    if ("url" in image) form.set("url", image.url);
    else form.set("file", image.file);
    form.set("id", imageId);
    form.set("requireSignedURLs", "false");
    form.set(
      "metadata",
      JSON.stringify({
        source: sourceUrl.slice(0, 800),
        managedBy: "EkuboProtocol/default-tokens",
      }),
    );
    return form;
  }

  private async upload(
    imageId: string,
    sourceUrl: string,
    image: { url: string } | { file: File },
  ): Promise<CloudflareImage> {
    const { response, body } = await this.fetchApi({
      method: "POST",
      body: this.form(imageId, sourceUrl, image),
    });
    if (response.ok && body.success && body.result) return body.result;

    // A previous or concurrent run may already have created this custom ID.
    if (await this.deliveryExists(imageId)) return { id: imageId };

    const message = `Cloudflare image upload failed (${response.status}): ${responseError(body)}`;
    const error = new CloudflareApiError(response.status, body, message);
    if (
      response.status === 429 ||
      response.status >= 500 ||
      ((response.status === 401 || response.status === 403) &&
        !isOriginFetchFailure(error))
    ) {
      throw new FatalCloudflareImagesError(message, { cause: error });
    }
    throw error;
  }

  private async downloadSourceImage(sourceUrl: string): Promise<File> {
    const parsed = new URL(sourceUrl);
    let response: Response | undefined;
    let networkError: unknown;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await this.config.fetch(sourceUrl, {
          headers: {
            Accept: "image/avif,image/webp,image/svg+xml,image/*,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.8",
            Referer: `${parsed.origin}/`,
            "User-Agent":
              "Mozilla/5.0 (compatible; EkuboTokenList/1.0; +https://github.com/EkuboProtocol/default-tokens)",
          },
          redirect: "follow",
          signal: AbortSignal.timeout(30_000),
        });
      } catch (error) {
        networkError = error;
        if (attempt < 2) {
          await this.config.sleep(1_000 * 2 ** attempt);
          continue;
        }
        break;
      }
      if (response.ok) break;
      if (response.status !== 429 && response.status < 500) break;
      await this.config.sleep(1_000 * 2 ** attempt);
    }

    if (!response?.ok) {
      throw new Error(
        `Source image download failed (${response?.status ?? errorMessage(networkError)}): ${sourceUrl}`,
      );
    }

    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > 10_000_000) {
      throw new Error(`Source image exceeds the 10 MB upload limit: ${sourceUrl}`);
    }
    const contentType =
      response.headers.get("content-type")?.split(";")[0]?.trim() ||
      "application/octet-stream";
    if (contentType === "text/html") {
      throw new Error(`Source returned HTML instead of an image: ${sourceUrl}`);
    }

    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 10_000_000) {
      throw new Error(`Source image exceeds the 10 MB upload limit: ${sourceUrl}`);
    }
    return new File([bytes], sourceFilename(sourceUrl), { type: contentType });
  }

  async host(sourceUrl: string): Promise<string> {
    if (this.isHostedByUs(sourceUrl)) {
      return this.normalizeHostedUrl(sourceUrl);
    }

    const resolvedSourceUrl = fetchableSourceUrl(sourceUrl);
    const imageId = this.imageId(sourceUrl);
    if (await this.deliveryExists(imageId)) return this.deliveryUrl(imageId);

    let image: CloudflareImage;
    try {
      image = await this.upload(imageId, sourceUrl, {
        url: resolvedSourceUrl,
      });
    } catch (error) {
      if (
        error instanceof FatalCloudflareImagesError ||
        !(error instanceof CloudflareApiError) ||
        !isOriginFetchFailure(error)
      ) {
        throw error;
      }
      console.warn(
        `Cloudflare could not fetch ${sourceUrl}; downloading it in the runner`,
      );
      const file = await this.downloadSourceImage(resolvedSourceUrl);
      image = await this.upload(imageId, sourceUrl, { file });
    }
    return this.deliveryUrl(imageId, image.variants);
  }
}

export async function hostTokenLogos({
  tokens,
  previousTokens,
  imageSourceCache,
  logoCandidates = new Map(),
  cloudflare,
}: {
  tokens: Token[];
  previousTokens: Token[];
  imageSourceCache: ImageSourceCache;
  logoCandidates?: Map<string, string[]>;
  cloudflare: CloudflareImages;
}): Promise<ImageSourceCache> {
  const previousByKey = new Map(
    previousTokens.map((token) => [
      tokenKey(token.chain_id, token.token_address),
      token,
    ]),
  );
  const pendingBySource = new Map<string, Promise<string>>();
  const stats = {
    alreadyHosted: 0,
    cached: 0,
    resolved: 0,
    retained: 0,
    omitted: 0,
  };
  let nextIndex = 0;

  async function hostOne(token: Token): Promise<void> {
    const key = tokenKey(token.chain_id, token.token_address);
    const candidates = [
      ...(token.logo_url ? [token.logo_url] : []),
      ...(logoCandidates.get(key) ?? []),
    ].filter((url, index, urls) => urls.indexOf(url) === index);
    if (candidates.length === 0) {
      const previousLogo = previousByKey.get(key)?.logo_url;
      if (previousLogo && cloudflare.isHostedByUs(previousLogo)) {
        token.logo_url = cloudflare.normalizeHostedUrl(previousLogo);
        stats.retained++;
      }
      return;
    }

    let lastError: unknown;
    for (const candidateUrl of candidates) {
      if (cloudflare.isHostedByUs(candidateUrl)) {
        token.logo_url = cloudflare.normalizeHostedUrl(candidateUrl);
        stats.alreadyHosted++;
        return;
      }

      const cached = imageSourceCache[candidateUrl];
      if (cached && cloudflare.isHostedByUs(cached)) {
        const hosted = cloudflare.normalizeHostedUrl(cached);
        imageSourceCache[candidates[0]!] = hosted;
        token.logo_url = hosted;
        stats.cached++;
        return;
      }

      try {
        let pending = pendingBySource.get(candidateUrl);
        if (!pending) {
          pending = cloudflare.host(candidateUrl);
          pendingBySource.set(candidateUrl, pending);
        }
        const hosted = await pending;
        imageSourceCache[candidateUrl] = hosted;
        imageSourceCache[candidates[0]!] = hosted;
        token.logo_url = hosted;
        stats.resolved++;
        return;
      } catch (error) {
        if (error instanceof FatalCloudflareImagesError) throw error;
        lastError = error;
      }
    }

    const previousLogo = previousByKey.get(key)?.logo_url;
    if (previousLogo && cloudflare.isHostedByUs(previousLogo)) {
      const normalizedPreviousLogo =
        cloudflare.normalizeHostedUrl(previousLogo);
      console.warn(
        `Could not refresh any of ${candidates.length} logo source(s); retaining ${normalizedPreviousLogo}: ${errorMessage(lastError)}`,
      );
      token.logo_url = normalizedPreviousLogo;
      stats.retained++;
      return;
    }

    console.warn(
      `Could not host any of ${candidates.length} logo source(s) for ${token.chain_id}:${token.token_address}; omitting it: ${errorMessage(lastError)}`,
    );
    token.logo_url = null;
    stats.omitted++;
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

  console.log(
    `Token logos: ${stats.alreadyHosted} already hosted, ${stats.cached} cached, ${stats.resolved} resolved, ${stats.retained} retained, ${stats.omitted} omitted`,
  );
  return Object.fromEntries(
    Object.entries(imageSourceCache).sort(([a], [b]) => a.localeCompare(b)),
  );
}
