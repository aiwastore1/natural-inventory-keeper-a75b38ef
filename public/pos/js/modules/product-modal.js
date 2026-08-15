/**
 * Advanced 3-tab Add/Edit product modal:
 *  Tab 1 Basic info (+ additional barcodes, initial batch, margin presets)
 *  Tab 2 Attributes & multi-pricing (units, wholesale packs, tiered prices)
 *  Tab 3 Variants & matrix generator (option groups, bulk fill, barcodes)
 */
import { db, uid, logActivity } from "../database.js";
import { get, byId, reload, state } from "../state.js";
import { t, localName } from "../i18n.js";
import { esc, money, num, todayISO } from "../utils/format.js";
import * as UI from "../components/ui.js";
import { nextSKU, applyStockChange } from "./domain.js";
import { buildMatrix, bulkFill, fillEmptyBarcodes, generateBarcode, parseValues, priceFromMargin, variantStock } from "./variants.js";
import { broadcastSync } from "./network.js";

const MARGINS = [0, 10, 20, 30, 50];

function tabButton(id, label, active) {
  return `<button type="button" class="tab-btn ${active ? "active" : ""}" data-tab="${id}">${esc(label)}</button>`;
}

export function openProductModal(product, done = () => {}) {
  const p = product ? { ...product } : {};
  const model = {
    extraBarcodes: [...(p.extraBarcodes || [])],
    tiers: [...(p.tierPrices || [])],
    groups: (p.optionGroups || []).map((g) => ({ ...g, values: [...g.values] })),
    variants: product ? get("variants").filter((v) => v.productId === product.id).map((v) => ({ ...v, index: 0 })) : [],
    variantsEnabled: Boolean(p.hasVariants),
    tab: "basic",
  };
  model.variants = model.variants.map((v, i) => ({ ...v, index: i + 1 }));

  const cats = get("categories");
  const sups = get("suppliers");
  const brands = get("brands");

  UI.openModal({
    title: product ? `${t("edit")} — ${localName(product)}` : t("new_product"),
    size: "xl",
    body: `<div class="pm">
      <div class="tabs">
        ${tabButton("basic", t("tab_basic"), true)}
        ${tabButton("attrs", t("tab_attrs"), false)}
        ${tabButton("variants", t("tab_variants"), false)}
      </div>
      <form id="pform" class="pm-body" novalidate><div id="pm-pane"></div></form>
    </div>`,
    footer: `<button class="btn" data-close>${t("cancel")}</button><button class="btn btn-primary" data-save>${t("save")}</button>`,
    onMount(modal) {
      const pane = modal.querySelector("#pm-pane");
      const form = modal.querySelector("#pform");
      const draft = {
        nameAr: p.nameAr || "",
        nameEn: p.nameEn || "",
        nameFr: p.nameFr || "",
        sku: p.sku || nextSKU(),
        barcode: p.barcode || "",
        categoryId: p.categoryId || cats[0]?.id || "",
        family: p.family || "",
        brandId: p.brandId || "",
        supplierId: p.supplierId || "",
        minimumStock: p.minimumStock ?? state.settings.defaultMinimumStock,
        shelfLocation: p.shelfLocation || "",
        descriptionAr: p.descriptionAr || "",
        image: p.image || "",
        initialQty: product ? 0 : 0,
        purchasePrice: p.purchasePrice ?? 0,
        sellingPrice: p.sellingPrice ?? 0,
        wholesalePrice: p.wholesalePrice ?? 0,
        expiryDate: "",
        unit: p.unit || t("unit_piece"),
        weightVolume: p.weightVolume || "",
        color: p.color || "",
        wholesaleUnit: p.wholesaleUnit || "",
        unitsPerPack: p.unitsPerPack ?? 0,
        status: p.status || "active",
      };

      function readPane() {
        pane.querySelectorAll("[name]").forEach((el) => {
          if (el.type === "file") return;
          draft[el.name] = el.type === "number" ? Number(el.value) || 0 : el.value;
        });
      }

      /* ------------------------------ panes ------------------------------ */

      function basicPane() {
        return `
        <div class="form-grid">
          ${UI.field({ label: `${t("barcode")} (${t("main")})`, name: "barcode", value: draft.barcode, attrs: 'id="f_barcode"' })}
          <div class="field"><label>&nbsp;</label><button type="button" class="btn" data-gen-barcode>🎲 ${t("generate_barcode")}</button></div>
          <div class="field full extra-bc">
            <label>${t("additional_barcodes")}</label>
            <div id="bc-list">${model.extraBarcodes
              .map((code, i) => `<div class="dyn-row"><input class="input" data-bc="${i}" value="${esc(code)}"><button type="button" class="btn btn-danger btn-sm" data-bc-del="${i}">🗑</button></div>`)
              .join("")}</div>
            <button type="button" class="btn btn-sm" data-bc-add>+ ${t("add_barcode")}</button>
          </div>
          ${UI.field({ label: "الاسم (AR)", name: "nameAr", value: draft.nameAr, required: true })}
          ${UI.field({ label: "Name (EN)", name: "nameEn", value: draft.nameEn, required: true })}
          ${UI.field({ label: "Nom (FR)", name: "nameFr", value: draft.nameFr })}
          ${UI.field({ label: t("sku"), name: "sku", value: draft.sku, required: true })}
          ${UI.selectField({ label: t("category"), name: "categoryId", required: true, options: UI.selectOptions(cats, "id", localName, draft.categoryId) })}
          ${UI.field({ label: t("family"), name: "family", value: draft.family })}
          ${UI.selectField({ label: t("brand"), name: "brandId", options: `<option value="">—</option>${UI.selectOptions(brands, "id", localName, draft.brandId)}` })}
          ${UI.selectField({ label: t("supplier"), name: "supplierId", options: `<option value="">—</option>${UI.selectOptions(sups, "id", (s) => s.name, draft.supplierId)}` })}
          ${UI.field({ label: t("min_stock"), name: "minimumStock", type: "number", value: draft.minimumStock, attrs: 'min="0"' })}
          ${UI.field({ label: t("shelf_location"), name: "shelfLocation", value: draft.shelfLocation })}
          ${UI.textareaField({ label: t("description"), name: "descriptionAr", value: draft.descriptionAr })}
          <div class="field full"><label>${t("image")}</label>
            <div class="file-upload">
              <label class="btn" for="f_img">📷 ${t("choose_file")}</label>
              <input class="input" id="f_img" type="file" accept="image/*" hidden>
              <span class="stat-hint" id="f_img_name"></span>
            </div>
            <div id="img-prev">${draft.image ? `<img src="${draft.image}" alt="" class="img-prev">` : ""}</div></div>
        </div>
        <fieldset class="pm-fs"><legend>${t("initial_batch")}</legend>
          <div class="form-grid">
            ${UI.field({ label: t("initial_quantity"), name: "initialQty", type: "number", value: draft.initialQty, attrs: 'min="0"' })}
            ${UI.field({ label: `${t("purchase_price")} (${t("currency_dzd")})`, name: "purchasePrice", type: "number", value: draft.purchasePrice, attrs: 'min="0" step="0.01" id="f_cost"' })}
            <div class="field full"><label>${t("quick_margin")}</label>
              <div class="margin-bar">${MARGINS.map((m) => `<button type="button" class="btn btn-sm" data-margin="${m}">${m}%</button>`).join("")}</div></div>
            ${UI.field({ label: `${t("selling_price")} (${t("retail")})`, name: "sellingPrice", type: "number", value: draft.sellingPrice, required: true, attrs: 'min="0" step="0.01" id="f_price"' })}
            ${UI.field({ label: `${t("selling_price")} (${t("wholesale")})`, name: "wholesalePrice", type: "number", value: draft.wholesalePrice, attrs: 'min="0" step="0.01"' })}
            ${UI.field({ label: t("expiry_date"), name: "expiryDate", type: "date", value: draft.expiryDate })}
          </div>
        </fieldset>`;
      }

      function attrsPane() {
        return `
        <fieldset class="pm-fs"><legend>${t("unit_attributes")}</legend>
          <div class="form-grid">
            ${UI.field({ label: t("unit_of_measure"), name: "unit", value: draft.unit })}
            ${UI.field({ label: t("weight_volume"), name: "weightVolume", value: draft.weightVolume, hint: "500غ / 250ml" })}
            ${UI.field({ label: t("color"), name: "color", value: draft.color })}
          </div>
        </fieldset>
        <fieldset class="pm-fs"><legend>${t("wholesale_settings")}</legend>
          <div class="form-grid">
            ${UI.field({ label: t("wholesale_unit"), name: "wholesaleUnit", value: draft.wholesaleUnit, hint: "علبة / كرتونة" })}
            ${UI.field({ label: t("units_per_pack"), name: "unitsPerPack", type: "number", value: draft.unitsPerPack, attrs: 'min="0"' })}
          </div>
        </fieldset>
        <fieldset class="pm-fs"><legend>${t("tiered_prices")}</legend>
          <div id="tier-list">${model.tiers
            .map(
              (tier, i) => `<div class="dyn-row"><input class="input" data-tier-label="${i}" value="${esc(tier.label)}" placeholder="${t("price_label")}">
              <input class="input" data-tier-value="${i}" type="number" min="0" step="0.01" value="${Number(tier.value) || 0}">
              <button type="button" class="btn btn-danger btn-sm" data-tier-del="${i}">🗑</button></div>`,
            )
            .join("")}</div>
          <button type="button" class="btn btn-sm" data-tier-add>+ ${t("add_price")}</button>
        </fieldset>`;
      }

      function variantsPane() {
        return `
        <div class="switch-row">
          <label class="switch"><input type="checkbox" id="v-enable" ${model.variantsEnabled ? "checked" : ""}><span></span></label>
          <span>${t("enable_variants")}</span>
        </div>
        <div class="${model.variantsEnabled ? "" : "muted-block"}" id="v-area">
          <fieldset class="pm-fs"><legend>${t("option_groups")}</legend>
            <div id="grp-list">${model.groups
              .map(
                (g, i) => `<div class="grp">
                  <input class="input" data-grp-name="${i}" value="${esc(g.name)}" placeholder="${t("attribute_name")}">
                  <div class="tags" data-tags="${i}">${g.values.map((v, vi) => `<span class="tag">${esc(v)}<button type="button" data-tag-del="${i}:${vi}">✕</button></span>`).join("")}</div>
                  <input class="input" data-grp-input="${i}" placeholder="${t("values_hint")}">
                  <button type="button" class="btn btn-danger btn-sm" data-grp-del="${i}">🗑</button>
                </div>`,
              )
              .join("")}</div>
            <button type="button" class="btn btn-sm" data-grp-add>+ ${t("add_option_group")}</button>
          </fieldset>
          <div class="bulk-bar">
            <input class="input" id="bf-cost" type="number" min="0" step="0.01" placeholder="${t("cost_price")}">
            <input class="input" id="bf-price" type="number" min="0" step="0.01" placeholder="${t("selling_price")}">
            <input class="input" id="bf-qty" type="number" min="0" placeholder="${t("quantity")}">
            <button type="button" class="btn btn-primary" id="bf-apply">⚡ ${t("bulk_apply")}</button>
            <button type="button" class="btn" id="bf-barcodes">🏷 ${t("generate_empty_barcodes")}</button>
          </div>
          <div class="warn-note">⚠ ${t("variant_override_warning")}</div>
          <div class="table-wrap"><table class="table variant-table">
            <thead><tr><th>#</th><th>${t("variant_name")}</th><th>${t("barcode")}</th><th>${t("quantity")}</th><th>${t("cost_price")}</th><th>${t("selling_price")}</th><th>${t("active")}</th><th></th></tr></thead>
            <tbody>${
              model.variants.length
                ? model.variants
                    .map(
                      (v, i) => `<tr><td>${v.index || i + 1}</td><td>${esc(v.name)}</td>
                  <td><input class="input" data-v-barcode="${i}" value="${esc(v.barcode || "")}"></td>
                  <td><input class="input" data-v-qty="${i}" type="number" min="0" value="${Number(v.quantity) || 0}"></td>
                  <td><input class="input" data-v-cost="${i}" type="number" min="0" step="0.01" value="${Number(v.costPrice) || 0}"></td>
                  <td><input class="input" data-v-price="${i}" type="number" min="0" step="0.01" value="${Number(v.sellingPrice) || 0}"></td>
                  <td><input type="checkbox" data-v-active="${i}" ${v.active !== false ? "checked" : ""}></td>
                  <td><button type="button" class="btn btn-sm btn-danger" data-v-del="${i}">🗑</button></td></tr>`,
                    )
                    .join("")
                : `<tr><td colspan="8" class="stat-hint" style="padding:16px">${t("no_variants_yet")}</td></tr>`
            }</tbody>
          </table></div>
          <div class="stat-hint">${t("total_variant_stock")}: <strong>${num(variantStock(model.variants))}</strong></div>
        </div>`;
      }

      /* ------------------------------ wiring ----------------------------- */

      function regenerate() {
        model.variants = buildMatrix(model.groups, model.variants).map((v, i) => ({ ...v, index: i + 1 }));
      }

      function renderPane() {
        pane.innerHTML = model.tab === "basic" ? basicPane() : model.tab === "attrs" ? attrsPane() : variantsPane();
        modal.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === model.tab));
        wirePane();
      }

      function switchTab(tab) {
        readPane();
        model.tab = tab;
        renderPane();
      }

      function wirePane() {
        // Tab 1
        pane.querySelector("[data-gen-barcode]")?.addEventListener("click", () => {
          draft.barcode = generateBarcode();
          pane.querySelector("#f_barcode").value = draft.barcode;
        });
        pane.querySelector("[data-bc-add]")?.addEventListener("click", () => {
          readPane();
          model.extraBarcodes.push(generateBarcode());
          renderPane();
        });
        pane.querySelectorAll("[data-bc]").forEach((inp) => inp.addEventListener("change", () => { model.extraBarcodes[Number(inp.dataset.bc)] = inp.value.trim(); }));
        pane.querySelectorAll("[data-bc-del]").forEach((b) =>
          b.addEventListener("click", () => {
            readPane();
            model.extraBarcodes.splice(Number(b.dataset.bcDel), 1);
            renderPane();
          }),
        );
        pane.querySelectorAll("[data-margin]").forEach((b) =>
          b.addEventListener("click", () => {
            const cost = Number(pane.querySelector("#f_cost").value) || 0;
            const price = priceFromMargin(cost, b.dataset.margin);
            pane.querySelector("#f_price").value = price;
            draft.sellingPrice = price;
          }),
        );
        pane.querySelector("#f_img")?.addEventListener("change", (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            draft.image = String(reader.result);
            pane.querySelector("#img-prev").innerHTML = `<img src="${draft.image}" alt="" class="img-prev">`;
            const nameEl = pane.querySelector("#f_img_name");
            if (nameEl) nameEl.textContent = file.name;
          };
          reader.readAsDataURL(file);
        });

        // Tab 2
        pane.querySelector("[data-tier-add]")?.addEventListener("click", () => {
          readPane();
          model.tiers.push({ label: "", value: 0 });
          renderPane();
        });
        pane.querySelectorAll("[data-tier-label]").forEach((inp) => inp.addEventListener("change", () => { model.tiers[Number(inp.dataset.tierLabel)].label = inp.value; }));
        pane.querySelectorAll("[data-tier-value]").forEach((inp) => inp.addEventListener("change", () => { model.tiers[Number(inp.dataset.tierValue)].value = Number(inp.value) || 0; }));
        pane.querySelectorAll("[data-tier-del]").forEach((b) =>
          b.addEventListener("click", () => {
            readPane();
            model.tiers.splice(Number(b.dataset.tierDel), 1);
            renderPane();
          }),
        );

        // Tab 3
        pane.querySelector("#v-enable")?.addEventListener("change", (e) => {
          model.variantsEnabled = e.target.checked;
          if (model.variantsEnabled && !model.groups.length) model.groups.push({ name: "", values: [] });
          renderPane();
        });
        pane.querySelector("[data-grp-add]")?.addEventListener("click", () => {
          model.groups.push({ name: "", values: [] });
          renderPane();
        });
        pane.querySelectorAll("[data-grp-name]").forEach((inp) =>
          inp.addEventListener("change", () => {
            model.groups[Number(inp.dataset.grpName)].name = inp.value.trim();
            regenerate();
            renderPane();
          }),
        );
        pane.querySelectorAll("[data-grp-input]").forEach((inp) => {
          const commit = () => {
            const values = parseValues(inp.value);
            if (!values.length) return;
            const group = model.groups[Number(inp.dataset.grpInput)];
            values.forEach((v) => {
              if (!group.values.some((x) => x.toLowerCase() === v.toLowerCase())) group.values.push(v);
            });
            inp.value = "";
            regenerate();
            renderPane();
          };
          inp.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          });
          inp.addEventListener("blur", commit);
          inp.addEventListener("paste", () => setTimeout(commit, 0));
        });
        pane.querySelectorAll("[data-tag-del]").forEach((b) =>
          b.addEventListener("click", () => {
            const [gi, vi] = b.dataset.tagDel.split(":").map(Number);
            model.groups[gi].values.splice(vi, 1);
            regenerate();
            renderPane();
          }),
        );
        pane.querySelectorAll("[data-grp-del]").forEach((b) =>
          b.addEventListener("click", () => {
            model.groups.splice(Number(b.dataset.grpDel), 1);
            regenerate();
            renderPane();
          }),
        );
        pane.querySelector("#bf-apply")?.addEventListener("click", () => {
          const cost = pane.querySelector("#bf-cost").value;
          const price = pane.querySelector("#bf-price").value;
          const qty = pane.querySelector("#bf-qty").value;
          if (cost !== "") model.variants = bulkFill(model.variants, "costPrice", cost);
          if (price !== "") model.variants = bulkFill(model.variants, "sellingPrice", price);
          if (qty !== "") model.variants = bulkFill(model.variants, "quantity", qty);
          renderPane();
          UI.toast(t("bulk_applied"));
        });
        pane.querySelector("#bf-barcodes")?.addEventListener("click", () => {
          model.variants = fillEmptyBarcodes(model.variants);
          renderPane();
        });
        const bindV = (attr, key, numeric = true) =>
          pane.querySelectorAll(`[data-v-${attr}]`).forEach((inp) =>
            inp.addEventListener("change", () => {
              const i = Number(inp.dataset[`v${attr[0].toUpperCase()}${attr.slice(1)}`]);
              model.variants[i][key] = inp.type === "checkbox" ? inp.checked : numeric ? Number(inp.value) || 0 : inp.value.trim();
            }),
          );
        bindV("barcode", "barcode", false);
        bindV("qty", "quantity");
        bindV("cost", "costPrice");
        bindV("price", "sellingPrice");
        bindV("active", "active");
        pane.querySelectorAll("[data-v-del]").forEach((b) =>
          b.addEventListener("click", () => {
            model.variants.splice(Number(b.dataset.vDel), 1);
            renderPane();
          }),
        );
      }

      modal.querySelectorAll(".tab-btn").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
      renderPane();

      /* ------------------------------- save ------------------------------ */

      modal.querySelector("[data-save]").addEventListener("click", async () => {
        readPane();
        if (!draft.nameAr && !draft.nameEn) return UI.toast(t("required_field"), "error");
        if (!draft.sku) return UI.toast(t("required_field"), "error");
        if (get("products").some((x) => x.sku === draft.sku && x.id !== p.id)) return UI.toast(t("duplicate_sku"), "error");
        const codes = [draft.barcode, ...model.extraBarcodes].filter(Boolean);
        const clash = get("products").find((x) => x.id !== p.id && [x.barcode, ...(x.extraBarcodes || [])].some((c) => c && codes.includes(c)));
        if (clash) return UI.toast(t("duplicate_barcode"), "error");

        const useVariants = model.variantsEnabled && model.variants.length > 0;
        const record = {
          id: p.id || uid("prd"),
          nameAr: draft.nameAr,
          nameEn: draft.nameEn || draft.nameAr,
          nameFr: draft.nameFr,
          sku: draft.sku,
          barcode: draft.barcode,
          extraBarcodes: model.extraBarcodes.filter(Boolean),
          categoryId: draft.categoryId,
          family: draft.family,
          brandId: draft.brandId || null,
          supplierId: draft.supplierId || null,
          minimumStock: Number(draft.minimumStock) || 0,
          maximumStock: p.maximumStock ?? 100,
          reorderPoint: p.reorderPoint ?? state.settings.defaultReorderPoint,
          shelfLocation: draft.shelfLocation,
          descriptionAr: draft.descriptionAr,
          descriptionEn: p.descriptionEn || "",
          image: draft.image,
          purchasePrice: Number(draft.purchasePrice) || 0,
          sellingPrice: Number(draft.sellingPrice) || 0,
          wholesalePrice: Number(draft.wholesalePrice) || 0,
          unit: draft.unit,
          weightVolume: draft.weightVolume,
          color: draft.color,
          wholesaleUnit: draft.wholesaleUnit,
          unitsPerPack: Number(draft.unitsPerPack) || 0,
          tierPrices: model.tiers.filter((x) => x.label),
          optionGroups: model.groups.filter((g) => g.name && g.values.length),
          hasVariants: useVariants,
          status: draft.status || "active",
          quantity: Number(p.quantity) || 0,
          createdAt: p.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        if (useVariants) record.quantity = variantStock(model.variants);
        await db.put("products", record);

        // sync variant rows
        const existing = get("variants").filter((v) => v.productId === record.id);
        for (const old of existing) {
          if (!model.variants.some((v) => v.id === old.id)) await db.delete("variants", old.id);
        }
        for (const v of model.variants) {
          await db.put("variants", {
            id: v.id || uid("var"),
            productId: record.id,
            name: v.name,
            options: v.options || {},
            barcode: v.barcode || "",
            quantity: Number(v.quantity) || 0,
            costPrice: Number(v.costPrice) || 0,
            sellingPrice: Number(v.sellingPrice) || Number(record.sellingPrice) || 0,
            active: v.active !== false,
            updatedAt: new Date().toISOString(),
          });
        }
        await reload(["products", "variants", "inventory"]);

        // initial batch (only when variants are not driving stock)
        const initialQty = Number(draft.initialQty) || 0;
        if (!useVariants && initialQty > 0) {
          await applyStockChange({
            productId: record.id,
            type: "STOCK_IN",
            quantity: initialQty,
            reason: t("initial_batch"),
            unitCost: record.purchasePrice,
            batch: {
              batchNumber: `BATCH-${(get("batches").filter((b) => b.productId === record.id).length || 0) + 1}`,
              expiryDate: draft.expiryDate || null,
              supplierId: record.supplierId,
              purchasePrice: record.purchasePrice,
            },
          });
        }

        await logActivity(product ? "UPDATE" : "CREATE", "product", `${record.sku} — ${record.nameAr || record.nameEn}`, { id: record.id });
        await reload(["products", "variants", "batches", "inventory", "stockMovements", "activityLog"]);
        broadcastSync({
          products: [record],
          variants: get("variants").filter((v) => v.productId === record.id),
          batches: get("batches").filter((b) => b.productId === record.id),
          inventory: get("inventory").filter((i) => i.productId === record.id),
          stockMovements: get("stockMovements").filter((m) => m.productId === record.id),
        });
        UI.closeModal();
        UI.toast(t("saved"));
        done();
      });

      void byId;
      void money;
      void todayISO;
    },
  });
}
