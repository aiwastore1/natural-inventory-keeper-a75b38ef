/**
 * LAN / Wi-Fi sync bridge (Electron desktop).
 * The Electron main process runs the WebSocket server (port 8080) and the UDP
 * discovery broadcast (port 41234); this module talks to it through the
 * contextBridge API exposed in preload. In a plain browser it degrades to a
 * read-only status panel.
 */
import { db, uid, STORES } from "../database.js";
import { get, reload, state, saveSetting } from "../state.js";
import { t } from "../i18n.js";
import { esc, fmtDateTime, num } from "../utils/format.js";
import * as UI from "../components/ui.js";

const bridge = () => (typeof window !== "undefined" ? window.posSync : undefined);

export function isDesktop() {
  return Boolean(bridge());
}

let statusCache = { role: "offline", peers: [], connected: false };
let listenerBound = false;

function logSync(direction, store, recordId, peer) {
  return db.put("syncLog", {
    id: uid("syn"),
    direction,
    store,
    recordId,
    peer: peer || "?",
    createdAt: new Date().toISOString(),
  });
}

/** Send a local change to peers (no-op in browser). */
export function broadcastChange(store, record) {
  const api = bridge();
  if (!api) return;
  try {
    api.send({ kind: "change", store, record, at: new Date().toISOString(), origin: state.settings.deviceName || "device" });
  } catch {
    /* peer offline */
  }
}

/**
 * Send store->records map to peers so compound operations (sales, returns,
 * product edits) keep stock/batches/inventory consistent on every machine.
 * The receiving side upserts the records (safe merge, no deletions).
 */
export function broadcastSync(map) {
  const api = bridge();
  if (!api) return;
  const stores = {};
  for (const [name, rows] of Object.entries(map)) {
    const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
    if (list.length) stores[name] = list.map((r) => ({ ...r }));
  }
  if (!Object.keys(stores).length) return;
  try {
    api.send({ kind: "state", at: new Date().toISOString(), origin: state.settings.deviceName || "device", stores });
  } catch {
    /* peer offline */
  }
}

/** Full snapshot of every store except device-local ones (settings, syncLog). */
function fullState() {
  const stores = {};
  for (const [name, rows] of Object.entries(state.data)) {
    if (name === "settings" || name === "syncLog") continue;
    if (Array.isArray(rows) && rows.length) stores[name] = rows.map((r) => ({ ...r }));
  }
  return stores;
}

function isSyncableStore(name) {
  return Boolean(STORES[name]) && name !== "settings" && name !== "syncLog";
}

async function applyRemote(message) {
  if (!message || typeof message !== "object") return;
  const origin = message.origin || "?";
  const api = bridge();

  if (message.kind === "snapshot_request") {
    if (!api) return;
    api.send({ kind: "snapshot", at: new Date().toISOString(), origin: state.settings.deviceName || "device", stores: fullState() });
    return;
  }

  if (message.kind === "snapshot" && message.stores) {
    const names = Object.keys(message.stores).filter((n) => isSyncableStore(n));
    if (!names.length) return;
    for (const name of names) {
      const rows = message.stores[name];
      if (!Array.isArray(rows)) continue;
      await db.replaceStore(name, rows);
    }
    await logSync("in", "snapshot", names.join(","), origin);
    await reload([...names, "syncLog"]);
    UI.toast(`${t("sync_received")}: ${names.length} ${t("store")}(s)`);
    return;
  }

  if (message.kind === "state" && message.stores) {
    const names = Object.keys(message.stores).filter((n) => isSyncableStore(n));
    if (!names.length) return;
    for (const name of names) {
      const rows = message.stores[name];
      if (!Array.isArray(rows) || !rows.length) continue;
      await db.bulkInsert(name, rows);
    }
    await logSync("in", "state", names.join(","), origin);
    await reload([...names, "syncLog"]);
    UI.toast(`${t("sync_received")}: ${names.join(", ")}`);
    return;
  }

  if (message.kind !== "change" || !message.store || !message.record) return;
  if (!isSyncableStore(message.store)) return;
  await db.put(message.store, message.record);
  await logSync("in", message.store, message.record.id, origin);
  await reload([message.store, "syncLog"]);
  UI.toast(`${t("sync_received")}: ${message.store}`);
}

