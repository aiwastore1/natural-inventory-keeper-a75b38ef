/**
 * POS terminal (#/pos) — sale + live return mode, holds, drafts, receipts,
 * FEFO batch tags, keyboard shortcuts F1..F5.
 */
import { db, uid, logActivity } from "../database.js";
import { get, byId, reload, state, saveSetting } from "../state.js";
import { t, localName } from "../i18n.js";
import { money, num, esc, fmtDateTime, debounce } from "../utils/format.js";
import * as UI from "../components/ui.js";
import { createSale, applyStockChange, productBatches, expiryStatus, EXPIRY_META, nextInvoiceNumber } from "./domain.js";
import { broadcastSync } from "./network.js";

const cart = { lines: [], customerId: null, returnMode: false, discount: 0, note: "" };
let renderRoot = null;
let rerender = () => {};

/* ------------------------------- helpers ------------------------------- */

function variantsOf(productId) {
  return get("variants").filter((v) => v.productId === productId && v.active !== false);
}

function unitPrice(product, variant) {
  return Number(variant?.sellingPrice) || Number(product.sellingPrice) || 0;
}

function batchTag(productId) {
  const batches = productBatches(productId);
  if (!batches.length) return "";
  const b = batches[0];
  const status = b.expiryDate ? expiryStatus(b.expiryDate) : "safe";
  return `<span class="pos-batch ${EXPIRY_META[status]?.tone || ""}">${esc(b.batchNumber || "BATCH")}</span>`;
}

function lineTotal(l) {
  return Number(l.quantity) * Number(l.price) - (Number(l.discount) || 0);
}

function totals() {
  const sign = cart.returnMode ? -1 : 1;
  const subtotal = cart.lines.reduce((a, l) => a + lineTotal(l), 0);
  const discount = Number(cart.discount) || 0;
  const total = Math.max(0, subtotal - discount);
  return { subtotal: subtotal * sign, discount: discount * sign, total: total * sign, count: cart.lines.reduce((a, l) => a + Number(l.quantity), 0) };
}

export function addToCart(product, variant = null, qty = 1) {
  if (!product) return;
  const key = `${product.id}:${variant?.id || ""}`;
  const existing = cart.lines.find((l) => l.key === key);
  if (existing) existing.quantity += qty;
  else
    cart.lines.push({
      key,
      productId: product.id,
      variantId: variant?.id || null,
      name: variant ? `${localName(product)} — ${variant.name}` : localName(product),
      sku: variant?.barcode || product.sku,
      price: unitPrice(product, variant),
      quantity: qty,
      discount: 0,
    });
  rerender();
}

function findByBarcode(code) {
  const clean = String(code || "").trim();
  if (!clean) return null;
  const variant = get("variants").find((v) => v.barcode === clean);
  if (variant) return { product: byId("products", variant.productId), variant };
  const product = get("products").find(
    (p) => p.barcode === clean || p.sku?.toLowerCase() === clean.toLowerCase() || (p.extraBarcodes || []).includes(clean),
  );
  return product ? { product, variant: null } : null;
}

/* ------------------------------- receipt ------------------------------- */

function receiptHTML({ title, number, lines, sums, customerName, kind }) {
  return `<div class="receipt">
    <h2>${esc(state.settings.storeName || t("app_name"))}</h2>
    <div class="r-sub">${esc(title)} — ${esc(number)}</div>
    <div class="r-sub">${esc(fmtDateTime(new Date().toISOString()))}</div>
    ${customerName ? `<div class="r-sub">${t("customer")}: ${esc(customerName)}</div>` : ""}
    <table>
      <thead><tr><th>${t("name")}</th><th>${t("qty")}</th><th>${t("price")}</th><th>${t("total")}</th></tr></thead>
      <tbody>${lines
        .map((l) => `<tr><td>${esc(l.name)}</td><td>${num(l.quantity)}</td><td>${money(l.price)}</td><td>${money(lineTotal(l))}</td></tr>`)
        .join("")}</tbody>
    </table>
    <div class="r-tot"><span>${t("subtotal")}</span><span>${money(sums.subtotal)}</span></div>
    <div class="r-tot"><span>${t("discount")}</span><span>${money(sums.discount)}</span></div>
    <div class="r-tot grand"><span>${kind === "return" ? t("refund_total") : t("total")}</span><span>${money(sums.total)}</span></div>
    <p class="r-foot">${esc(t("thank_you"))}</p>
  </div>`;
}

