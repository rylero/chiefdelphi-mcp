import { XMLParser } from "fast-xml-parser";
import { excerpt, htmlToMarkdown } from "./html.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  cdataPropName: "#cdata",
  textNodeName: "#text",
  isArray: (name) => name === "item" || name === "category",
});

export interface FeedItem {
  title: string;
  url: string;
  author: string;
  category: string;
  published: string;
  markdown: string;
  topicId: number | null;
  postNumber: number | null;
}

export interface ParsedFeed {
  title: string;
  url: string;
  items: FeedItem[];
}

export function parseRss(xml: string): ParsedFeed {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const rss = asRecord(doc.rss);
  const channel = asRecord(rss?.channel);
  const rawItems = Array.isArray(channel?.item) ? channel.item : [];

  const items = rawItems.map((raw) => {
    const item = asRecord(raw) ?? {};
    const url = xmlText(item.link);
    const html = xmlText(item.description);
    return {
      title: xmlText(item.title),
      url,
      author: xmlText(item.creator),
      category: xmlText(item.category),
      published: xmlText(item.pubDate),
      markdown: htmlToMarkdown(html),
      topicId: parseTopicId(url),
      postNumber: parsePostNumber(url),
    } satisfies FeedItem;
  });

  const category = xmlText(channel?.category);
  return {
    title: xmlText(channel?.title),
    url: xmlText(channel?.link),
    items: items.map((item) => ({ ...item, category: item.category || category })),
  };
}

export function parseTopicId(input: string): number | null {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const match =
    trimmed.match(/\/t\/[^/?#]+\/(\d+)/i) ??
    trimmed.match(/\/t\/-\/(\d+)/i) ??
    trimmed.match(/chiefdelphi\.com-topic-(\d+)/i) ??
    trimmed.match(/chiefdelphi\.com-post-(\d+)/i);
  return match ? Number(match[1]) : null;
}

export function parsePostNumber(url: string): number | null {
  const match = url.match(/\/t\/[^/?#]+\/\d+\/(\d+)/i);
  return match ? Number(match[1]) : null;
}

export function topicRssUrl(topicId: number): string {
  return `https://www.chiefdelphi.com/t/-/${topicId}.rss`;
}

export function topicUrl(topicId: number): string {
  return `https://www.chiefdelphi.com/t/-/${topicId}`;
}

export function formatTopicList(items: FeedItem[], limit: number): string {
  if (items.length === 0) return "No topics found.";
  return items
    .slice(0, limit)
    .map((item, index) => {
      const id = item.topicId ? ` (topic ${item.topicId})` : "";
      const meta = [item.author && `by ${item.author}`, item.published, item.category]
        .filter(Boolean)
        .join(" · ");
      return [
        `### ${index + 1}. ${item.title}${id}`,
        meta,
        item.url,
        excerpt(item.markdown),
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

function xmlText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(xmlText).filter(Boolean).join(", ");
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("#cdata" in obj) return xmlText(obj["#cdata"]);
    if ("#text" in obj) return xmlText(obj["#text"]);
  }
  return "";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
