/** All route views. Each view renders real IndexedDB-backed data and wires working actions. */
import { db, uid, logActivity } from "../database.js";
import { state, get, byId, reload, saveSetting } from "../state.js";
import { t, localName, LANGS } from "../i18n.js";
import { money, num, pct, esc, fmtDate, fmtDateTime, daysUntil, sum, debounce, download, todayISO } from "../utils/format.js";
import { exportCSV, parseCSV, readFileText, readFileDataURL } from "../utils/csv.js";
import { lineChart, barChart, donutChart, hBarChart, legendHTML, PALETTE } from "../utils/charts.js";
import * as UI from "../components/ui.js";
import {
  stockStatus,
  STATUS_META,
  expiryStatus,
  EXPIRY_META,
  applyStockChange,
  receivePurchase,
  createSale,
  nextInvoiceNumber,
  nextPONumber,
  nextSKU,
  productBatches,
  MOVEMENT_TYPES,
} from "./domain.js";
import { navigate } from "../router.js";
import { seedDemoData } from "../seed.js";

const ctrls = {};
function ctrl(key, init) {
  if (!ctrls[key]) ctrls[key] = { page: 1, perPage: 10, sort: null, dir: "asc", q: "", selected: new Set(), visibleIds: [], hiddenCols: new Set(), ...init };
  return ctrls[key];
}

function head(title, desc, actions = "") {
  return `<div class="page-head"><div><h1 class="page-title">${esc(title)}</h1><p class="page-desc">${esc(desc)}</p></div><div class="row-actions">${actions}</div></div>`;
}

function statusBadge(product) {
  const meta = STATUS_META[stockStatus(product)];
  return UI.badge(t(meta.key), meta.tone);
}

function prodName(id) {
  return localName(byId("products", id));
}

function match(text, q) {
  return String(text || "").toLowerCase().includes(q.toLowerCase());
}

/* ------------------------------- Dashboard ------------------------------- */
export async function dashboard(route, view) {
  const products = get("products");
  const sales = get("sales");
  const purchases = get("purchaseOrders");
  const today = todayISO();
  const month = today.slice(0, 7);
  const invValue = sum(products, (p) => p.quantity * p.purchasePrice);
  const counts = { healthy: 0, low: 0, critical: 0, out: 0, over: 0 };
  products.forEach((p) => (counts[stockStatus(p)] += 1));
  const todaySales = sales.filter((s) => s.date === today);
  const monthSales = sales.filter((s) => String(s.date).startsWith(month));
  const monthPurch = purchases.filter((p) => String(p.date).startsWith(month) && p.status === "received");
  const grossProfit = sum(monthSales, (s) => (s.total - (s.taxAmount || 0)) - (s.cogs || 0));
  const expSoon = get("batches").filter((b) => b.quantity > 0 && b.expiryDate && ["soon", "critical", "expired"].includes(expiryStatus(b.expiryDate))).length;

  view.innerHTML = `
    ${head(t("dashboard"), state.settings.storeName, `<button class="btn" data-print>🖨 ${t("print")}</button>`)}
    <div class="kpi-grid">
      ${UI.statCard({ label: t("total_products"), value: num(products.length), icon: "🧴", route: "/products" })}
      ${UI.statCard({ label: t("total_stock"), value: num(sum(products, (p) => p.quantity)), icon: "📦", route: "/inventory" })}
      ${UI.statCard({ label: t("inventory_value"), value: money(invValue), icon: "💰", route: "/inventory" })}
      ${UI.statCard({ label: t("low_stock"), value: num(counts.low), icon: "⚠️", route: "/inventory" })}
      ${UI.statCard({ label: t("critical_stock"), value: num(counts.critical), icon: "🚨", route: "/inventory" })}
      ${UI.statCard({ label: t("out_of_stock"), value: num(counts.out), icon: "⛔", route: "/inventory" })}
      ${UI.statCard({ label: t("expiring_soon"), value: num(expSoon), icon: "⏳", route: "/expiry" })}
      ${UI.statCard({ label: t("today_sales"), value: money(sum(todaySales, (s) => s.total)), icon: "🧾", route: "/sales" })}
      ${UI.statCard({ label: t("monthly_sales"), value: money(sum(monthSales, (s) => s.total)), icon: "📈", route: "/sales" })}
      ${UI.statCard({ label: t("monthly_purchases"), value: money(sum(monthPurch, (p) => p.total)), icon: "🚚", route: "/purchases" })}
      ${UI.statCard({ label: t("gross_profit"), value: money(grossProfit), icon: "💹", route: "/analytics" })}
    </div>
    <div class="grid g2">
      ${UI.card({ title: t("sales_overview"), body: `<div class="chart-wrap"><canvas id="ch-sales"></canvas></div>`, cls: "chart-card" })}
      ${UI.card({ title: t("purchases_vs_sales"), body: `<div class="chart-wrap"><canvas id="ch-pvs"></canvas></div>`, cls: "chart-card" })}
      ${UI.card({ title: t("stock_by_category"), body: `<div class="chart-wrap"><canvas id="ch-cat"></canvas></div><div id="lg-cat"></div>`, cls: "chart-card" })}
      ${UI.card({ title: t("stock_health"), body: `<div class="chart-wrap"><canvas id="ch-health"></canvas></div><div id="lg-health"></div>`, cls: "chart-card" })}
      ${UI.card({ title: t("top_products"), body: `<div class="chart-wrap"><canvas id="ch-top"></canvas></div>`, cls: "chart-card" })}
      ${UI.card({ title: t("expiry_overview"), body: `<div class="chart-wrap"><canvas id="ch-exp"></canvas></div><div id="lg-exp"></div>`, cls: "chart-card" })}
    </div>`;

  // Sales last 14 days
  const labels = [];
  const values = [];
  const purchValues = [];
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    labels.push(key.slice(5));
    values.push(sum(sales.filter((s) => s.date === key), (s) => s.total));
    purchValues.push(sum(purchases.filter((p) => p.date === key), (p) => p.total));
  }
  lineChart(view.querySelector("#ch-sales"), labels, [{ data: values, color: PALETTE[0] }]);
  barChart(view.querySelector("#ch-pvs"), labels.slice(-7), [
    { data: purchValues.slice(-7), color: PALETTE[1] },
    { data: values.slice(-7), color: PALETTE[0] },
  ]);
  const catItems = get("categories")
    .map((c, i) => ({ label: localName(c), value: sum(get("products").filter((p) => p.categoryId === c.id), (p) => p.quantity), color: PALETTE[i % PALETTE.length] }))
    .filter((c) => c.value > 0);
  donutChart(view.querySelector("#ch-cat"), catItems, { centerLabel: num(sum(catItems, (c) => c.value)) });
  view.querySelector("#lg-cat").innerHTML = legendHTML(catItems);
  const healthItems = [
    { label: t("healthy"), value: counts.healthy, color: "#15803d" },
    { label: t("low_stock"), value: counts.low, color: "#b45309" },
    { label: t("critical_stock"), value: counts.critical, color: "#dc2626" },
    { label: t("out_of_stock"), value: counts.out, color: "#7f1d1d" },
    { label: t("overstocked"), value: counts.over, color: "#1d4ed8" },
  ];
  donutChart(view.querySelector("#ch-health"), healthItems, { centerLabel: num(products.length) });
  view.querySelector("#lg-health").innerHTML = legendHTML(healthItems);
  const soldMap = new Map();
  get("saleItems").forEach((it) => soldMap.set(it.productId, (soldMap.get(it.productId) || 0) + it.quantity));
  const top = [...soldMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7).map(([id, qty]) => ({ label: prodName(id), value: qty }));
  hBarChart(view.querySelector("#ch-top"), top);
  const expBuckets = [
    { label: t("expired"), value: 0, color: "#7f1d1d" },
    { label: "≤7", value: 0, color: "#dc2626" },
    { label: "≤30", value: 0, color: "#b45309" },
    { label: "≤90", value: 0, color: "#ca8a04" },
    { label: t("safe"), value: 0, color: "#15803d" },
  ];
  get("batches").filter((b) => b.quantity > 0 && b.expiryDate).forEach((b) => {
    const d = daysUntil(b.expiryDate);
    if (d < 0) expBuckets[0].value += 1;
    else if (d <= 7) expBuckets[1].value += 1;
    else if (d <= 30) expBuckets[2].value += 1;
    else if (d <= 90) expBuckets[3].value += 1;
    else expBuckets[4].value += 1;
  });
  donutChart(view.querySelector("#ch-exp"), expBuckets, { centerLabel: num(sum(expBuckets, (b) => b.value)) });
  view.querySelector("#lg-exp").innerHTML = legendHTML(expBuckets);
  view.querySelector("[data-print]").addEventListener("click", () => window.print());
}

/* -------------------------------- Products -------------------------------- */
export async function products(route, view) {
  if (route.param) return productDetails(route.param, view);
  const c = ctrl("products", { sort: "sku", perPage: 10, category: "", status: "" });
  const render = () => {
    let rows = get("products").filter(
      (p) =>
        (!c.q || match(localName(p), c.q) || match(p.sku, c.q) || match(p.barcode, c.q)) &&
        (!c.category || p.categoryId === c.category) &&
        (!c.status || p.status === c.status),
    );
    rows = rows.map((p) => ({ ...p, name: localName(p), catName: localName(byId("categories", p.categoryId)) }));
    if (c.sort) {
      const dir = c.dir === "asc" ? 1 : -1;
      rows.sort((a, b) => (typeof a[c.sort] === "number" ? (a[c.sort] - b[c.sort]) * dir : String(a[c.sort] ?? "").localeCompare(String(b[c.sort] ?? "")) * dir));
    }
    c.visibleIds = rows.slice((c.page - 1) * c.perPage, c.page * c.perPage).map((r) => r.id);
    const columns = [
      { key: "sku", label: t("sku") },
      { key: "name", label: t("name"), render: (r) => `<a href="#/products/${r.id}"><strong>${esc(r.name)}</strong></a><div class="stat-hint">${esc(r.barcode)}</div>` },
      { key: "catName", label: t("category") },
      { key: "quantity", label: t("stock"), className: "num", render: (r) => `${num(r.quantity)} <span class="stat-hint">${esc(r.unit)}</span>` },
      { key: "purchasePrice", label: t("purchase_price"), className: "num", render: (r) => money(r.purchasePrice) },
      { key: "sellingPrice", label: t("selling_price"), className: "num", render: (r) => money(r.sellingPrice) },
      { key: "stockStatus", label: t("status"), sortable: false, render: (r) => statusBadge(r) },
      {
        key: "actions",
        label: t("actions"),
        sortable: false,
        render: (r) => `<div class="row-actions">
          <button class="btn btn-sm" data-view="${r.id}">👁</button>
          <button class="btn btn-sm" data-edit="${r.id}">✏️</button>
          <button class="btn btn-sm btn-danger" data-del="${r.id}">🗑</button></div>`,
      },
    ];
    view.innerHTML = `
      ${head(t("products"), `${rows.length} ${t("rows")}`, `<button class="btn" data-export>⬇ ${t("export_csv")}</button><button class="btn btn-primary" data-add>+ ${t("add")}</button>`)}
      <div class="toolbar">
        <div class="search" style="flex:1;min-width:220px"><span class="sic">🔍</span><input class="search-input" data-q value="${esc(c.q)}" placeholder="${t("search")}"></div>
        <select class="select" data-cat style="max-width:200px"><option value="">${t("all")} — ${t("category")}</option>${UI.selectOptions(get("categories"), "id", localName, c.category)}</select>
        <select class="select" data-status style="max-width:170px"><option value="">${t("all")} — ${t("status")}</option>
          <option value="active" ${c.status === "active" ? "selected" : ""}>${t("active")}</option>
          <option value="inactive" ${c.status === "inactive" ? "selected" : ""}>${t("inactive")}</option>
          <option value="discontinued" ${c.status === "discontinued" ? "selected" : ""}>${t("discontinued")}</option></select>
        <div class="col-toggle"><button class="btn" data-cols>⚙ ${t("columns")}</button>
          <div class="col-menu">${columns.map((col) => `<label><input type="checkbox" data-col="${col.key}" ${c.hiddenCols.has(col.key) ? "" : "checked"}> ${esc(col.label)}</label>`).join("")}</div></div>
      </div>
      <div id="tbl">${UI.dataTable({ columns, rows, page: c.page, perPage: c.perPage, sort: c.sort, dir: c.dir, selectable: true, selected: c.selected, hiddenCols: c.hiddenCols })}</div>`;

    UI.wireTable(view, c, render);
    view.querySelector("[data-q]").addEventListener("input", debounce((e) => {
      c.q = e.target.value;
      c.page = 1;
      render();
      view.querySelector("[data-q]").focus();
    }));
    view.querySelector("[data-cat]").addEventListener("change", (e) => {
      c.category = e.target.value;
      c.page = 1;
      render();
    });
    view.querySelector("[data-status]").addEventListener("change", (e) => {
      c.status = e.target.value;
      c.page = 1;
      render();
    });
    const colsBtn = view.querySelector("[data-cols]");
    colsBtn.addEventListener("click", () => view.querySelector(".col-menu").classList.toggle("show"));
    view.querySelectorAll("[data-col]").forEach((cb) =>
      cb.addEventListener("change", () => {
        if (cb.checked) c.hiddenCols.delete(cb.dataset.col);
        else c.hiddenCols.add(cb.dataset.col);
        render();
      }),
    );
    view.querySelector("[data-add]").addEventListener("click", () => productForm(null, render));
    view.querySelector("[data-export]").addEventListener("click", () =>
      exportCSV("products.csv", get("products").map((p) => ({ ...p, category: localName(byId("categories", p.categoryId)) }))),
    );
    view.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => navigate(`/products/${b.dataset.view}`)));
    view.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => productForm(byId("products", b.dataset.edit), render)));
    view.querySelectorAll("[data-del]").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!(await UI.confirmDialog({ message: t("delete_warning") }))) return;
        await db.delete("products", b.dataset.del);
        await logActivity("DELETE", "product", `Deleted ${b.dataset.del}`);
        await reload(["products", "activityLog"]);
        UI.toast(t("deleted"));
        render();
      }),
    );
    view.querySelectorAll("[data-bulk]").forEach((b) =>
      b.addEventListener("click", async () => {
        const ids = [...c.selected];
        if (b.dataset.bulk === "clear") c.selected.clear();
        if (b.dataset.bulk === "export") exportCSV("products-selection.csv", get("products").filter((p) => ids.includes(p.id)));
        if (b.dataset.bulk === "delete") {
          if (!(await UI.confirmDialog({ message: `${ids.length} × ${t("delete_warning")}` }))) return;
          for (const id of ids) await db.delete("products", id);
          await reload("products");
          c.selected.clear();
          UI.toast(t("deleted"));
        }
        render();
      }),
    );
  };
  render();
}

