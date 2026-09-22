# Chief Delphi MCP

Read-only [Model Context Protocol](https://modelcontextprotocol.io) server that treats [Chief Delphi](https://www.chiefdelphi.com) as a **local knowledge base** for FRC mechanical and design work.

Ask things like “how have teams intaked algae” and it should return **quoted comments**, not just thread titles.

Chief Delphi blocks the Discourse JSON API (Cloudflare). This server stays on allowed RSS feeds, downloads matching threads, and indexes every comment in a local SQLite FTS database.

It does not post, scrape logged-in pages, or call `/search.json`.

## Tools

| Tool | What it does |
| --- | --- |
| `search_knowledge` | **Main tool.** Full-text search inside posts/comments. Fetches related threads on demand, including **Open Alliance** build blogs (details live in comments). Optional `game_piece` (algae, coral, note, cone, …). |
| `ingest_knowledge` | Preload full threads into the index so later searches are deeper. |
| `index_status` | How many topics/comments are indexed. |
| `get_topic` | Read a whole thread (and add it to the index). |
| `search_topics` | Thread-title search of recent RSS. Weaker than `search_knowledge`. |
| `list_latest` | Recent topics from RSS. |
| `list_categories` | Category slugs. |

Prompt: `research_frc_design` — search comments, open 1–3 threads, answer with citations.

Typical flow for an intake:

1. `search_knowledge` query `algae ground intake compliant wheels`, `game_piece: algae`
2. If results are thin, `ingest_knowledge` with the same query, then search again
3. `get_topic` on the best topic IDs for surrounding context

The index lives in `data/chiefdelphi.sqlite` and grows as you research. Discovery uses **Chief Delphi tag RSS**, **Open Alliance** category RSS, and **public sitemaps** (topic slugs). Once a thread is fetched, every comment is searchable.

A project skill at `.cursor/skills/chiefdelphi/SKILL.md` tells agents how to rewrite queries and treat Open Alliance threads as a primary source. Copy that folder to `~/.cursor/skills/chiefdelphi` if you want the same workflow in other workspaces.

## Run locally

Requires Node 20+ (22+ recommended for `node:sqlite`).

```bash
npm start
```

```bash
npm run smoke
```

Used by [RobotLogBot](https://github.com/rylero/RobotLogBot) as a stdio MCP server.

## Add it to Cursor

```json
{
  "mcpServers": {
    "chiefdelphi": {
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "cwd": "/path/to/chiefdelphi-mcp"
    }
  }
}
```

Restart the Chief Delphi MCP in Cursor settings after changing this.

Inspector:

```bash
npx @modelcontextprotocol/inspector npx tsx src/index.ts
```

## Be polite

Requests to Chief Delphi are rate-limited and cached. Don’t wrap this in a tight crawl loop. Quote people; don’t paste entire mega-threads into other public places without context.
