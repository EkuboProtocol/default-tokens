type FetchJsonConfig = {
  fetch?: typeof globalThis.fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  maxRetries?: number;
  timeoutMs?: number;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function retryDelay(response: Response | undefined, attempt: number): number {
  const retryAfter = response?.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.ceil(seconds * 1_000);
    }
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return Math.min(30_000, 1_000 * 2 ** attempt);
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export async function fetchJson<T>(
  name: string,
  url: string,
  config: FetchJsonConfig = {},
): Promise<T> {
  const fetchImplementation = config.fetch ?? globalThis.fetch;
  const sleep =
    config.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const maxRetries = config.maxRetries ?? 3;
  const timeoutMs = config.timeoutMs ?? 60_000;

  for (let attempt = 0; ; attempt++) {
    let response: Response | undefined;
    let failure: Error;
    try {
      response = await fetchImplementation(url, {
        headers: {
          "User-Agent": "EkuboProtocol/default-tokens",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        failure = new Error(
          `Failed to download ${name} from ${url}: ${response.status} ${response.statusText}`,
        );
        if (!isRetryableStatus(response.status)) throw failure;
      } else {
        try {
          return (await response.json()) as T;
        } catch (error) {
          failure = new Error(
            `Failed to parse ${name} from ${url}: ${errorMessage(error)}`,
            { cause: error },
          );
        }
      }
    } catch (error) {
      failure =
        error instanceof Error
          ? error
          : new Error(`Failed to download ${name}: ${String(error)}`);
      if (
        response !== undefined &&
        !isRetryableStatus(response.status)
      ) {
        throw failure;
      }
    }

    if (attempt >= maxRetries) throw failure;
    const delay = retryDelay(response, attempt);
    console.warn(
      `${failure.message}; retrying in ${Math.ceil(delay / 1_000)}s`,
    );
    await sleep(delay);
  }
}