function productForm(product, done) {
  const cats = get("categories");
  const brands = get("brands");
  const sups = get("suppliers");
  const p = product || {};
  UI.openModal({
    title: product ? `${t("edit")} — ${localName(product)}` : `${t("add")} ${t("products")}`,
    size: "lg",
    body: `<form id="pform" class="form-grid" novalidate>
      ${UI.field({ label: "الاسم (AR)", name: "nameAr", value: p.nameAr || "", required: true })}
      ${UI.field({ label: "Name (EN)", name: "nameEn", value: p.nameEn || "", required: true })}
      ${UI.field({ label: "Nom (FR)", name: "nameFr", value: p.nameFr || "" })}
      ${UI.field({ label: t("sku"), name: "sku", value: p.sku || nextSKU(), required: true })}
      ${UI.field({ label: t("barcode"), name: "barcode", value: p.barcode || "" })}
      ${UI.selectField({ label: t("category"), name: "categoryId", required: true, options: UI.selectOptions(cats, "id", localName, p.categoryId) })}
      ${UI.selectField({ label: t("brand"), name: "brandId", options: `<option value="">—</option>${UI.selectOptions(brands, "id", localName, p.brandId)}` })}
      ${UI.selectField({ label: t("supplier"), name: "supplierId", options: `<option value="">—</option>${UI.selectOptions(sups, "id", (s) => s.name, p.supplierId)}` })}
      ${UI.field({ label: t("unit"), name: "unit", value: p.unit || "piece" })}
      ${UI.field({ label: t("purchase_price"), name: "purchasePrice", type: "number", value: p.purchasePrice ?? 0, required: true, attrs: 'min="0" step="0.01"' })}
      ${UI.field({ label: t("selling_price"), name: "sellingPrice", type: "number", value: p.sellingPrice ?? 0, required: true, attrs: 'min="0" step="0.01"' })}
      ${UI.field({ label: t("quantity"), name: "quantity", type: "number", value: p.quantity ?? 0, attrs: 'min="0"' })}
      ${UI.field({ label: t("min_stock"), name: "minimumStock", type: "number", value: p.minimumStock ?? state.settings.defaultMinimumStock, attrs: 'min="0"' })}
      ${UI.field({ label: t("max_stock"), name: "maximumStock", type: "number", value: p.maximumStock ?? 100, attrs: 'min="0"' })}
      ${UI.field({ label: t("reorder_point"), name: "reorderPoint", type: "number", value: p.reorderPoint ?? state.settings.defaultReorderPoint, attrs: 'min="0"' })}
      ${UI.selectField({
        label: t("status"),
        name: "status",
        options: ["active", "inactive", "discontinued"].map((s) => `<option value="${s}" ${p.status === s ? "selected" : ""}>${t(s)}</option>`).join(""),
      })}
      <div class="field full"><label for="f_image">${t("image")}</label><input class="input" id="f_image" type="file" accept="image/*" name="imageFile">
        ${p.image ? `<img src="${p.image}" alt="" style="height:64px;margin-top:8px;border-radius:8px">` : ""}</div>
      ${UI.textareaField({ label: `${t("description")} (AR)`, name: "descriptionAr", value: p.descriptionAr || "" })}
      ${UI.textareaField({ label: `${t("description")} (EN)`, name: "descriptionEn", value: p.descriptionEn || "" })}
    </form>`,
    footer: `<button class="btn" data-close>${t("cancel")}</button><button class="btn btn-primary" data-save>${t("save")}</button>`,
    onMount(modal) {
      modal.querySelector("[data-save]").addEventListener("click", async () => {
        const form = modal.querySelector("#pform");
        const ok = UI.validate(form, {
          sku: (v) => (get("products").some((x) => x.sku === v && x.id !== p.id) ? "Duplicate SKU" : ""),
          barcode: (v) => (v && get("products").some((x) => x.barcode === v && x.id !== p.id) ? "Duplicate barcode" : ""),
          sellingPrice: (v, all) => (Number(v) < Number(all.purchasePrice) ? "Selling price below purchase price" : ""),
        });
        if (!ok) return;
        const data = UI.formData(form);
        const file = form.querySelector('[name="imageFile"]').files[0];
        const image = file ? await readFileDataURL(file) : p.image || "";
        const payload = {
          ...p,
          ...data,
          image,
          purchasePrice: Number(data.purchasePrice),
          sellingPrice: Number(data.sellingPrice),
          quantity: Number(data.quantity),
          minimumStock: Number(data.minimumStock),
          maximumStock: Number(data.maximumStock),
          reorderPoint: Number(data.reorderPoint),
          updatedAt: new Date().toISOString(),
        };
        delete payload.imageFile;
        if (product) await db.put("products", payload);
        else await db.create("products", { ...payload, id: uid("prd"), createdAt: new Date().toISOString() });
        await logActivity(product ? "UPDATE" : "CREATE", "product", `${payload.sku} — ${payload.nameEn}`);
        await reload(["products", "inventory", "activityLog"]);
        UI.closeModal();
        UI.toast(t("saved"));
        done();
      });
    },
  });
}

async function productDetails(id, view) {
  const p = byId("products", id);
  if (!p) {
    view.innerHTML = UI.emptyState(t("empty_title"));
    return;
  }
  const movements = get("stockMovements").filter((m) => m.productId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const soldItems = get("saleItems").filter((i) => i.productId === id);
  const sold = sum(soldItems, (i) => i.quantity);
  const days = 60;
  const avgDaily = sold / days;
  const remaining = avgDaily > 0 ? Math.round(p.quantity / avgDaily) : null;
  const margin = p.sellingPrice ? ((p.sellingPrice - p.purchasePrice) / p.sellingPrice) * 100 : 0;
  const batches = productBatches(id);
  view.innerHTML = `
    ${head(localName(p), `${p.sku} · ${esc(p.barcode || "")}`, `<button class="btn" data-back>← ${t("products")}</button><button class="btn btn-primary" data-move>± ${t("adjust")}</button>`)}
    <div class="grid g4" style="margin-bottom:14px">
      ${UI.statCard({ label: t("stock"), value: num(p.quantity), hint: p.unit, icon: "📦" })}
      ${UI.statCard({ label: t("inventory_value"), value: money(p.quantity * p.purchasePrice), icon: "💰" })}
      ${UI.statCard({ label: t("profit_margin"), value: pct(margin), hint: `${money(p.sellingPrice - p.purchasePrice)} / ${t("unit")}`, icon: "💹" })}
      ${UI.statCard({ label: t("days_remaining"), value: remaining === null ? "—" : num(remaining), hint: t("simple_forecast"), icon: "⏱" })}
    </div>
    <div class="grid g2">
      ${UI.card({
        title: t("details"),
        body: `${p.image ? `<img src="${p.image}" alt="${esc(localName(p))}" style="height:110px;border-radius:10px;margin-bottom:10px">` : ""}
          <div class="kv"><span>${t("category")}</span><span>${esc(localName(byId("categories", p.categoryId)))}</span></div>
          <div class="kv"><span>${t("brand")}</span><span>${esc(localName(byId("brands", p.brandId)))}</span></div>
          <div class="kv"><span>${t("supplier")}</span><span>${esc(byId("suppliers", p.supplierId)?.name || "—")}</span></div>
          <div class="kv"><span>${t("purchase_price")}</span><span>${money(p.purchasePrice)}</span></div>
          <div class="kv"><span>${t("selling_price")}</span><span>${money(p.sellingPrice)}</span></div>
          <div class="kv"><span>${t("min_stock")} / ${t("reorder_point")}</span><span>${num(p.minimumStock)} / ${num(p.reorderPoint)}</span></div>
          <div class="kv"><span>${t("status")}</span><span>${statusBadge(p)} ${UI.badge(t(p.status), "info")}</span></div>
          <div class="kv"><span>${t("avg_daily_sales")}</span><span>${avgDaily.toFixed(2)}</span></div>
          <div class="kv"><span>${t("barcode")}</span><span><canvas id="qr" width="90" height="90"></canvas></span></div>`,
      })}
      ${UI.card({
        title: `${t("batches")} (FEFO)`,
        body: batches.length
          ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>${t("batch_number")}</th><th>${t("expiry_date")}</th><th class="num">${t("quantity")}</th><th>${t("status")}</th></tr></thead>
            <tbody>${batches
              .map((b) => {
                const meta = EXPIRY_META[expiryStatus(b.expiryDate)];
                return `<tr><td>${esc(b.batchNumber)}</td><td>${fmtDate(b.expiryDate)}</td><td class="num">${num(b.quantity)}</td><td>${UI.badge(t(meta.key), meta.tone)}</td></tr>`;
              })
              .join("")}</tbody></table></div>`
          : UI.emptyState(t("empty_title"), "", "🧪"),
      })}
      ${UI.card({
        title: t("movements"),
        body: movements.length
          ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>${t("date")}</th><th>${t("movement_type")}</th><th class="num">${t("quantity")}</th><th>${t("reason")}</th></tr></thead>
              <tbody>${movements
                .slice(0, 20)
                .map((m) => `<tr><td>${fmtDateTime(m.createdAt)}</td><td>${UI.badge(m.type, m.quantity > 0 ? "success" : "danger")}</td><td class="num">${num(m.quantity)}</td><td>${esc(m.reason || "—")}</td></tr>`)
                .join("")}</tbody></table></div>`
          : UI.emptyState(t("empty_title"), "", "🔁"),
      })}
      ${UI.card({
        title: t("history"),
        body: `<div class="timeline">${soldItems
          .slice(-8)
          .reverse()
          .map((i) => {
            const sale = byId("sales", i.saleId);
            return `<div class="timeline-item"><span class="dotline"></span><div><strong>${esc(sale?.invoiceNumber || "—")}</strong> · ${num(i.quantity)} × ${money(i.price)}<div class="stat-hint">${fmtDate(sale?.date)}</div></div></div>`;
          })
          .join("") || UI.emptyState(t("empty_title"), "", "🧾")}</div>`,
      })}
    </div>`;
  view.querySelector("[data-back]").addEventListener("click", () => navigate("/products"));
  view.querySelector("[data-move]").addEventListener("click", () => movementForm(p.id, () => productDetails(id, view)));
  drawQR(view.querySelector("#qr"), p.barcode || p.sku);
}

/** Tiny deterministic QR-like matrix (offline, no libraries) for quick visual codes. */
function drawQR(canvas, text) {
  if (!canvas) return;
  const size = 21;
  const cell = canvas.width / size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  let h = 7;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      h = (h * 1103515245 + 12345) >>> 0;
      const finder = (x < 7 && y < 7) || (x > size - 8 && y < 7) || (x < 7 && y > size - 8);
      const on = finder ? x % 6 === 0 || y % 6 === 0 || (x > 1 && x < 5 && y > 1 && y < 5) : (h >> 8) % 2 === 0;
      if (on) ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
}

/* ------------------------------- Categories ------------------------------- */
export async function categories(route, view) {
  const render = () => {
    const rows = get("categories").map((c) => ({ ...c, count: get("products").filter((p) => p.categoryId === c.id).length }));
    view.innerHTML = `${head(t("categories"), `${rows.length} ${t("rows")}`, `<button class="btn btn-primary" data-add>+ ${t("add")}</button>`)}
      ${UI.dataTable({
        columns: [
          { key: "nameAr", label: "AR" },
          { key: "nameEn", label: "EN" },
          { key: "nameFr", label: "FR" },
          { key: "count", label: t("products"), className: "num" },
          { key: "a", label: t("actions"), sortable: false, render: (r) => `<div class="row-actions"><button class="btn btn-sm" data-edit="${r.id}">✏️</button><button class="btn btn-sm btn-danger" data-del="${r.id}">🗑</button></div>` },
        ],
        rows,
        perPage: 12,
      })}`;
    view.querySelector("[data-add]").addEventListener("click", () => catForm(null, render));
    view.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => catForm(byId("categories", b.dataset.edit), render)));
    view.querySelectorAll("[data-del]").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!(await UI.confirmDialog({ message: t("delete_warning") }))) return;
        await db.delete("categories", b.dataset.del);
        await reload("categories");
        UI.toast(t("deleted"));
        render();
      }),
    );
  };
  render();
}

