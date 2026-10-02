// Mini stockage IndexedDB : le handle du dossier choisi ne peut pas aller dans chrome.storage.
const idb = {
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open("moodle-scrapper", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async get(k) {
    const db = await this.open();
    return new Promise((res) => {
      const r = db.transaction("kv").objectStore("kv").get(k);
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(undefined);
    });
  },
  async set(k, v) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction("kv", "readwrite");
      t.objectStore("kv").put(v, k);
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
  },
};
