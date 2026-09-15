/* Best-effort game asset downloader.
 *
 * Games on this site are iframes into pages we don't host. There's no
 * generic way to know a game's full asset list up front, so this crawls
 * outward from our local wrapper page: follow iframes / <base href>,
 * scan HTML/CSS/JS for anything that looks like an asset reference
 * (including quoted config values like `dataUrl: "Build/x.data"` and
 * Unity's `.partN` split-file convention), and fetch what it can.
 *
 * Anything that fails (CORS, 403, gone) is skipped from the zip but
 * still listed in MANIFEST.txt with its direct URL, along with a
 * best-guess link to the source GitHub repo when the asset host is
 * jsdelivr's /gh/ CDN or raw.githubusercontent.com, so the person can
 * fetch it themselves if they want the missing pieces.
 */
(function () {
  "use strict";

  const ASSET_EXT_RE = /\.(?:js|mjs|css|json|wasm|data|png|jpe?g|gif|webp|svg|ico|mp3|ogg|wav|m4a|ttf|otf|woff2?|glb|gltf|bin)(?:\?[^"'()\s]*)?$/i;
  const ATTR_URL_RE = /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  const CSS_URL_RE = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  const QUOTED_ASSET_RE = /["']([^"'\s<>]+?\.(?:js|mjs|css|json|wasm|data|png|jpe?g|gif|webp|svg|mp3|ogg|wav|m4a|ttf|otf|woff2?|glb|gltf|bin))["']/gi;
  const BASE_HREF_RE = /<base\s+href\s*=\s*["']([^"']+)["']/i;
  const IFRAME_SRC_RE = /<iframe[^>]+src\s*=\s*["']([^"']+)["']/i;

  const MAX_ASSETS = 80;
  const MAX_CRAWL_DEPTH = 2;
  const FETCH_TIMEOUT_MS = 12000;

  function withTimeout(promise, ms) {
    let t;
    const timeout = new Promise((_, reject) => { t = setTimeout(() => reject(new Error("timeout")), ms); });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
  }

  function resolveUrl(url, base) {
    try { return new URL(url, base).href; } catch { return null; }
  }

  function isProbablySameKindOfFile(url) {
    return ASSET_EXT_RE.test(url.split("#")[0]);
  }

  function repoHintFor(url) {
    let m = url.match(/cdn\.jsdelivr\.net\/gh\/([^/]+)\/([^/@]+)@?([^/]*)\//);
    if (m) return `https://github.com/${m[1]}/${m[2]}`;
    m = url.match(/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\//);
    if (m) return `https://github.com/${m[1]}/${m[2]}`;
    m = url.match(/^https?:\/\/([^./]+)\.github\.io\//);
    if (m) return `https://github.com/${m[1]}/${m[1]}.github.io`;
    return null;
  }

  async function fetchText(url) {
    const res = await withTimeout(fetch(url, { mode: "cors" }), FETCH_TIMEOUT_MS);
    if (!res.ok) throw new Error("HTTP " + res.status);
    return { text: await res.text(), finalUrl: res.url || url };
  }

  async function fetchBinary(url) {
    const res = await withTimeout(fetch(url, { mode: "cors" }), FETCH_TIMEOUT_MS);
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.blob();
  }

  function extractCandidates(text, baseUrl) {
    const found = new Set();
    let m;
    ATTR_URL_RE.lastIndex = 0;
    while ((m = ATTR_URL_RE.exec(text))) {
      const u = resolveUrl(m[1], baseUrl);
      if (u) found.add(u);
    }
    CSS_URL_RE.lastIndex = 0;
    while ((m = CSS_URL_RE.exec(text))) {
      const u = resolveUrl(m[1], baseUrl);
      if (u) found.add(u);
    }
    QUOTED_ASSET_RE.lastIndex = 0;
    while ((m = QUOTED_ASSET_RE.exec(text))) {
      const u = resolveUrl(m[1], baseUrl);
      if (u) found.add(u);
    }
    return found;
  }

  // Unity WebGL builds (and similar) split large files into
  // "name.ext.part1", "name.ext.part2", ... — probe for those next to
  // any asset we found so the split chunks make it into the bundle too.
  async function expandSplitParts(url, addFound) {
    for (let i = 1; i <= 40; i++) {
      const partUrl = `${url}.part${i}`;
      try {
        const res = await withTimeout(fetch(partUrl, { method: "HEAD", mode: "cors" }), 6000);
        if (!res.ok) break;
        addFound(partUrl);
      } catch {
        break;
      }
    }
  }

  function localPathFor(url, rootOrigin) {
    const u = new URL(url);
    if (u.origin === rootOrigin) return u.pathname.replace(/^\//, "");
    return "assets/" + u.hostname + u.pathname;
  }

  async function crawl(startUrl, rootOrigin, onProgress) {
    const visitedPages = new Set();
    const assetUrls = new Set();
    const queue = [{ url: startUrl, depth: 0 }];

    while (queue.length) {
      const { url, depth } = queue.shift();
      if (visitedPages.has(url) || depth > MAX_CRAWL_DEPTH) continue;
      visitedPages.add(url);
      onProgress?.(`Reading ${new URL(url).hostname}…`);

      let text, finalUrl;
      try {
        ({ text, finalUrl } = await fetchText(url));
      } catch {
        continue;
      }

      let base = finalUrl;
      const baseMatch = text.match(BASE_HREF_RE);
      if (baseMatch) {
        const resolved = resolveUrl(baseMatch[1], finalUrl);
        if (resolved) base = resolved;
      }

      const iframeMatch = text.match(IFRAME_SRC_RE);
      if (iframeMatch) {
        const nested = resolveUrl(iframeMatch[1], finalUrl);
        if (nested && !visitedPages.has(nested)) queue.push({ url: nested, depth: depth + 1 });
      }

      for (const candidate of extractCandidates(text, base)) {
        if (assetUrls.size >= MAX_ASSETS) break;
        if (isProbablySameKindOfFile(candidate)) assetUrls.add(candidate);
        else if (/\.html?(?:\?|$)/i.test(candidate) && !visitedPages.has(candidate)) {
          queue.push({ url: candidate, depth: depth + 1 });
        }
      }
    }

    // Probe split parts for every non-html asset we found.
    const withParts = new Set(assetUrls);
    await Promise.all(
      [...assetUrls].slice(0, 25).map((u) =>
        expandSplitParts(u, (partUrl) => withParts.add(partUrl))
      )
    );

    return { pages: visitedPages, assets: withParts };
  }

  async function buildZip(gameUrl, opts) {
    const onProgress = opts?.onProgress || (() => {});
    const zip = new JSZip();
    const rootOrigin = location.origin;
    const failures = [];
    const succeeded = [];

    onProgress("Finding game files…");
    const { pages, assets } = await crawl(gameUrl, rootOrigin, onProgress);

    let done = 0;
    const total = pages.size + assets.size || 1;
    const bump = () => onProgress(`Downloading files… (${++done}/${total})`);

    for (const pageUrl of pages) {
      try {
        const { text } = await fetchText(pageUrl);
        zip.file(localPathFor(pageUrl, rootOrigin), text);
        succeeded.push(pageUrl);
      } catch {
        failures.push(pageUrl);
      }
      bump();
    }

    await Promise.all(
      [...assets].map(async (assetUrl) => {
        try {
          const blob = await fetchBinary(assetUrl);
          zip.file(localPathFor(assetUrl, rootOrigin), blob);
          succeeded.push(assetUrl);
        } catch {
          failures.push(assetUrl);
        } finally {
          bump();
        }
      })
    );

    const repoHints = new Set();
    for (const url of [...pages, ...assets]) {
      const hint = repoHintFor(url);
      if (hint) repoHints.add(hint);
    }

    const manifestLines = [
      `Game source: ${gameUrl}`,
      "",
      `Downloaded ${succeeded.length} file(s) into this archive.`,
    ];
    if (failures.length) {
      manifestLines.push(
        "",
        `${failures.length} file(s) couldn't be downloaded automatically (likely blocked by`,
        "the host's CORS policy). Direct links, open these yourself if you need them:",
        "",
        ...failures.map((f) => `  - ${f}`)
      );
    }
    if (repoHints.size) {
      manifestLines.push(
        "",
        "This game's files look like they're mirrored from these repos —",
        "clone/download from there if you want the complete original source:",
        "",
        ...[...repoHints].map((r) => `  - ${r}`)
      );
    }
    zip.file("MANIFEST.txt", manifestLines.join("\n"));

    return { blob: await zip.generateAsync({ type: "blob" }), succeeded, failures };
  }

  window.GameDownloader = { buildZip };
})();