function catForm(cat, done) {
  const c = cat || {};
  UI.openModal({
    title: cat ? t("edit") : t("add"),
    body: `<form id="cf" class="form-grid">
      ${UI.field({ label: "الاسم (AR)", name: "nameAr", value: c.nameAr || "", required: true })}
      ${UI.field({ label: "Name (EN)", name: "nameEn", value: c.nameEn || "", required: true })}
      ${UI.field({ label: "Nom (FR)", name: "nameFr", value: c.nameFr || "", full: true })}</form>`,
    footer: `<button class="btn" data-close>${t("cancel")}</button><button class="btn btn-primary" data-save>${t("save")}</button>`,
    onMount(modal) {
      modal.querySelector("[data-save]").addEventListener("click", async () => {
        const form = modal.querySelector("#cf");
        if (!UI.validate(form)) return;
        const data = UI.formData(form);
        if (cat) await db.put("categories", { ...cat, ...data });
        else await db.create("categories", { id: uid("cat"), ...data, createdAt: new Date().toISOString() });
        await reload("categories");
        UI.closeModal();
        UI.toast(t("saved"));
        done();
      });
    },
  });
}

/* -------------------------------- Inventory ------------------------------- */
export async function inventory(route, view) {
  const c = ctrl("inventory", { statusFilter: "", perPage: 12 });
  const render = () => {
    const all = get("products");
    const counts = { healthy: 0, low: 0, critical: 0, out: 0, over: 0 };
    all.forEach((p) => (counts[stockStatus(p)] += 1));
    const rows = all
      .filter((p) => (!c.statusFilter || stockStatus(p) === c.statusFilter) && (!c.q || match(localName(p), c.q) || match(p.sku, c.q)))
      .map((p) => ({ ...p, name: localName(p), value: p.quantity * p.purchasePrice, st: stockStatus(p) }));
    c.visibleIds = rows.map((r) => r.id);
    view.innerHTML = `${head(t("inventory"), t("inventory_value") + ": " + money(sum(all, (p) => p.quantity * p.purchasePrice)), `<button class="btn" data-export>⬇ ${t("export_csv")}</button><button class="btn btn-primary" data-move>± ${t("adjust")}</button>`)}
      <div class="kpi-grid">
        ${UI.statCard({ label: t("total_stock"), value: num(sum(all, (p) => p.quantity)), icon: "📦" })}
        ${UI.statCard({ label: t("healthy"), value: num(counts.healthy), icon: "✅" })}
        ${UI.statCard({ label: t("low_stock"), value: num(counts.low), icon: "⚠️" })}
        ${UI.statCard({ label: t("critical_stock"), value: num(counts.critical), icon: "🚨" })}
        ${UI.statCard({ label: t("out_of_stock"), value: num(counts.out), icon: "⛔" })}
        ${UI.statCard({ label: t("overstocked"), value: num(counts.over), icon: "📈" })}
      </div>
      <div class="toolbar">
        <div class="search" style="flex:1;min-width:200px"><span class="sic">🔍</span><input class="search-input" data-q value="${esc(c.q)}" placeholder="${t("search")}"></div>
        <select class="select" data-st style="max-width:200px"><option value="">${t("all")}</option>
          ${Object.keys(STATUS_META).map((k) => `<option value="${k}" ${c.statusFilter === k ? "selected" : ""}>${t(STATUS_META[k].key)}</option>`).join("")}</select>
      </div>
      ${UI.dataTable({
        columns: [
          { key: "sku", label: t("sku") },
          { key: "name", label: t("name") },
          { key: "quantity", label: t("stock"), className: "num", render: (r) => num(r.quantity) },
          { key: "minimumStock", label: t("min_stock"), className: "num" },
          { key: "value", label: t("inventory_value"), className: "num", render: (r) => money(r.value) },
          { key: "st", label: t("status"), render: (r) => statusBadge(r) },
          { key: "a", label: t("actions"), sortable: false, render: (r) => `<button class="btn btn-sm" data-move-id="${r.id}">±</button>` },
        ],
        rows,
        page: c.page,
        perPage: c.perPage,
        sort: c.sort,
        dir: c.dir,
      })}`;
    UI.wireTable(view, c, render);
    view.querySelector("[data-q]").addEventListener("input", debounce((e) => {
      c.q = e.target.value;
      c.page = 1;
      render();
      view.querySelector("[data-q]").focus();
    }));
    view.querySelector("[data-st]").addEventListener("change", (e) => {
      c.statusFilter = e.target.value;
      c.page = 1;
      render();
    });
    view.querySelector("[data-export]").addEventListener("click", () =>
      exportCSV("inventory.csv", rows.map((r) => ({ sku: r.sku, name: r.name, quantity: r.quantity, value: r.value, status: r.st }))),
    );
    view.querySelector("[data-move]").addEventListener("click", () => movementForm(null, render));
    view.querySelectorAll("[data-move-id]").forEach((b) => b.addEventListener("click", () => movementForm(b.dataset.moveId, render)));
  };
  render();
}

export function movementForm(productId, done) {
  UI.openModal({
    title: t("movement_type"),
    body: `<form id="mf" class="form-grid">
      ${UI.selectField({ label: t("products"), name: "productId", required: true, full: true, options: UI.selectOptions(get("products"), "id", (p) => `${localName(p)} (${p.sku}) — ${p.quantity}`, productId) })}
      ${UI.selectField({ label: t("movement_type"), name: "type", options: MOVEMENT_TYPES.map((m) => `<option value="${m}">${m}</option>`).join("") })}
      ${UI.field({ label: t("quantity"), name: "quantity", type: "number", value: 1, required: true, attrs: 'min="1"' })}
      ${UI.field({ label: t("batch_number"), name: "batchNumber", value: "", hint: "STOCK_IN / PURCHASE / RETURN" })}
      ${UI.field({ label: t("expiry_date"), name: "expiryDate", type: "date" })}
      ${UI.textareaField({ label: t("reason"), name: "reason" })}</form>`,
    footer: `<button class="btn" data-close>${t("cancel")}</button><button class="btn btn-primary" data-save>${t("save")}</button>`,
    onMount(modal) {
      modal.querySelector("[data-save]").addEventListener("click", async () => {
        const form = modal.querySelector("#mf");
        if (!UI.validate(form, { quantity: (v) => (Number(v) <= 0 ? "Quantity must be > 0" : "") })) return;
        const d = UI.formData(form);
        try {
          await applyStockChange({
            productId: d.productId,
            type: d.type,
            quantity: Number(d.quantity),
            reason: d.reason,
            batch: { batchNumber: d.batchNumber, expiryDate: d.expiryDate },
          });
          UI.closeModal();
          UI.toast(t("saved"));
          done();
        } catch (err) {
          UI.toast(err.message, "error", 4200);
        }
      });
    },
  });
}

/* ------------------------------- Movements -------------------------------- */
export async function movements(route, view) {
  const c = ctrl("movements", { sort: "createdAt", dir: "desc", perPage: 15, type: "" });
  const render = () => {
    const rows = get("stockMovements")
      .filter((m) => (!c.type || m.type === c.type) && (!c.q || match(prodName(m.productId), c.q) || match(m.reason, c.q)))
      .map((m) => ({ ...m, name: prodName(m.productId) }))
      .sort((a, b) => (c.dir === "desc" ? String(b[c.sort]).localeCompare(String(a[c.sort])) : String(a[c.sort]).localeCompare(String(b[c.sort]))));
    view.innerHTML = `${head(t("movements"), `${rows.length} ${t("rows")}`, `<button class="btn" data-print>🖨</button><button class="btn" data-export>⬇ CSV</button><button class="btn btn-primary" data-add>± ${t("adjust")}</button>`)}
      <div class="toolbar">
        <div class="search" style="flex:1;min-width:200px"><span class="sic">🔍</span><input class="search-input" data-q value="${esc(c.q)}" placeholder="${t("search")}"></div>
        <select class="select" data-type style="max-width:200px"><option value="">${t("all")}</option>${MOVEMENT_TYPES.map((m) => `<option ${c.type === m ? "selected" : ""}>${m}</option>`).join("")}</select>
      </div>
      ${UI.dataTable({
        columns: [
          { key: "createdAt", label: t("date"), render: (r) => fmtDateTime(r.createdAt) },
          { key: "name", label: t("products") },
          { key: "type", label: t("movement_type"), render: (r) => UI.badge(r.type, r.quantity > 0 ? "success" : "danger") },
          { key: "quantity", label: t("quantity"), className: "num", render: (r) => num(r.quantity) },
          { key: "balanceAfter", label: t("stock"), className: "num", render: (r) => num(r.balanceAfter ?? 0) },
          { key: "reason", label: t("reason") },
          { key: "b", label: t("fefo_used"), sortable: false, render: (r) => (r.batches?.length ? r.batches.map((b) => `${esc(b.batchNumber || "")}×${b.quantity}`).join(", ") : "—") },
        ],
        rows,
        page: c.page,
        perPage: c.perPage,
        sort: c.sort,
        dir: c.dir,
      })}`;
    UI.wireTable(view, c, render);
    view.querySelector("[data-q]").addEventListener("input", debounce((e) => {
      c.q = e.target.value;
      c.page = 1;
      render();
      view.querySelector("[data-q]").focus();
    }));
    view.querySelector("[data-type]").addEventListener("change", (e) => {
      c.type = e.target.value;
      render();
    });
    view.querySelector("[data-add]").addEventListener("click", () => movementForm(null, render));
    view.querySelector("[data-print]").addEventListener("click", () => window.print());
    view.querySelector("[data-export]").addEventListener("click", () =>
      exportCSV("stock-movements.csv", rows.map((r) => ({ date: r.createdAt, product: r.name, type: r.type, quantity: r.quantity, reason: r.reason }))),
    );
  };
  render();
}

