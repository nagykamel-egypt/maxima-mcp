import type { AnyNode, Element } from "domhandler";
import type { CheerioAPI } from "cheerio";

const SKIP_TAGS = new Set(["script", "style", "noscript", "nav", "svg"]);
const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "dd",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);

function isElement(node: AnyNode): node is Element {
  return node.type === "tag" || node.type === "script" || node.type === "style";
}

function shouldSkip(node: Element): boolean {
  if (SKIP_TAGS.has(node.name)) return true;
  const className = node.attribs?.class ?? "";
  if (className.includes("nav-panel")) return true;
  if (className.includes("copiable-link")) return true;
  if (className.includes("headerlink")) return true;
  if (className.includes("categorybox")) return true;
  return false;
}

function elementText($: CheerioAPI, node: AnyNode): string {
  if (node.type === "text") return node.data;
  if (node.type === "comment") return "";
  if (!isElement(node)) return "";
  if (shouldSkip(node)) return "";
  if (node.name === "br") return "\n";
  const inner = node.children.map((child) => elementText($, child)).join("");
  if (node.name === "pre") return `\n${inner}\n`;
  if (BLOCK_TAGS.has(node.name)) return `\n${inner}\n`;
  return inner;
}

/** Convert an HTML subtree to readable plain text while preserving paragraphs. */
export function htmlToText($: CheerioAPI, node: AnyNode): string {
  const raw = elementText($, node).replace(/\u00a0/g, " ");
  const lines = raw.split("\n").map((line) => line.replace(/[ \t]+/g, " ").trimEnd());
  const collapsed: string[] = [];
  for (const line of lines) {
    if (line.trim() === "") {
      if (collapsed.length > 0 && collapsed[collapsed.length - 1] !== "") collapsed.push("");
      continue;
    }
    collapsed.push(line);
  }
  while (collapsed[0] === "") collapsed.shift();
  while (collapsed[collapsed.length - 1] === "") collapsed.pop();
  return collapsed.join("\n");
}

/** Extract example blocks from a documentation element. */
export function extractExamples($: CheerioAPI, node: AnyNode, limit = 20): string[] {
  if (!isElement(node) && node.type !== "root") return [];
  const root = $(node);
  const examples: string[] = [];
  root.find("pre").each((_, element) => {
    if (examples.length >= limit) return;
    const text = $(element)
      .text()
      .replace(/\u00a0/g, " ")
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.replace(/[ \t]+$/g, ""))
      .join("\n")
      .trim();
    if (text) examples.push(text);
  });
  return examples;
}

/** Decode Texinfo `_XXXX` escapes used in index anchors. */
export function decodeTexinfo(value: string): string {
  return value.replace(/_([0-9a-fA-F]{4})/g, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

export function escapeAttribute(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
