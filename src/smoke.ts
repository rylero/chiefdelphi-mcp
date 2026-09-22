import { getTopic, listLatest, searchTopics } from "./chiefdelphi.js";
import { htmlToMarkdown } from "./html.js";
import { formatIndexStatus, searchKnowledge } from "./knowledge.js";
import { parseQuery } from "./query.js";
import { parseTopicId } from "./rss.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const md = htmlToMarkdown(
  `<p>Hello <a href="/t/example/1">world</a></p><ul><li>One</li><li>Two</li></ul>`,
);
assert(md.includes("[world](https://www.chiefdelphi.com/t/example/1)"), "link rewrite");
assert(md.includes("- One"), "list rewrite");

assert(parseTopicId("470903") === 470903, "numeric id");
assert(parseTopicId("https://www.chiefdelphi.com/t/swerve-modules/470903") === 470903, "url id");
assert(parseTopicId("https://www.chiefdelphi.com/t/swerve-modules/470903/3") === 470903, "post url id");

const latest = await listLatest({ limit: 3 });
assert(latest.includes("http"), `latest RSS should include links\n${latest}`);
console.error("list_latest ok");

const topic = await getTopic({ topic: "477497", limit: 5 });
assert(topic.includes("Chief Delphi"), `get_topic should include title\n${topic}`);
assert(topic.includes("Post"), "get_topic should include posts");
console.error("get_topic ok");

const search = await searchTopics({ query: "swerve module", limit: 5 });
assert(/chiefdelphi\.com\/t\//.test(search), `search should return CD threads\n${search}`);
console.error("search_topics ok");

const compare = await searchTopics({ query: "MK4i vs MAXSwerve", category: "design", limit: 5 });
assert(/chiefdelphi\.com\/t\//.test(compare), `design search should return CD threads\n${compare}`);
const parsed = parseQuery("intake for algae", "algae");
assert(parsed.tokens.includes("intake"), "tokenize intake");
assert(parsed.tokens.includes("algae"), "tokenize algae");
assert(parsed.ftsStrict.includes("intake") && parsed.ftsStrict.includes("algae"), "strict AND query");
assert(parsed.ftsExpanded.includes("OR"), "expanded synonyms");
console.error("query parse ok");

const knowledge = await searchKnowledge({
  query: "swerve module",
  max_topics: 3,
  limit: 5,
});
assert(/topic \d+|Indexed|posts/i.test(knowledge), `knowledge search should index or match posts\n${knowledge}`);
console.error("search_knowledge ok");
console.error(formatIndexStatus());
console.error("smoke tests passed");
