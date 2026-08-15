/**
 * Offline ZIP backup & restore using the bundled JSZip build.
 * Archive layout:
 *   manifest.json         meta (app, version, date, counts)
 *   database.json         full IndexedDB dump
 *   csv/<store>.csv       flat CSV per store (readable outside the app)
 *   images/<sku>.txt      base64 product images (kept out of the JSON dump)
 */
import { db } from "../database.js";
import { get, reload, state } from "../state.js";
import { t } from "../i18n.js";
import { esc, fmtDateTime, num } from "../utils/format.js";
import { toCSV } from "../utils/csv.js";
import * as UI from "../components/ui.js";

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function zipLib() {
  if (!window.JSZip) throw new Error("JSZip not loaded");
  return window.JSZip;
}

export async function createZipBackup() {
  const JSZip = zipLib();
  const zip = new JSZip();
  const dump = await db.exportAll();
  const images = zip.folder("images");
  const csv = zip.folder("csv");

  for (const product of dump.stores.products || []) {
    if (product.image && String(product.image).startsWith("data:")) {
      images.file(`${product.sku || product.id}.txt`, product.image);
      product.image = `images/${product.sku || product.id}.txt`;
    }
  }
  for (const [name, rows] of Object.entries(dump.stores)) {
    if (Array.isArray(rows) && rows.length) csv.file(`${name}.csv`, toCSV(rows));
  }
  zip.file("database.json", JSON.stringify(dump, null, 2));
  zip.file(
    "manifest.json",
    JSON.stringify(
      {
        app: "Natural Cosmetics POS & Inventory",
        store: state.settings.storeName,
        currency: state.settings.currency,
        createdAt: new Date().toISOString(),
        counts: Object.fromEntries(Object.entries(dump.stores).map(([k, v]) => [k, v.length])),
      },
      null,
      2,
    ),
  );
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `backup-${stamp()}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  await db.setSetting("lastBackupAt", new Date().toISOString());
  await reload("settings");
  return blob.size;
}

export async function restoreZipBackup(file, { wipe = true } = {}) {
  const JSZip = zipLib();
  const zip = await JSZip.loadAsync(file);
  const entry = zip.file("database.json");
  if (!entry) throw new Error("database.json missing in archive");
  const dump = JSON.parse(await entry.async("string"));
  for (const product of dump.stores.products || []) {
    if (typeof product.image === "string" && product.image.startsWith("images/")) {
      const img = zip.file(product.image);
      product.image = img ? await img.async("string") : "";
    }
  }
  await db.importAll(dump, { wipe });
  await reload(Object.keys(dump.stores));
  return dump;
}

/* --------------------------------- view --------------------------------- */

export async function backup(route, view) {
  const counts = ["products", "variants", "sales", "returns", "batches", "customers", "suppliers", "drafts"];
  const render = () => {
    view.innerHTML = `
      <header class="page-head"><div><h1 class="page-title">${t("backup_center")}</h1>
      <p class="page-sub">${t("backup_sub")}</p></div></header>
      <div class="stats">${counts.map((c) => UI.statCard({ label: t(c) || c, value: num(get(c).length), icon: "🗄" })).join("")}</div>
      ${UI.card({
        title: `${t("zip_backup")}`,
        body: `<p class="stat-hint">${t("zip_backup_hint")}</p>
          <div class="row-actions" style="margin-top:12px">
            <button class="btn btn-primary" id="do-zip">🗜 ${t("download_zip")}</button>
            <button class="btn" id="do-json">⬇ ${t("export_json")}</button>
          </div>
          <p class="stat-hint" style="margin-top:10px">${t("last_backup")}: ${state.settings.lastBackupAt ? esc(fmtDateTime(state.settings.lastBackupAt)) : "—"}</p>`,
      })}
      ${UI.card({
        title: t("restore"),
        body: `<p class="stat-hint">${t("restore_hint")}</p>
          <div class="row-actions" style="margin-top:12px">
            <input class="input" id="zip-file" type="file" accept=".zip" style="max-width:320px">
            <input class="input" id="json-file" type="file" accept=".json" style="max-width:320px">
          </div>`,
      })}`;

    view.querySelector("#do-zip").addEventListener("click", async () => {
      try {
        const size = await createZipBackup();
        UI.toast(`${t("backup_done")} — ${Math.round(size / 1024)} KB`);
        render();
      } catch (e) {
        UI.toast(e.message, "error");
      }
    });
    view.querySelector("#do-json").addEventListener("click", async () => {
      const dump = await db.exportAll();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" }));
      a.download = `backup-${stamp()}.json`;
      a.click();
    });
    view.querySelector("#zip-file").addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!(await UI.confirmDialog({ title: t("restore"), message: t("restore_warning") }))) return;
      try {
        await restoreZipBackup(file);
        UI.toast(t("restored"));
        render();
      } catch (err) {
        UI.toast(err.message, "error");
      }
    });
    view.querySelector("#json-file").addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!(await UI.confirmDialog({ title: t("restore"), message: t("restore_warning") }))) return;
      try {
        const dump = JSON.parse(await file.text());
        await db.importAll(dump);
        await reload(Object.keys(dump.stores || {}));
        UI.toast(t("restored"));
        render();
      } catch (err) {
        UI.toast(err.message, "error");
      }
    });
  };
  render();
  void route;
}
