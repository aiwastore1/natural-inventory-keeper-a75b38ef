/**
 * General settings tab (#/settings/general):
 * store logo, language, expense categories, legal store information,
 * POS behavior toggles, electronic scale config and stamp duty (droit de timbre).
 */
import { db, uid, logActivity } from "../database.js";
import { get, reload, state, saveSetting } from "../state.js";
import { t, LANGS, setLang } from "../i18n.js";
import { esc, money } from "../utils/format.js";
import { readFileDataURL } from "../utils/csv.js";
import * as UI from "../components/ui.js";

export const DEFAULT_EXPENSE_CATEGORIES = [
  { name: "إيجار / Rent" },
  { name: "كهرباء / Electricity" },
  { name: "ماء / Water" },
  { name: "رواتب / Salaries" },
  { name: "نقل / Transport" },
  { name: "صيانة / Maintenance" },
  { name: "أخرى / Other" },
];

export function expenseCategories() {
  return get("expenseCategories").slice().sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export async function ensureExpenseCategories() {
  if (get("expenseCategories").length) return;
  await db.bulkInsert(
    "expenseCategories",
    DEFAULT_EXPENSE_CATEGORIES.map((c, i) => ({ id: uid("exc"), name: c.name, system: true, createdAt: new Date(Date.now() + i).toISOString() })),
  );
  await reload("expenseCategories");
}

/* ---------------------------- stamp duty logic --------------------------- */

/**
 * Droit de timbre (Algeria) — applied to CASH invoices only.
 * Tiers, min and max are editable settings, not hardcoded constants, because
 * the Journal Officiel rate table is revised periodically (Loi de Finances).
 */
export function computeStampDuty(ttcTotal, paymentMethod = "cash", settings = state.settings) {
  if (!settings.stampDutyEnabled) return 0;
  if (String(paymentMethod).toLowerCase() !== "cash") return 0;
  const total = Number(ttcTotal) || 0;
  if (total <= 0) return 0;
  const tiers = Array.isArray(settings.stampDutyTiers) && settings.stampDutyTiers.length ? settings.stampDutyTiers : [{ upTo: null, rate: 1 }];
  const tier = tiers.find((tr) => tr.upTo === null || tr.upTo === undefined || total <= Number(tr.upTo)) || tiers[tiers.length - 1];
  const raw = (total * Number(tier.rate || 0)) / 100;
  const min = Number(settings.stampDutyMin) || 0;
  const max = Number(settings.stampDutyMax) || Infinity;
  return Math.min(Math.max(Math.ceil(raw), min), max);
}

/* -------------------------------- the view ------------------------------- */

const TOGGLES = [
  ["posQuickSale", "quick_sale", "quick_sale_hint"],
  ["posAccountingOnly", "accounting_only", "accounting_only_hint"],
  ["posAllowNegativeStock", "allow_negative_sale", "allow_negative_sale_hint"],
  ["posConfirmNegativeSale", "confirm_negative_sale", "confirm_negative_sale_hint"],
  ["posWeightedAveragePricing", "weighted_average_pricing", "weighted_average_pricing_hint"],
  ["stampDutyEnabled", "stamp_duty", "stamp_duty_hint"],
];

export async function generalSettings(route, view) {
  await ensureExpenseCategories();

  const render = () => {
    const s = state.settings;
    const tiers = Array.isArray(s.stampDutyTiers) ? s.stampDutyTiers : [];
    view.innerHTML = `
      <div class="grid g2">
        ${UI.card({
          title: t("store_logo"),
          body: `<div class="logo-drop" id="logo-drop" tabindex="0" role="button" aria-label="${t("store_logo")}">
              ${s.storeLogo ? `<img src="${esc(s.storeLogo)}" alt="${t("store_logo")}" class="logo-preview">` : `<span class="ic">🖼</span>`}
              <p class="hint">${t("logo_hint")}</p>
            </div>
            <input type="file" id="logo-file" accept="image/png,image/jpeg" hidden>
            <div class="row-actions" style="margin-top:10px">
              <button class="btn" data-pick-logo>${t("choose_file")}</button>
              ${s.storeLogo ? `<button class="btn btn-danger" data-remove-logo>${t("delete")}</button>` : ""}
            </div>`,
        })}
        ${UI.card({
          title: t("language_settings"),
          body: `<label class="field"><span class="label">${t("language")}</span>
            <select class="select" id="ui-lang" name="uiLanguage">${LANGS.map((l) => `<option value="${l.code}" ${s.language === l.code ? "selected" : ""}>${l.label}</option>`).join("")}</select>
          </label><p class="hint">${t("language_hint")}</p>`,
        })}
        ${UI.card({
          title: t("expense_categories"),
          cls: "full",
          body: `<div class="tag-list" id="cat-tags">${expenseCategories()
            .map((c) => `<span class="tag">${esc(c.name)}<button class="tag-x" data-del-cat="${c.id}" aria-label="${t("delete")}">×</button></span>`)
            .join("")}</div>
            <div class="row-actions" style="margin-top:10px">
              <input class="input" id="new-cat" placeholder="${esc(t("new_category"))}">
              <button class="btn btn-primary" data-add-cat>+ ${t("add")}</button>
            </div>
            <p class="hint">${t("expense_category_delete_hint")}</p>`,
        })}
        ${UI.card({
          title: t("store_information"),
          cls: "full",
          body: `<form id="store-form" class="grid g3">
            ${UI.field({ label: t("store_name"), name: "storeName", value: s.storeName, required: true })}
            ${UI.field({ label: t("store_description"), name: "storeDescription", value: s.storeDescription })}
            ${UI.field({ label: t("address"), name: "storeAddress", value: s.storeAddress })}
            ${UI.field({ label: t("landline"), name: "storeLandline", value: s.storeLandline, attrs: 'placeholder="021 XX XX XX"' })}
            ${UI.field({ label: t("mobile"), name: "storeMobile", value: s.storeMobile, attrs: 'placeholder="055XX XX XX"' })}
            ${UI.field({ label: t("rc_number"), name: "storeRC", value: s.storeRC })}
            ${UI.field({ label: t("email"), name: "storeEmail", type: "email", value: s.storeEmail })}
            ${UI.field({ label: t("nif"), name: "storeNIF", value: s.storeNIF })}
            ${UI.field({ label: t("ai_article"), name: "storeAI", value: s.storeAI })}
            ${UI.field({ label: t("nis"), name: "storeNIS", value: s.storeNIS })}
            ${UI.field({ label: t("vat_rate"), name: "vatRate", type: "number", value: s.vatRate, attrs: 'min="0" max="100" step="0.01"' })}
            <div class="field full"><button class="btn btn-primary" type="button" data-save-store>💾 ${t("save")}</button></div>
          </form>`,
        })}
        ${UI.card({
          title: t("pos_behavior"),
          cls: "full",
          body: TOGGLES.map(
            ([key, label, hint]) => `<div class="switch-row">
              <div><strong>${t(label)}</strong><div class="hint">${t(hint)}</div></div>
              <input type="checkbox" data-pos-toggle="${key}" ${s[key] ? "checked" : ""} aria-label="${t(label)}">
            </div>`,
          ).join(""),
        })}
        ${UI.card({
          title: t("stamp_duty_settings"),
          cls: "full",
          body: `<p class="hint">${t("stamp_duty_law_note")}</p>
            <form id="stamp-form" class="grid g3">
              ${UI.field({ label: t("stamp_min"), name: "stampDutyMin", type: "number", value: s.stampDutyMin, attrs: 'min="0" step="0.01"' })}
              ${UI.field({ label: t("stamp_max"), name: "stampDutyMax", type: "number", value: s.stampDutyMax, attrs: 'min="0" step="0.01"' })}
              <div></div>
              ${tiers
                .map(
                  (tr, i) => `${UI.field({ label: `${t("tier_up_to")} #${i + 1}`, name: `tierUpTo${i}`, type: "number", value: tr.upTo ?? "", attrs: 'min="0" step="0.01" placeholder="∞"' })}
                  ${UI.field({ label: `${t("tier_rate")} #${i + 1} (%)`, name: `tierRate${i}`, type: "number", value: tr.rate, attrs: 'min="0" step="0.01"' })}
                  <div></div>`,
                )
                .join("")}
              <div class="field full"><button class="btn btn-primary" type="button" data-save-stamp>💾 ${t("save")}</button></div>
            </form>
            <p class="hint">${t("stamp_example")}: ${money(computeStampDuty(12000, "cash", state.settings))} ${t("for_ttc")} ${money(12000)}</p>`,
        })}
        ${UI.card({
          title: t("scale_settings"),
          cls: "full",
          body: `<div class="switch-row"><div><strong>${t("scale_enabled")}</strong><div class="hint">${t("scale_hint")}</div></div>
              <input type="checkbox" data-pos-toggle="scaleEnabled" ${s.scaleEnabled ? "checked" : ""}></div>
            <form id="scale-form" class="grid g3">
              ${UI.field({ label: t("scale_prefix"), name: "scalePrefix", value: s.scalePrefix })}
              ${UI.field({ label: t("scale_plu_digits"), name: "scalePluDigits", type: "number", value: s.scalePluDigits, attrs: 'min="1" max="8"' })}
              ${UI.field({ label: t("scale_value_digits"), name: "scaleValueDigits", type: "number", value: s.scaleValueDigits, attrs: 'min="1" max="8"' })}
              ${UI.selectField({
                label: t("scale_value_type"),
                name: "scaleValueType",
                options: `<option value="weight" ${s.scaleValueType === "weight" ? "selected" : ""}>${t("weight_kg")}</option><option value="price" ${s.scaleValueType === "price" ? "selected" : ""}>${t("price")}</option>`,
              })}
              ${UI.field({ label: t("scale_decimals"), name: "scaleDecimals", type: "number", value: s.scaleDecimals, attrs: 'min="0" max="4"' })}
              ${UI.selectField({
                label: t("drawer_connection"),
                name: "cashDrawerConnection",
                options: `<option value="printer" ${s.cashDrawerConnection === "printer" ? "selected" : ""}>${t("drawer_via_printer")}</option><option value="usb" ${s.cashDrawerConnection === "usb" ? "selected" : ""}>${t("drawer_usb_com")}</option>`,
              })}
              <div class="field full"><button class="btn btn-primary" type="button" data-save-scale>💾 ${t("save")}</button></div>
            </form>
            <p class="hint">${t("scale_example")}</p>`,
        })}
      </div>`;

    /* logo */
    const logoFile = view.querySelector("#logo-file");
    const drop = view.querySelector("#logo-drop");
    const takeFile = async (file) => {
      if (!file) return;
      if (!/^image\/(png|jpeg)$/.test(file.type)) return UI.toast(t("logo_type_error"), "error");
      if (file.size > 2 * 1024 * 1024) return UI.toast(t("logo_size_error"), "error");
      const dataUrl = await readFileDataURL(file);
      await saveSetting("storeLogo", dataUrl);
      await logActivity("SETTINGS", "system", t("store_logo"));
      UI.toast(t("saved"));
      render();
      window.dispatchEvent(new CustomEvent("app:settings"));
    };
    view.querySelector("[data-pick-logo]").addEventListener("click", () => logoFile.click());
    logoFile.addEventListener("change", () => takeFile(logoFile.files[0]));
    drop.addEventListener("click", () => logoFile.click());
    drop.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.classList.add("over");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("over");
      takeFile(e.dataTransfer.files[0]);
    });
    view.querySelector("[data-remove-logo]")?.addEventListener("click", async () => {
      await saveSetting("storeLogo", "");
      UI.toast(t("saved"));
      render();
      window.dispatchEvent(new CustomEvent("app:settings"));
    });

    /* language */
    view.querySelector("#ui-lang").addEventListener("change", async (e) => {
      await saveSetting("language", e.target.value);
      setLang(e.target.value);
      window.dispatchEvent(new CustomEvent("app:language"));
    });

    /* expense categories */
    view.querySelector("[data-add-cat]").addEventListener("click", async () => {
      const input = view.querySelector("#new-cat");
      const name = input.value.trim();
      if (!name) return UI.toast(t("required_field"), "error");
      if (expenseCategories().some((c) => c.name.toLowerCase() === name.toLowerCase())) return UI.toast(t("duplicate_category"), "error");
      await db.put("expenseCategories", { id: uid("exc"), name, createdAt: new Date().toISOString() });
      await reload("expenseCategories");
      UI.toast(t("saved"));
      render();
    });
    view.querySelector("#new-cat")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        view.querySelector("[data-add-cat]").click();
      }
    });
    view.querySelectorAll("[data-del-cat]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const cat = get("expenseCategories").find((c) => c.id === btn.dataset.delCat);
        const used = get("cashTransactions").filter((tr) => tr.category === cat?.name);
        const ok = await UI.confirmDialog({
          title: t("delete"),
          message: used.length ? `${used.length} ${t("records_reassigned_other")}` : t("delete_warning"),
        });
        if (!ok) return;
        for (const tr of used) await db.put("cashTransactions", { ...tr, category: "أخرى / Other" });
        await db.delete("expenseCategories", cat.id);
        await reload(["expenseCategories", "cashTransactions"]);
        UI.toast(t("deleted"));
        render();
      }),
    );

    /* store info */
    view.querySelector("[data-save-store]").addEventListener("click", async () => {
      const data = UI.formData(view.querySelector("#store-form"));
      if (!String(data.storeName || "").trim()) return UI.toast(t("required_field"), "error");
      for (const [k, v] of Object.entries(data)) await saveSetting(k, k === "vatRate" ? Number(v) || 0 : v);
      UI.toast(t("saved"));
      window.dispatchEvent(new CustomEvent("app:settings"));
    });

    /* POS toggles */
    view.querySelectorAll("[data-pos-toggle]").forEach((cb) =>
      cb.addEventListener("change", async () => {
        await saveSetting(cb.dataset.posToggle, cb.checked);
        UI.toast(`${t("saved")} — ${cb.checked ? t("enabled") : t("disabled")}`);
      }),
    );

    /* stamp duty */
    view.querySelector("[data-save-stamp]").addEventListener("click", async () => {
      const data = UI.formData(view.querySelector("#stamp-form"));
      const nextTiers = tiers.map((_, i) => ({
        upTo: String(data[`tierUpTo${i}`] || "").trim() === "" ? null : Number(data[`tierUpTo${i}`]),
        rate: Number(data[`tierRate${i}`]) || 0,
      }));
      await saveSetting("stampDutyMin", Number(data.stampDutyMin) || 0);
      await saveSetting("stampDutyMax", Number(data.stampDutyMax) || 0);
      await saveSetting("stampDutyTiers", nextTiers);
      UI.toast(t("saved"));
      render();
    });

    /* scale */
    view.querySelector("[data-save-scale]").addEventListener("click", async () => {
      const data = UI.formData(view.querySelector("#scale-form"));
      await saveSetting("scalePrefix", String(data.scalePrefix || "2").replace(/\D/g, "") || "2");
      await saveSetting("scalePluDigits", Number(data.scalePluDigits) || 5);
      await saveSetting("scaleValueDigits", Number(data.scaleValueDigits) || 5);
      await saveSetting("scaleValueType", data.scaleValueType);
      await saveSetting("scaleDecimals", Number(data.scaleDecimals) || 0);
      await saveSetting("cashDrawerConnection", data.cashDrawerConnection);
      UI.toast(t("saved"));
    });
  };

  render();
  void route;
}