/* --------------------------------- Batches -------------------------------- */
export async function batches(route, view) {
  const c = ctrl("batches", { sort: "expiryDate", perPage: 12 });
  const render = () => {
    const rows = get("batches")
      .filter((b) => !c.q || match(b.batchNumber, c.q) || match(prodName(b.productId), c.q))
      .map((b) => ({ ...b, name: prodName(b.productId), st: expiryStatus(b.expiryDate) }));
    view.innerHTML = `${head(t("batches"), `${rows.length} ${t("rows")}`, `<button class="btn" data-export>⬇ CSV</button><button class="btn btn-primary" data-add>+ ${t("add")}</button>`)}
      <div class="toolbar"><div class="search" style="flex:1"><span class="sic">🔍</span><input class="search-input" data-q value="${esc(c.q)}" placeholder="${t("search")}"></div></div>
      ${UI.dataTable({
        columns: [
          { key: "batchNumber", label: t("batch_number") },
          { key: "name", label: t("products") },
          { key: "manufacturingDate", label: t("manufacturing_date"), render: (r) => fmtDate(r.manufacturingDate) },
          { key: "expiryDate", label: t("expiry_date"), render: (r) => fmtDate(r.expiryDate) },
          { key: "quantity", label: t("quantity"), className: "num", render: (r) => num(r.quantity) },
          { key: "st", label: t("status"), render: (r) => UI.badge(t(EXPIRY_META[r.st].key), EXPIRY_META[r.st].tone) },
          { key: "a", label: t("actions"), sortable: false, render: (r) => `<button class="btn btn-sm btn-danger" data-del="${r.id}">🗑</button>` },
        ],
        rows,
        page: c.page,
        perPage: c.perPage,
        sort: c.sort,
        dir: c.dir,
      })}`;
    UI.wireTable(view, c, render);
    view.querySelector("[data-q]").addEventListener("input", debounce((e) => {
      c.q = e.target.value;
      render();
      view.querySelector("[data-q]").focus();
    }));
    view.querySelector("[data-export]").addEventListener("click", () => exportCSV("batches.csv", rows));
    view.querySelector("[data-add]").addEventListener("click", () => movementForm(null, render));
    view.querySelectorAll("[data-del]").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!(await UI.confirmDialog({ message: t("delete_warning") }))) return;
        await db.delete("batches", b.dataset.del);
        await reload("batches");
        render();
      }),
    );
  };
  render();
}

/* ------------------------------ Expiry Center ----------------------------- */
export async function expiry(route, view) {
  const rows = get("batches")
    .filter((b) => b.quantity > 0 && b.expiryDate)
    .map((b) => ({ ...b, name: prodName(b.productId), days: daysUntil(b.expiryDate), st: expiryStatus(b.expiryDate) }))
    .sort((a, b) => a.days - b.days);
  const bucket = (max, min = -99999) => rows.filter((r) => r.days <= max && r.days > min).length;
  view.innerHTML = `${head(t("expiry"), t("expiry_overview"), `<button class="btn" data-print>🖨 ${t("print")}</button><button class="btn" data-export>⬇ CSV</button>`)}
    <div class="expiry-tiles">
      ${UI.statCard({ label: t("expired"), value: num(bucket(-1)), icon: "☠️" })}
      ${UI.statCard({ label: "≤ 7", value: num(bucket(7, -1)), icon: "🚨" })}
      ${UI.statCard({ label: "≤ 30", value: num(bucket(30, 7)), icon: "⚠️" })}
      ${UI.statCard({ label: "≤ 60", value: num(bucket(60, 30)), icon: "🕒" })}
      ${UI.statCard({ label: "≤ 90", value: num(bucket(90, 60)), icon: "📅" })}
      ${UI.statCard({ label: t("safe"), value: num(rows.filter((r) => r.days > 90).length), icon: "✅" })}
    </div>
    ${UI.dataTable({
      columns: [
        { key: "batchNumber", label: t("batch_number") },
        { key: "name", label: t("products") },
        { key: "expiryDate", label: t("expiry_date"), render: (r) => fmtDate(r.expiryDate) },
        { key: "days", label: t("days_remaining"), className: "num", render: (r) => num(r.days) },
        { key: "quantity", label: t("quantity"), className: "num", render: (r) => num(r.quantity) },
        { key: "st", label: t("status"), render: (r) => UI.badge(t(EXPIRY_META[r.st].key), EXPIRY_META[r.st].tone) },
        { key: "a", label: t("actions"), sortable: false, render: (r) => `<button class="btn btn-sm btn-danger" data-dispose="${r.productId}" data-qty="${r.quantity}">${t("expired")}</button>` },
      ],
      rows,
      perPage: 15,
    })}`;
  view.querySelector("[data-print]").addEventListener("click", () => window.print());
  view.querySelector("[data-export]").addEventListener("click", () => exportCSV("expiry-report.csv", rows));
  view.querySelectorAll("[data-dispose]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!(await UI.confirmDialog({ message: t("are_you_sure") }))) return;
      try {
        await applyStockChange({ productId: b.dataset.dispose, type: "EXPIRED", quantity: Number(b.dataset.qty), reason: "Expiry disposal" });
        UI.toast(t("saved"));
        expiry(route, view);
      } catch (e) {
        UI.toast(e.message, "error");
      }
    }),
  );
}

/* ---------------------------- Suppliers/Customers -------------------------- */
export async function suppliers(route, view) {
  const c = ctrl("suppliers", { perPage: 10 });
  const render = () => {
    const rows = get("suppliers")
      .filter((s) => !c.q || match(s.name, c.q) || match(s.company, c.q) || match(s.phone, c.q))
      .map((s) => {
        const pos = get("purchaseOrders").filter((p) => p.supplierId === s.id);
        return {
          ...s,
          orders: pos.length,
          totalValue: sum(pos, (p) => p.total),
          outstanding: sum(pos.filter((p) => p.paymentStatus !== "paid"), (p) => p.total),
          last: pos.map((p) => p.date).sort().pop(),
        };
      });
    view.innerHTML = `${head(t("suppliers"), `${rows.length} ${t("rows")}`, `<button class="btn" data-export>⬇ CSV</button><button class="btn btn-primary" data-add>+ ${t("add")}</button>`)}
      <div class="toolbar"><div class="search" style="flex:1"><span class="sic">🔍</span><input class="search-input" data-q value="${esc(c.q)}" placeholder="${t("search")}"></div></div>
      ${UI.dataTable({
        columns: [
          { key: "name", label: t("name") },
          { key: "company", label: t("company") },
          { key: "phone", label: t("phone") },
          { key: "city", label: t("city") },
          { key: "orders", label: t("orders"), className: "num" },
          { key: "totalValue", label: t("total"), className: "num", render: (r) => money(r.totalValue) },
          { key: "outstanding", label: t("outstanding"), className: "num", render: (r) => money(r.outstanding) },
          { key: "last", label: t("last_purchase"), render: (r) => fmtDate(r.last) },
          { key: "a", label: t("actions"), sortable: false, render: (r) => `<div class="row-actions"><button class="btn btn-sm" data-edit="${r.id}">✏️</button><button class="btn btn-sm btn-danger" data-del="${r.id}">🗑</button></div>` },
        ],
        rows,
        page: c.page,
        perPage: c.perPage,
        sort: c.sort,
        dir: c.dir,
      })}`;
    UI.wireTable(view, c, render);
    view.querySelector("[data-q]").addEventListener("input", debounce((e) => {
      c.q = e.target.value;
      render();
      view.querySelector("[data-q]").focus();
    }));
    view.querySelector("[data-export]").addEventListener("click", () => exportCSV("suppliers.csv", get("suppliers")));
    view.querySelector("[data-add]").addEventListener("click", () => partyForm("suppliers", null, render));
    view.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => partyForm("suppliers", byId("suppliers", b.dataset.edit), render)));
    view.querySelectorAll("[data-del]").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!(await UI.confirmDialog({ message: t("delete_warning") }))) return;
        await db.delete("suppliers", b.dataset.del);
        await reload("suppliers");
        render();
      }),
    );
  };
  render();
}

export async function customers(route, view) {
  const c = ctrl("customers", { perPage: 10 });
  const render = () => {
    const rows = get("customers")
      .filter((s) => !c.q || match(s.name, c.q) || match(s.phone, c.q))
      .map((cu) => {
        const list = get("sales").filter((s) => s.customerId === cu.id);
        return { ...cu, orders: list.length, spent: sum(list, (s) => s.total), last: list.map((s) => s.date).sort().pop() };
      });
    view.innerHTML = `${head(t("customers"), `${rows.length} ${t("rows")}`, `<button class="btn" data-export>⬇ CSV</button><button class="btn btn-primary" data-add>+ ${t("add")}</button>`)}
      <div class="toolbar"><div class="search" style="flex:1"><span class="sic">🔍</span><input class="search-input" data-q value="${esc(c.q)}" placeholder="${t("search")}"></div></div>
      ${UI.dataTable({
        columns: [
          { key: "name", label: t("name") },
          { key: "phone", label: t("phone") },
          { key: "city", label: t("city") },
          { key: "orders", label: t("orders"), className: "num" },
          { key: "spent", label: t("total_spent"), className: "num", render: (r) => money(r.spent) },
          { key: "last", label: t("last_purchase"), render: (r) => fmtDate(r.last) },
          { key: "a", label: t("actions"), sortable: false, render: (r) => `<div class="row-actions"><button class="btn btn-sm" data-edit="${r.id}">✏️</button><button class="btn btn-sm btn-danger" data-del="${r.id}">🗑</button></div>` },
        ],
        rows,
        page: c.page,
        perPage: c.perPage,
        sort: c.sort,
        dir: c.dir,
      })}`;
    UI.wireTable(view, c, render);
    view.querySelector("[data-q]").addEventListener("input", debounce((e) => {
      c.q = e.target.value;
      render();
      view.querySelector("[data-q]").focus();
    }));
    view.querySelector("[data-export]").addEventListener("click", () => exportCSV("customers.csv", get("customers")));
    view.querySelector("[data-add]").addEventListener("click", () => partyForm("customers", null, render));
    view.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => partyForm("customers", byId("customers", b.dataset.edit), render)));
    view.querySelectorAll("[data-del]").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!(await UI.confirmDialog({ message: t("delete_warning") }))) return;
        await db.delete("customers", b.dataset.del);
        await reload("customers");
        render();
      }),
    );
  };
  render();
}

function partyForm(store, item, done) {
  const p = item || {};
  const isSupplier = store === "suppliers";
  UI.openModal({
    title: `${item ? t("edit") : t("add")} — ${t(isSupplier ? "supplier" : "customer")}`,
    body: `<form id="pf" class="form-grid">
      ${UI.field({ label: t("name"), name: "name", value: p.name || "", required: true })}
      ${isSupplier ? UI.field({ label: t("company"), name: "company", value: p.company || "" }) : ""}
      ${UI.field({ label: t("phone"), name: "phone", value: p.phone || "" })}
      ${UI.field({ label: t("email"), name: "email", type: "email", value: p.email || "" })}
      ${UI.field({ label: t("address"), name: "address", value: p.address || "" })}
      ${UI.field({ label: t("city"), name: "city", value: p.city || "" })}
      ${UI.textareaField({ label: t("notes"), name: "notes", value: p.notes || "" })}</form>`,
    footer: `<button class="btn" data-close>${t("cancel")}</button><button class="btn btn-primary" data-save>${t("save")}</button>`,
    onMount(modal) {
      modal.querySelector("[data-save]").addEventListener("click", async () => {
        const form = modal.querySelector("#pf");
        if (!UI.validate(form, { email: (v) => (v && !/^\S+@\S+\.\S+$/.test(v) ? "Invalid email" : "") })) return;
        const data = UI.formData(form);
        if (item) await db.put(store, { ...item, ...data });
        else await db.create(store, { id: uid(store.slice(0, 3)), ...data, status: "active", createdAt: new Date().toISOString() });
        await reload(store);
        UI.closeModal();
        UI.toast(t("saved"));
        done();
      });
    },
  });
}