export function initSync() {
  const api = bridge();
  if (!api || listenerBound) return;
  listenerBound = true;
  api.onMessage((msg) => applyRemote(msg).catch((e) => console.error("sync", e)));
  api.onStatus((status) => {
    const was = statusCache.role;
    statusCache = { ...statusCache, ...status };
    // Client asks the master for a full snapshot as soon as the link is up.
    if (statusCache.role === "client" && was !== "client") {
      try {
        api.send({ kind: "snapshot_request", origin: state.settings.deviceName || "device" });
      } catch {
        /* not ready yet */
      }
    }
  });
  api.getStatus?.().then((s) => {
    if (s) statusCache = { ...statusCache, ...s };
  });
}

export async function network(route, view) {
  const render = () => {
    const desktop = isDesktop();
    view.innerHTML = `
      <header class="page-head"><div><h1 class="page-title">${t("lan_sync")}</h1>
      <p class="page-sub">${t("lan_sync_sub")}</p></div></header>
      ${
        desktop
          ? ""
          : `<div class="warn-note">💻 ${t("desktop_only_sync")}</div>`
      }
      ${UI.card({
        title: t("sync_role"),
        body: `<div class="form-grid">
          <div class="field"><label>${t("device_name")}</label><input class="input" id="dev-name" value="${esc(state.settings.deviceName || "POS-1")}"></div>
          <div class="field"><label>${t("sync_role")}</label>
            <select class="select" id="dev-role">
              <option value="master" ${state.settings.syncRole === "master" ? "selected" : ""}>${t("role_master")}</option>
              <option value="client" ${state.settings.syncRole === "client" ? "selected" : ""}>${t("role_client")}</option>
            </select></div>
          <div class="field"><label>${t("master_host")}</label><input class="input" id="dev-host" value="${esc(state.settings.masterHost || "")}" placeholder="192.168.1.10"></div>
          <div class="field"><label>${t("port")}</label><input class="input" value="8080 / UDP 41234" readonly></div>
        </div>
        <div class="row-actions" style="margin-top:12px">
          <button class="btn btn-primary" id="sync-start" ${desktop ? "" : "disabled"}>▶ ${t("start_sync")}</button>
          <button class="btn" id="sync-stop" ${desktop ? "" : "disabled"}>■ ${t("stop_sync")}</button>
          <button class="btn" id="sync-discover" ${desktop ? "" : "disabled"}>📡 ${t("discover_peers")}</button>
        </div>
        <p class="stat-hint" style="margin-top:10px">${t("status")}: <strong>${esc(statusCache.role)}</strong> · ${t("peers")}: ${num(statusCache.peers?.length || 0)} ${
          statusCache.peers?.length ? `— ${statusCache.peers.map((p) => esc(p.name || p.address)).join(", ")}` : ""
        }</p>`,
      })}
      ${UI.card({
        title: t("sync_log"),
        body: get("syncLog").length
          ? `<table class="table"><thead><tr><th>${t("date")}</th><th>${t("direction")}</th><th>${t("store")}</th><th>${t("peers")}</th></tr></thead><tbody>${get("syncLog")
              .slice()
              .reverse()
              .slice(0, 50)
              .map((r) => `<tr><td>${esc(fmtDateTime(r.createdAt))}</td><td>${esc(r.direction)}</td><td>${esc(r.store)}</td><td>${esc(r.peer || "—")}</td></tr>`)
              .join("")}</tbody></table>`
          : UI.emptyState(t("empty_title"), t("empty_desc"), "📡"),
      })}`;

    const save = async () => {
      await saveSetting("deviceName", view.querySelector("#dev-name").value.trim());
      await saveSetting("syncRole", view.querySelector("#dev-role").value);
      await saveSetting("masterHost", view.querySelector("#dev-host").value.trim());
    };
    view.querySelector("#sync-start").addEventListener("click", async () => {
      await save();
      try {
        const res = await bridge().start({ role: state.settings.syncRole || "master", host: state.settings.masterHost, name: state.settings.deviceName });
        statusCache = { ...statusCache, ...(res || {}) };
        UI.toast(t("sync_started"));
      } catch (e) {
        UI.toast(e.message, "error");
      }
      render();
    });
    view.querySelector("#sync-stop").addEventListener("click", async () => {
      await bridge()?.stop();
      statusCache = { role: "offline", peers: [], connected: false };
      UI.toast(t("sync_stopped"));
      render();
    });
    view.querySelector("#sync-discover").addEventListener("click", async () => {
      const peers = (await bridge()?.discover()) || [];
      statusCache.peers = peers;
      render();
    });
  };
  render();
  void route;
}
