const USER_AGENT =
  "chiefdelphi-mcp/0.1 (read-only RSS + public search; FRC research)";

const cache = new Map<string, { expires: number; body: string; status: number }>();
let lastChiefDelphiAt = 0;

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export async function fetchText(
  url: string,
  options: {
    ttlMs?: number;
    headers?: Record<string, string>;
    method?: string;
    body?: string;
    throttleChiefDelphi?: boolean;
  } = {},
): Promise<string> {
  const ttlMs = options.ttlMs ?? 10 * 60 * 1000;
  const method = options.method ?? "GET";
  const cacheKey = `${method}:${url}:${options.body ?? ""}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expires > Date.now()) {
    if (hit.status >= 400) {
      throw new HttpError(`HTTP ${hit.status} for ${url}`, hit.status, url);
    }
    return hit.body;
  }

  if (options.throttleChiefDelphi !== false && url.includes("chiefdelphi.com")) {
    const wait = 400 - (Date.now() - lastChiefDelphiAt);
    if (wait > 0) await sleep(wait);
    lastChiefDelphiAt = Date.now();
  }

  const res = await fetch(url, {
    method,
    body: options.body,
    redirect: "follow",
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/rss+xml, application/xml, text/html, text/plain;q=0.9, */*;q=0.8",
      ...options.headers,
    },
  });
  const body = await res.text();
  cache.set(cacheKey, { expires: Date.now() + ttlMs, body, status: res.status });
  if (!res.ok) {
    throw new HttpError(`HTTP ${res.status} for ${url}`, res.status, url);
  }
  return body;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
