/** Reusable UI primitives: Modal, ConfirmDialog, Toast, Table, Pagination, EmptyState, StatCard, Badge. */
import { t } from "../i18n.js";
import { esc } from "../utils/format.js";

let lastFocused = null;

export function toast(message, type = "success", ms = 2800) {
  const host = document.getElementById("toasts");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.setAttribute("role", type === "error" ? "alert" : "status");
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

/** openModal({title, body, footer, size, onMount}) */
export function openModal({ title, body, footer = "", size = "", onMount, onClose }) {
  const root = document.getElementById("modal-root");
  lastFocused = document.activeElement;
  root.innerHTML = `
    <div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head">
        <h2 class="modal-title">${esc(title)}</h2>
        <button class="icon-btn" data-close aria-label="${t("close")}">✕</button>
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ""}
    </div>`;
  root.classList.add("show");
  root.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => closeModal(onClose)));
  root.onclick = (e) => {
    if (e.target === root) closeModal(onClose);
  };
  const focusable = root.querySelector("input, select, textarea, button:not([data-close])");
  if (focusable) focusable.focus();
  root.onkeydown = (e) => {
    if (e.key !== "Tab") return;
    const items = [...root.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter(
      (el) => !el.disabled && el.offsetParent !== null,
    );
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  if (onMount) onMount(root.querySelector(".modal"));
  return root.querySelector(".modal");
}

export function closeModal(onClose) {
  const root = document.getElementById("modal-root");
  root.classList.remove("show");
  root.innerHTML = "";
  if (lastFocused && lastFocused.focus) lastFocused.focus();
  if (onClose) onClose();
}

export function confirmDialog({ title, message, confirmText, danger = true }) {
  return new Promise((resolve) => {
    openModal({
      title: title || t("are_you_sure"),
      size: "sm",
      body: `<p style="color:var(--text-muted)">${esc(message || t("delete_warning"))}</p>`,
      footer: `<button class="btn" data-cancel>${t("cancel")}</button>
        <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-ok>${esc(confirmText || t("confirm"))}</button>`,
      onMount(modal) {
        modal.querySelector("[data-cancel]").addEventListener("click", () => {
          closeModal();
          resolve(false);
        });
        modal.querySelector("[data-ok]").addEventListener("click", () => {
          closeModal();
          resolve(true);
        });
        modal.querySelector("[data-ok]").focus();
      },
      onClose: () => resolve(false),
    });
  });
}

export function emptyState(title, desc, icon = "📦") {
  return `<div class="empty"><div class="ic">${icon}</div><h3>${esc(title || t("empty_title"))}</h3><p>${esc(desc || t("empty_desc"))}</p></div>`;
}

export function statCard({ label, value, hint, icon = "📊", tone = "", route }) {
  const tag = route ? "button" : "div";
  const attrs = route ? `data-nav="${route}" type="button"` : "";
  return `<${tag} class="stat" ${attrs}>
    <span class="stat-ic ${tone}">${icon}</span>
    <span style="min-width:0">
      <span class="stat-label">${esc(label)}</span>
      <div class="stat-value">${value}</div>
      ${hint ? `<span class="stat-hint">${esc(hint)}</span>` : ""}
    </span>
  </${tag}>`;
}

export function badge(text, tone = "") {
  return `<span class="badge ${tone}">${esc(text)}</span>`;
}

export function card({ title, actions = "", body, cls = "" }) {
  return `<section class="card ${cls}">
    ${title || actions ? `<div class="card-head"><h2 class="card-title">${esc(title || "")}</h2><div class="row-actions">${actions}</div></div>` : ""}
    <div class="card-body">${body}</div>
  </section>`;
}

/**
 * dataTable: renders a table with sorting, pagination, selection, column visibility.
 * config: { id, columns:[{key,label,render,className,hidden}], rows, page, perPage, sort, dir,
 *           selectable, footer, onState(newState) }
 */
export function dataTable(cfg) {
  const {
    columns,
    rows,
    page = 1,
    perPage = 10,
    sort,
    dir = "asc",
    selectable = false,
    selected = new Set(),
    footer = "",
    hiddenCols = new Set(),
  } = cfg;
  const visible = columns.filter((c) => !hiddenCols.has(c.key));
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(page, pages);
  const slice = rows.slice((current - 1) * perPage, current * perPage);
  if (!total) return `<div class="card">${emptyState()}</div>`;

  const head = `<tr>
    ${selectable ? `<th style="width:34px"><input type="checkbox" data-select-all aria-label="select all"></th>` : ""}
    ${visible
      .map(
        (c) =>
          `<th class="${c.sortable === false ? "" : "sortable"} ${c.className || ""}" ${
            c.sortable === false ? "" : `data-sort="${c.key}" tabindex="0" role="button"`
          }>${esc(c.label)}${sort === c.key ? (dir === "asc" ? " ▲" : " ▼") : ""}</th>`,
      )
      .join("")}
  </tr>`;

  const body = slice
    .map(
      (row) => `<tr data-id="${esc(row.id)}">
      ${selectable ? `<td><input type="checkbox" data-row-select="${esc(row.id)}" ${selected.has(row.id) ? "checked" : ""} aria-label="select row"></td>` : ""}
      ${visible.map((c) => `<td class="${c.className || ""}">${c.render ? c.render(row) : esc(row[c.key] ?? "—")}</td>`).join("")}
    </tr>`,
    )
    .join("");

  const pagerButtons = [];
  const window_ = 5;
  let start = Math.max(1, current - Math.floor(window_ / 2));
  const end = Math.min(pages, start + window_ - 1);
  start = Math.max(1, end - window_ + 1);
  for (let i = start; i <= end; i += 1) pagerButtons.push(`<button data-page="${i}" class="${i === current ? "active" : ""}">${i}</button>`);

  return `<div class="card">
    ${
      selectable && selected.size
        ? `<div class="bulkbar"><span>${selected.size} ${t("selected")}</span>
             <button class="btn btn-sm" data-bulk="export">${t("export_csv")}</button>
             <button class="btn btn-sm btn-danger" data-bulk="delete">${t("delete")}</button>
             <button class="btn btn-sm btn-ghost" data-bulk="clear">${t("cancel")}</button></div>`
        : ""
    }
    <div class="table-wrap"><table class="tbl"><thead>${head}</thead><tbody>${body}</tbody>${footer ? `<tfoot>${footer}</tfoot>` : ""}</table></div>
    <div class="pagination">
      <span>${total} ${t("rows")} · ${t("page")} ${current} ${t("of")} ${pages}</span>
      <div class="pager">
        <button data-page="${Math.max(1, current - 1)}" ${current === 1 ? "disabled" : ""}>‹</button>
        ${pagerButtons.join("")}
        <button data-page="${Math.min(pages, current + 1)}" ${current === pages ? "disabled" : ""}>›</button>
      </div>
    </div>
  </div>`;
}

/** Wire table interactions to a state object + rerender callback. */
export function wireTable(container, ctrl, rerender) {
  container.querySelectorAll("th[data-sort]").forEach((th) => {
    const handler = () => {
      const key = th.dataset.sort;
      if (ctrl.sort === key) ctrl.dir = ctrl.dir === "asc" ? "desc" : "asc";
      else {
        ctrl.sort = key;
        ctrl.dir = "asc";
      }
      rerender();
    };
    th.addEventListener("click", handler);
    th.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handler();
      }
    });
  });
  container.querySelectorAll("[data-page]").forEach((b) =>
    b.addEventListener("click", () => {
      ctrl.page = Number(b.dataset.page);
      rerender();
    }),
  );
  const all = container.querySelector("[data-select-all]");
  if (all) {
    all.addEventListener("change", () => {
      if (all.checked) ctrl.visibleIds.forEach((id) => ctrl.selected.add(id));
      else ctrl.selected.clear();
      rerender();
    });
  }
  container.querySelectorAll("[data-row-select]").forEach((cb) =>
    cb.addEventListener("change", () => {
      const id = cb.dataset.rowSelect;
      if (cb.checked) ctrl.selected.add(id);
      else ctrl.selected.delete(id);
      rerender();
    }),
  );
}

