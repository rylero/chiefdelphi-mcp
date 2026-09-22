import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { extractSnippet, scoreText, type ParsedQuery } from "./query.js";

export interface IndexedPost {
  topicId: number;
  postNumber: number;
  title: string;
  category: string;
  author: string;
  published: string;
  url: string;
  markdown: string;
  snippet: string;
  rank: number;
}

export interface IndexStats {
  topics: number;
  posts: number;
  fullTopics: number;
  dbPath: string;
}

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
export const dataDir = join(rootDir, "data");
export const dbPath = join(dataDir, "chiefdelphi.sqlite");

let db: DatabaseSync | undefined;
let ftsAvailable = true;

export function getDb(): DatabaseSync {
  if (db) return db;
  mkdirSync(dataDir, { recursive: true });
  db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS topics (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      full_fetched INTEGER NOT NULL DEFAULT 0,
      post_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id INTEGER NOT NULL,
      post_number INTEGER NOT NULL,
      author TEXT NOT NULL DEFAULT '',
      published TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      markdown TEXT NOT NULL DEFAULT '',
      UNIQUE(topic_id, post_number),
      FOREIGN KEY(topic_id) REFERENCES topics(id)
    );
    CREATE INDEX IF NOT EXISTS posts_topic ON posts(topic_id);
  `);
  ftsAvailable = ensureFts(db);
  return db;
}

export function indexStats(): IndexStats {
  const database = getDb();
  const topics = numberOf(database.prepare("SELECT COUNT(*) AS n FROM topics").get());
  const posts = numberOf(database.prepare("SELECT COUNT(*) AS n FROM posts").get());
  const fullTopics = numberOf(
    database.prepare("SELECT COUNT(*) AS n FROM topics WHERE full_fetched = 1").get(),
  );
  return { topics, posts, fullTopics, dbPath };
}

export function isFullyFetched(topicId: number): boolean {
  const row = getDb().prepare("SELECT full_fetched AS n FROM topics WHERE id = ?").get(topicId) as
    | { n: number }
    | undefined;
  return Boolean(row?.n);
}

export function upsertTopic(topic: {
  id: number;
  title: string;
  url: string;
  category: string;
  fullFetched?: boolean;
  postCount?: number;
}): void {
  const database = getDb();
  database
    .prepare(
      `INSERT INTO topics (id, title, url, category, full_fetched, post_count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         title = CASE WHEN excluded.title != '' THEN excluded.title ELSE topics.title END,
         url = CASE WHEN excluded.url != '' THEN excluded.url ELSE topics.url END,
         category = CASE WHEN excluded.category != '' THEN excluded.category ELSE topics.category END,
         full_fetched = MAX(topics.full_fetched, excluded.full_fetched),
         post_count = CASE WHEN excluded.post_count > 0 THEN excluded.post_count ELSE topics.post_count END,
         updated_at = datetime('now')`,
    )
    .run(
      topic.id,
      topic.title,
      topic.url,
      topic.category,
      topic.fullFetched ? 1 : 0,
      topic.postCount ?? 0,
    );
}

export function replaceTopicPosts(
  topicId: number,
  posts: Array<{
    postNumber: number;
    author: string;
    published: string;
    url: string;
    markdown: string;
  }>,
  meta: { title: string; url: string; category: string; fullFetched: boolean },
): number {
  const database = getDb();
  database.exec("BEGIN");
  try {
    upsertTopic({
      id: topicId,
      title: meta.title,
      url: meta.url,
      category: meta.category,
      fullFetched: meta.fullFetched,
      postCount: posts.length,
    });

    const existing = database.prepare("SELECT id, post_number FROM posts WHERE topic_id = ?").all(topicId) as unknown as Array<{
      id: number;
      post_number: number;
    }>;
    const keep = new Set(posts.map((p) => p.postNumber));
    const insert = database.prepare(
      `INSERT INTO posts (topic_id, post_number, author, published, url, markdown)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(topic_id, post_number) DO UPDATE SET
         author = excluded.author,
         published = excluded.published,
         url = excluded.url,
         markdown = excluded.markdown`,
    );
    const lookupId = database.prepare("SELECT id FROM posts WHERE topic_id = ? AND post_number = ?");

    for (const row of existing) {
      if (!keep.has(row.post_number)) {
        database.prepare("DELETE FROM posts WHERE id = ?").run(row.id);
        deleteFts(row.id);
      }
    }

    for (const post of posts) {
      insert.run(topicId, post.postNumber, post.author, post.published, post.url, post.markdown);
      const result = lookupId.get(topicId, post.postNumber) as unknown as { id: number } | undefined;
      if (!result) continue;
      upsertFts(result.id, {
        title: meta.title,
        author: post.author,
        category: meta.category,
        markdown: post.markdown,
      });
    }

    database
      .prepare("UPDATE topics SET post_count = ?, full_fetched = ?, updated_at = datetime('now') WHERE id = ?")
      .run(posts.length, meta.fullFetched ? 1 : 0, topicId);
    database.exec("COMMIT");
    return posts.length;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function searchIndexedPosts(parsed: ParsedQuery, limit: number): IndexedPost[] {
  const queries = [parsed.ftsRequired, parsed.ftsExpanded, parsed.ftsBroad].filter((q) => q.length > 0);
  const seen = new Set<string>();
  const hits: IndexedPost[] = [];
  for (const match of queries) {
    for (const hit of ftsSearch(match, parsed.tokens, limit * 3)) {
      const key = `${hit.topicId}:${hit.postNumber}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(hit);
    }
  }
  if (hits.length === 0) {
    return likeSearch(parsed.tokens, limit);
  }
  const required = parsed.requiredTokens.length > 0 ? parsed.requiredTokens : parsed.tokens;
  const ranked = hits
    .map((hit) => {
      const text = `${hit.title}\n${hit.markdown}`;
      const requiredHits = required.filter((token) => text.toLowerCase().includes(token.toLowerCase())).length;
      const detailHits = scoreText(text, parsed.tokens);
      return { hit, requiredHits, detailHits };
    })
    .filter((row) => row.requiredHits > 0 || parsed.requiredTokens.length === 0)
    .sort((a, b) => b.requiredHits - a.requiredHits || b.detailHits - a.detailHits || a.hit.rank - b.hit.rank);
  return ranked.slice(0, limit).map((row) => row.hit);
}

