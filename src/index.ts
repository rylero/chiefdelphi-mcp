import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod";
import { getTopic, listCategories, listLatest, searchTopics } from "./chiefdelphi.js";
import { HttpError } from "./http.js";
import { formatIndexStatus, ingestKnowledge, searchKnowledge } from "./knowledge.js";

const VERSION = "0.2.0";

const readOnly = { readOnlyHint: true, openWorldHint: true } as const;

function createServer(): McpServer {
  const server = new McpServer({
    name: "chiefdelphi",
    version: VERSION,
  });

  server.registerTool(
    "search_knowledge",
    {
      title: "Search Chief Delphi knowledge base",
      description:
        "Primary tool for FRC mechanical/design research. Searches inside posts and comments, not just thread titles, using a local full-text index. Fetches relevant threads on demand so details like roller durometer, belt size, or algae-handling tricks can be found and cited. Prefer this over search_topics for questions like designing an intake for a specific game piece.",
      inputSchema: z.object({
        query: z
          .string()
          .min(2)
          .describe(
            'Natural-language or keyword query, e.g. "algae ground intake compliant wheels" or "note underbumper polycord"',
          ),
        game_piece: z
          .string()
          .optional()
          .describe(
            "Optional game piece to expand synonyms: algae, coral, note, cone, cube, cargo, hatch, ball, fuel, boulder, tube, frisbee, ring.",
          ),
        category: z
          .string()
          .optional()
          .describe('Optional category slug, or "design" to stay in CAD/mech/papers feeds.'),
        limit: z.number().int().min(1).max(20).optional().describe("Max matching comments to return, default 10"),
        max_topics: z
          .number()
          .int()
          .min(1)
          .max(25)
          .optional()
          .describe("Max new threads to fully download into the index this call, default 12"),
      }),
      annotations: readOnly,
    },
    async ({ query, game_piece, category, limit, max_topics }) =>
      textResult(searchKnowledge({ query, game_piece, category, limit, max_topics })),
  );

  server.registerTool(
    "search_topics",
    {
      title: "Search Chief Delphi thread titles",
      description:
        "Thread-level search of recent RSS (and web search if available). Use search_knowledge instead when you need details from inside comments. This is useful for a quick list of matching thread titles.",
      inputSchema: z.object({
        query: z
          .string()
          .min(2)
          .describe('Search terms, e.g. "cascade elevator 1x1 tubing" or "MK4i vs MAXSwerve"'),
        category: z
          .string()
          .optional()
          .describe(
            'Optional category slug such as cad, manufacturing, technical-discussion, papers, electrical. Use "design" to bias toward CAD/mech threads.',
          ),
        limit: z.number().int().min(1).max(15).optional().describe("Max results, default 8"),
      }),
      annotations: readOnly,
    },
    async ({ query, category, limit }) => textResult(searchTopics({ query, category, limit })),
  );

  server.registerTool(
    "get_topic",
    {
      title: "Get Chief Delphi topic",
      description:
        "Fetch a Chief Delphi topic and its comments as readable markdown (author, date, body). Also adds the thread to the local knowledge index. Pass a numeric topic ID or a full Chief Delphi URL. Use after search_knowledge when you need the surrounding discussion. Paginate long threads with offset.",
      inputSchema: z.object({
        topic: z.string().describe("Topic ID or URL, e.g. 470903 or https://www.chiefdelphi.com/t/slug/470903"),
        offset: z.number().int().min(0).optional().describe("Skip this many posts from the start of the thread"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(80)
          .optional()
          .describe("Max posts to return, default 40"),
      }),
      annotations: readOnly,
    },
    async ({ topic, offset, limit }) => textResult(getTopic({ topic, offset, limit })),
  );

  server.registerTool(
    "list_latest",
    {
      title: "List latest Chief Delphi topics",
      description:
        "List recently created Chief Delphi topics from the public RSS feed, optionally in one category. Good for current-season discussion, not a substitute for historical search_topics.",
      inputSchema: z.object({
        category: z
          .string()
          .optional()
          .describe("Optional category slug such as cad, technical, papers. Omit for site-wide latest."),
        limit: z.number().int().min(1).max(30).optional().describe("Max topics, default 15"),
      }),
      annotations: readOnly,
    },
    async ({ category, limit }) => textResult(listLatest({ category, limit })),
  );

  server.registerTool(
    "list_categories",
    {
      title: "List Chief Delphi categories",
      description: "List known Chief Delphi categories and slugs you can pass to search_topics or list_latest.",
      inputSchema: z.object({}),
      annotations: readOnly,
    },
    async () => ({ content: [{ type: "text" as const, text: listCategories() }] }),
  );

  server.registerTool(
    "ingest_knowledge",
    {
      title: "Ingest Chief Delphi threads",
      description:
        "Download full threads (all comments) into the local knowledge base so later search_knowledge calls can find details without refetching. Pass a query to choose related threads, or omit to preload recent design/CAD discussion.",
      inputSchema: z.object({
        query: z.string().optional().describe("Optional query used to pick which recent threads to ingest"),
        category: z.string().optional().describe("Optional category slug or design"),
        max_topics: z
          .number()
          .int()
          .min(1)
          .max(40)
          .optional()
          .describe("Max threads to fully download, default 20"),
      }),
      annotations: readOnly,
    },
    async ({ query, category, max_topics }) => textResult(ingestKnowledge({ query, category, max_topics })),
  );

  server.registerTool(
    "index_status",
    {
      title: "Knowledge index status",
      description: "Show how many Chief Delphi topics and comments are in the local full-text knowledge base.",
      inputSchema: z.object({}),
      annotations: readOnly,
    },
    async () => ({ content: [{ type: "text" as const, text: formatIndexStatus() }] }),
  );

  server.registerPrompt(
    "research_frc_design",
    {
      title: "Research FRC design on Chief Delphi",
      description:
        "Look up how FRC teams have approached a mechanical or design problem on Chief Delphi, then answer with citations.",
      argsSchema: z.object({
        question: z.string().describe("The mechanical or design question to research"),
      }),
    },
    ({ question }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Research this FRC mechanical/design question using the Chief Delphi MCP tools.

Question: ${question}

Do this:
1. Call search_knowledge with a focused query. Set game_piece when the question is about handling a specific object (algae, coral, note, cone, cube, cargo, etc.).
2. If the first pass is thin, call ingest_knowledge with the same query to pull more full threads, then search_knowledge again.
3. Call get_topic on 1–3 of the most useful topic IDs when you need surrounding context.
4. Answer from those posts: what teams did, COTS vs custom, years/games if mentioned, and tradeoffs.
5. Cite Chief Delphi URLs, authors, and dates. Quote small details (sizes, durometers, belt types, failure modes) when they appear. If threads disagree, say so.
6. Do not invent team numbers, part numbers, or results that were not in the fetched posts.`,
          },
        },
      ],
    }),
  );

  return server;
}

async function textResult(work: Promise<string>): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  try {
    const text = await work;
    return { content: [{ type: "text", text }] };
  } catch (error) {
    const text =
      error instanceof HttpError
        ? `${error.message}. Chief Delphi blocks the Discourse JSON API; this server only uses public RSS and web search. Slow down and retry, or open the thread in a browser.`
        : error instanceof Error
          ? error.message
          : String(error);
    return { content: [{ type: "text", text }], isError: true };
  }
}

void serveStdio(createServer);
console.error(`chiefdelphi-mcp ${VERSION} running on stdio`);
