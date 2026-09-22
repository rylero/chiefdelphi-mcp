import { isFullyFetched, replaceTopicPosts, upsertTopic } from "./db.js";
import { fetchText } from "./http.js";
import { parseRss, parseTopicId, topicRssUrl, topicUrl, type FeedItem } from "./rss.js";

export async function ingestFeedItems(items: FeedItem[], fullFetched: boolean): Promise<number> {
  let posts = 0;
  const byTopic = new Map<number, FeedItem[]>();
  for (const item of items) {
    const topicId = item.topicId ?? parseTopicId(item.url);
    if (!topicId) continue;
    const list = byTopic.get(topicId) ?? [];
    list.push(item);
    byTopic.set(topicId, list);
  }

  for (const [topicId, topicItems] of byTopic) {
    if (!fullFetched && isFullyFetched(topicId)) continue;
    const title = topicItems[0]?.title ?? `Topic ${topicId}`;
    const category = topicItems.find((i) => i.category)?.category ?? "";
    const url = topicItems[0]?.url ? topicItems[0].url.replace(/\/\d+$/, "") : topicUrl(topicId);
    posts += replaceTopicPosts(
      topicId,
      topicItems.map((item) => ({
        postNumber: item.postNumber ?? 1,
        author: item.author,
        published: item.published,
        url: item.url || `${url}/1`,
        markdown: item.markdown,
      })),
      { title, url, category, fullFetched },
    );
  }
  return posts;
}

export async function ingestTopic(topicId: number, force = false): Promise<{ title: string; posts: number } | null> {
  if (!force && isFullyFetched(topicId)) return null;
  const xml = await fetchText(topicRssUrl(topicId), { ttlMs: 30 * 60 * 1000 });
  const feed = parseRss(xml);
  if (feed.items.length === 0) {
    upsertTopic({ id: topicId, title: feed.title, url: feed.url || topicUrl(topicId), category: "" });
    return { title: feed.title || `Topic ${topicId}`, posts: 0 };
  }
  const posts = await ingestFeedItems(feed.items, true);
  return { title: feed.title || feed.items[0]?.title || `Topic ${topicId}`, posts };
}

export async function ingestTopics(
  topicIds: number[],
  maxTopics: number,
): Promise<{ fetched: number; posts: number; titles: string[] }> {
  const unique = [...new Set(topicIds)].filter((id) => id > 0);
  let fetched = 0;
  let posts = 0;
  const titles: string[] = [];
  for (const id of unique) {
    if (fetched >= maxTopics) break;
    if (isFullyFetched(id)) continue;
    const result = await ingestTopic(id);
    if (!result) continue;
    fetched += 1;
    posts += result.posts;
    titles.push(result.title);
  }
  return { fetched, posts, titles };
}
