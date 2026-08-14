/** Business rules: inventory status, movements, FEFO, purchases receiving, sales, notifications. */
import { tx, wrap, uid, logActivity } from "../database.js";
import { state, get, byId, reload } from "../state.js";
import { localName, t } from "../i18n.js";
import { daysUntil, sum } from "../utils/format.js";

export const MOVEMENT_TYPES = ["STOCK_IN", "STOCK_OUT", "SALE", "PURCHASE", "RETURN", "DAMAGED", "EXPIRED", "ADJUSTMENT", "TRANSFER"];
export const IN_TYPES = ["STOCK_IN", "PURCHASE", "RETURN"];

export function stockStatus(product) {
  const qty = Number(product.quantity) || 0;
  const min = Number(product.minimumStock) || 0;
  const max = Number(product.maximumStock) || 0;
  if (qty <= 0) return "out";
  if (qty <= Math.max(1, Math.ceil(min / 2))) return "critical";
  if (qty <= min) return "low";
  if (max && qty > max) return "over";
  return "healthy";
}

export const STATUS_META = {
  healthy: { key: "healthy", tone: "success" },
  low: { key: "low_stock", tone: "warning" },
  critical: { key: "critical_stock", tone: "danger" },
  out: { key: "out_of_stock", tone: "danger" },
  over: { key: "overstocked", tone: "info" },
};

export function expiryStatus(expiryDate) {
  const d = daysUntil(expiryDate);
  if (d < 0) return "expired";
  if (d <= 7) return "critical";
  if (d <= (state.settings.expiryWarningDays || 30)) return "soon";
  return "safe";
}

export const EXPIRY_META = {
  expired: { key: "expired", tone: "danger" },
  critical: { key: "critical", tone: "danger" },
  soon: { key: "expiring_soon", tone: "warning" },
  safe: { key: "safe", tone: "success" },
};

export function productBatches(productId) {
  return get("batches")
    .filter((b) => b.productId === productId && Number(b.quantity) > 0)
    .sort((a, b) => String(a.expiryDate).localeCompare(String(b.expiryDate)));
}

export function productLabel(product) {
  return product ? `${localName(product)} (${product.sku})` : "—";
}

/* ---------- transactional primitives (run inside an existing tx) ---------- */

async function syncInventoryRow(stores, product) {
  const rows = await wrap(stores.inventory.index("by_productId").getAll(product.id));
  const status = stockStatus(product);
  const payload = {
    id: rows[0]?.id || uid("inv"),
    productId: product.id,
    quantity: Number(product.quantity) || 0,
    value: (Number(product.quantity) || 0) * (Number(product.purchasePrice) || 0),
    status,
    updatedAt: new Date().toISOString(),
  };
  await wrap(stores.inventory.put(payload));
  return status;
}

async function pushNotification(stores, type, title, message, meta = {}) {
  const settings = state.settings;
  if (type === "LOW_STOCK" && !settings.lowStockAlerts) return;
  if (type === "EXPIRY" && !settings.expiryAlerts) return;
  if (type === "SALES" && !settings.salesAlerts) return;
  await wrap(
    stores.notifications.put({
      id: uid("ntf"),
      type,
      title,
      message,
      meta,
      read: 0,
      createdAt: new Date().toISOString(),
    }),
  );
}

async function addMovement(stores, movement) {
  const record = { id: uid("mov"), createdAt: new Date().toISOString(), ...movement };
  await wrap(stores.stockMovements.put(record));
  return record;
}

/** FEFO consumption inside a transaction. Returns [{batchId, batchNumber, quantity, expiryDate}] */
async function consumeFEFO(stores, productId, quantity) {
  const batches = (await wrap(stores.batches.index("by_productId").getAll(productId)))
    .filter((b) => Number(b.quantity) > 0)
    .sort((a, b) => String(a.expiryDate || "9999").localeCompare(String(b.expiryDate || "9999")));
  let remaining = quantity;
  const used = [];
  for (const batch of batches) {
    if (remaining <= 0) break;
    const take = Math.min(Number(batch.quantity), remaining);
    batch.quantity = Number(batch.quantity) - take;
    batch.updatedAt = new Date().toISOString();
    await wrap(stores.batches.put(batch));
    used.push({ batchId: batch.id, batchNumber: batch.batchNumber, quantity: take, expiryDate: batch.expiryDate });
    remaining -= take;
  }
  return { used, remaining };
}

