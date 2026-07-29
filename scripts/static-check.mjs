import { access, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const html = await readFile(new URL("index.html", root), "utf8");
const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
const unsafe = references.filter((reference) => reference.startsWith("/"));
if (unsafe.length) throw new Error(`Root-relative URLs are not Pages-safe: ${unsafe.join(", ")}`);

for (const reference of references.filter(
  (item) => !item.startsWith("http") && !item.endsWith(".md"),
)) {
  await access(new URL(reference, root));
}

const workflow = await readFile(new URL(".github/workflows/pages.yml", root), "utf8");
if (!workflow.includes("actions/deploy-pages@v5")) {
  throw new Error("Pages deployment workflow is incomplete");
}

console.log("Static checks passed: relative assets, local runtime scripts, and Pages workflow.");
