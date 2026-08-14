/**
 * IndexedDB access layer for MasterPosInventoryDB.
 * Generic, reusable CRUD + transaction helpers. No LocalStorage as primary store.
 */

export const DB_NAME = "MasterPosInventoryDB";
export const DB_VERSION = 1;

export const STORES = {
  products: { keyPath: "id", indexes: ["sku", "barcode", "categoryId", "supplierId", "status", "brandId"] },
  categories: { keyPath: "id", indexes: ["nameEn"] },
  brands: { keyPath: "id", indexes: ["nameEn"] },
  suppliers: { keyPath: "id", indexes: ["name", "status"] },
  customers: { keyPath: "id", indexes: ["name", "phone"] },
  batches: { keyPath: "id", indexes: ["productId", "expiryDate", "batchNumber", "supplierId"] },
  inventory: { keyPath: "id", indexes: ["productId", "status"] },
  stockMovements: { keyPath: "id", indexes: ["productId", "type", "createdAt", "batchId", "refId"] },
  purchaseOrders: { keyPath: "id", indexes: ["poNumber", "supplierId", "status", "date"] },
  purchaseItems: { keyPath: "id", indexes: ["purchaseId", "productId"] },
  sales: { keyPath: "id", indexes: ["invoiceNumber", "customerId", "date", "paymentStatus"] },
  saleItems: { keyPath: "id", indexes: ["saleId", "productId"] },
  notifications: { keyPath: "id", indexes: ["type", "read", "createdAt"] },
  settings: { keyPath: "key" },
  activityLog: { keyPath: "id", indexes: ["createdAt", "entity"] },
};

let dbPromise = null;

export function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      // Migration path: create any missing store/index for the target version.
      for (const [name, def] of Object.entries(STORES)) {
        let store;
        if (!db.objectStoreNames.contains(name)) {
          store = db.createObjectStore(name, { keyPath: def.keyPath });
        } else {
          store = req.transaction.objectStore(name);
        }
        for (const idx of def.indexes || []) {
          if (!store.indexNames.contains(`by_${idx}`)) store.createIndex(`by_${idx}`, idx, { unique: false });
        }
      }
      void event;
    };
    req.onsuccess = () => {
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error || new Error("Failed to open database"));
    req.onblocked = () => reject(new Error("Database upgrade blocked by another tab"));
  });
  return dbPromise;
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Run a transaction over one or more stores. fn(storesMap, tx) */
export async function tx(storeNames, mode, fn) {
  const db = await openDB();
  const names = Array.isArray(storeNames) ? storeNames : [storeNames];
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(names, mode);
    const map = {};
    names.forEach((n) => (map[n] = transaction.objectStore(n)));
    let result;
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("Transaction aborted"));
    Promise.resolve(fn(map, transaction))
      .then((r) => {
        result = r;
      })
      .catch((err) => {
        try {
          transaction.abort();
        } catch {
          /* already aborted */
        }
        reject(err);
      });
  });
}

export const db = {
  async create(store, value) {
    const record = { ...value };
    if (STORES[store].keyPath === "id" && !record.id) record.id = uid(store.slice(0, 3));
    await tx(store, "readwrite", (s) => wrap(s[store].add(record)));
    return record;
  },
  async put(store, value) {
    await tx(store, "readwrite", (s) => wrap(s[store].put(value)));
    return value;
  },
  async read(store, key) {
    return tx(store, "readonly", (s) => wrap(s[store].get(key)));
  },
  async readAll(store) {
    return tx(store, "readonly", (s) => wrap(s[store].getAll()));
  },
  async update(store, key, patch) {
    return tx(store, "readwrite", async (s) => {
      const existing = await wrap(s[store].get(key));
      if (!existing) throw new Error(`Record not found in ${store}: ${key}`);
      const next = { ...existing, ...patch, updatedAt: new Date().toISOString() };
      await wrap(s[store].put(next));
      return next;
    });
  },
  async delete(store, key) {
    return tx(store, "readwrite", (s) => wrap(s[store].delete(key)));
  },
  async bulkInsert(store, values) {
    return tx(store, "readwrite", async (s) => {
      const out = [];
      for (const v of values) {
        const record = { ...v };
        if (STORES[store].keyPath === "id" && !record.id) record.id = uid(store.slice(0, 3));
        await wrap(s[store].put(record));
        out.push(record);
      }
      return out;
    });
  },
  async bulkUpdate(store, values) {
    return this.bulkInsert(store, values);
  },
  /** query(store, {index, value, filter, sort, dir, limit, offset}) */
  async query(store, opts = {}) {
    const rows = await tx(store, "readonly", async (s) => {
      const os = s[store];
      if (opts.index && opts.value !== undefined) {
        return wrap(os.index(`by_${opts.index}`).getAll(opts.value));
      }
      return wrap(os.getAll());
    });
    let list = rows;
    if (opts.filter) list = list.filter(opts.filter);
    if (opts.sort) {
      const dir = opts.dir === "desc" ? -1 : 1;
      list.sort((a, b) => {
        const x = a[opts.sort];
        const y = b[opts.sort];
        if (x === y) return 0;
        if (x === undefined || x === null) return 1;
        if (y === undefined || y === null) return -1;
        return (typeof x === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * dir;
      });
    }
    const offset = opts.offset || 0;
    if (opts.limit) return list.slice(offset, offset + opts.limit);
    return offset ? list.slice(offset) : list;
  },
  async count(store) {
    return tx(store, "readonly", (s) => wrap(s[store].count()));
  },
  async clear(store) {
    return tx(store, "readwrite", (s) => wrap(s[store].clear()));
  },
  async clearAll() {
    return tx(Object.keys(STORES), "readwrite", async (s) => {
      for (const name of Object.keys(STORES)) await wrap(s[name].clear());
      return true;
    });
  },
  async getSetting(key, fallback = null) {
    const row = await this.read("settings", key);
    return row ? row.value : fallback;
  },
  async setSetting(key, value) {
    return this.put("settings", { key, value, updatedAt: new Date().toISOString() });
  },
  async exportAll() {
    const dump = { app: "natural-cosmetics-inventory", version: DB_VERSION, exportedAt: new Date().toISOString(), stores: {} };
    for (const name of Object.keys(STORES)) dump.stores[name] = await this.readAll(name);
    return dump;
  },
  async importAll(dump, { wipe = true } = {}) {
    const names = Object.keys(STORES);
    return tx(names, "readwrite", async (s) => {
      for (const name of names) {
        const rows = dump.stores?.[name];
        if (!Array.isArray(rows)) continue;
        if (wipe) await wrap(s[name].clear());
        for (const row of rows) await wrap(s[name].put(row));
      }
      return true;
    });
  },
};

export async function logActivity(action, entity, description, meta = {}) {
  return db.create("activityLog", {
    id: uid("log"),
    action,
    entity,
    description,
    meta,
    createdAt: new Date().toISOString(),
  });
}

export { wrap };
