/**
 * Electronic scale barcode parsing (configurable prefix / PLU / value blocks).
 * Example with prefix=2, plu=5, value=5, decimals=3:
 *   "20150012345"  -> PLU 01500? no: prefix "2", PLU "01500", value "12345"
 *   "2015001500"   -> see settings; value/10^decimals gives kg or price.
 */
import { state } from "../state.js";
import { get } from "../state.js";

export function scaleConfig(settings = state.settings) {
  return {
    enabled: Boolean(settings.scaleEnabled),
    prefix: String(settings.scalePrefix ?? "2"),
    pluDigits: Number(settings.scalePluDigits) || 5,
    valueDigits: Number(settings.scaleValueDigits) || 5,
    valueType: settings.scaleValueType === "price" ? "price" : "weight",
    decimals: Number(settings.scaleDecimals) || 0,
  };
}

/** Parse a raw scanned code. Returns null when it is not a scale barcode. */
export function parseScaleBarcode(raw, settings = state.settings) {
  const cfg = scaleConfig(settings);
  if (!cfg.enabled) return null;
  const code = String(raw || "").replace(/\D/g, "");
  const expected = cfg.prefix.length + cfg.pluDigits + cfg.valueDigits;
  if (!cfg.prefix || !code.startsWith(cfg.prefix)) return null;
  // Tolerate a trailing check digit (EAN-13 convention).
  if (code.length !== expected && code.length !== expected + 1) return null;
  const plu = code.slice(cfg.prefix.length, cfg.prefix.length + cfg.pluDigits);
  const valueRaw = code.slice(cfg.prefix.length + cfg.pluDigits, cfg.prefix.length + cfg.pluDigits + cfg.valueDigits);
  const value = Number(valueRaw) / 10 ** cfg.decimals;
  return { plu, pluNumber: Number(plu), value, valueType: cfg.valueType, code };
}

/** Look up a product by its configured PLU code (falls back to sku/barcode tail). */
export function findByPLU(plu) {
  const stripped = String(plu).replace(/^0+/, "") || "0";
  const products = get("products");
  return (
    products.find((p) => String(p.plu || "").replace(/^0+/, "") === stripped) ||
    products.find((p) => String(p.plu || "") === String(plu)) ||
    products.find((p) => String(p.sku || "").endsWith(stripped)) ||
    products.find((p) => String(p.barcode || "").includes(String(plu))) ||
    null
  );
}

/**
 * Resolve a scale scan into a cart line instruction.
 * Weight  -> { quantity: weight, price: unitPrice }
 * Price   -> { quantity: total/unitPrice (implied), price: unitPrice, lineTotal: value }
 */
export function resolveScaleScan(raw, unitPriceOf, settings = state.settings) {
  const parsed = parseScaleBarcode(raw, settings);
  if (!parsed) return null;
  const product = findByPLU(parsed.plu);
  if (!product) return { parsed, product: null };
  const unitPrice = Number(unitPriceOf ? unitPriceOf(product) : product.sellingPrice) || 0;
  if (parsed.valueType === "weight") {
    return { parsed, product, quantity: parsed.value, price: unitPrice, lineTotal: unitPrice * parsed.value };
  }
  const quantity = unitPrice > 0 ? parsed.value / unitPrice : 1;
  return { parsed, product, quantity, price: unitPrice, lineTotal: parsed.value };
}
