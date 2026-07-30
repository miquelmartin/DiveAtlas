import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const rootFile = (name) => join(process.cwd(), name);

describe("GitHub Pages and offline shell", () => {
  it("uses project-subpath-safe document links", async () => {
    const html = await readFile(rootFile("index.html"), "utf8");
    const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
    expect(references.filter((reference) => reference.startsWith("/"))).toEqual([]);
    expect(html).toContain('src="src/app.js"');
    expect(html).toContain('src="src/theme.js"');
    expect(html).toContain('src="icons/logo-192.png"');
    expect(html).toContain('rel="icon" href="icons/logo-192.png" type="image/png"');
    expect(html).toContain("Dive data stays on this device");
    expect(html).not.toContain("No dive data leaves this device");
    expect(html).not.toMatch(/<script[^>]+https?:/);
    expect(html).not.toMatch(/<script(?:\s[^>]*)?>\s*\(\(\)/);
  });

  it("uses relative manifest scope and start URL", async () => {
    const manifest = JSON.parse(await readFile(rootFile("manifest.webmanifest"), "utf8"));
    expect(manifest.start_url).toBe("./");
    expect(manifest.scope).toBe("./");
    expect(manifest.icons).toEqual([
      {
        src: "icons/logo-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "icons/logo.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ]);
  });

  it("caches only relative application assets and every asset exists", async () => {
    const serviceWorker = await readFile(rootFile("sw.js"), "utf8");
    const assets = [...serviceWorker.matchAll(/"(\.\/[^"]+)"/g)].map((match) => match[1]);
    expect(assets.length).toBeGreaterThan(10);
    for (const asset of assets.filter((item) => item !== "./")) {
      await expect(access(rootFile(asset.slice(2)))).resolves.toBeUndefined();
    }
  });

  it("restricts network connections to self and configured map tiles", async () => {
    const html = await readFile(rootFile("index.html"), "utf8");
    expect(html).toContain("--cp-accent: #087ea4");
    expect(html).toContain("--cp-bg: #eef7fb");
    expect(html).toContain("connect-src 'self' https://*.tile.openstreetmap.org");
    expect(html).toContain("https://server.arcgisonline.com");
    expect(html).toContain("https://tiles.openseamap.org");
    expect(html).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(html).not.toMatch(/<script[^>]+(?:analytics|telemetry)/i);
    const app = await readFile(rootFile("src/app.js"), "utf8");
    const startup = app.slice(app.indexOf("async function start()"));
    expect(startup).not.toContain("initializeMap(elements.map)");
  });
});
