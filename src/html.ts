import { parse, type HTMLElement, type Node, type TextNode } from "node-html-parser";

export function htmlToMarkdown(html: string): string {
  if (!html?.trim()) return "";
  const root = parse(html, { comment: false });
  for (const el of root.querySelectorAll("script, style, template, noscript")) {
    el.remove();
  }
  const text = renderNodes(root.childNodes).replace(/[ \t]+\n/g, "\n");
  return collapseBlankLines(text).trim();
}

function renderNodes(nodes: Node[]): string {
  return nodes.map(renderNode).join("");
}

function renderNode(node: Node): string {
  if (node.nodeType === 3) {
    return decode((node as TextNode).rawText).replace(/\s+/g, " ");
  }
  if (node.nodeType !== 1) return "";
  const el = node as HTMLElement;
  const tag = el.tagName?.toLowerCase() ?? "";
  const inner = renderNodes(el.childNodes);

  switch (tag) {
    case "p":
    case "div":
    case "section":
      return `\n\n${inner.trim()}\n\n`;
    case "br":
      return "\n";
    case "h1":
      return `\n\n# ${inner.trim()}\n\n`;
    case "h2":
      return `\n\n## ${inner.trim()}\n\n`;
    case "h3":
      return `\n\n### ${inner.trim()}\n\n`;
    case "h4":
    case "h5":
    case "h6":
      return `\n\n#### ${inner.trim()}\n\n`;
    case "strong":
    case "b":
      return inner.trim() ? `**${inner.trim()}**` : "";
    case "em":
    case "i":
      return inner.trim() ? `*${inner.trim()}*` : "";
    case "code":
      return inner.includes("\n") ? `\n\`\`\`\n${inner.trim()}\n\`\`\`\n` : `\`${inner.trim()}\``;
    case "pre":
      return `\n\`\`\`\n${el.text.trim()}\n\`\`\`\n`;
    case "blockquote":
    case "aside":
      return `\n\n${inner
        .trim()
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n")}\n\n`;
    case "ul":
      return `\n${renderList(el, false)}\n`;
    case "ol":
      return `\n${renderList(el, true)}\n`;
    case "li":
      return inner.trim();
    case "a": {
      const href = el.getAttribute("href") ?? "";
      const label = inner.trim() || href;
      if (!href) return label;
      return `[${label}](${absolutize(href)})`;
    }
    case "img": {
      const src = el.getAttribute("src") ?? "";
      const alt = el.getAttribute("alt") || "image";
      return src ? `![${alt}](${absolutize(src)})` : "";
    }
    case "hr":
      return "\n\n---\n\n";
    default:
      return inner;
  }
}

function renderList(el: HTMLElement, ordered: boolean): string {
  const items = el.querySelectorAll("li");
  return items
    .map((item, i) => {
      const body = renderNodes(item.childNodes).trim().replace(/\n/g, "\n  ");
      return ordered ? `${i + 1}. ${body}` : `- ${body}`;
    })
    .join("\n");
}

function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n");
}

function decode(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function absolutize(href: string): string {
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  if (href.startsWith("//")) return `https:${href}`;
  if (href.startsWith("/")) return `https://www.chiefdelphi.com${href}`;
  return href;
}

export function excerpt(markdown: string, maxChars = 420): string {
  const compact = markdown.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, maxChars - 1).trimEnd()}…`;
}
