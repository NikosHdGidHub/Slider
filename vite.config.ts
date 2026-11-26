import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

async function filesIn(directory: string, prefix = ""): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory())
      result.push(...(await filesIn(join(directory, entry.name), name + "/")));
    else if (entry.isFile() && name !== "sw.js" && !name.endsWith(".map"))
      result.push(name);
  }
  return result.sort();
}

function offlineShell(): Plugin {
  let directory = "";
  return {
    name: "atlas-offline-shell",
    apply: "build",
    configResolved(config) {
      directory = resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const files = await filesIn(directory);
      const hash = createHash("sha256");
      const fonts: Record<string, string> = {};
      for (const path of files) {
        hash.update(path);
        const contents = await readFile(join(directory, path));
        hash.update(contents);
        if (path.startsWith("fonts/") && path.endsWith(".woff2"))
          fonts[path] = createHash("sha256").update(contents).digest("hex").slice(0, 20);
      }
      const worker = `
const urls = ${JSON.stringify(files)}.map(path => new URL(path, self.registration.scope).href);
const allowed = new Set(urls);
const fontKeys = new Map(Object.entries(${JSON.stringify(fonts)}).map(([path, hash]) => {
  const source = new URL(path, self.registration.scope);
  const key = new URL(source);
  key.searchParams.set('atlas-font-revision', hash);
  return [source.href, key.href];
}));
const coreFonts = [...fontKeys.keys()].filter(url => ['sans', 'serif', 'mono'].some(id =>
  url.startsWith(new URL('fonts/' + id + '/', self.registration.scope).href)));
const shellUrls = urls.filter(url => !url.startsWith(new URL('fonts/', self.registration.scope).href));
const prefix = 'atlas-shell:' + encodeURIComponent(self.registration.scope) + ':';
const cacheName = prefix + '${hash.digest("hex").slice(0, 20)}';
const indexUrl = new URL('index.html', self.registration.scope).href;
const fontCacheName = 'atlas-fonts:' + encodeURIComponent(self.registration.scope);

async function cacheFonts(urls) {
  if (!urls.length) return;
  const cache = await caches.open(fontCacheName);
  await Promise.all(urls.map(async url => {
    const key = fontKeys.get(url);
    if (await cache.match(key)) return;
    const response = await fetch(url, { cache: 'reload' });
    if (!response.ok) throw new Error('Font download failed');
    await cache.put(key, response);
  }));
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll(shellUrls.map(url => new Request(url, {cache: 'reload'})));
    await cacheFonts(coreFonts);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(prefix) && key !== cacheName) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const root = new URL(self.registration.scope);
  const shellNavigation = event.request.mode === 'navigate' &&
    url.origin === root.origin && (url.pathname === root.pathname || url.pathname === new URL(indexUrl).pathname);
  const key = shellNavigation ? indexUrl : url.href;
  if (!allowed.has(key)) return;
  event.respondWith((async () => {
    const fontKey = fontKeys.get(key);
    const cache = await caches.open(fontKey ? fontCacheName : cacheName);
    const saved = await cache.match(fontKey || key);
    if (saved) return saved;
    const result = await fetch(event.request);
    if (result.ok && fontKey) await cache.put(fontKey, result.clone()).catch(() => {});
    return result;
  })());
});

self.addEventListener('message', event => {
  if ((event.data?.type !== 'atlas-check-shell' && event.data !== 'atlas-check-shell') || !event.ports[0]) return;
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(cacheName);
      const missing = [];
      const requested = (event.data.fonts || []).map(path => new URL(path, self.registration.scope).href);
      if (requested.some(url => !fontKeys.has(url))) throw new Error('Unknown font URL');
      for (const url of shellUrls) if (!(await cache.match(url))) missing.push(url);
      if (missing.length) await cache.addAll(missing.map(url => new Request(url, {cache: 'reload'})));
      await cacheFonts([...new Set([...coreFonts, ...requested])]);
      event.ports[0].postMessage(true);
    } catch {
      event.ports[0].postMessage(false);
    }
  })());
});
`;
      await writeFile(join(directory, "sw.js"), worker);
    },
  };
}

export default defineConfig({ base: "./", plugins: [react(), offlineShell()] });