/* -------------------------------- Purchases ------------------------------- */
export async function purchases(route, view) {
  const c = ctrl("purchases", { sort: "date", dir: "desc", perPage: 10 });
  const render = () => {
    const rows = get("purchaseOrders")
      .filter((p) => !c.q || match(p.poNumber, c.q) || match(byId("suppliers", p.supplierId)?.name, c.q))
      .map((p) => ({ ...p, supplier: byId("suppliers", p.supplierId)?.name || "—" }))
      .sort((a, b) => (c.dir === "desc" ? String(b[c.sort]).localeCompare(String(a[c.sort])) : String(a[c.sort]).localeCompare(String(b[c.sort]))));
    view.innerHTML = `${head(t("purchases"), `${rows.length} ${t("rows")}`, `<button class="btn" data-export>⬇ CSV</button><button class="btn btn-primary" data-add>+ ${t("create_po")}</button>`)}
      <div class="toolbar"><div class="search" style="flex:1"><span class="sic">🔍</span><input class="search-input" data-q value="${esc(c.q)}" placeholder="${t("search")}"></div></div>
      ${UI.dataTable({
        columns: [
          { key: "poNumber", label: t("po_number") },
          { key: "supplier", label: t("supplier") },
          { key: "date", label: t("date"), render: (r) => fmtDate(r.date) },
          { key: "total", label: t("total"), className: "num", render: (r) => money(r.total) },
          { key: "paymentStatus", label: t("payment_status"), render: (r) => UI.badge(t(r.paymentStatus), r.paymentStatus === "paid" ? "success" : "warning") },
          { key: "status", label: t("order_status"), render: (r) => UI.badge(t(r.status), r.status === "received" ? "success" : r.status === "cancelled" ? "danger" : "info") },
          {
            key: "a",
            label: t("actions"),
            sortable: false,
            render: (r) => `<div class="row-actions"><button class="btn btn-sm" data-open="${r.id}">👁</button>
              ${r.status !== "received" && r.status !== "cancelled" ? `<button class="btn btn-sm btn-primary" data-recv="${r.id}">${t("receive")}</button>` : ""}
              <button class="btn btn-sm btn-danger" data-del="${r.id}">🗑</button></div>`,
          },
        ],
        rows,
        page: c.page,
        perPage: c.perPage,
        sort: c.sort,
        dir: c.dir,
      })}`;
    UI.wireTable(view, c, render);
    view.querySelector("[data-q]").addEventListener("input", debounce((e) => {
      c.q = e.target.value;
      render();
      view.querySelector("[data-q]").focus();
    }));
    view.querySelector("[data-export]").addEventListener("click", () => exportCSV("purchases.csv", rows));
    view.querySelector("[data-add]").addEventListener("click", () => purchaseForm(null, render));
    view.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => documentModal("purchase", b.dataset.open)));
    view.querySelectorAll("[data-recv]").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!(await UI.confirmDialog({ message: t("are_you_sure"), danger: false, confirmText: t("receive") }))) return;
        try {
          await receivePurchase(b.dataset.recv);
          UI.toast(t("received_done"));
          render();
        } catch (e) {
          UI.toast(e.message, "error");
        }
      }),
    );
    view.querySelectorAll("[data-del]").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!(await UI.confirmDialog({ message: t("delete_warning") }))) return;
        await db.delete("purchaseOrders", b.dataset.del);
        await reload("purchaseOrders");
        render();
      }),
    );
  };
  render();
}

function lineRowHTML(products, line = {}, priceField = "unitCost") {
  return `<div class="line-row" data-line>
    <div class="field"><select class="select" name="productId"><option value="">—</option>${UI.selectOptions(products, "id", (p) => `${localName(p)} (${p.sku})`, line.productId)}</select></div>
    <div class="field"><input class="input" name="quantity" type="number" min="1" value="${line.quantity ?? 1}"></div>
    <div class="field"><input class="input" name="${priceField}" type="number" min="0" step="0.01" value="${line.price ?? 0}"></div>
    <div class="field"><input class="input" name="discount" type="number" min="0" step="0.01" value="${line.discount ?? 0}"></div>
    <button class="btn btn-sm btn-danger" type="button" data-rm>✕</button>
  </div>`;
}

function collectLines(form, priceField) {
  return [...form.querySelectorAll("[data-line]")].map((row) => ({
    productId: row.querySelector('[name="productId"]').value,
    quantity: Number(row.querySelector('[name="quantity"]').value),
    price: Number(row.querySelector(`[name="${priceField}"]`).value),
    discount: Number(row.querySelector('[name="discount"]').value),
  }));
}

function purchaseForm(_, done, prefill = null) {
  const products = get("products");
  UI.openModal({
    title: t("create_po"),
    size: "lg",
    body: `<form id="pof">
      <div class="form-grid">
        ${UI.field({ label: t("po_number"), name: "poNumber", value: nextPONumber(), required: true })}
        ${UI.selectField({ label: t("supplier"), name: "supplierId", required: true, options: UI.selectOptions(get("suppliers"), "id", (s) => s.name, prefill?.supplierId) })}
        ${UI.field({ label: t("date"), name: "date", type: "date", value: todayISO(), required: true })}
        ${UI.selectField({ label: t("order_status"), name: "status", options: ["draft", "ordered", "partially_received", "received", "cancelled"].map((s) => `<option value="${s}">${t(s)}</option>`).join("") })}
      </div>
      <h3 style="margin:10px 0 6px;font-size:13px">${t("products")}</h3>
      <div id="lines">${lineRowHTML(products, prefill ? { productId: prefill.productId, quantity: prefill.quantity, price: prefill.price } : {})}</div>
      <button class="btn btn-sm" type="button" data-addline>+ ${t("add_line")}</button>
      <div class="form-grid" style="margin-top:12px">
        ${UI.field({ label: `${t("discount")}`, name: "discount", type: "number", value: 0, attrs: 'min="0"' })}
        ${UI.field({ label: `${t("tax")} %`, name: "tax", type: "number", value: 19, attrs: 'min="0"' })}
        ${UI.field({ label: t("shipping"), name: "shipping", type: "number", value: 0, attrs: 'min="0"' })}
        ${UI.selectField({ label: t("payment_status"), name: "paymentStatus", options: ["unpaid", "partial", "paid"].map((s) => `<option value="${s}">${t(s)}</option>`).join("") })}
        ${UI.textareaField({ label: t("notes"), name: "notes" })}
      </div></form>`,
    footer: `<button class="btn" data-close>${t("cancel")}</button><button class="btn btn-primary" data-save>${t("save")}</button>`,
    onMount(modal) {
      const form = modal.querySelector("#pof");
      const wire = () =>
        form.querySelectorAll("[data-rm]").forEach((b) =>
          b.addEventListener("click", () => {
            if (form.querySelectorAll("[data-line]").length > 1) b.closest("[data-line]").remove();
          }),
        );
      wire();
      form.querySelectorAll('[name="productId"]').forEach((sel) =>
        sel.addEventListener("change", () => {
          const p = byId("products", sel.value);
          if (p) sel.closest("[data-line]").querySelector('[name="unitCost"]').value = p.purchasePrice;
        }),
      );
      modal.querySelector("[data-addline]").addEventListener("click", () => {
        form.querySelector("#lines").insertAdjacentHTML("beforeend", lineRowHTML(products));
        wire();
        const last = [...form.querySelectorAll('[name="productId"]')].pop();
        last.addEventListener("change", () => {
          const p = byId("products", last.value);
          if (p) last.closest("[data-line]").querySelector('[name="unitCost"]').value = p.purchasePrice;
        });
      });
      modal.querySelector("[data-save]").addEventListener("click", async () => {
        if (!UI.validate(form)) return;
        const d = UI.formData(form);
        const lines = collectLines(form, "unitCost").filter((l) => l.productId && l.quantity > 0);
        if (!lines.length) return UI.toast(t("required_fields"), "error");
        const subtotal = sum(lines, (l) => l.quantity * l.price - l.discount);
        const taxAmount = ((subtotal - Number(d.discount)) * Number(d.tax)) / 100;
        const id = uid("pur");
        await db.create("purchaseOrders", {
          id,
          poNumber: d.poNumber,
          supplierId: d.supplierId,
          date: d.date,
          subtotal,
          discount: Number(d.discount),
          tax: Number(d.tax),
          taxAmount,
          shipping: Number(d.shipping),
          total: subtotal - Number(d.discount) + taxAmount + Number(d.shipping),
          paymentStatus: d.paymentStatus,
          status: d.status,
          notes: d.notes,
          createdAt: new Date().toISOString(),
        });
        await db.bulkInsert(
          "purchaseItems",
          lines.map((l) => ({
            id: uid("pit"),
            purchaseId: id,
            productId: l.productId,
            productName: localName(byId("products", l.productId)),
            sku: byId("products", l.productId)?.sku,
            quantity: l.quantity,
            receivedQuantity: 0,
            unitCost: l.price,
            total: l.quantity * l.price - l.discount,
          })),
        );
        await logActivity("CREATE", "purchase", `PO ${d.poNumber}`);
        await reload(["purchaseOrders", "purchaseItems", "activityLog"]);
        if (d.status === "received") await receivePurchase(id);
        UI.closeModal();
        UI.toast(t("saved"));
        done();
      });
    },
  });
}

function documentModal(kind, id) {
  const isSale = kind === "sale";
  const doc = byId(isSale ? "sales" : "purchaseOrders", id);
  const items = get(isSale ? "saleItems" : "purchaseItems").filter((i) => (isSale ? i.saleId : i.purchaseId) === id);
  const party = isSale ? byId("customers", doc.customerId) : byId("suppliers", doc.supplierId);
  UI.openModal({
    title: isSale ? `${t("invoice_number")} ${doc.invoiceNumber}` : `${t("po_number")} ${doc.poNumber}`,
    size: "lg",
    body: `<div id="printable">
      <div class="invoice-head"><div><strong>${esc(state.settings.storeName)}</strong><div class="stat-hint">${fmtDate(doc.date)}</div></div>
      <div><strong>${esc(party?.name || "—")}</strong><div class="stat-hint">${esc(party?.phone || "")}</div></div></div>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>${t("products")}</th><th class="num">${t("quantity")}</th><th class="num">${t("price")}</th><th class="num">${t("total")}</th></tr></thead>
      <tbody>${items
        .map((i) => `<tr><td>${esc(i.productName)}<div class="stat-hint">${esc(i.sku || "")} ${i.batches?.length ? `· FEFO: ${i.batches.map((b) => `${esc(b.batchNumber || "")}×${b.quantity}`).join(", ")}` : ""}</div></td>
        <td class="num">${num(i.quantity)}</td><td class="num">${money(i.price ?? i.unitCost)}</td><td class="num">${money(i.total)}</td></tr>`)
        .join("")}</tbody></table></div>
      <div class="totals">
        <div class="kv"><span>${t("subtotal")}</span><span>${money(doc.subtotal)}</span></div>
        <div class="kv"><span>${t("discount")}</span><span>${money(doc.discount)}</span></div>
        <div class="kv"><span>${t("tax")} ${doc.tax}%</span><span>${money(doc.taxAmount)}</span></div>
        ${!isSale ? `<div class="kv"><span>${t("shipping")}</span><span>${money(doc.shipping)}</span></div>` : ""}
        <div class="kv"><strong>${t("grand_total")}</strong><strong>${money(doc.total)}</strong></div>
      </div></div>`,
    footer: `<button class="btn" data-close>${t("close")}</button><button class="btn btn-primary" data-print>🖨 ${t("print")}</button>`,
    onMount(modal) {
      modal.querySelector("[data-print]").addEventListener("click", () => {
        const w = window.open("", "_blank", "width=820,height=900");
        w.document.write(`<html dir="${document.documentElement.dir}"><head><title>${esc(doc.invoiceNumber || doc.poNumber)}</title>
          <style>body{font-family:system-ui;padding:24px}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #ddd;padding:8px;text-align:start}.num{text-align:end}.kv{display:flex;justify-content:space-between;padding:4px 0}.totals{max-width:320px;margin-inline-start:auto}</style>
          </head><body>${modal.querySelector("#printable").innerHTML}</body></html>`);
        w.document.close();
        w.print();
      });
    },
  });
}