export function selectOptions(items, valueKey, labelFn, selectedValue) {
  return items
    .map((i) => `<option value="${esc(i[valueKey])}" ${String(i[valueKey]) === String(selectedValue) ? "selected" : ""}>${esc(labelFn(i))}</option>`)
    .join("");
}

export function field({ label, name, type = "text", value = "", required = false, hint = "", attrs = "", full = false }) {
  return `<div class="field ${full ? "full" : ""}">
    <label for="f_${name}">${esc(label)} ${required ? '<span class="req">*</span>' : ""}</label>
    <input class="input" id="f_${name}" name="${name}" type="${type}" value="${esc(value)}" ${required ? "required" : ""} ${attrs}>
    ${hint ? `<div class="hint">${esc(hint)}</div>` : ""}
  </div>`;
}

export function selectField({ label, name, options, value, required = false, full = false, attrs = "" }) {
  return `<div class="field ${full ? "full" : ""}">
    <label for="f_${name}">${esc(label)} ${required ? '<span class="req">*</span>' : ""}</label>
    <select class="select" id="f_${name}" name="${name}" ${required ? "required" : ""} ${attrs}>${options}</select>
  </div>`;
}

export function textareaField({ label, name, value = "", full = true }) {
  return `<div class="field ${full ? "full" : ""}">
    <label for="f_${name}">${esc(label)}</label>
    <textarea class="textarea" id="f_${name}" name="${name}">${esc(value)}</textarea>
  </div>`;
}

export function formData(form) {
  const out = {};
  new FormData(form).forEach((v, k) => {
    out[k] = typeof v === "string" ? v.trim() : v;
  });
  return out;
}

export function validate(form, rules = {}) {
  const errors = [];
  form.querySelectorAll(".err").forEach((e) => e.remove());
  form.querySelectorAll(".invalid").forEach((e) => e.classList.remove("invalid"));
  form.querySelectorAll("[required]").forEach((el) => {
    if (!String(el.value).trim()) errors.push([el, t("required_fields")]);
  });
  for (const [name, fn] of Object.entries(rules)) {
    const el = form.querySelector(`[name="${name}"]`);
    if (!el) continue;
    const msg = fn(el.value, formData(form));
    if (msg) errors.push([el, msg]);
  }
  errors.forEach(([el, msg]) => {
    el.classList.add("invalid");
    const p = document.createElement("div");
    p.className = "err";
    p.textContent = msg;
    el.parentElement.appendChild(p);
  });
  if (errors.length) errors[0][0].focus();
  return errors.length === 0;
}
