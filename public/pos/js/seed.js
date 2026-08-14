/** Demo data generator — writes realistic seed records into IndexedDB. */
import { db, uid, logActivity } from "./database.js";
import { CATEGORIES, BRANDS, SUPPLIERS, CUSTOMERS, PRODUCTS } from "../data/seed-data.js";
import { stockStatus } from "./modules/domain.js";

function iso(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export async function seedDemoData() {
  await db.clearAll();
  const now = new Date().toISOString();

  const categories = await db.bulkInsert(
    "categories",
    CATEGORIES.map((c) => ({ id: uid("cat"), ...c, createdAt: now })),
  );
  const catMap = {};
  categories.forEach((c) => (catMap[c.key] = c.id));

  const brands = await db.bulkInsert("brands", BRANDS.map((b) => ({ id: uid("brd"), ...b, createdAt: now })));
  const suppliers = await db.bulkInsert(
    "suppliers",
    SUPPLIERS.map((s) => ({ id: uid("sup"), ...s, notes: "", status: "active", createdAt: now })),
  );
  const customers = await db.bulkInsert("customers", CUSTOMERS.map((c) => ({ id: uid("cus"), ...c, notes: "", createdAt: now })));

  const products = await db.bulkInsert(
    "products",
    PRODUCTS.map((p, i) => ({
      id: uid("prd"),
      nameAr: p.nameAr,
      nameEn: p.nameEn,
      nameFr: p.nameFr,
      sku: p.sku,
      barcode: p.barcode,
      categoryId: catMap[p.category] || catMap.other,
      brandId: brands[i % brands.length].id,
      descriptionAr: `${p.nameAr} — منتج طبيعي عالي الجودة.`,
      descriptionEn: `${p.nameEn} — high quality natural product.`,
      descriptionFr: `${p.nameFr} — produit naturel de haute qualité.`,
      unit: p.unit,
      purchasePrice: p.purchasePrice,
      sellingPrice: p.sellingPrice,
      quantity: p.quantity,
      minimumStock: p.minimumStock,
      maximumStock: p.maximumStock,
      reorderPoint: p.reorderPoint,
      supplierId: suppliers[i % suppliers.length].id,
      image: "",
      status: p.status,
      createdAt: now,
      updatedAt: now,
    })),
  );

  // Inventory rows
  await db.bulkInsert(
    "inventory",
    products.map((p) => ({
      id: uid("inv"),
      productId: p.id,
      quantity: p.quantity,
      value: p.quantity * p.purchasePrice,
      status: stockStatus(p),
      updatedAt: now,
    })),
  );

  // Batches with mixed expiry profiles
  const expiryOffsets = [-40, -5, 4, 12, 25, 45, 75, 140, 260, 400, 540];
  const batches = [];
  products.forEach((p, i) => {
    if (p.quantity <= 0) return;
    const count = p.quantity > 40 ? 3 : p.quantity > 10 ? 2 : 1;
    let left = p.quantity;
    for (let b = 0; b < count; b += 1) {
      const qty = b === count - 1 ? left : Math.max(1, Math.floor(p.quantity / count));
      left -= qty;
      const off = expiryOffsets[(i + b * 3) % expiryOffsets.length];
      batches.push({
        id: uid("bat"),
        batchNumber: `LOT-${p.sku.split("-")[1]}-${b + 1}`,
        productId: p.id,
        manufacturingDate: iso(off - 365),
        expiryDate: iso(off),
        quantity: qty,
        purchasePrice: p.purchasePrice,
        supplierId: p.supplierId,
        createdAt: now,
      });
      if (left <= 0) break;
    }
  });
  await db.bulkInsert("batches", batches);

  // Purchase orders
  const movements = [];
  const purchases = [];
  const purchaseItems = [];
  for (let i = 0; i < 8; i += 1) {
    const supplier = suppliers[i % suppliers.length];
    const id = uid("pur");
    const date = iso(-(i * 9 + 3));
    const picks = products.slice(i * 3, i * 3 + 3);
    let subtotal = 0;
    picks.forEach((p) => {
      const qty = 20 + ((i * 7 + p.purchasePrice) % 30);
      subtotal += qty * p.purchasePrice;
      purchaseItems.push({
        id: uid("pit"),
        purchaseId: id,
        productId: p.id,
        productName: p.nameEn,
        sku: p.sku,
        quantity: qty,
        receivedQuantity: i < 6 ? qty : 0,
        unitCost: p.purchasePrice,
        batchNumber: `LOT-${p.sku.split("-")[1]}-1`,
        expiryDate: iso(300 - i * 10),
        total: qty * p.purchasePrice,
      });
      if (i < 6) {
        movements.push({
          id: uid("mov"),
          productId: p.id,
          type: "PURCHASE",
          quantity: qty,
          reason: `PO-${2000 + i}`,
          refId: id,
          refType: "purchase",
          unitCost: p.purchasePrice,
          balanceAfter: p.quantity,
          createdAt: `${date}T09:15:00.000Z`,
        });
      }
    });
    const tax = 19;
    const taxAmount = (subtotal * tax) / 100;
    purchases.push({
      id,
      poNumber: `PO-${new Date().getFullYear()}-${String(i + 1).padStart(4, "0")}`,
      supplierId: supplier.id,
      date,
      subtotal,
      discount: 0,
      tax,
      taxAmount,
      shipping: 1500,
      total: subtotal + taxAmount + 1500,
      paymentStatus: i % 3 === 0 ? "unpaid" : "paid",
      status: i < 6 ? "received" : i === 6 ? "ordered" : "draft",
      notes: "",
      createdAt: `${date}T09:00:00.000Z`,
    });
  }
  await db.bulkInsert("purchaseOrders", purchases);
  await db.bulkInsert("purchaseItems", purchaseItems);

  // Sales spread over the last 60 days
  const sales = [];
  const saleItems = [];
  for (let d = 60; d >= 0; d -= 1) {
    const perDay = (d * 7) % 3;
    for (let s = 0; s <= perDay; s += 1) {
      const id = uid("sal");
      const date = iso(-d);
      const customer = customers[(d + s) % customers.length];
      const picks = [products[(d * 3 + s) % products.length], products[(d * 5 + s + 7) % products.length]].filter((p) => p.quantity > 0);
      if (!picks.length) continue;
      let subtotal = 0;
      let cogs = 0;
      picks.forEach((p) => {
        const qty = 1 + ((d + s) % 4);
        subtotal += qty * p.sellingPrice;
        cogs += qty * p.purchasePrice;
        saleItems.push({
          id: uid("sit"),
          saleId: id,
          productId: p.id,
          productName: p.nameEn,
          sku: p.sku,
          quantity: qty,
          price: p.sellingPrice,
          discount: 0,
          cost: p.purchasePrice,
          total: qty * p.sellingPrice,
          batches: [],
        });
        movements.push({
          id: uid("mov"),
          productId: p.id,
          type: "SALE",
          quantity: -qty,
          reason: `INV-${date}-${s}`,
          refId: id,
          refType: "sale",
          unitCost: p.purchasePrice,
          balanceAfter: p.quantity,
          createdAt: `${date}T13:${String(10 + s * 5).padStart(2, "0")}:00.000Z`,
        });
      });
      const tax = 19;
      const taxAmount = (subtotal * tax) / 100;
      sales.push({
        id,
        invoiceNumber: `INV-${new Date().getFullYear()}-${String(sales.length + 1).padStart(4, "0")}`,
        customerId: customer.id,
        date,
        subtotal,
        discount: 0,
        tax,
        taxAmount,
        total: subtotal + taxAmount,
        cogs,
        profit: subtotal - cogs,
        paymentMethod: ["cash", "card", "bank_transfer", "other"][(d + s) % 4],
        paymentStatus: (d + s) % 7 === 0 ? "unpaid" : "paid",
        notes: "",
        createdAt: `${date}T13:00:00.000Z`,
      });
    }
  }
  await db.bulkInsert("sales", sales);
  await db.bulkInsert("saleItems", saleItems);
  await db.bulkInsert("stockMovements", movements);

  // Notifications for current risky stock
  const notifications = products
    .filter((p) => ["out", "critical", "low"].includes(stockStatus(p)))
    .slice(0, 12)
    .map((p) => ({
      id: uid("ntf"),
      type: stockStatus(p) === "out" ? "OUT_OF_STOCK" : stockStatus(p) === "critical" ? "CRITICAL_STOCK" : "LOW_STOCK",
      title: stockStatus(p) === "out" ? "Out of stock" : stockStatus(p) === "critical" ? "Critical stock" : "Low stock",
      message: `${p.nameEn} — ${p.quantity} ${p.unit}`,
      meta: { productId: p.id },
      read: 0,
      createdAt: now,
    }));
  await db.bulkInsert("notifications", notifications);

  await logActivity("SEED", "system", "Demo data initialized");
  await db.setSetting("seeded", true);
  return true;
}

export async function ensureSeeded() {
  const seeded = await db.getSetting("seeded", false);
  const count = await db.count("products");
  if (!seeded && count === 0) await seedDemoData();
}
