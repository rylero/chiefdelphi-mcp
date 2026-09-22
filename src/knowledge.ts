import { findCategory, isDesignBias } from "./categories.js";
import { discoverRecentTopics, latestCategoryTopics } from "./chiefdelphi.js";
import { indexStats, searchIndexedPosts, type IndexedPost } from "./db.js";
import { ingestFeedItems, ingestTopics } from "./ingest.js";
import { looksHistorical, parseQuery, recencyScore } from "./query.js";
import { type FeedItem } from "./rss.js";
import { searchChiefDelphi } from "./search.js";
import { ensureTopicSlugs, searchSlugsContaining, searchTopicSlugs, slugCount } from "./sitemap.js";
import { WEAK_DISCOVERY_TOKENS } from "./synonyms.js";

export async function searchKnowledge(args: {
  query: string;
  game_piece?: string;
  category?: string;
  limit?: number;
  max_topics?: number;
  include_open_alliance?: boolean;
}): Promise<string> {
  const limit = args.limit ?? 10;
  const maxTopics = args.max_topics ?? 12;
  const includeOA = args.include_open_alliance !== false && args.category?.trim().toLowerCase() !== "ftc-open-alliance";
  const parsed = parseQuery(args.query, args.game_piece);
  const designBias = isDesignBias(args.category) || !findCategory(args.category);

  const discovered = await discoverRecentTopics({
    query: discoveryQuery(args.query, args.game_piece),
    category: args.category,
    limit: Math.max(15, maxTopics),
    designBias,
  });
  const extraBags = [];
  for (const token of parsed.requiredTokens.slice(0, 3)) {
    if (WEAK_DISCOVERY_TOKENS.has(token)) continue;
    extraBags.push(
      await discoverRecentTopics({
        query: token,
        category: args.category,
        limit: 10,
        designBias,
      }),
    );
  }

  const oaItems = includeOA
    ? [
        ...(await latestCategoryTopics("open-alliance", 20)),
        ...(parsed.tokens.includes("ftc") ? await latestCategoryTopics("ftc-open-alliance", 10) : []),
      ]
    : [];
  const oaDiscovered = includeOA
    ? await discoverRecentTopics({
        query: discoveryQuery(args.query, args.game_piece),
        category: "open-alliance",
        limit: 12,
        designBias: false,
      })
    : { items: [] };

  const discoveredItems = dedupeItems([
    discovered.items,
    ...extraBags.map((bag) => bag.items),
    oaItems,
    oaDiscovered.items,
  ]);
  await ingestFeedItems(discoveredItems, false);

  const slugCatalog = await ensureTopicSlugs("recent");
  const slugHits = searchTopicSlugs(parsed.groups, 20);
  const oaSlugHits = includeOA ? searchSlugsContaining(["open alliance", "openalliance"], 12) : [];
  const slugScores = new Map(slugHits.map((hit) => [hit.id, hit.score]));
  for (const hit of oaSlugHits) {
    slugScores.set(hit.id, (slugScores.get(hit.id) ?? 0) + 3);
  }

  const webIds = await discoverWebTopicIds(discoveryQuery(args.query, args.game_piece));
  const rssIds = discoveredItems.map((item) => item.topicId).filter((id): id is number => Boolean(id));
  const rankedIds = rankTopicIds(
    [...rssIds, ...webIds, ...slugHits.map((hit) => hit.id), ...oaSlugHits.map((hit) => hit.id)],
    parsed.requiredTokens.length ? parsed.requiredTokens : parsed.tokens,
    discoveredItems,
    slugScores,
    new Set(oaItems.map((item) => item.topicId).filter((id): id is number => Boolean(id))),
    looksHistorical(parsed.tokens),
  );

  const oaIds = [
    ...new Set([...oaItems, ...oaDiscovered.items].map((item) => item.topicId).filter((id): id is number => Boolean(id))),
  ];
  const mainIds = rankedIds.filter((id) => !oaIds.includes(id));
  const ingest = await ingestTopics([...oaIds, ...mainIds], maxTopics);

  const hits = searchIndexedPosts(parsed, limit);
  const stats = indexStats();
  const hay = hits.map((hit) => `${hit.title}\n${hit.markdown}`.toLowerCase()).join("\n");
  const missingRequired = parsed.requiredTokens.filter((token) => !hay.includes(token.toLowerCase()));
  const oaHitCount = hits.filter((hit) => isOpenAlliance(hit)).length;

  if (hits.length === 0) {
    return [
      `No indexed posts matched "${args.query}".`,
      `Index: ${stats.posts} posts in ${stats.topics} topics (${stats.fullTopics} full threads).`,
      ingest.fetched
        ? `Fetched ${ingest.fetched} threads this call (${ingest.posts} posts).`
        : "No new threads were fetched — try ingest_knowledge with a broader query, or name a game piece.",
      parsed.tokens.length ? `Tokens: ${parsed.tokens.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    `# Knowledge search: ${args.query}`,
    args.game_piece ? `Game piece: ${args.game_piece}` : "",
    `Matched ${hits.length} comments/posts. Index now has ${stats.posts} posts across ${stats.topics} topics (${stats.fullTopics} full threads).`,
    ingest.fetched
      ? `Fetched ${ingest.fetched} full threads this call so comments could be searched: ${ingest.titles.slice(0, 6).join("; ")}${ingest.titles.length > 6 ? "…" : ""}`
      : "Used threads already in the local index.",
    slugCatalog.slugs
      ? `Discovery used Chief Delphi tag RSS, ${includeOA ? "Open Alliance feeds, " : ""}and ${slugCatalog.slugs} sitemap slugs.`
      : "",
    includeOA
      ? oaHitCount
        ? `${oaHitCount} of these hits are from Open Alliance / build-thread posts.`
        : "Open Alliance recent posts were indexed; none of the top hits were from those threads."
      : "",
    missingRequired.length
      ? `No downloaded comments mentioned: ${missingRequired.join(", ")}. Showing the closest matches in the current index. If you have a thread URL, get_topic will index it.`
      : "",
    `These are quoted details from inside threads, not just titles. Call get_topic on a topic ID to read the surrounding discussion.`,
    "",
    formatHits(hits),
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export async function ingestKnowledge(args: {
  query?: string;
  category?: string;
  max_topics?: number;
}): Promise<string> {
  const maxTopics = args.max_topics ?? 20;
  const query = args.query?.trim() || "intake elevator gearbox swerve cad";
  const slugs = await ensureTopicSlugs("all");
  const discovered = await discoverRecentTopics({
    query,
    category: args.category,
    limit: Math.max(20, maxTopics),
    designBias: isDesignBias(args.category) || !findCategory(args.category),
  });
  const oaItems = await latestCategoryTopics("open-alliance", 15);
  await ingestFeedItems([...discovered.items, ...oaItems], false);
  const ids = [
    ...oaItems.map((item) => item.topicId),
    ...discovered.items.map((item) => item.topicId),
  ].filter((id): id is number => Boolean(id));
  const ingest = await ingestTopics(ids, maxTopics);
  const stats = indexStats();
  return [
    `Ingested ${ingest.fetched} full threads (${ingest.posts} posts) into the local knowledge base.`,
    ingest.titles.length ? `Threads: ${ingest.titles.join("; ")}` : "Those topics were already fully indexed.",
    slugs.fetched
      ? `Sitemap catalog: fetched ${slugs.fetched} URL lists, ${slugs.slugs} topic slugs searchable.`
      : `Sitemap catalog: ${slugs.slugs} topic slugs searchable.`,
    `Database: ${stats.dbPath}`,
  ].join("\n");
}

export function formatIndexStatus(): string {
  const stats = indexStats();
  return [
    "Local Chief Delphi knowledge base (SQLite FTS).",
    `Topics: ${stats.topics}`,
    `Full threads (all comments indexed): ${stats.fullTopics}`,
    `Posts/comments: ${stats.posts}`,
    `Topic slugs from sitemaps: ${slugCount()}`,
    `Database: ${stats.dbPath}`,
    "search_knowledge grows this index as it fetches threads. ingest_knowledge can preload more.",
  ].join("\n");
}

function discoveryQuery(query: string, gamePiece?: string): string {
  return [query, gamePiece].filter(Boolean).join(" ");
}

function dedupeItems(bags: FeedItem[][]): FeedItem[] {
  const seen = new Set<number>();
  const out: FeedItem[] = [];
  for (const bag of bags) {
    for (const item of bag) {
      const id = item.topicId;
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      out.push(item);
    }
  }
  return out;
}

async function discoverWebTopicIds(query: string): Promise<number[]> {
  try {
    const hits = await searchChiefDelphi(query, 8);
    return hits.map((hit) => hit.topicId).filter((id): id is number => Boolean(id));
  } catch {
    return [];
  }
}

function rankTopicIds(
  ids: number[],
  tokens: string[],
  items: Array<{ topicId: number | null; title: string; markdown: string; category?: string }>,
  slugScores = new Map<number, number>(),
  oaIds = new Set<number>(),
  historical = false,
): number[] {
  const textById = new Map<number, string>();
  for (const item of items) {
    if (!item.topicId) continue;
    textById.set(item.topicId, `${item.title}\n${item.markdown}\n${item.category ?? ""}`);
  }
  const unique = [...new Set(ids)];
  return unique.sort(
    (a, b) => scoreId(b, tokens, textById, slugScores, oaIds, historical) - scoreId(a, tokens, textById, slugScores, oaIds, historical),
  );
}

function scoreId(
  id: number,
  tokens: string[],
  textById: Map<number, string>,
  slugScores: Map<number, number>,
  oaIds: Set<number>,
  historical: boolean,
): number {
  const text = (textById.get(id) ?? "").toLowerCase();
  let score = slugScores.get(id) ?? 0;
  for (const token of tokens) {
    if (text.includes(token.toLowerCase())) score += 2;
  }
  if (oaIds.has(id) || /\bopen\s*alliance\b|\boa\b/.test(text)) score += 5;
  if (!historical) score += recencyScore(id);
  return score;
}

function isOpenAlliance(hit: IndexedPost): boolean {
  const hay = `${hit.title}\n${hit.category}`.toLowerCase();
  return hay.includes("open alliance") || hay.includes("openalliance");
}

function formatHits(hits: IndexedPost[]): string {
  const groups = new Map<number, IndexedPost[]>();
  const order: number[] = [];
  for (const hit of hits) {
    if (!groups.has(hit.topicId)) {
      groups.set(hit.topicId, []);
      order.push(hit.topicId);
    }
    groups.get(hit.topicId)!.push(hit);
  }

  return order
    .map((topicId, index) => {
      const posts = groups.get(topicId)!;
      const head = posts[0];
      const lines = [
        `## ${index + 1}. ${head.title} (topic ${topicId})`,
        [head.category, isOpenAlliance(head) ? "Open Alliance" : "", `https://www.chiefdelphi.com/t/-/${topicId}`]
          .filter(Boolean)
          .join(" · "),
      ];
      for (const post of posts) {
        const meta = [`post ${post.postNumber}`, post.author && `@${post.author}`, post.published]
          .filter(Boolean)
          .join(" · ");
        lines.push(`### ${meta}`);
        lines.push(post.url);
        lines.push(post.snippet || post.markdown.replace(/\s+/g, " ").slice(0, 400));
        lines.push("");
      }
      return lines.join("\n");
    })
    .join("\n");
}
