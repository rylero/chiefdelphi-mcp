import { parse } from "node-html-parser";
import { fetchText } from "./http.js";
import { parseTopicId } from "./rss.js";

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
  topicId: number | null;
}

export async function searchChiefDelphi(query: string, limit: number): Promise<SearchHit[]> {
  const q = `site:www.chiefdelphi.com ${query}`;
  const errors: string[] = [];

  for (const attempt of [searchDuckDuckGoHtml, searchDuckDuckGoLite]) {
    try {
      const hits = await attempt(q);
      const filtered = dedupe(
        hits.filter((hit) => hit.url.includes("chiefdelphi.com/t/")),
      );
      if (filtered.length > 0) return filtered.slice(0, limit);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(
    `Web search for Chief Delphi failed (${errors.join("; ") || "no results"}). ` +
      "The forum JSON search API is blocked; this server uses public web search plus RSS.",
  );
}

async function searchDuckDuckGoHtml(q: string): Promise<SearchHit[]> {
  const body = await fetchText("https://html.duckduckgo.com/html/", {
    method: "POST",
    ttlMs: 5 * 60 * 1000,
    throttleChiefDelphi: false,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "text/html",
    },
    body: `q=${encodeURIComponent(q)}&b=`,
  });
  return parseDuckDuckGoHtml(body);
}

async function searchDuckDuckGoLite(q: string): Promise<SearchHit[]> {
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`;
  const body = await fetchText(url, {
    ttlMs: 5 * 60 * 1000,
    throttleChiefDelphi: false,
    headers: { Accept: "text/html" },
  });
  return parseDuckDuckGoLite(body);
}

export function parseDuckDuckGoHtml(html: string): SearchHit[] {
  const root = parse(html);
  const hits: SearchHit[] = [];
  for (const result of root.querySelectorAll(".result, .web-result, .links_main")) {
    const anchor = result.querySelector("a.result__a, a.result-link, a");
    if (!anchor) continue;
    const url = unwrapDuckDuckGoUrl(anchor.getAttribute("href") ?? "");
    if (!url) continue;
    const snippet =
      result.querySelector(".result__snippet, .result-snippet, td.result-snippet")?.text.trim() ??
      "";
    hits.push({
      title: collapse(anchor.text),
      url,
      snippet: collapse(snippet),
      topicId: parseTopicId(url),
    });
  }
  return hits;
}

export function parseDuckDuckGoLite(html: string): SearchHit[] {
  const root = parse(html);
  const hits: SearchHit[] = [];
  for (const anchor of root.querySelectorAll("a.result-link, a")) {
    const url = unwrapDuckDuckGoUrl(anchor.getAttribute("href") ?? "");
    if (!url.includes("chiefdelphi.com")) continue;
    hits.push({
      title: collapse(anchor.text),
      url,
      snippet: "",
      topicId: parseTopicId(url),
    });
  }
  return hits;
}

export function unwrapDuckDuckGoUrl(href: string): string {
  if (!href) return "";
  try {
    const parsed = new URL(href, "https://duckduckgo.com");
    const uddg = parsed.searchParams.get("uddg");
    if (uddg) return uddg;
    if (parsed.hostname.includes("chiefdelphi.com")) return parsed.toString();
    return href.startsWith("http") ? href : "";
  } catch {
    return href.startsWith("http") ? href : "";
  }
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function dedupe(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const hit of hits) {
    const key = String(hit.topicId ?? hit.url.split("?")[0]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}
