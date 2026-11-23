import type { Deck } from "./model";

export type Entry = { deck: Deck; updated: number; revision: number };
const opened = new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open("atlas-lessons-v1", 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore("lessons", { keyPath: "deck.id" });
    request.result.createObjectStore("images");
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
export async function entries(): Promise<Entry[]> {
  const db = await opened;
  return new Promise((resolve, reject) => {
    const q = db.transaction("lessons").objectStore("lessons").getAll();
    q.onsuccess = () =>
      resolve(q.result.sort((a: Entry, b: Entry) => b.updated - a.updated));
    q.onerror = () => reject(q.error);
  });
}
export async function saveEntry(deck: Deck, revision: number, remove = false) {
  const db = await opened;
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("lessons", "readwrite"),
      store = tx.objectStore("lessons");
    const read = store.get(deck.id);
    read.onsuccess = () => {
      if ((read.result?.revision ?? 0) !== revision) {
        reject(
          new Error(
            "Версия на диске изменилась. Экспортируйте текущую работу и откройте библиотеку заново.",
          ),
        );
        tx.abort();
      } else if (remove) store.delete(deck.id);
      else store.put({ deck, revision: revision + 1, updated: Date.now() });
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(tx.error || new Error("Запись в браузер прервана."));
  });
}
export async function imageAddress(
  key: string,
  url?: string,
): Promise<string | undefined> {
  const db = await opened;
  return new Promise((resolve, reject) => {
    const tx = db.transaction("images", url ? "readwrite" : "readonly");
    const store = tx.objectStore("images");
    const req = url ? store.put(url, key) : store.get(key);
    tx.oncomplete = () => resolve(url || req.result);
    tx.onabort = () => reject(tx.error);
  });
}