export function printReceipt(payload) {
  const host = document.getElementById("receipt-print");
  host.innerHTML = receiptHTML(payload);
  document.body.classList.add("printing");
  window.print();
  setTimeout(() => {
    document.body.classList.remove("printing");
    host.innerHTML = "";
  }, 400);
}

/* ------------------------------ operations ----------------------------- */

async function confirmSale() {
  if (!cart.lines.length) return UI.toast(t("cart_empty"), "error");
  const sums = totals();
  try {
    if (cart.returnMode) {
      const returnNumber = `RET-${new Date().getFullYear()}-${String(get("returns").length + 1).padStart(4, "0")}`;
      for (const l of cart.lines) {
        await applyStockChange({
          productId: l.productId,
          type: "RETURN",
          quantity: l.quantity,
          reason: `${t("return_mode")} ${returnNumber}`,
          refId: returnNumber,
          refType: "return",
        });
      }
      const record = {
        id: uid("ret"),
        returnNumber,
        customerId: cart.customerId,
        lines: cart.lines.map((l) => ({ ...l, total: lineTotal(l) })),
        refundTotal: Math.abs(sums.total),
        createdAt: new Date().toISOString(),
      };
      await db.put("returns", record);
      await logActivity("RETURN", "return", `${returnNumber} — ${money(record.refundTotal)}`);
      await reload(["returns", "activityLog"]);
      const affected = new Set(cart.lines.map((l) => l.productId));
      broadcastSync({
        returns: [record],
        products: get("products").filter((p) => affected.has(p.id)),
        batches: get("batches").filter((b) => affected.has(b.productId)),
        inventory: get("inventory").filter((i) => affected.has(i.productId)),
        stockMovements: get("stockMovements").filter((m) => affected.has(m.productId)),
        notifications: get("notifications").filter((n) => affected.has(n.meta?.productId)),
      });
      UI.toast(`${t("refund_done")} — ${returnNumber}`);
      if (state.settings.autoPrint) printReceipt({ title: t("return_receipt"), number: returnNumber, lines: cart.lines, sums, kind: "return", customerName: byId("customers", cart.customerId)?.name });
    } else {
      const sale = await createSale({
        customerId: cart.customerId,
        lines: cart.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, price: l.price, discount: l.discount })),
        discount: Number(cart.discount) || 0,
        tax: 0,
        paymentMethod: "cash",
        paymentStatus: "paid",
        notes: cart.note,
      });
      const affected = new Set(cart.lines.map((l) => l.productId));
      broadcastSync({
        sales: [sale],
        saleItems: get("saleItems").filter((i) => i.saleId === sale.id),
        products: get("products").filter((p) => affected.has(p.id)),
        batches: get("batches").filter((b) => affected.has(b.productId)),
        inventory: get("inventory").filter((i) => affected.has(i.productId)),
        stockMovements: get("stockMovements").filter((m) => affected.has(m.productId)),
        notifications: get("notifications").filter((n) => affected.has(n.meta?.productId)),
      });
      UI.toast(`${t("sale_done")} — ${sale.invoiceNumber}`);
      if (state.settings.autoPrint) printReceipt({ title: t("invoice"), number: sale.invoiceNumber, lines: cart.lines, sums, kind: "sale", customerName: byId("customers", cart.customerId)?.name });
    }
    cart.lines = [];
    cart.discount = 0;
    cart.customerId = null;
    rerender();
  } catch (error) {
    UI.toast(error.message, "error");
  }
}

