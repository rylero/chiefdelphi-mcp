import { CATEGORIES, categoryRssUrl, findCategory, isDesignBias, type Category } from "./categories.js";
import { excerpt } from "./html.js";
import { fetchText } from "./http.js";
import { ingestFeedItems } from "./ingest.js";
import { scoreText, tokenizeQuery } from "./query.js";
import {
  formatTopicList,
  parseRss,
  parseTopicId,
  topicRssUrl,
  topicUrl,
  type FeedItem,
} from "./rss.js";
import { searchChiefDelphi, type SearchHit } from "./search.js";
import { tagsForTokens, tagRssUrl } from "./tags.js";

const LATEST_RSS = "https://www.chiefdelphi.com/latest.rss";

export async function searchTopics(args: {
  query: string;
  category?: string;
  limit?: number;
}): Promise<string> {
  const limit = args.limit ?? 8;
  const designBias = isDesignBias(args.category);
  const category = findCategory(args.category);
  const webQuery = buildWebQuery(args.query, category, args.category);

  let webError = "";
  try {
    const hits = await searchChiefDelphi(webQuery, limit);
    if (hits.length > 0) return formatSearchHits(args.query, hits, "web search");
  } catch (error) {
    webError = error instanceof Error ? error.message : String(error);
  }

  const fallback = await discoverRecentTopics({
    query: args.query,
    category: args.category,
    limit,
    designBias,
  });
  if (fallback.items.length === 0) {
    return [
      `No Chief Delphi results for "${args.query}".`,
      webError && `Web search was unavailable: ${webError}`,
      "Try a shorter query, a category like cad, or list_latest then get_topic.",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    `Search: ${args.query}`,
    `Source: recent Chief Delphi RSS${category ? ` (${category.name})` : designBias ? " (design-related categories)" : ""}. Web search engines blocked this client, so results are from currently active threads, not the full archive.`,
    `Next step: call get_topic with a topic ID or URL to read the posts and comments.`,
    "",
    formatTopicList(fallback.items, limit),
  ].join("\n");
}

export async function getTopic(args: {
  topic: string;
  offset?: number;
  limit?: number;
}): Promise<string> {
  const topicId = parseTopicId(args.topic);
  if (!topicId) {
    return `Could not parse a Chief Delphi topic ID from "${args.topic}". Pass a numeric ID or a URL like https://www.chiefdelphi.com/t/slug/12345.`;
  }

  const xml = await fetchText(topicRssUrl(topicId), { ttlMs: 15 * 60 * 1000 });
  const feed = parseRss(xml);
  const posts = [...feed.items].sort((a, b) => (a.postNumber ?? 0) - (b.postNumber ?? 0));
  const offset = args.offset ?? 0;
  const limit = args.limit ?? 40;
  const slice = posts.slice(offset, offset + limit);

  if (posts.length === 0) {
    return `Topic ${topicId} RSS had no posts. Try the thread in a browser: ${topicUrl(topicId)}`;
  }

  try {
    await ingestFeedItems(feed.items, true);
  } catch {
    // Reading the thread should still succeed if indexing fails.
  }

  const header = [
    `# ${feed.title || posts[0]?.title || `Topic ${topicId}`}`,
    `URL: ${feed.url || topicUrl(topicId)}`,
    `Category: ${posts.find((p) => p.category)?.category || "unknown"}`,
    `Posts in feed: ${posts.length}. Showing ${offset + 1}–${offset + slice.length}.`,
    offset + slice.length < posts.length
      ? `More remain — call get_topic again with offset=${offset + slice.length}.`
      : "",
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");

  const body = slice
    .map((post) => {
      const n = post.postNumber ?? "?";
      const meta = [post.author && `@${post.author}`, post.published].filter(Boolean).join(" · ");
      return `## Post ${n} — ${meta}\n${post.markdown.trim() || "(empty)"}`;
    })
    .join("\n\n");

  return `${header}\n${body}`;
}

export async function listLatest(args: { category?: string; limit?: number }): Promise<string> {
  const limit = args.limit ?? 15;
  const category = findCategory(args.category);
  const url = category ? categoryRssUrl(category) : LATEST_RSS;
  const xml = await fetchText(url, { ttlMs: 3 * 60 * 1000 });
  const feed = parseRss(xml);
  const label = category ? category.name : "Latest topics";
  return `# ${label}\nSource: ${url}\n\n${formatTopicList(feed.items, limit)}`;
}

export function listCategories(): string {
  const rows = CATEGORIES.map((c) => {
    const flag = c.designRelevant ? "yes" : "";
    return `| ${c.slug} | ${c.name} | ${flag} |`;
  });
  return [
    "Chief Delphi categories this server can filter on.",
    "Use `cad`, `manufacturing`, `technical-discussion`, or `papers` for mechanical/design research.",
    "For search_topics, `design` searches several mech/CAD feeds instead of one category. Alias: `whitepaper` → papers.",
    "",
    "| slug | name | design-relevant |",
    "| --- | --- | --- |",
    ...rows,
  ].join("\n");
}

export async function discoverRecentTopics(args: {
  query: string;
  category?: string;
  limit?: number;
  designBias?: boolean;
}): Promise<{ items: FeedItem[] }> {
  const limit = args.limit ?? 12;
  const category = findCategory(args.category);
  const designBias = args.designBias ?? isDesignBias(args.category);
  const terms = tokenizeQuery(args.query);
  const slugs = category
    ? [category.slug]
    : designBias
      ? ["technical", "technical-discussion", "cad", "manufacturing", "kit-hardware", "papers"]
      : ["technical", "cad", "technical-discussion", "kit-hardware", "papers"];

  const feeds: Array<{ label: string; url: string; tagged?: boolean }> = category
    ? [{ label: category.slug, url: categoryRssUrl(category) }]
    : [
        { label: "latest", url: LATEST_RSS },
        ...slugs
          .map((slug) => CATEGORIES.find((c) => c.slug === slug))
          .filter((c): c is Category => Boolean(c))
          .map((c) => ({ label: c.slug, url: categoryRssUrl(c) })),
      ];
  for (const tag of tagsForTokens(terms)) {
    feeds.push({ label: `tag:${tag}`, url: tagRssUrl(tag), tagged: true });
  }

  const scored: Array<{ item: FeedItem; score: number }> = [];
  const seen = new Set<number>();
  for (const feed of feeds) {
    try {
      const xml = await fetchText(feed.url, { ttlMs: 5 * 60 * 1000 });
      for (const item of parseRss(xml).items) {
        const id = item.topicId ?? 0;
        if (id && seen.has(id)) continue;
        const score =
          scoreText(item.title, terms) * 2 +
          scoreText(`${item.title}\n${item.markdown}`, terms) +
          (feed.tagged ? 4 : 0);
        if (terms.length > 0 && score <= 0) continue;
        if (id) seen.add(id);
        scored.push({ item, score });
      }
    } catch {
      // Skip a blocked or empty feed and keep looking.
    }
  }
  scored.sort((a, b) => b.score - a.score || Date.parse(b.item.published) - Date.parse(a.item.published));
  return { items: scored.slice(0, limit).map((row) => row.item) };
}

function buildWebQuery(query: string, category: Category | undefined, rawCategory?: string): string {
  if (category) return `${query} site:www.chiefdelphi.com/c/${category.path}`;
  const key = rawCategory?.trim().toLowerCase();
  if (key === "design" || key === "mechanical") {
    return `${query} (CAD OR manufacturing OR elevator OR gearbox OR "technical discussion" OR pneumatics)`;
  }
  return query;
}

function formatSearchHits(query: string, hits: SearchHit[], source: string): string {
  if (hits.length === 0) return `No Chief Delphi threads found for "${query}".`;
  const blocks = hits.map((hit, index) => {
    const id = hit.topicId ? ` (topic ${hit.topicId})` : "";
    return [
      `### ${index + 1}. ${hit.title}${id}`,
      hit.url,
      hit.snippet ? excerpt(hit.snippet, 360) : "",
    ]
      .filter(Boolean)
      .join("\n");
  });
  return [
    `Search: ${query}`,
    `Source: ${source} of site:www.chiefdelphi.com`,
    `Next step: call get_topic with a topic ID or URL to read the posts and comments.`,
    "",
    ...blocks,
  ].join("\n");
}
