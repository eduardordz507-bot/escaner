// Almacenamiento local en IndexedDB: los documentos nunca salen del teléfono.

let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open('escaner', 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('docs', { keyPath: 'id' });
        r.result.createObjectStore('pages', { keyPath: 'id' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return dbPromise;
}

const wait = r => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

const done = t => new Promise((resolve, reject) => {
  t.oncomplete = () => resolve();
  t.onerror = t.onabort = () => reject(t.error);
});

async function store(name, mode = 'readonly') {
  return (await open()).transaction(name, mode).objectStore(name);
}

export async function listDocs() {
  const docs = await wait((await store('docs')).getAll());
  return docs.sort((a, b) => b.updated - a.updated);
}

export const getDoc = async id => wait((await store('docs')).get(id));
export const putDoc = async doc => wait((await store('docs', 'readwrite')).put(doc));
export const getPage = async id => wait((await store('pages')).get(id));
export const putPage = async page => wait((await store('pages', 'readwrite')).put(page));
export const deletePage = async id => wait((await store('pages', 'readwrite')).delete(id));

export async function getPages(doc) {
  return (await Promise.all(doc.pageIds.map(getPage))).filter(Boolean);
}

export async function deleteDoc(doc) {
  const t = (await open()).transaction(['docs', 'pages'], 'readwrite');
  t.objectStore('docs').delete(doc.id);
  for (const id of doc.pageIds) t.objectStore('pages').delete(id);
  return done(t);
}
