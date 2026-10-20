import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GuideContent } from "./src/Guide";

// The console's Guide page and docs/USER_GUIDE.md must say the same thing.
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
const rendered = normalize(renderToStaticMarkup(createElement(GuideContent))
  .replace(/<[^>]+>/g, " ")
  .replace(/&quot;/g, "\"").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/ ([.,;:)])/g, "$1").replace(/\( /g, "("));

function markdownFragments(markdown: string): string[] {
  return markdown.split("\n").flatMap((line) => {
    if (/^\s*$/.test(line) || /^\|[-| ]+\|$/.test(line)) return [];
    const cells = line.startsWith("|") ? line.split("|").slice(1, -1) : [line];
    return cells.map((cell) => normalize(cell.replace(/^#+\s*/, "").replace(/^\s*(?:\d+\.|-)\s+/, "").replace(/\*\*|`/g, ""))).filter(Boolean);
  });
}

describe("user guide", () => {
  it("shows every line of docs/USER_GUIDE.md in the console", () => {
    const markdown = readFileSync(new URL("../docs/USER_GUIDE.md", import.meta.url), "utf8");
    const missing = markdownFragments(markdown).filter((fragment) => !rendered.includes(fragment));
    expect(missing).toEqual([]);
  });

  it("carries the exact CNY disclaimer", () => {
    expect(rendered).toContain("Simulated demo units denominated in CNY for illustration. No value, not issued, not redeemable, not a digital currency, not linked to e-CNY.");
  });
});
