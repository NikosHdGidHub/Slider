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
      for (const path of files) {
        hash.update(path);
        hash.update(await readFile(join(directory, path)));
      }
      const worker = `
const urls = ${JSON.stringify(files)}.map(path => new URL(path, self.registration.scope).href);
const allowed = new Set(urls);
const prefix = 'atlas-shell:' + encodeURIComponent(self.registration.scope) + ':';
const cacheName = prefix + '${hash.digest("hex").slice(0, 20)}';
const indexUrl = new URL('index.html', self.registration.scope).href;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll(urls.map(url => new Request(url, {cache: 'reload'})));
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
    const cache = await caches.open(cacheName);
    return await cache.match(key) || fetch(event.request);
  })());
});

self.addEventListener('message', event => {
  if (event.data !== 'atlas-check-shell' || !event.ports[0]) return;
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(cacheName);
      const missing = [];
      for (const url of urls) if (!(await cache.match(url))) missing.push(url);
      if (missing.length) await cache.addAll(missing.map(url => new Request(url, {cache: 'reload'})));
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