/* ---------------------------------- Sales --------------------------------- */
export async function sales(route, view) {
  const c = ctrl("sales", { sort: "date", dir: "desc", perPage: 10 });
  const render = () => {
    const rows = get("sales")
      .filter((s) => !c.q || match(s.invoiceNumber, c.q) || match(byId("customers", s.customerId)?.name, c.q))
      .map((s) => ({ ...s, customer: byId("customers", s.customerId)?.name || "—" }))
      .sort((a, b) => (c.dir === "desc" ? String(b[c.sort]).localeCompare(String(a[c.sort])) : String(a[c.sort]).localeCompare(String(b[c.sort]))));
    view.innerHTML = `${head(t("sales"), `${t("revenue")}: ${money(sum(rows, (r) => r.total))}`, `<button class="btn" data-export>⬇ CSV</button><button class="btn btn-primary" data-add>+ ${t("complete_sale")}</button>`)}
      <div class="toolbar"><div class="search" style="flex:1"><span class="sic">🔍</span><input class="search-input" data-q value="${esc(c.q)}" placeholder="${t("search")}"></div></div>
      ${UI.dataTable({
        columns: [
          { key: "invoiceNumber", label: t("invoice_number") },
          { key: "customer", label: t("customer") },
          { key: "date", label: t("date"), render: (r) => fmtDate(r.date) },
          { key: "total", label: t("total"), className: "num", render: (r) => money(r.total) },
          { key: "profit", label: t("gross_profit"), className: "num", render: (r) => money(r.profit ?? 0) },
          { key: "paymentMethod", label: t("payment_method"), render: (r) => UI.badge(t(r.paymentMethod), "info") },
          { key: "paymentStatus", label: t("payment_status"), render: (r) => UI.badge(t(r.paymentStatus), r.paymentStatus === "paid" ? "success" : "warning") },
          { key: "a", label: t("actions"), sortable: false, render: (r) => `<div class="row-actions"><button class="btn btn-sm" data-open="${r.id}">🧾</button><button class="btn btn-sm btn-danger" data-del="${r.id}">🗑</button></div>` },
        ],
        rows,
        page: c.page,
        perPage: c.perPage,
        sort: c.sort,
        dir: c.dir,
      })}`;
    UI.wireTable(view, c, render);
    view.querySelector("[data-q]").addEventListener("input", debounce((e) => {
      c.q = e.target.value;
      render();
      view.querySelector("[data-q]").focus();
    }));
    view.querySelector("[data-export]").addEventListener("click", () => exportCSV("sales.csv", rows));
    view.querySelector("[data-add]").addEventListener("click", () => saleForm(render));
    view.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => documentModal("sale", b.dataset.open)));
    view.querySelectorAll("[data-del]").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!(await UI.confirmDialog({ message: t("delete_warning") }))) return;
        await db.delete("sales", b.dataset.del);
        await reload("sales");
        render();
      }),
    );
  };
  render();
}

function saleForm(done) {
  const products = get("products").filter((p) => p.status === "active");
  UI.openModal({
    title: t("complete_sale"),
    size: "lg",
    body: `<form id="sf">
      <div class="form-grid">
        ${UI.field({ label: t("invoice_number"), name: "invoiceNumber", value: nextInvoiceNumber(), required: true })}
        ${UI.selectField({ label: t("customer"), name: "customerId", options: `<option value="">—</option>${UI.selectOptions(get("customers"), "id", (x) => x.name)}` })}
        ${UI.field({ label: t("date"), name: "date", type: "date", value: todayISO(), required: true })}
        ${UI.field({ label: t("scan"), name: "scan", value: "", hint: t("camera_unavailable") })}
      </div>
      <h3 style="margin:10px 0 6px;font-size:13px">${t("products")}</h3>
      <div id="lines">${lineRowHTML(products, {}, "price")}</div>
      <button class="btn btn-sm" type="button" data-addline>+ ${t("add_line")}</button>
      <div class="form-grid" style="margin-top:12px">
        ${UI.field({ label: t("discount"), name: "discount", type: "number", value: 0, attrs: 'min="0"' })}
        ${UI.field({ label: `${t("tax")} %`, name: "tax", type: "number", value: 19, attrs: 'min="0"' })}
        ${UI.selectField({ label: t("payment_method"), name: "paymentMethod", options: ["cash", "card", "bank_transfer", "other"].map((m) => `<option value="${m}">${t(m)}</option>`).join("") })}
        ${UI.selectField({ label: t("payment_status"), name: "paymentStatus", options: ["paid", "partial", "unpaid"].map((m) => `<option value="${m}">${t(m)}</option>`).join("") })}
        ${UI.textareaField({ label: t("notes"), name: "notes" })}
      </div>
      <div class="totals"><div class="kv"><strong>${t("grand_total")}</strong><strong id="gt">—</strong></div></div>
    </form>`,
    footer: `<button class="btn" data-close>${t("cancel")}</button><button class="btn btn-primary" data-save>${t("complete_sale")}</button>`,
    onMount(modal) {
      const form = modal.querySelector("#sf");
      const recalc = () => {
        const lines = collectLines(form, "price");
        const subtotal = sum(lines, (l) => l.quantity * l.price - l.discount);
        const d = UI.formData(form);
        const taxable = Math.max(0, subtotal - Number(d.discount || 0));
        form.querySelector("#gt").textContent = money(taxable + (taxable * Number(d.tax || 0)) / 100);
      };
      const wireLine = (row) => {
        row.querySelector("[data-rm]").addEventListener("click", () => {
          if (form.querySelectorAll("[data-line]").length > 1) row.remove();
          recalc();
        });
        row.querySelector('[name="productId"]').addEventListener("change", (e) => {
          const p = byId("products", e.target.value);
          if (p) row.querySelector('[name="price"]').value = p.sellingPrice;
          recalc();
        });
        row.querySelectorAll("input").forEach((i) => i.addEventListener("input", recalc));
      };
      form.querySelectorAll("[data-line]").forEach(wireLine);
      form.querySelectorAll('[name="discount"], [name="tax"]').forEach((i) => i.addEventListener("input", recalc));
      form.querySelector('[name="scan"]').addEventListener("change", (e) => {
        const code = e.target.value.trim();
        const p = get("products").find((x) => x.barcode === code || x.sku === code);
        if (!p) return UI.toast(t("error"), "error");
        form.querySelector("#lines").insertAdjacentHTML("beforeend", lineRowHTML(products, { productId: p.id, quantity: 1, price: p.sellingPrice }, "price"));
        const row = [...form.querySelectorAll("[data-line]")].pop();
        row.querySelector('[name="price"]').value = p.sellingPrice;
        wireLine(row);
        e.target.value = "";
        recalc();
      });
      modal.querySelector("[data-addline]").addEventListener("click", () => {
        form.querySelector("#lines").insertAdjacentHTML("beforeend", lineRowHTML(products, {}, "price"));
        wireLine([...form.querySelectorAll("[data-line]")].pop());
      });
      modal.querySelector("[data-save]").addEventListener("click", async () => {
        if (!UI.validate(form)) return;
        const d = UI.formData(form);
        try {
          const sale = await createSale({
            invoiceNumber: d.invoiceNumber,
            customerId: d.customerId,
            date: d.date,
            lines: collectLines(form, "price").filter((l) => l.productId && l.quantity > 0),
            discount: Number(d.discount),
            tax: Number(d.tax),
            paymentMethod: d.paymentMethod,
            paymentStatus: d.paymentStatus,
            notes: d.notes,
          });
          UI.closeModal();
          UI.toast(`${t("sale_done")} — ${sale.invoiceNumber}`);
          done();
        } catch (e) {
          UI.toast(e.message, "error", 4500);
        }
      });
    },
  });
}

/* -------------------------------- Analytics ------------------------------- */
export function abcAnalysis() {
  const items = get("products")
    .map((p) => {
      const sold = sum(get("saleItems").filter((i) => i.productId === p.id), (i) => i.quantity * i.price);
      return { product: p, value: sold || p.quantity * p.purchasePrice };
    })
    .sort((a, b) => b.value - a.value);
  const total = sum(items, (i) => i.value) || 1;
  let acc = 0;
  return items.map((i) => {
    acc += i.value;
    const share = (acc / total) * 100;
    return { ...i, share: (i.value / total) * 100, cls: share <= 70 ? "A" : share <= 90 ? "B" : "C" };
  });
}

export function reorderList() {
  const days = 60;
  return get("products")
    .map((p) => {
      const sold = sum(get("saleItems").filter((i) => i.productId === p.id), (i) => i.quantity);
      const avg = sold / days;
      const remaining = avg > 0 ? p.quantity / avg : Infinity;
      const recommended = Math.max(p.reorderPoint || 0, Math.ceil(avg * 30) + (p.minimumStock || 0) - p.quantity);
      return { p, avg, remaining, recommended: Math.max(0, recommended) };
    })
    .filter((r) => r.p.quantity <= (r.p.reorderPoint || 0) || r.remaining < 14)
    .sort((a, b) => a.remaining - b.remaining);
}