async function holdCart() {
  if (!cart.lines.length) return UI.toast(t("cart_empty"), "error");
  const record = { id: uid("hld"), lines: [...cart.lines], customerId: cart.customerId, discount: cart.discount, total: totals().total, createdAt: new Date().toISOString() };
  await db.put("holds", record);
  await reload("holds");
  broadcastSync({ holds: [record] });
  cart.lines = [];
  cart.discount = 0;
  UI.toast(t("held"));
  rerender();
}

async function saveDraft(type) {
  if (!cart.lines.length) return UI.toast(t("cart_empty"), "error");
  const prefix = type === "order" ? "ORD" : "PRO";
  const number = `${prefix}-${new Date().getFullYear()}-${String(get("drafts").filter((d) => d.type === type).length + 1).padStart(4, "0")}`;
  const record = {
    id: uid("drf"),
    type,
    number,
    customerId: cart.customerId,
    lines: [...cart.lines],
    discount: cart.discount,
    total: totals().total,
    createdAt: new Date().toISOString(),
  };
  await db.put("drafts", record);
  await reload("drafts");
  broadcastSync({ drafts: [record] });
  UI.toast(`${type === "order" ? t("order") : t("proforma")} — ${number}`);
  printReceipt({ title: type === "order" ? t("order") : t("proforma"), number, lines: cart.lines, sums: totals(), kind: type, customerName: byId("customers", cart.customerId)?.name });
  rerender();
}

function listModal(kind) {
  const rows = kind === "holds" ? get("holds") : kind === "history" ? get("sales").slice().reverse().slice(0, 40) : get("drafts");
  UI.openModal({
    title: kind === "holds" ? t("hold") : kind === "history" ? t("history") : t("drafts"),
    size: "lg",
    body: rows.length
      ? `<table class="table"><thead><tr><th>#</th><th>${t("date")}</th><th>${t("total")}</th><th>${t("actions")}</th></tr></thead><tbody>${rows
          .map(
            (r) => `<tr><td>${esc(r.invoiceNumber || r.number || r.id.slice(-6))}</td><td>${esc(fmtDateTime(r.createdAt))}</td><td class="num">${money(r.total)}</td>
            <td><div class="row-actions">
              ${kind === "history" ? `<button class="btn btn-sm" data-print="${r.id}">🖨</button>` : `<button class="btn btn-sm btn-primary" data-load="${r.id}">↩ ${t("resume")}</button><button class="btn btn-sm btn-danger" data-drop="${r.id}">🗑</button>`}
            </div></td></tr>`,
          )
          .join("")}</tbody></table>`
      : UI.emptyState(t("empty_title"), t("empty_desc")),
    footer: `<button class="btn" data-close>${t("close")}</button>`,
    onMount(modal) {
      modal.querySelectorAll("[data-load]").forEach((b) =>
        b.addEventListener("click", async () => {
          const row = rows.find((r) => r.id === b.dataset.load);
          cart.lines = row.lines.map((l) => ({ ...l }));
          cart.customerId = row.customerId || null;
          cart.discount = Number(row.discount) || 0;
          if (kind === "holds") {
            await db.delete("holds", row.id);
            await reload("holds");
          }
          UI.closeModal();
          rerender();
        }),
      );
      modal.querySelectorAll("[data-drop]").forEach((b) =>
        b.addEventListener("click", async () => {
          await db.delete(kind === "holds" ? "holds" : "drafts", b.dataset.drop);
          await reload(kind === "holds" ? "holds" : "drafts");
          UI.closeModal();
          rerender();
        }),
      );
      modal.querySelectorAll("[data-print]").forEach((b) =>
        b.addEventListener("click", () => {
          const sale = rows.find((r) => r.id === b.dataset.print);
          const items = get("saleItems").filter((i) => i.saleId === sale.id).map((i) => ({ name: i.productName, quantity: i.quantity, price: i.price, discount: i.discount }));
          printReceipt({ title: t("invoice"), number: sale.invoiceNumber, lines: items, sums: { subtotal: sale.subtotal, discount: sale.discount, total: sale.total }, kind: "sale" });
        }),
      );
    },
  });
}

/* -------------------------------- view -------------------------------- */