function ftsSearch(match: string, tokens: string[], limit: number): IndexedPost[] {
  if (!ftsAvailable || !match) return [];
  const database = getDb();
  try {
    const rows = database
      .prepare(
        `SELECT
           p.topic_id AS topicId,
           p.post_number AS postNumber,
           t.title AS title,
           t.category AS category,
           p.author AS author,
           p.published AS published,
           p.url AS url,
           p.markdown AS markdown,
           bm25(posts_fts) AS rank
         FROM posts_fts
         JOIN posts p ON p.id = posts_fts.rowid
         JOIN topics t ON t.id = p.topic_id
         WHERE posts_fts MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(match, limit) as unknown as Array<IndexedPost & { rank: number; markdown: string }>;
    return rows.map((row) => ({
      ...row,
      snippet: extractSnippet(row.markdown, tokens),
    }));
  } catch {
    return [];
  }
}

function likeSearch(tokens: string[], limit: number): IndexedPost[] {
  if (tokens.length === 0) return [];
  const database = getDb();
  const where = tokens.map(() => "(p.markdown LIKE ? OR t.title LIKE ? OR p.author LIKE ?)").join(" AND ");
  const params: Array<string | number> = [];
  for (const token of tokens) {
    const like = `%${token}%`;
    params.push(like, like, like);
  }
  params.push(limit);
  const rows = database
    .prepare(
      `SELECT
         p.topic_id AS topicId,
         p.post_number AS postNumber,
         t.title AS title,
         t.category AS category,
         p.author AS author,
         p.published AS published,
         p.url AS url,
         p.markdown AS markdown,
         0 AS rank
       FROM posts p
       JOIN topics t ON t.id = p.topic_id
       WHERE ${where}
       LIMIT ?`,
    )
    .all(...params) as unknown as Array<IndexedPost & { markdown: string }>;
  return rows.map((row) => ({
    ...row,
    snippet: extractSnippet(row.markdown, tokens),
  }));
}

function ensureFts(database: DatabaseSync): boolean {
  try {
    database.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
        title,
        author,
        category,
        markdown,
        tokenize = 'unicode61 remove_diacritics 2'
      );
    `);
    return true;
  } catch {
    return false;
  }
}

function upsertFts(
  rowid: number,
  fields: { title: string; author: string; category: string; markdown: string },
): void {
  if (!ftsAvailable) return;
  const database = getDb();
  deleteFts(rowid);
  database
    .prepare("INSERT INTO posts_fts(rowid, title, author, category, markdown) VALUES (?, ?, ?, ?, ?)")
    .run(rowid, fields.title, fields.author, fields.category, fields.markdown);
}

function deleteFts(rowid: number): void {
  if (!ftsAvailable) return;
  try {
    getDb().prepare("DELETE FROM posts_fts WHERE rowid = ?").run(rowid);
  } catch {
    // FTS row may not exist yet.
  }
}

function numberOf(row: unknown): number {
  if (row && typeof row === "object" && "n" in row) return Number((row as { n: number }).n) || 0;
  return 0;
}
