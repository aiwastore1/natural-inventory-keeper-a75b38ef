/**
 * Import / Export & Backup hub (#/data | #/settings/import-export).
 * - ZIP restore (destructive, double confirmation) + ZIP backup (reuses backup.js engine)
 * - Excel import/export for products, suppliers, customers (merge or full replacement)
 * - Sales log Excel export scoped by date range
 * - Danger zone factory reset
 */
import { db, uid, logActivity } from "../database.js";
import { get, reload, state, saveSetting } from "../state.js";
import { t } from "../i18n.js";
import { esc, fmtDateTime, num, todayISO, money } from "../utils/format.js";
import * as UI from "../components/ui.js";
import { downloadXlsx, readXlsx, rowsToObjects } from "../utils/xlsx.js";
import { createZipBackup, restoreFromFile } from "./backup.js";

const PRODUCT_HEADERS = ["barcode", "sku", "name_ar", "name_en", "name_fr", "category", "cost_price", "selling_price", "quantity", "min_stock", "expiry_date", "unit"];
const SUPPLIER_HEADERS = ["name", "contact", "phone", "email", "address", "status"];
const CUSTOMER_HEADERS = ["name", "phone", "email", "address", "loyalty_points"];

function n(value) {
  const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function categoryIdByName(name) {
  const clean = String(name || "").trim().toLowerCase();
  if (!clean) return null;
  const match = get("categories").find((c) =>
    [c.nameAr, c.nameEn, c.nameFr, c.name].filter(Boolean).some((v) => String(v).toLowerCase() === clean),
  );
  return match?.id || null;
}

/* ----------------------------- import engines ---------------------------- */

export async function importProducts(rows, mode) {
  const report = { ok: 0, failed: 0, errors: [] };
  const existing = get("products");
  const seen = new Set();
  const records = [];
  rows.forEach((row, i) => {
    const line = i + 2;
    const name = row.name_en || row.name_ar || row.name_fr || row.name;
    if (!name) {
      report.failed += 1;
      report.errors.push(`${t("row")} ${line}: ${t("required_field")} (name)`);
      return;
    }
    const barcode = String(row.barcode || "").trim();
    if (barcode && seen.has(barcode)) {
      report.failed += 1;
      report.errors.push(`${t("row")} ${line}: ${t("duplicate_barcode")} ${barcode}`);
      return;
    }
    if (barcode) seen.add(barcode);
    const prev = mode === "merge" ? existing.find((p) => (barcode && p.barcode === barcode) || (row.sku && p.sku === row.sku)) : null;
    records.push({
      ...(prev || {}),
      id: prev?.id || uid("prd"),
      sku: row.sku || prev?.sku || `SKU-${Date.now().toString(36)}-${i}`,
      barcode: barcode || prev?.barcode || "",
      nameAr: row.name_ar || prev?.nameAr || name,
      nameEn: row.name_en || prev?.nameEn || name,
      nameFr: row.name_fr || prev?.nameFr || name,
      categoryId: categoryIdByName(row.category) || prev?.categoryId || null,
      purchasePrice: row.cost_price !== undefined && row.cost_price !== "" ? n(row.cost_price) : prev?.purchasePrice || 0,
      sellingPrice: row.selling_price !== undefined && row.selling_price !== "" ? n(row.selling_price) : prev?.sellingPrice || 0,
      quantity: row.quantity !== undefined && row.quantity !== "" ? n(row.quantity) : prev?.quantity || 0,
      minimumStock: row.min_stock !== undefined && row.min_stock !== "" ? n(row.min_stock) : prev?.minimumStock ?? state.settings.defaultMinimumStock,
      expiryDate: row.expiry_date || prev?.expiryDate || "",
      unit: row.unit || prev?.unit || t("unit_piece"),
      status: prev?.status || "active",
      updatedAt: new Date().toISOString(),
      createdAt: prev?.createdAt || new Date().toISOString(),
    });
    report.ok += 1;
  });
  if (mode === "replace") await db.clear("products");
  if (records.length) await db.bulkInsert("products", records);
  await reload(["products", "inventory"]);
  await logActivity("IMPORT", "products", `${report.ok} ${t("products")} (${mode})`);
  await reload("activityLog");
  return report;
}

async function importSimple(store, rows, mode, map, keyFields) {
  const report = { ok: 0, failed: 0, errors: [] };
  const existing = get(store);
  const records = [];
  rows.forEach((row, i) => {
    const line = i + 2;
    if (!row.name) {
      report.failed += 1;
      report.errors.push(`${t("row")} ${line}: ${t("required_field")} (name)`);
      return;
    }
    const prev = mode === "merge" ? existing.find((e) => keyFields.some((f) => row[f] && String(e[f] || "") === String(row[f]))) : null;
    records.push({ ...(prev || {}), id: prev?.id || uid(store.slice(0, 3)), ...map(row, prev), updatedAt: new Date().toISOString(), createdAt: prev?.createdAt || new Date().toISOString() });
    report.ok += 1;
  });
  if (mode === "replace") await db.clear(store);
  if (records.length) await db.bulkInsert(store, records);
  await reload(store);
  await logActivity("IMPORT", store, `${report.ok} ${t(store)} (${mode})`);
  await reload("activityLog");
  return report;
}

/* ----------------------------- export engines ---------------------------- */

async function exportProducts() {
  const rows = [
    PRODUCT_HEADERS,
    ...get("products").map((p) => [
      p.barcode || "",
      p.sku || "",
      p.nameAr || "",
      p.nameEn || "",
      p.nameFr || "",
      get("categories").find((c) => c.id === p.categoryId)?.nameEn || "",
      Number(p.purchasePrice) || 0,
      Number(p.sellingPrice) || 0,
      Number(p.quantity) || 0,
      Number(p.minimumStock) || 0,
      p.expiryDate || "",
      p.unit || "",
    ]),
  ];
  const variantRows = [
    ["product_sku", "variant_name", "barcode", "cost_price", "selling_price", "quantity"],
    ...get("variants").map((v) => {
      const parent = get("products").find((p) => p.id === v.productId);
      return [parent?.sku || "", v.name || "", v.barcode || "", Number(v.costPrice) || 0, Number(v.sellingPrice) || 0, Number(v.quantity) || 0];
    }),
  ];
  await downloadXlsx(`products-${todayISO()}.xlsx`, [
    { name: "Products", rows },
    { name: "Variants", rows: variantRows },
  ]);
}

async function exportSuppliers() {
  await downloadXlsx(`suppliers-${todayISO()}.xlsx`, [
    { name: "Suppliers", rows: [SUPPLIER_HEADERS, ...get("suppliers").map((s) => [s.name || "", s.contactPerson || "", s.phone || "", s.email || "", s.address || "", s.status || "active"])] },
  ]);
}

async function exportCustomers() {
  await downloadXlsx(`customers-${todayISO()}.xlsx`, [
    { name: "Customers", rows: [CUSTOMER_HEADERS, ...get("customers").map((c) => [c.name || "", c.phone || "", c.email || "", c.address || "", Number(c.loyaltyPoints) || 0])] },
  ]);
}

async function exportSalesLog(from, to) {
  const sales = get("sales").filter((s) => (!from || s.date >= from) && (!to || s.date <= to));
  const items = get("saleItems");
  const rows = [
    ["invoice", "date", "customer", "payment_method", "subtotal", "discount", "tax", "stamp_duty", "total", "profit"],
    ...sales.map((s) => [
      s.invoiceNumber,
      s.date,
      get("customers").find((c) => c.id === s.customerId)?.name || "",
      s.paymentMethod || "",
      Number(s.subtotal) || 0,
      Number(s.discount) || 0,
      Number(s.taxAmount) || 0,
      Number(s.stampDuty) || 0,
      Number(s.total) || 0,
      Number(s.profit) || 0,
    ]),
  ];
  const lineRows = [
    ["invoice", "product", "sku", "quantity", "price", "discount", "total"],
    ...sales.flatMap((s) =>
      items.filter((i) => i.saleId === s.id).map((i) => [s.invoiceNumber, i.productName, i.sku || "", Number(i.quantity) || 0, Number(i.price) || 0, Number(i.discount) || 0, Number(i.total) || 0]),
    ),
  ];
  await downloadXlsx(`sales-log-${from || "all"}_${to || todayISO()}.xlsx`, [
    { name: "Sales", rows },
    { name: "Lines", rows: lineRows },
  ]);
  return sales.length;
}

/* -------------------------------- the view ------------------------------- */

function importBlock({ id, title, headers, exportLabel }) {
  return UI.card({
    title,
    body: `<div class="row-actions" style="flex-wrap:wrap;gap:8px">
        <button class="btn" data-export="${id}">📤 ${exportLabel}</button>
        <button class="btn" data-template="${id}">📄 ${t("download_template")}</button>
      </div>
      <div class="import-block">
        <input type="file" accept=".xlsx" id="file-${id}">
        <div class="radio-row">
          <label><input type="radio" name="mode-${id}" value="merge" checked> ${t("merge_update")}</label>
          <label><input type="radio" name="mode-${id}" value="replace"> ${t("full_replacement")}</label>
        </div>
        <button class="btn btn-primary" data-import="${id}">📥 ${t("start_import")}</button>
      </div>
      <p class="hint">${t("expected_columns")}: ${esc(headers.join(", "))}</p>`,
  });
}

export async function importExport(route, view) {
  const render = () => {
    const last = state.settings.lastBackupTimestamp;
    view.innerHTML = `
      <div class="page-head"><div><h1>${t("import_export")}</h1><p class="stat-hint">${t("import_export_sub")}</p></div></div>
      <div class="grid g2">
        ${UI.card({
          title: t("database_system_zip"),
          body: `<div class="row-actions" style="flex-wrap:wrap;gap:8px">
              <button class="btn btn-primary" data-zip-backup>🗜 ${t("backup_now")}</button>
              <button class="btn" data-zip-restore>⬆ ${t("upload_and_restore")}</button>
              <input type="file" id="zip-file" accept=".zip,application/json" hidden>
            </div>
            <p class="hint">${t("last_backup")}: ${last ? esc(fmtDateTime(last)) : t("not_available")}</p>
            <p class="hint danger-text">⚠ ${t("restore_destructive_warning")}</p>`,
        })}
        ${UI.card({
          title: t("sales_log"),
          body: `<div class="grid g2">
              ${UI.field({ label: t("from"), name: "salesFrom", type: "date", value: "" })}
              ${UI.field({ label: t("to"), name: "salesTo", type: "date", value: todayISO() })}
            </div>
            <p class="hint">⚠ ${t("heavy_export_warning")}</p>
            <button class="btn btn-primary" data-export-sales>📤 ${t("export_to_excel")}</button>`,
        })}
        ${importBlock({ id: "products", title: t("inventory_products_excel"), headers: PRODUCT_HEADERS, exportLabel: t("export_products") })}
        ${importBlock({ id: "suppliers", title: t("supplier_list"), headers: SUPPLIER_HEADERS, exportLabel: t("export_to_excel") })}
        ${importBlock({ id: "customers", title: t("customer_list"), headers: CUSTOMER_HEADERS, exportLabel: t("export_to_excel") })}
        <section class="card danger-zone full">
          <div class="card-head"><h2 class="card-title">${t("danger_zone")}</h2></div>
          <div class="card-body">
            <p>${t("factory_reset_warning")}</p>
            <button class="btn btn-danger" data-factory-reset>🗑 ${t("factory_reset_now")}</button>
          </div>
        </section>
      </div>`;

    /* ZIP backup */
    view.querySelector("[data-zip-backup]").addEventListener("click", async () => {
      try {
        await createZipBackup();
        const stampTime = new Date().toISOString();
        await saveSetting("lastBackupTimestamp", stampTime);
        UI.toast(t("backup_done"));
        render();
      } catch (error) {
        UI.toast(error.message, "error", 4000);
      }
    });

    const zipInput = view.querySelector("#zip-file");
    view.querySelector("[data-zip-restore]").addEventListener("click", () => zipInput.click());
    zipInput.addEventListener("change", async () => {
      const file = zipInput.files[0];
      zipInput.value = "";
      if (!file) return;
      const confirmed = await confirmTyped(t("restore"), t("restore_destructive_warning"), "RESTORE");
      if (!confirmed) return;
      try {
        await restoreFromFile(file);
        UI.toast(t("restored"));
        render();
      } catch (error) {
        UI.toast(error.message, "error", 5000);
      }
    });

    /* sales export */
    view.querySelector("[data-export-sales]").addEventListener("click", async () => {
      const from = view.querySelector("#f_salesFrom").value;
      const to = view.querySelector("#f_salesTo").value;
      const count = await exportSalesLog(from, to);
      UI.toast(`${t("export_to_excel")} — ${num(count)} ${t("sales")}`);
    });

    /* exports */
    view.querySelectorAll("[data-export]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const kind = btn.dataset.export;
        if (kind === "products") await exportProducts();
        if (kind === "suppliers") await exportSuppliers();
        if (kind === "customers") await exportCustomers();
        UI.toast(t("export_to_excel"));
      }),
    );

    /* templates */
    view.querySelectorAll("[data-template]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const kind = btn.dataset.template;
        const headers = kind === "products" ? PRODUCT_HEADERS : kind === "suppliers" ? SUPPLIER_HEADERS : CUSTOMER_HEADERS;
        await downloadXlsx(`${kind}-template.xlsx`, [{ name: kind, rows: [headers] }]);
        UI.toast(t("download_template"));
      }),
    );

    /* imports */
    view.querySelectorAll("[data-import]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const kind = btn.dataset.import;
        const input = view.querySelector(`#file-${kind}`);
        const file = input.files[0];
        if (!file) return UI.toast(t("choose_file"), "error");
        const mode = view.querySelector(`input[name="mode-${kind}"]:checked`).value;
        if (mode === "replace") {
          const ok = await confirmTyped(t("full_replacement"), t("replace_destructive_warning"), "DELETE");
          if (!ok) return;
        }
        try {
          const { first } = await readXlsx(file);
          const rows = rowsToObjects(first);
          if (!rows.length) return UI.toast(t("empty_file"), "error");
          let report;
          if (kind === "products") report = await importProducts(rows, mode);
          if (kind === "suppliers")
            report = await importSimple(
              "suppliers",
              rows,
              mode,
              (r) => ({ name: r.name, contactPerson: r.contact || "", phone: r.phone || "", email: r.email || "", address: r.address || "", status: r.status || "active" }),
              ["name", "phone"],
            );
          if (kind === "customers")
            report = await importSimple(
              "customers",
              rows,
              mode,
              (r) => ({ name: r.name, phone: r.phone || "", email: r.email || "", address: r.address || "", loyaltyPoints: n(r.loyalty_points) }),
              ["name", "phone"],
            );
          input.value = "";
          UI.openModal({
            title: t("import_report"),
            size: "sm",
            body: `<p>✅ ${t("imported")}: <strong>${num(report.ok)}</strong></p>
              <p>❌ ${t("failed")}: <strong>${num(report.failed)}</strong></p>
              ${report.errors.length ? `<ul class="err-list">${report.errors.slice(0, 40).map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}`,
          });
          render();
        } catch (error) {
          UI.toast(error.message, "error", 5000);
        }
      }),
    );

    /* factory reset */
    view.querySelector("[data-factory-reset]").addEventListener("click", async () => {
      const ok = await confirmTyped(t("factory_reset"), t("factory_reset_warning"), "DELETE");
      if (!ok) return;
      await db.clearAll();
      await reload(Object.keys(state.data).concat("settings"));
      UI.toast(t("factory_reset_done"));
      setTimeout(() => window.location.reload(), 600);
    });
  };

  render();
  void route;
  void money;
}

/** Destructive-action guard: requires a typed keyword + explicit checkbox. */
export function confirmTyped(title, message, keyword) {
  return new Promise((resolve) => {
    UI.openModal({
      title,
      size: "sm",
      body: `<p class="danger-text">${esc(message)}</p>
        <label class="switch"><span>${t("i_understand")}</span><input type="checkbox" id="ct-ack"></label>
        <div class="field full"><label for="ct-word">${t("type_to_confirm")} <code>${esc(keyword)}</code></label>
          <input class="input" id="ct-word" autocomplete="off"></div>`,
      footer: `<button class="btn" data-cancel>${t("cancel")}</button><button class="btn btn-danger" data-ok disabled>${t("confirm")}</button>`,
      onMount(modal) {
        const ack = modal.querySelector("#ct-ack");
        const word = modal.querySelector("#ct-word");
        const ok = modal.querySelector("[data-ok]");
        const sync = () => {
          ok.disabled = !(ack.checked && word.value.trim().toUpperCase() === keyword.toUpperCase());
        };
        ack.addEventListener("change", sync);
        word.addEventListener("input", sync);
        modal.querySelector("[data-cancel]").addEventListener("click", () => {
          UI.closeModal();
          resolve(false);
        });
        ok.addEventListener("click", () => {
          UI.closeModal();
          resolve(true);
        });
      },
      onClose: () => resolve(false),
    });
  });
}