let filter = { q: "", category: "" };

export async function pos(route, view) {
  renderRoot = view;
  rerender = render;

  function productCards() {
    const list = get("products")
      .filter((p) => p.status !== "inactive")
      .filter((p) => !filter.category || p.categoryId === filter.category)
      .filter((p) => !filter.q || [localName(p), p.sku, p.barcode].some((f) => String(f || "").toLowerCase().includes(filter.q.toLowerCase())))
      .slice(0, 60);
    if (!list.length) return UI.emptyState(t("empty_title"), t("empty_desc"), "🔍");
    return `<div class="pos-grid">${list
      .map((p) => {
        const qty = Number(p.quantity) || 0;
        const tone = qty <= 0 ? "danger" : qty <= (p.minimumStock || 0) ? "warning" : "success";
        return `<button class="pos-card" data-add-product="${p.id}" ${qty <= 0 && !state.settings.allowNegativeStock ? "disabled" : ""}>
          <span class="pos-card-name">${esc(localName(p))}</span>
          <span class="pos-card-meta">${esc(p.sku)} ${variantsOf(p.id).length ? `· ${variantsOf(p.id).length} ${t("variants")}` : ""}</span>
          <span class="pos-card-row"><span class="pos-price">${money(unitPrice(p))}</span>
          <span class="badge ${tone}">${num(qty)}</span></span>
          ${batchTag(p.id)}
        </button>`;
      })
      .join("")}</div>`;
  }

  function cartRows() {
    if (!cart.lines.length) return UI.emptyState(t("cart_empty"), t("cart_hint"), "🛒");
    return cart.lines
      .map(
        (l, i) => `<div class="pos-line">
        <div class="pos-line-main"><strong>${esc(l.name)}</strong><span class="stat-hint">${esc(l.sku || "")} ${batchTag(l.productId)}</span></div>
        <div class="qty-mod">
          <button class="btn btn-sm" data-dec="${i}" aria-label="-">−</button>
          <input class="input qty-input" data-qty="${i}" type="number" min="1" step="1" value="${l.quantity}">
          <button class="btn btn-sm" data-inc="${i}" aria-label="+">+</button>
        </div>
        <input class="input price-input" data-price="${i}" type="number" min="0" step="0.01" value="${l.price}">
        <span class="pos-line-total ${cart.returnMode ? "neg" : ""}">${money(cart.returnMode ? -lineTotal(l) : lineTotal(l))}</span>
        <button class="btn btn-sm btn-danger" data-rm="${i}">✕</button>
      </div>`,
      )
      .join("");
  }

  function render() {
    const sums = totals();
    const customerName = byId("customers", cart.customerId)?.name || "";
    view.innerHTML = `
      <div class="pos-wrap ${cart.returnMode ? "return-mode" : ""}">
        <div class="pos-top">
          <div class="search"><span class="sic">🔍</span><input class="search-input" id="pos-q" value="${esc(filter.q)}" placeholder="${esc(t("search_product"))}"></div>
          <div class="search"><span class="sic">🏷</span><input class="search-input" id="pos-barcode" placeholder="${esc(t("scan_barcode"))}" autocomplete="off"></div>
          <select class="select" id="pos-cat" style="max-width:200px"><option value="">${t("all")} — ${t("category")}</option>${UI.selectOptions(get("categories"), "id", localName, filter.category)}</select>
          <button class="btn ${cart.returnMode ? "btn-danger solid" : ""}" id="pos-return">↩ ${t("return_mode")}</button>
        </div>
        <div class="pos-body">
          <section class="pos-products">${productCards()}</section>
          <aside class="pos-cart">
            <div class="pos-cart-head">
              <div class="pos-customer">
                <input class="input pos-customer-input" id="pos-customer-search" value="${esc(customerName)}" placeholder="${esc(t("customer_search"))}" autocomplete="off" role="combobox" aria-expanded="false" aria-label="${esc(t("customer"))}">
                <div class="pos-customer-results" id="pos-customer-results"></div>
              </div>
              <span class="badge">${num(sums.count)} ${t("items")}</span>
            </div>
            <div class="pos-lines">${cartRows()}</div>
            <div class="pos-sums">
              <div class="row"><span>${t("subtotal")}</span><strong>${money(sums.subtotal)}</strong></div>
              <div class="row"><span>${t("discount")}</span><input class="input" id="pos-discount" type="number" min="0" step="0.01" value="${cart.discount}"></div>
              <div class="row grand ${cart.returnMode ? "neg" : ""}"><span>${cart.returnMode ? t("refund_total") : t("total")}</span><strong>${money(sums.total)}</strong></div>
            </div>
            <div class="pos-actions">
              <button class="btn" data-act="cancel">✕ ${t("cancel_f4")}</button>
              <button class="btn" data-act="hold">⏸ ${t("hold_f2")}</button>
              <button class="btn" data-act="history">🕘 ${t("history")}</button>
              <button class="btn" data-act="drafts">🗂 ${t("drafts_f3")}</button>
              <button class="btn ${state.settings.autoPrint ? "btn-primary" : ""}" data-act="autoprint">🖨 ${t("auto_print")}: ${state.settings.autoPrint ? t("enabled") : t("disabled")} — F5</button>
            </div>
            <div class="pos-exec">
              <button class="btn" data-act="proforma">${t("proforma")}</button>
              <button class="btn" data-act="order">${t("order")}</button>
              <button class="btn" data-act="print">🖨 ${t("print")}</button>
              <button class="btn btn-lg ${cart.returnMode ? "btn-danger" : "btn-primary"}" data-act="confirm">
                ${cart.returnMode ? `${t("confirm_return")} F1` : `${t("confirm_sale")} F1`}
              </button>
            </div>
          </aside>
        </div>
      </div>`;

    const q = view.querySelector("#pos-q");
    q.addEventListener("input", debounce((e) => {
      filter.q = e.target.value;
      render();
      const el = view.querySelector("#pos-q");
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }, 180));
    view.querySelector("#pos-cat").addEventListener("change", (e) => {
      filter.category = e.target.value;
      render();
    });
    const bc = view.querySelector("#pos-barcode");
    bc.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const hit = findByBarcode(bc.value);
      if (hit) {
        addToCart(hit.product, hit.variant, 1);
        UI.toast(localName(hit.product));
      } else UI.toast(t("not_found"), "error");
      bc.value = "";
    });
    view.querySelector("#pos-return").addEventListener("click", () => {
      cart.returnMode = !cart.returnMode;
      render();
    });
    const custInput = view.querySelector("#pos-customer-search");
    const custResults = view.querySelector("#pos-customer-results");
    const renderCustResults = () => {
      const q = custInput.value.trim().toLowerCase();
      const matches = get("customers")
        .filter((c) => !q || String(c.name || "").toLowerCase().includes(q) || String(c.phone || "").includes(q))
        .slice(0, 8);
      const html = q
        ? matches.length
          ? matches.map((c) => `<button class="res-item" type="button" data-cust="${c.id}"><span>${esc(c.name)}</span><span class="stat-hint">${esc(c.phone || "")}</span></button>`).join("")
          : `<div class="res-group">${t("not_found")}</div>`
        : `<button class="res-item" type="button" data-cust="">${esc(t("walk_in"))}</button>`;
      custResults.innerHTML = html;
      custResults.classList.add("show");
      custInput.setAttribute("aria-expanded", "true");
      custResults.querySelectorAll("[data-cust]").forEach((b) =>
        b.addEventListener("click", () => {
          const cid = b.dataset.cust;
          cart.customerId = cid || null;
          custInput.value = cid ? (byId("customers", cid)?.name || "") : "";
          hideCustResults();
        }),
      );
    };
    const hideCustResults = () => {
      custResults.classList.remove("show");
      custInput.setAttribute("aria-expanded", "false");
    };
    custInput.addEventListener("focus", renderCustResults);
    custInput.addEventListener("input", renderCustResults);
    custInput.addEventListener("blur", () => setTimeout(hideCustResults, 180));
    custInput.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const first = custResults.querySelector("[data-cust]");
      if (first) first.click();
    });
    view.querySelector("#pos-discount").addEventListener("change", (e) => {
      cart.discount = Number(e.target.value) || 0;
      render();
    });
    view.querySelectorAll("[data-add-product]").forEach((b) =>
      b.addEventListener("click", () => {
        const product = byId("products", b.dataset.addProduct);
        const vs = variantsOf(product.id);
        if (!vs.length) return addToCart(product);
        UI.openModal({
          title: `${t("variants")} — ${localName(product)}`,
          size: "sm",
          body: `<div class="variant-pick">${vs
            .map((v) => `<button class="btn" data-v="${v.id}">${esc(v.name)} · ${money(unitPrice(product, v))} · ${num(v.quantity)}</button>`)
            .join("")}</div>`,
          onMount(modal) {
            modal.querySelectorAll("[data-v]").forEach((btn) =>
              btn.addEventListener("click", () => {
                addToCart(product, vs.find((v) => v.id === btn.dataset.v));
                UI.closeModal();
              }),
            );
          },
        });
      }),
    );
    view.querySelectorAll("[data-inc]").forEach((b) => b.addEventListener("click", () => { cart.lines[b.dataset.inc].quantity += 1; render(); }));
    view.querySelectorAll("[data-dec]").forEach((b) =>
      b.addEventListener("click", () => {
        const l = cart.lines[b.dataset.dec];
        l.quantity = Math.max(1, l.quantity - 1);
        render();
      }),
    );
    view.querySelectorAll("[data-qty]").forEach((inp) =>
      inp.addEventListener("change", () => {
        cart.lines[inp.dataset.qty].quantity = Math.max(1, Number(inp.value) || 1);
        render();
      }),
    );
    view.querySelectorAll("[data-price]").forEach((inp) =>
      inp.addEventListener("change", () => {
        cart.lines[inp.dataset.price].price = Math.max(0, Number(inp.value) || 0);
        render();
      }),
    );
    view.querySelectorAll("[data-rm]").forEach((b) =>
      b.addEventListener("click", () => {
        cart.lines.splice(Number(b.dataset.rm), 1);
        render();
      }),
    );
    view.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => action(b.dataset.act)));
    bc.focus();
  }

  render();
  void route;
}