/* ---------- public operations ---------- */

export async function applyStockChange({ productId, type, quantity, reason = "", batch = null, refId = null, refType = null, unitCost = null }) {
  const qty = Math.abs(Number(quantity) || 0);
  if (!qty) throw new Error("Quantity must be greater than zero");
  const isIn = IN_TYPES.includes(type);
  const result = await tx(
    ["products", "inventory", "batches", "stockMovements", "notifications"],
    "readwrite",
    async (stores) => {
      const product = await wrap(stores.products.get(productId));
      if (!product) throw new Error("Product not found");
      let fefo = { used: [], remaining: 0 };
      let batchId = null;

      if (isIn) {
        const bn = batch?.batchNumber?.trim();
        if (bn) {
          const existing = (await wrap(stores.batches.index("by_productId").getAll(productId))).find((b) => b.batchNumber === bn);
          if (existing) {
            existing.quantity = Number(existing.quantity) + qty;
            if (batch.expiryDate) existing.expiryDate = batch.expiryDate;
            existing.updatedAt = new Date().toISOString();
            await wrap(stores.batches.put(existing));
            batchId = existing.id;
          } else {
            const created = {
              id: uid("bat"),
              batchNumber: bn,
              productId,
              manufacturingDate: batch.manufacturingDate || null,
              expiryDate: batch.expiryDate || null,
              quantity: qty,
              purchasePrice: Number(unitCost ?? batch.purchasePrice ?? product.purchasePrice) || 0,
              supplierId: batch.supplierId || product.supplierId || null,
              createdAt: new Date().toISOString(),
            };
            await wrap(stores.batches.put(created));
            batchId = created.id;
          }
        }
        product.quantity = (Number(product.quantity) || 0) + qty;
      } else {
        const available = Number(product.quantity) || 0;
        if (qty > available && !state.settings.allowNegativeStock) {
          throw new Error(`${t("no_stock")}: ${available}`);
        }
        if (state.settings.enableFEFO) {
          fefo = await consumeFEFO(stores, productId, qty);
          batchId = fefo.used[0]?.batchId || null;
        }
        product.quantity = available - qty;
      }
      product.updatedAt = new Date().toISOString();
      await wrap(stores.products.put(product));
      const status = await syncInventoryRow(stores, product);

      const movement = await addMovement(stores, {
        productId,
        type,
        quantity: isIn ? qty : -qty,
        reason,
        batchId,
        batches: fefo.used,
        refId,
        refType,
        unitCost: Number(unitCost ?? product.purchasePrice) || 0,
        balanceAfter: product.quantity,
      });

      if (status === "out") {
        await pushNotification(stores, "OUT_OF_STOCK", t("out_of_stock"), `${localName(product)} — ${product.sku}`, { productId });
      } else if (status === "critical") {
        await pushNotification(stores, "CRITICAL_STOCK", t("critical_stock"), `${localName(product)} — ${product.quantity}`, { productId });
      } else if (status === "low") {
        await pushNotification(stores, "LOW_STOCK", t("low_stock"), `${localName(product)} — ${product.quantity}`, { productId });
      }
      return { product, movement, fefo: fefo.used };
    },
  );
  await logActivity(type, "product", `${type} ${qty} — ${result.product.sku}`, { productId });
  await reload(["products", "inventory", "batches", "stockMovements", "notifications", "activityLog"]);
  return result;
}

