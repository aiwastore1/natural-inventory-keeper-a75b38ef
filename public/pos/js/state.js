/** Central in-memory cache over IndexedDB + pub/sub for real-time UI updates. */
import { db, STORES } from "./database.js";

export const DEFAULT_SETTINGS = {
  storeName: "Natural Cosmetics",
  currency: "DZD",
  language: "ar",
  theme: "system",
  dateFormat: "YYYY-MM-DD",
  firstDayOfWeek: "sunday",
  defaultMinimumStock: 10,
  defaultReorderPoint: 15,
  allowNegativeStock: false,
  expiryWarningDays: 30,
  enableFEFO: true,
  lowStockAlerts: true,
  expiryAlerts: true,
  salesAlerts: true,
};

export const state = {
  settings: { ...DEFAULT_SETTINGS },
  data: {},
  ready: false,
};

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit(reason = "change") {
  listeners.forEach((fn) => fn(reason));
}

export async function loadAll() {
  const names = Object.keys(STORES).filter((n) => n !== "settings");
  const results = await Promise.all(names.map((n) => db.readAll(n)));
  names.forEach((n, i) => (state.data[n] = results[i]));
  const rows = await db.readAll("settings");
  const saved = {};
  rows.forEach((r) => (saved[r.key] = r.value));
  state.settings = { ...DEFAULT_SETTINGS, ...saved };
  state.ready = true;
}

export async function reload(names) {
  const list = Array.isArray(names) ? names : [names];
  await Promise.all(
    list.map(async (n) => {
      if (n === "settings") {
        const rows = await db.readAll("settings");
        const saved = {};
        rows.forEach((r) => (saved[r.key] = r.value));
        state.settings = { ...DEFAULT_SETTINGS, ...saved };
      } else {
        state.data[n] = await db.readAll(n);
      }
    }),
  );
  emit("reload");
}

export async function saveSetting(key, value) {
  state.settings[key] = value;
  await db.setSetting(key, value);
  emit("settings");
}

export function get(store) {
  return state.data[store] || [];
}

export function byId(store, id) {
  return get(store).find((r) => r.id === id);
}
