/**
 * Variant engine: option groups -> cartesian matrix, bulk fill, barcode generation.
 * Pure logic, no DOM. Used by the product modal (Tab 3).
 */

/** Build EAN-13 style numeric barcode with checksum. */
export function generateBarcode(prefix = "200") {
  const base = (String(prefix).replace(/\D/g, "") + Math.floor(Math.random() * 1e12)).slice(0, 12).padEnd(12, "0");
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(base[i]) * (i % 2 === 0 ? 1 : 3);
  const check = (10 - (sum % 10)) % 10;
  return `${base}${check}`;
}

/** Parse "bleu, noir; rouge" or newline separated values into clean tags. */
export function parseValues(raw) {
  return String(raw || "")
    .split(/[,;\n\t]+/)
    .map((v) => v.trim())
    .filter(Boolean)
    .filter((v, i, arr) => arr.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i);
}

/** groups: [{ name, values: [] }] -> [{ options: {name:value}, name: "bleu / 500g" }] */
export function cartesian(groups) {
  const usable = (groups || []).filter((g) => g.name?.trim() && g.values?.length);
  if (!usable.length) return [];
  let combos = [{}];
  for (const group of usable) {
    const next = [];
    for (const combo of combos) {
      for (const value of group.values) next.push({ ...combo, [group.name.trim()]: value });
    }
    combos = next;
  }
  return combos.map((options) => ({ options, name: Object.values(options).join(" / ") }));
}

/**
 * Merge generated combos with existing variant rows so user-entered
 * prices/quantities/barcodes survive regeneration.
 */
export function buildMatrix(groups, existing = []) {
  const combos = cartesian(groups);
  return combos.map((combo, index) => {
    const prev = existing.find((v) => v.name === combo.name) || {};
    return {
      id: prev.id || null,
      index: index + 1,
      name: combo.name,
      options: combo.options,
      barcode: prev.barcode || "",
      quantity: Number(prev.quantity) || 0,
      costPrice: Number(prev.costPrice) || 0,
      sellingPrice: Number(prev.sellingPrice) || 0,
      active: prev.active !== false,
    };
  });
}

/** Apply the same value to every row for one field (تعميم / bulk fill). */
export function bulkFill(rows, field, value) {
  const numeric = ["quantity", "costPrice", "sellingPrice"].includes(field);
  return rows.map((r) => ({ ...r, [field]: numeric ? Number(value) || 0 : value }));
}

/** Fill only the empty barcodes. */
export function fillEmptyBarcodes(rows, prefix = "200") {
  const used = new Set(rows.map((r) => r.barcode).filter(Boolean));
  return rows.map((r) => {
    if (r.barcode) return r;
    let code = generateBarcode(prefix);
    while (used.has(code)) code = generateBarcode(prefix);
    used.add(code);
    return { ...r, barcode: code };
  });
}

/** Sum of variant stock — overrides the product's initial batch quantity. */
export function variantStock(rows) {
  return rows.filter((r) => r.active !== false).reduce((acc, r) => acc + (Number(r.quantity) || 0), 0);
}

/** Margin helper for the quick margin bar (0/10/20/30/50%). */
export function priceFromMargin(cost, marginPct) {
  const c = Number(cost) || 0;
  return Math.round(c * (1 + (Number(marginPct) || 0) / 100) * 100) / 100;
}

export function marginOf(cost, price) {
  const c = Number(cost) || 0;
  if (!c) return 0;
  return ((Number(price) || 0) / c - 1) * 100;
}