export async function receivePurchase(purchaseId) {
  const result = await tx(
    ["purchaseOrders", "purchaseItems", "products", "inventory", "batches", "stockMovements", "notifications"],
    "readwrite",
    async (stores) => {
      const po = await wrap(stores.purchaseOrders.get(purchaseId));
      if (!po) throw new Error("Purchase order not found");
      if (po.status === "received") throw new Error("Already received");
      const items = await wrap(stores.purchaseItems.index("by_purchaseId").getAll(purchaseId));
      for (const item of items) {
        const product = await wrap(stores.products.get(item.productId));
        if (!product) continue;
        const qty = Number(item.quantity) || 0;
        if (qty <= 0) continue;
        const batchNumber = item.batchNumber || `PO-${po.poNumber}-${product.sku}`;
        const existing = (await wrap(stores.batches.index("by_productId").getAll(product.id))).find((b) => b.batchNumber === batchNumber);
        if (existing) {
          existing.quantity = Number(existing.quantity) + qty;
          await wrap(stores.batches.put(existing));
        } else {
          await wrap(
            stores.batches.put({
              id: uid("bat"),
              batchNumber,
              productId: product.id,
              manufacturingDate: item.manufacturingDate || po.date,
              expiryDate: item.expiryDate || null,
              quantity: qty,
              purchasePrice: Number(item.unitCost) || Number(product.purchasePrice) || 0,
              supplierId: po.supplierId,
              createdAt: new Date().toISOString(),
            }),
          );
        }
        product.quantity = (Number(product.quantity) || 0) + qty;
        if (Number(item.unitCost) > 0) product.purchasePrice = Number(item.unitCost);
        product.updatedAt = new Date().toISOString();
        await wrap(stores.products.put(product));
        await syncInventoryRow(stores, product);
        await addMovement(stores, {
          productId: product.id,
          type: "PURCHASE",
          quantity: qty,
          reason: `PO ${po.poNumber}`,
          refId: po.id,
          refType: "purchase",
          unitCost: Number(item.unitCost) || 0,
          balanceAfter: product.quantity,
          batches: [{ batchNumber, quantity: qty }],
        });
        item.receivedQuantity = qty;
        await wrap(stores.purchaseItems.put(item));
      }
      po.status = "received";
      po.receivedAt = new Date().toISOString();
      await wrap(stores.purchaseOrders.put(po));
      await pushNotification(stores, "PURCHASE_RECEIVED", t("received"), `PO ${po.poNumber}`, { purchaseId: po.id });
      return po;
    },
  );
  await logActivity("RECEIVE", "purchase", `Received PO ${result.poNumber}`, { id: result.id });
  await reload(["purchaseOrders", "purchaseItems", "products", "inventory", "batches", "stockMovements", "notifications", "activityLog"]);
  return result;
}

/**
 * createSale({customerId, date, lines:[{productId,quantity,price,discount}], discount, tax, paymentMethod, paymentStatus, notes})
 * Atomic: sale -> saleItems -> products -> inventory -> batches -> movements -> notifications
 */