export async function action(kind) {
  if (kind === "confirm") return confirmSale();
  if (kind === "hold") return holdCart();
  if (kind === "drafts") return listModal("drafts");
  if (kind === "history") return listModal("history");
  if (kind === "proforma") return saveDraft("proforma");
  if (kind === "order") return saveDraft("order");
  if (kind === "print") {
    if (!cart.lines.length) return UI.toast(t("cart_empty"), "error");
    return printReceipt({ title: cart.returnMode ? t("return_receipt") : t("invoice"), number: nextInvoiceNumber(), lines: cart.lines, sums: totals(), kind: cart.returnMode ? "return" : "sale" });
  }
  if (kind === "autoprint") {
    await saveSetting("autoPrint", !state.settings.autoPrint);
    UI.toast(`${t("auto_print")}: ${state.settings.autoPrint ? t("enabled") : t("disabled")}`);
    return rerender();
  }
  if (kind === "cancel") {
    if (!cart.lines.length) return;
    if (!(await UI.confirmDialog({ title: t("cancel_f4"), message: t("clear_cart_warning") }))) return;
    cart.lines = [];
    cart.discount = 0;
    return rerender();
  }
  return undefined;
}

/** Bind F1..F5 while the POS route is visible. */
export function bindShortcuts() {
  document.addEventListener("keydown", (e) => {
    if (!window.location.hash.startsWith("#/pos")) return;
    const map = { F1: "confirm", F2: "hold", F3: "drafts", F4: "cancel", F5: "autoprint" };
    if (!map[e.key]) return;
    e.preventDefault();
    action(map[e.key]);
  });
}

export function holdsCount() {
  return get("holds").length;
}

void renderRoot;