export async function analytics(route, view) {
  const abc = abcAnalysis();
  const reorder = reorderList();
  const classCounts = ["A", "B", "C"].map((k) => ({
    label: k,
    value: abc.filter((i) => i.cls === k).length,
    money: sum(abc.filter((i) => i.cls === k), (i) => i.value),
  }));
  const totalValue = sum(abc, (i) => i.value) || 1;
  const soldMap = new Map();
  get("saleItems").forEach((i) => soldMap.set(i.productId, (soldMap.get(i.productId) || 0) + i.quantity));
  const fast = [...soldMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const over = get("products").filter((p) => stockStatus(p) === "over");
  const expSoon = get("batches").filter((b) => b.quantity > 0 && ["soon", "critical"].includes(expiryStatus(b.expiryDate)));

  view.innerHTML = `${head(t("analytics"), t("simple_forecast"))}
    <div class="grid g2">
      ${UI.card({
        title: t("insights"),
        body: `<div class="grid" style="gap:8px">
          ${fast.map(([id, q]) => `<div class="insight"><span class="ic">🔥</span><span>${esc(prodName(id))} — ${num(q)} ${t("quantity")}</span></div>`).join("")}
          ${reorder.slice(0, 4).map((r) => `<div class="insight"><span class="ic">🛒</span><span>${esc(localName(r.p))} — ${t("reorder_point")} ${num(r.p.reorderPoint)} · ${t("recommended_qty")} ${num(r.recommended)}</span></div>`).join("")}
          ${expSoon.slice(0, 3).map((b) => `<div class="insight"><span class="ic">⏳</span><span>${esc(prodName(b.productId))} — ${fmtDate(b.expiryDate)}</span></div>`).join("")}
          ${over.slice(0, 3).map((p) => `<div class="insight"><span class="ic">📦</span><span>${esc(localName(p))} — ${t("overstocked")} (${num(p.quantity)})</span></div>`).join("")}
        </div>`,
      })}
      ${UI.card({ title: t("abc_analysis"), body: `<div class="chart-wrap"><canvas id="ch-abc"></canvas></div>
        ${["A", "B", "C"]
          .map((k, i) => {
            const c = classCounts[i];
            return `<div class="kv"><span>${UI.badge(`${t("class")} ${k}`, k === "A" ? "success" : k === "B" ? "warning" : "info")} ${num(c.value)} ${t("products")}</span><span>${money(c.money)} · ${pct((c.money / totalValue) * 100)}</span></div>`;
          })
          .join("")}` })}
      ${UI.card({
        title: t("reorder_center"),
        cls: "full",
        body: reorder.length
          ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>${t("products")}</th><th class="num">${t("stock")}</th><th class="num">${t("avg_daily_sales")}</th><th class="num">${t("days_remaining")}</th><th class="num">${t("reorder_point")}</th><th class="num">${t("recommended_qty")}</th><th>${t("supplier")}</th><th>${t("actions")}</th></tr></thead>
            <tbody>${reorder
              .map(
                (r) => `<tr><td>${esc(localName(r.p))}</td><td class="num">${num(r.p.quantity)}</td><td class="num">${r.avg.toFixed(2)}</td>
                <td class="num">${Number.isFinite(r.remaining) ? num(Math.round(r.remaining)) : "∞"}</td><td class="num">${num(r.p.reorderPoint)}</td>
                <td class="num"><strong>${num(r.recommended)}</strong></td><td>${esc(byId("suppliers", r.p.supplierId)?.name || "—")}</td>
                <td><button class="btn btn-sm btn-primary" data-po="${r.p.id}" data-qty="${r.recommended}">${t("create_po")}</button></td></tr>`,
              )
              .join("")}</tbody></table></div>`
          : UI.emptyState(t("empty_title"), "", "✅"),
      })}
    </div>`;
  const abcItems = classCounts.map((c, i) => ({ label: `${t("class")} ${["A", "B", "C"][i]}`, value: c.money, color: PALETTE[i] }));
  donutChart(view.querySelector("#ch-abc"), abcItems, { centerLabel: num(abc.length) });
  view.querySelectorAll("[data-po]").forEach((b) =>
    b.addEventListener("click", () => {
      const p = byId("products", b.dataset.po);
      purchaseForm(null, () => navigate("/purchases"), { productId: p.id, quantity: Number(b.dataset.qty) || 1, price: p.purchasePrice, supplierId: p.supplierId });
    }),
  );
}

/* --------------------------------- Reports -------------------------------- */
const REPORTS = ["inventory_report", "low_stock_report", "expiry_report", "sales_report", "purchase_report", "profit_report", "supplier_report", "performance_report", "movement_report"];

export async function reports(route, view) {
  const c = ctrl("reports", { report: "inventory_report", from: "", to: "" });
  const build = () => {
    const from = c.from || "0000-01-01";
    const to = c.to || "9999-12-31";
    const inRange = (d) => String(d).slice(0, 10) >= from && String(d).slice(0, 10) <= to;
    const q = c.q.toLowerCase();
    switch (c.report) {
      case "low_stock_report":
        return {
          cols: ["sku", "name", "quantity", "minimumStock", "status"],
          rows: get("products")
            .filter((p) => ["low", "critical", "out"].includes(stockStatus(p)) && (!q || match(localName(p), q)))
            .map((p) => ({ sku: p.sku, name: localName(p), quantity: p.quantity, minimumStock: p.minimumStock, status: t(STATUS_META[stockStatus(p)].key) })),
        };
      case "expiry_report":
        return {
          cols: ["batch", "product", "expiry", "days", "quantity", "status"],
          rows: get("batches")
            .filter((b) => b.quantity > 0 && (!q || match(prodName(b.productId), q)))
            .map((b) => ({ batch: b.batchNumber, product: prodName(b.productId), expiry: b.expiryDate, days: daysUntil(b.expiryDate), quantity: b.quantity, status: t(EXPIRY_META[expiryStatus(b.expiryDate)].key) }))
            .sort((a, b) => a.days - b.days),
        };
      case "sales_report":
        return {
          cols: ["invoice", "date", "customer", "total", "profit", "payment"],
          rows: get("sales")
            .filter((s) => inRange(s.date) && (!q || match(s.invoiceNumber, q)))
            .map((s) => ({ invoice: s.invoiceNumber, date: s.date, customer: byId("customers", s.customerId)?.name || "—", total: s.total, profit: s.profit ?? 0, payment: t(s.paymentStatus) })),
          totals: ["total", "profit"],
        };
      case "purchase_report":
        return {
          cols: ["po", "date", "supplier", "total", "status"],
          rows: get("purchaseOrders")
            .filter((p) => inRange(p.date) && (!q || match(p.poNumber, q)))
            .map((p) => ({ po: p.poNumber, date: p.date, supplier: byId("suppliers", p.supplierId)?.name || "—", total: p.total, status: t(p.status) })),
          totals: ["total"],
        };
      case "profit_report": {
        const rows = get("sales")
          .filter((s) => inRange(s.date))
          .map((s) => ({ invoice: s.invoiceNumber, date: s.date, revenue: s.total - (s.taxAmount || 0), cogs: s.cogs || 0, profit: (s.total - (s.taxAmount || 0)) - (s.cogs || 0) }));
        return { cols: ["invoice", "date", "revenue", "cogs", "profit"], rows, totals: ["revenue", "cogs", "profit"] };
      }
      case "supplier_report":
        return {
          cols: ["name", "orders", "total", "outstanding"],
          rows: get("suppliers").map((s) => {
            const pos = get("purchaseOrders").filter((p) => p.supplierId === s.id && inRange(p.date));
            return { name: s.name, orders: pos.length, total: sum(pos, (p) => p.total), outstanding: sum(pos.filter((p) => p.paymentStatus !== "paid"), (p) => p.total) };
          }),
          totals: ["total", "outstanding"],
        };
      case "performance_report":
        return {
          cols: ["sku", "name", "sold", "revenue", "profit"],
          rows: get("products")
            .map((p) => {
              const items = get("saleItems").filter((i) => i.productId === p.id);
              return { sku: p.sku, name: localName(p), sold: sum(items, (i) => i.quantity), revenue: sum(items, (i) => i.total), profit: sum(items, (i) => i.total - i.quantity * (i.cost || 0)) };
            })
            .filter((r) => !q || match(r.name, q))
            .sort((a, b) => b.revenue - a.revenue),
          totals: ["sold", "revenue", "profit"],
        };
      case "movement_report":
        return {
          cols: ["date", "product", "type", "quantity", "reason"],
          rows: get("stockMovements")
            .filter((m) => inRange(m.createdAt) && (!q || match(prodName(m.productId), q)))
            .map((m) => ({ date: String(m.createdAt).slice(0, 10), product: prodName(m.productId), type: m.type, quantity: m.quantity, reason: m.reason || "" })),
        };
      default:
        return {
          cols: ["sku", "name", "quantity", "purchasePrice", "value", "status"],
          rows: get("products")
            .filter((p) => !q || match(localName(p), q) || match(p.sku, q))
            .map((p) => ({ sku: p.sku, name: localName(p), quantity: p.quantity, purchasePrice: p.purchasePrice, value: p.quantity * p.purchasePrice, status: t(STATUS_META[stockStatus(p)].key) })),
          totals: ["quantity", "value"],
        };
    }
  };
  const render = () => {
    const data = build();
    const totalsRow = data.totals
      ? `<tr>${data.cols.map((col) => `<td class="${data.totals.includes(col) ? "num" : ""}">${data.totals.includes(col) ? money(sum(data.rows, (r) => r[col])) : col === data.cols[0] ? t("total") : ""}</td>`).join("")}</tr>`
      : "";
    view.innerHTML = `${head(t("reports"), t(c.report), `<button class="btn" data-print>🖨 ${t("print")}</button><button class="btn" data-export>⬇ ${t("export_csv")}</button>`)}
      <div class="tabs">${REPORTS.map((r) => `<button class="tab ${c.report === r ? "active" : ""}" data-rep="${r}">${t(r)}</button>`).join("")}</div>
      <div class="toolbar">
        <label>${t("from")} <input class="input" type="date" data-from value="${c.from}"></label>
        <label>${t("to")} <input class="input" type="date" data-to value="${c.to}"></label>
        <div class="search" style="flex:1;min-width:180px"><span class="sic">🔍</span><input class="search-input" data-q value="${esc(c.q)}" placeholder="${t("search")}"></div>
      </div>
      <div class="card"><div class="print-header"><strong>${esc(state.settings.storeName)}</strong> — ${t(c.report)}</div>
      <div class="table-wrap"><table class="tbl"><thead><tr>${data.cols.map((col) => `<th>${esc(col)}</th>`).join("")}</tr></thead>
      <tbody>${data.rows
        .map((r) => `<tr>${data.cols.map((col) => `<td class="${typeof r[col] === "number" ? "num" : ""}">${typeof r[col] === "number" && ["total", "revenue", "cogs", "profit", "value", "purchasePrice", "outstanding"].includes(col) ? money(r[col]) : esc(r[col])}</td>`).join("")}</tr>`)
        .join("")}</tbody>${totalsRow ? `<tfoot>${totalsRow}</tfoot>` : ""}</table></div>
      ${data.rows.length ? "" : UI.emptyState()}</div>`;
    view.querySelectorAll("[data-rep]").forEach((b) =>
      b.addEventListener("click", () => {
        c.report = b.dataset.rep;
        render();
      }),
    );
    view.querySelector("[data-from]").addEventListener("change", (e) => {
      c.from = e.target.value;
      render();
    });
    view.querySelector("[data-to]").addEventListener("change", (e) => {
      c.to = e.target.value;
      render();
    });
    view.querySelector("[data-q]").addEventListener("input", debounce((e) => {
      c.q = e.target.value;
      render();
      view.querySelector("[data-q]").focus();
    }));
    view.querySelector("[data-print]").addEventListener("click", () => window.print());
    view.querySelector("[data-export]").addEventListener("click", () => exportCSV(`${c.report}.csv`, data.rows, data.cols));
  };
  render();
}

/* ------------------------------ Notifications ----------------------------- */
export async function notifications(route, view) {
  const c = ctrl("notifications", { type: "" });
  const render = () => {
    const rows = get("notifications")
      .filter((n) => !c.type || n.type === c.type)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const types = [...new Set(get("notifications").map((n) => n.type))];
    view.innerHTML = `${head(t("notifications"), `${rows.filter((n) => !n.read).length} ${t("unread")}`, `<button class="btn" data-all>${t("mark_all_read")}</button>`)}
      <div class="tabs"><button class="tab ${!c.type ? "active" : ""}" data-type="">${t("all")}</button>${types.map((ty) => `<button class="tab ${c.type === ty ? "active" : ""}" data-type="${ty}">${ty}</button>`).join("")}</div>
      ${rows.length
        ? `<div class="card"><div class="card-body"><div class="timeline">${rows
            .map(
              (n) => `<div class="timeline-item"><span class="dotline" style="background:${n.read ? "var(--border)" : "var(--danger)"}"></span>
          <div style="flex:1"><strong>${esc(n.title)}</strong> ${UI.badge(n.type, "info")}<div class="stat-hint">${esc(n.message)} · ${fmtDateTime(n.createdAt)}</div></div>
          <div class="row-actions">${n.read ? "" : `<button class="btn btn-sm" data-read="${n.id}">✓</button>`}<button class="btn btn-sm btn-danger" data-del="${n.id}">🗑</button></div></div>`,
            )
            .join("")}</div></div></div>`
        : UI.emptyState(t("empty_title"), "", "🔔")}`;
    view.querySelectorAll("[data-type]").forEach((b) =>
      b.addEventListener("click", () => {
        c.type = b.dataset.type;
        render();
      }),
    );
    view.querySelector("[data-all]").addEventListener("click", async () => {
      await db.bulkUpdate("notifications", get("notifications").map((n) => ({ ...n, read: 1 })));
      await reload("notifications");
      render();
    });
    view.querySelectorAll("[data-read]").forEach((b) =>
      b.addEventListener("click", async () => {
        await db.update("notifications", b.dataset.read, { read: 1 });
        await reload("notifications");
        render();
      }),
    );
    view.querySelectorAll("[data-del]").forEach((b) =>
      b.addEventListener("click", async () => {
        await db.delete("notifications", b.dataset.del);
        await reload("notifications");
        render();
      }),
    );
  };
  render();
}

export async function activity(route, view) {
  const rows = get("activityLog").sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  view.innerHTML = `${head(t("activity"), `${rows.length} ${t("rows")}`, `<button class="btn" data-export>⬇ CSV</button>`)}
    ${UI.dataTable({
      columns: [
        { key: "createdAt", label: t("date"), render: (r) => fmtDateTime(r.createdAt) },
        { key: "action", label: "Action", render: (r) => UI.badge(r.action, "info") },
        { key: "entity", label: "Entity" },
        { key: "description", label: t("details") },
      ],
      rows,
      perPage: 15,
    })}`;
  view.querySelector("[data-export]").addEventListener("click", () => exportCSV("activity-log.csv", rows));
}

/* -------------------------------- Settings -------------------------------- */
export async function settings(route, view) {
  const s = state.settings;
  view.innerHTML = `${head(t("settings"), t("app_name"))}
    <div class="grid g2">
      ${UI.card({
        title: t("general"),
        body: `<form id="gen">
          ${UI.field({ label: t("store_name"), name: "storeName", value: s.storeName, full: true })}
          ${UI.field({ label: t("currency"), name: "currency", value: s.currency })}
          ${UI.selectField({ label: t("language"), name: "language", options: LANGS.map((l) => `<option value="${l.code}" ${s.language === l.code ? "selected" : ""}>${l.label}</option>`).join("") })}
          ${UI.selectField({ label: t("date_format"), name: "dateFormat", options: ["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"].map((f) => `<option ${s.dateFormat === f ? "selected" : ""}>${f}</option>`).join("") })}
          ${UI.selectField({ label: t("first_day"), name: "firstDayOfWeek", options: ["saturday", "sunday", "monday"].map((f) => `<option ${s.firstDayOfWeek === f ? "selected" : ""}>${f}</option>`).join("") })}
          ${UI.selectField({ label: t("appearance"), name: "theme", options: ["light", "dark", "system"].map((f) => `<option value="${f}" ${s.theme === f ? "selected" : ""}>${t(f)}</option>`).join("") })}
          <button class="btn btn-primary" type="button" data-save-gen>${t("save")}</button></form>`,
      })}
      ${UI.card({
        title: t("inventory"),
        body: `<form id="inv">
          ${UI.field({ label: t("min_stock"), name: "defaultMinimumStock", type: "number", value: s.defaultMinimumStock })}
          ${UI.field({ label: t("reorder_point"), name: "defaultReorderPoint", type: "number", value: s.defaultReorderPoint })}
          ${UI.field({ label: t("expiry_warning_days"), name: "expiryWarningDays", type: "number", value: s.expiryWarningDays })}
          <div class="switch"><span>${t("allow_negative")}</span><input type="checkbox" data-toggle="allowNegativeStock" ${s.allowNegativeStock ? "checked" : ""}></div>
          <div class="switch"><span>${t("enable_fefo")}</span><input type="checkbox" data-toggle="enableFEFO" ${s.enableFEFO ? "checked" : ""}></div>
          <div class="switch"><span>${t("low_stock")}</span><input type="checkbox" data-toggle="lowStockAlerts" ${s.lowStockAlerts ? "checked" : ""}></div>
          <div class="switch"><span>${t("expiry")}</span><input type="checkbox" data-toggle="expiryAlerts" ${s.expiryAlerts ? "checked" : ""}></div>
          <div class="switch"><span>${t("sales")}</span><input type="checkbox" data-toggle="salesAlerts" ${s.salesAlerts ? "checked" : ""}></div>
          <button class="btn btn-primary" type="button" data-save-inv style="margin-top:10px">${t("save")}</button></form>`,
      })}
      ${UI.card({
        title: t("data"),
        body: `<div class="row-actions" style="flex-wrap:wrap;gap:8px">
            <button class="btn btn-primary" data-backup>⬇ ${t("backup")}</button>
            <button class="btn" data-restore>⬆ ${t("restore")}</button>
            <button class="btn" data-imp>📥 ${t("import_csv")}</button>
            <button class="btn" data-exp-all>📤 ${t("export_csv")}</button>
            <button class="btn" data-reset>🔄 ${t("reset_demo")}</button>
            <button class="btn btn-danger" data-clear>🗑 ${t("clear_db")}</button>
          </div>
          <p class="hint" style="margin-top:10px">${t("offline_ready")} · IndexedDB · ${num(get("products").length)} ${t("products")}</p>
          <input type="file" accept="application/json" id="restore-file" hidden>
          <input type="file" accept=".csv,text/csv" id="csv-file" hidden>`,
      })}
    </div>`;

  view.querySelector("[data-save-gen]").addEventListener("click", async () => {
    const d = UI.formData(view.querySelector("#gen"));
    for (const [k, v] of Object.entries(d)) await saveSetting(k, v);
    UI.toast(t("saved"));
    window.dispatchEvent(new CustomEvent("app:settings"));
  });
  view.querySelector("[data-save-inv]").addEventListener("click", async () => {
    const d = UI.formData(view.querySelector("#inv"));
    for (const [k, v] of Object.entries(d)) await saveSetting(k, Number(v));
    UI.toast(t("saved"));
  });
  view.querySelectorAll("[data-toggle]").forEach((cb) =>
    cb.addEventListener("change", async () => {
      await saveSetting(cb.dataset.toggle, cb.checked);
      UI.toast(t("saved"));
    }),
  );
  view.querySelector("[data-backup]").addEventListener("click", async () => {
    const dump = await db.exportAll();
    download(`natural-cosmetics-backup-${todayISO()}.json`, JSON.stringify(dump, null, 2));
    await logActivity("BACKUP", "system", "Backup exported");
    await reload("activityLog");
    UI.toast(t("backup_done"));
  });
  const restoreInput = view.querySelector("#restore-file");
  view.querySelector("[data-restore]").addEventListener("click", () => restoreInput.click());
  restoreInput.addEventListener("change", async () => {
    const file = restoreInput.files[0];
    if (!file) return;
    try {
      const dump = JSON.parse(await readFileText(file));
      if (!dump.stores) throw new Error("Invalid backup file");
      const summary = Object.entries(dump.stores).map(([k, v]) => `${k}: ${v.length}`).join(" · ");
      if (!(await UI.confirmDialog({ title: t("restore"), message: `${summary}\n${t("are_you_sure")}`, danger: false, confirmText: t("restore") }))) return;
      const current = await db.exportAll();
      download(`natural-cosmetics-backup-before-restore-${todayISO()}.json`, JSON.stringify(current));
      await db.importAll(dump);
      await logActivity("RESTORE", "system", "Backup restored");
      await reload(Object.keys(dump.stores));
      UI.toast(t("restore_done"));
      navigate("/dashboard");
    } catch (e) {
      UI.toast(e.message, "error", 4500);
    }
    restoreInput.value = "";
  });
  view.querySelector("[data-exp-all]").addEventListener("click", () => {
    ["products", "inventory", "sales", "purchaseOrders", "suppliers", "customers"].forEach((store) => exportCSV(`${store}.csv`, get(store)));
    UI.toast(t("saved"));
  });
  const csvInput = view.querySelector("#csv-file");
  view.querySelector("[data-imp]").addEventListener("click", () => csvInput.click());
  csvInput.addEventListener("change", async () => {
    const file = csvInput.files[0];
    if (!file) return;
    const { records } = parseCSV(await readFileText(file));
    const valid = [];
    const invalid = [];
    records.forEach((r, i) => {
      const errors = [];
      if (!r.nameEn && !r.nameAr) errors.push("name");
      if (!r.sku) errors.push("sku");
      if (r.sku && get("products").some((p) => p.sku === r.sku)) errors.push("duplicate sku");
      if (Number.isNaN(Number(r.purchasePrice || 0))) errors.push("purchasePrice");
      if (errors.length) invalid.push({ line: i + 2, errors: errors.join(", ") });
      else valid.push(r);
    });
    UI.openModal({
      title: t("import_preview"),
      size: "lg",
      body: `<p>${t("valid_rows")}: <strong>${valid.length}</strong> · ${t("invalid_rows")}: <strong>${invalid.length}</strong></p>
        ${invalid.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>#</th><th>${t("error")}</th></tr></thead><tbody>${invalid.map((r) => `<tr><td>${r.line}</td><td>${esc(r.errors)}</td></tr>`).join("")}</tbody></table></div>` : ""}
        <div class="table-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>SKU</th><th>${t("name")}</th><th>${t("quantity")}</th></tr></thead>
        <tbody>${valid.slice(0, 10).map((r) => `<tr><td>${esc(r.sku)}</td><td>${esc(r.nameEn || r.nameAr)}</td><td>${esc(r.quantity || 0)}</td></tr>`).join("")}</tbody></table></div>`,
      footer: `<button class="btn" data-close>${t("cancel")}</button><button class="btn btn-primary" data-ok ${valid.length ? "" : "disabled"}>${t("confirm")} (${valid.length})</button>`,
      onMount(modal) {
        modal.querySelector("[data-ok]").addEventListener("click", async () => {
          const cat = get("categories")[0];
          await db.bulkInsert(
            "products",
            valid.map((r) => ({
              id: uid("prd"),
              nameAr: r.nameAr || r.nameEn,
              nameEn: r.nameEn || r.nameAr,
              nameFr: r.nameFr || r.nameEn || r.nameAr,
              sku: r.sku,
              barcode: r.barcode || "",
              categoryId: r.categoryId || cat?.id,
              unit: r.unit || "piece",
              purchasePrice: Number(r.purchasePrice || 0),
              sellingPrice: Number(r.sellingPrice || 0),
              quantity: Number(r.quantity || 0),
              minimumStock: Number(r.minimumStock || state.settings.defaultMinimumStock),
              maximumStock: Number(r.maximumStock || 100),
              reorderPoint: Number(r.reorderPoint || state.settings.defaultReorderPoint),
              status: r.status || "active",
              createdAt: new Date().toISOString(),
            })),
          );
          await logActivity("IMPORT", "product", `${valid.length} products imported`);
          await reload(["products", "activityLog"]);
          UI.closeModal();
          UI.toast(`${t("saved")} (${valid.length})`);
        });
      },
    });
    csvInput.value = "";
  });
  view.querySelector("[data-reset]").addEventListener("click", async () => {
    if (!(await UI.confirmDialog({ title: t("reset_demo"), message: t("delete_warning") }))) return;
    await seedDemoData();
    await reload(Object.keys(state.data).concat("settings"));
    UI.toast(t("saved"));
    navigate("/dashboard");
  });
  view.querySelector("[data-clear]").addEventListener("click", async () => {
    if (!(await UI.confirmDialog({ title: t("clear_db"), message: t("delete_warning") }))) return;
    if (!(await UI.confirmDialog({ title: t("clear_db"), message: t("are_you_sure") }))) return;
    await db.clearAll();
    await reload(Object.keys(state.data).concat("settings"));
    UI.toast(t("deleted"));
    navigate("/dashboard");
  });
}

/* ----------------------------- Global search ------------------------------ */
export function globalSearch(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const groups = [];
  const add = (label, items) => items.length && groups.push({ label, items: items.slice(0, 5) });
  add(t("products"), get("products").filter((p) => match(localName(p), q) || match(p.sku, q) || match(p.barcode, q)).map((p) => ({ label: `${localName(p)} · ${p.sku}`, hint: `${p.quantity}`, route: `/products/${p.id}` })));
  add(t("suppliers"), get("suppliers").filter((s) => match(s.name, q) || match(s.company, q)).map((s) => ({ label: s.name, hint: s.city, route: "/suppliers" })));
  add(t("customers"), get("customers").filter((s) => match(s.name, q) || match(s.phone, q)).map((s) => ({ label: s.name, hint: s.phone, route: "/customers" })));
  add(t("purchases"), get("purchaseOrders").filter((p) => match(p.poNumber, q)).map((p) => ({ label: p.poNumber, hint: money(p.total), route: "/purchases" })));
  add(t("sales"), get("sales").filter((s) => match(s.invoiceNumber, q)).map((s) => ({ label: s.invoiceNumber, hint: money(s.total), route: "/sales" })));
  add(t("batches"), get("batches").filter((b) => match(b.batchNumber, q)).map((b) => ({ label: b.batchNumber, hint: fmtDate(b.expiryDate), route: "/batches" })));
  return groups;
}