export async function createSale(payload) {
  const invoiceNumber = payload.invoiceNumber || nextInvoiceNumber();
  const result = await tx(
    ["sales", "saleItems", "products", "inventory", "batches", "stockMovements", "notifications"],
    "readwrite",
    async (stores) => {
      const lines = payload.lines.filter((l) => l.productId && Number(l.quantity) > 0);
      if (!lines.length) throw new Error("Add at least one product line");
      // validate stock first
      const loaded = {};
      for (const line of lines) {
        const product = await wrap(stores.products.get(line.productId));
        if (!product) throw new Error("Product not found");
        loaded[line.productId] = product;
        const available = Number(product.quantity) || 0;
        if (Number(line.quantity) > available && !state.settings.allowNegativeStock) {
          throw new Error(`${t("no_stock")}: ${localName(product)} (${available})`);
        }
      }
      const subtotal = sum(lines, (l) => Number(l.quantity) * Number(l.price) - (Number(l.discount) || 0));
      const discount = Number(payload.discount) || 0;
      const taxRate = Number(payload.tax) || 0;
      const taxable = Math.max(0, subtotal - discount);
      const taxAmount = (taxable * taxRate) / 100;
      const total = taxable + taxAmount;
      let cogs = 0;

      const saleId = uid("sal");
      for (const line of lines) {
        const product = loaded[line.productId];
        const qty = Number(line.quantity);
        const fefo = state.settings.enableFEFO ? await consumeFEFO(stores, product.id, qty) : { used: [] };
        product.quantity = (Number(product.quantity) || 0) - qty;
        product.updatedAt = new Date().toISOString();
        await wrap(stores.products.put(product));
        const status = await syncInventoryRow(stores, product);
        cogs += qty * (Number(product.purchasePrice) || 0);
        await wrap(
          stores.saleItems.put({
            id: uid("sit"),
            saleId,
            productId: product.id,
            productName: localName(product),
            sku: product.sku,
            quantity: qty,
            price: Number(line.price),
            discount: Number(line.discount) || 0,
            cost: Number(product.purchasePrice) || 0,
            total: qty * Number(line.price) - (Number(line.discount) || 0),
            batches: fefo.used,
          }),
        );
        await addMovement(stores, {
          productId: product.id,
          type: "SALE",
          quantity: -qty,
          reason: `${t("invoice_number")} ${invoiceNumber}`,
          refId: saleId,
          refType: "sale",
          batchId: fefo.used[0]?.batchId || null,
          batches: fefo.used,
          unitCost: Number(product.purchasePrice) || 0,
          balanceAfter: product.quantity,
        });
        if (status === "out" || status === "critical" || status === "low") {
          await pushNotification(
            stores,
            status === "out" ? "OUT_OF_STOCK" : status === "critical" ? "CRITICAL_STOCK" : "LOW_STOCK",
            t(status === "out" ? "out_of_stock" : status === "critical" ? "critical_stock" : "low_stock"),
            `${localName(product)} — ${product.quantity}`,
            { productId: product.id },
          );
        }
      }
      const sale = {
        id: saleId,
        invoiceNumber,
        customerId: payload.customerId || null,
        date: payload.date || new Date().toISOString().slice(0, 10),
        subtotal,
        discount,
        tax: taxRate,
        taxAmount,
        total,
        cogs,
        profit: total - taxAmount - cogs,
        paymentMethod: payload.paymentMethod || "cash",
        paymentStatus: payload.paymentStatus || "paid",
        notes: payload.notes || "",
        createdAt: new Date().toISOString(),
      };
      await wrap(stores.sales.put(sale));
      await pushNotification(stores, "SALES", t("sale_done"), `${invoiceNumber}`, { saleId });
      return sale;
    },
  );
  await logActivity("SALE", "sale", `${t("sale_done")} ${result.invoiceNumber}`, { id: result.id });
  await reload(["sales", "saleItems", "products", "inventory", "batches", "stockMovements", "notifications", "activityLog"]);
  return result;
}

export function nextInvoiceNumber() {
  const year = new Date().getFullYear();
  const count = get("sales").filter((s) => String(s.invoiceNumber).includes(`INV-${year}`)).length + 1;
  return `INV-${year}-${String(count).padStart(4, "0")}`;
}

export function nextPONumber() {
  const year = new Date().getFullYear();
  const count = get("purchaseOrders").filter((p) => String(p.poNumber).includes(`PO-${year}`)).length + 1;
  return `PO-${year}-${String(count).padStart(4, "0")}`;
}

export function nextSKU() {
  return `NC-${String(get("products").length + 1).padStart(4, "0")}`;
}

/** Scan open expiry issues and create notifications (deduplicated per day). */
export async function runExpiryScan() {
  if (!state.settings.expiryAlerts) return 0;
  const today = new Date().toISOString().slice(0, 10);
  const existing = new Set(
    get("notifications")
      .filter((n) => n.type === "EXPIRY" && String(n.createdAt).slice(0, 10) === today)
      .map((n) => n.meta?.batchId),
  );
  const risky = get("batches").filter((b) => Number(b.quantity) > 0 && b.expiryDate && ["expired", "critical", "soon"].includes(expiryStatus(b.expiryDate)));
  const toCreate = risky.filter((b) => !existing.has(b.id));
  if (!toCreate.length) return 0;
  await tx("notifications", "readwrite", async (stores) => {
    for (const batch of toCreate) {
      const product = byId("products", batch.productId);
      await wrap(
        stores.notifications.put({
          id: uid("ntf"),
          type: "EXPIRY",
          title: t(EXPIRY_META[expiryStatus(batch.expiryDate)].key),
          message: `${localName(product)} — ${batch.batchNumber} (${batch.expiryDate})`,
          meta: { batchId: batch.id, productId: batch.productId },
          read: 0,
          createdAt: new Date().toISOString(),
        }),
      );
    }
    return true;
  });
  await reload("notifications");
  return toCreate.length;
}
