/**
 * Cash register / shift session management (#/cash-register).
 * Opening float, deposits, withdrawals, expenses, live expected balance,
 * closing with counted balance + variance, and a full session audit log.
 */
import { db, uid, logActivity } from "../database.js";
import { get, byId, reload, state } from "../state.js";
import { t } from "../i18n.js";
import { money, esc, fmtDateTime, num } from "../utils/format.js";
import * as UI from "../components/ui.js";
import { currentUser } from "./accountSettings.js";
import { expenseCategories } from "./generalSettings.js";

export function openSession() {
  return get("cashSessions").find((s) => s.status === "open") || null;
}

export function sessionTransactions(sessionId) {
  return get("cashTransactions")
    .filter((tr) => tr.sessionId === sessionId)
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
}

export function expectedBalance(session, transactions = null) {
  if (!session) return 0;
  const rows = transactions || sessionTransactions(session.id);
  let total = Number(session.openingFloat) || 0;
  for (const tr of rows) {
    const amount = Number(tr.amount) || 0;
    if (tr.type === "deposit" || tr.type === "sale") total += amount;
    else if (tr.type === "withdrawal" || tr.type === "expense") total -= amount;
  }
  return total;
}

function breakdown(session) {
  const rows = sessionTransactions(session.id);
  const pick = (type) => rows.filter((r) => r.type === type).reduce((a, r) => a + (Number(r.amount) || 0), 0);
  return {
    rows,
    opening: Number(session.openingFloat) || 0,
    sales: pick("sale"),
    deposits: pick("deposit"),
    withdrawals: pick("withdrawal"),
    expenses: pick("expense"),
    expected: expectedBalance(session, rows),
  };
}

async function addTransaction(session, { type, amount, description = "", category = "" }) {
  const record = {
    id: uid("ctr"),
    sessionId: session.id,
    type,
    amount: Number(amount) || 0,
    description,
    category,
    timestamp: new Date().toISOString(),
  };
  await db.put("cashTransactions", record);
  const next = { ...session, expectedBalance: 0 };
  await reload("cashTransactions");
  next.expectedBalance = expectedBalance(byId("cashSessions", session.id) || session);
  await db.put("cashSessions", next);
  await reload("cashSessions");
  await logActivity(type.toUpperCase(), "cashRegister", `${t(`cash_${type}`)} — ${money(record.amount)}`, { sessionId: session.id });
  await reload("activityLog");
  return record;
}

/** Called by the POS after a completed cash sale so the drawer stays accurate. */
export async function recordCashSale(amount, description) {
  const session = openSession();
  if (!session || !amount) return null;
  return addTransaction(session, { type: "sale", amount: Math.abs(Number(amount)), description: description || t("sales") });
}

/** POS guard: is a session required and missing? */
export function sessionBlocked() {
  if (state.settings.posAccountingOnly) return false;
  if (!state.settings.enforceCashSession) return false;
  return !openSession();
}

export async function startSession(openingFloat) {
  const user = currentUser();
  const record = {
    id: uid("csn"),
    userId: user?.id || "local",
    userName: user?.username || t("cashier"),
    openedAt: new Date().toISOString(),
    closedAt: null,
    openingFloat: Number(openingFloat) || 0,
    expectedBalance: Number(openingFloat) || 0,
    countedBalance: null,
    variance: null,
    status: "open",
  };
  await db.put("cashSessions", record);
  await reload("cashSessions");
  await logActivity("SESSION_OPEN", "cashRegister", `${t("register_open")} — ${money(record.openingFloat)}`);
  await reload("activityLog");
  return record;
}

export async function closeSession(session, countedBalance) {
  const b = breakdown(session);
  const counted = Number(countedBalance) || 0;
  const record = {
    ...session,
    status: "closed",
    closedAt: new Date().toISOString(),
    expectedBalance: b.expected,
    countedBalance: counted,
    variance: Number((counted - b.expected).toFixed(2)),
  };
  await db.put("cashSessions", record);
  await reload("cashSessions");
  await logActivity("SESSION_CLOSE", "cashRegister", `${t("register_closed")} — ${t("variance")} ${money(record.variance)}`);
  await reload("activityLog");
  return record;
}

/* --------------------------------- view --------------------------------- */

function txTable(rows) {
  if (!rows.length) return UI.emptyState(t("session_transactions"), t("empty_desc"), "🧾");
  return `<div class="table-wrap"><table class="tbl"><thead><tr>
      <th>${t("time")}</th><th>${t("type")}</th><th>${t("description")}</th><th class="num">${t("amount")}</th></tr></thead>
    <tbody>${rows
      .map(
        (r) => `<tr><td>${esc(fmtDateTime(r.timestamp))}</td>
        <td>${UI.badge(t(`cash_${r.type}`), r.type === "deposit" || r.type === "sale" ? "ok" : "danger")}${
          r.category ? ` <span class="stat-hint">${esc(r.category)}</span>` : ""
        }</td>
        <td>${esc(r.description || "—")}</td>
        <td class="num">${money(r.type === "deposit" || r.type === "sale" ? r.amount : -r.amount)}</td></tr>`,
      )
      .join("")}</tbody></table></div>`;
}

export async function cashRegister(route, view) {
  const render = () => {
    const session = openSession();
    const sessions = get("cashSessions").slice().sort((a, b) => String(b.openedAt).localeCompare(String(a.openedAt)));
    const cats = expenseCategories();

    const banner = session
      ? `<div class="cash-banner open">
          <div><span class="badge ok">${t("register_open")}</span> <span class="stat-hint">${esc(session.userName)} · ${esc(fmtDateTime(session.openedAt))}</span></div>
          <div class="cash-expected"><span>${t("expected_balance")}</span><strong>${money(breakdown(session).expected)}</strong></div>
        </div>`
      : `<div class="cash-banner closed"><span class="badge danger">${t("register_closed")}</span>
          <span class="stat-hint">${t("open_register_hint")}</span></div>`;

    const b = session ? breakdown(session) : null;

    view.innerHTML = `
      <div class="page-head"><div><h1>${t("cash_register")}</h1><p class="stat-hint">${t("cash_register_sub")}</p></div></div>
      ${banner}
      ${
        session
          ? `<div class="stats">
              ${UI.statCard({ label: t("opening_float"), value: money(b.opening), icon: "🏦" })}
              ${UI.statCard({ label: t("cash_sales"), value: money(b.sales), icon: "🧾", tone: "ok" })}
              ${UI.statCard({ label: t("deposits"), value: money(b.deposits), icon: "⬆", tone: "ok" })}
              ${UI.statCard({ label: t("withdrawals"), value: money(b.withdrawals), icon: "⬇", tone: "danger" })}
              ${UI.statCard({ label: t("expenses"), value: money(b.expenses), icon: "💸", tone: "warn" })}
            </div>
            <div class="grid g2">
              ${UI.card({
                title: t("cash_deposit"),
                body: `<form id="dep-form">
                  ${UI.field({ label: t("amount"), name: "amount", type: "number", required: true, attrs: 'min="0.01" step="0.01"' })}
                  ${UI.field({ label: t("description"), name: "description", full: true })}
                  <button class="btn btn-primary" type="button" data-deposit>⬆ ${t("deposit")}</button></form>`,
              })}
              ${UI.card({
                title: t("cash_withdrawal"),
                body: `<form id="wd-form">
                  ${UI.field({ label: t("amount"), name: "amount", type: "number", required: true, attrs: `min="0.01" step="0.01" max="${b.expected}"` })}
                  ${UI.field({ label: t("description"), name: "description", full: true })}
                  ${UI.selectField({
                    label: t("expense_category"),
                    name: "category",
                    options: `<option value="">${t("none")}</option>${cats.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join("")}`,
                  })}
                  <div class="switch"><span>${t("tag_as_expense")}</span><input type="checkbox" id="as-expense"></div>
                  <button class="btn btn-danger" type="button" data-withdraw>⬇ ${t("withdraw")}</button>
                  <p class="hint">${t("withdraw_limit_hint")} ${money(b.expected)}</p></form>`,
              })}
            </div>
            ${UI.card({ title: t("session_transactions"), body: txTable(b.rows) })}
            ${UI.card({
              title: t("close_register"),
              cls: "danger-zone",
              body: `<form id="close-form">
                ${UI.field({ label: `${t("final_balance")} (${state.settings.currency})`, name: "counted", type: "number", required: true, attrs: 'step="0.01" min="0"' })}
                <p class="hint">${t("expected_balance")}: <strong>${money(b.expected)}</strong></p>
                <button class="btn btn-danger" type="button" data-close-register>🔒 ${t("close_register")}</button></form>`,
            })}`
          : UI.card({
              title: t("open_register"),
              body: `<form id="open-form">
                ${UI.field({ label: t("opening_float"), name: "openingFloat", type: "number", required: true, attrs: 'min="0" step="0.01"', value: "0" })}
                <button class="btn btn-primary" type="button" data-open-register>🔓 ${t("open_register")}</button></form>`,
            })
      }
      ${UI.card({
        title: t("session_log"),
        body: sessions.length
          ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>${t("cashier")}</th><th>${t("status")}</th><th>${t("opened_at")}</th><th class="num">${t("variance")}</th><th>${t("actions")}</th></tr></thead>
              <tbody>${sessions
                .map(
                  (s) => `<tr><td>${esc(s.userName || "—")}</td>
                <td>${UI.badge(s.status === "open" ? t("open") : t("closed"), s.status === "open" ? "ok" : "")}${
                  s.status === "closed" && Number(s.variance) !== 0 ? ` ${UI.badge(`⚠ ${t("variance")}`, "warn")}` : ""
                }</td>
                <td>${esc(fmtDateTime(s.openedAt))}</td>
                <td class="num">${s.variance === null || s.variance === undefined ? "—" : money(s.variance)}</td>
                <td><button class="btn btn-sm" data-audit="${s.id}">${t("view")}</button></td></tr>`,
                )
                .join("")}</tbody></table></div>`
          : UI.emptyState(t("session_log"), t("empty_desc"), "🗂"),
      })}`;

    const form = (sel) => view.querySelector(sel);

    view.querySelector("[data-open-register]")?.addEventListener("click", async () => {
      const data = UI.formData(form("#open-form"));
      const amount = Number(data.openingFloat);
      if (!Number.isFinite(amount) || amount < 0) return UI.toast(t("invalid_amount"), "error");
      await startSession(amount);
      UI.toast(t("register_open"));
      render();
    });

    view.querySelector("[data-deposit]")?.addEventListener("click", async () => {
      const data = UI.formData(form("#dep-form"));
      const amount = Number(data.amount);
      if (!(amount > 0)) return UI.toast(t("invalid_amount"), "error");
      await addTransaction(session, { type: "deposit", amount, description: data.description });
      UI.toast(t("deposit_done"));
      render();
    });

    view.querySelector("[data-withdraw]")?.addEventListener("click", async () => {
      const data = UI.formData(form("#wd-form"));
      const amount = Number(data.amount);
      const asExpense = view.querySelector("#as-expense").checked || Boolean(data.category);
      if (!(amount > 0)) return UI.toast(t("invalid_amount"), "error");
      if (amount > breakdown(session).expected) return UI.toast(t("withdraw_too_big"), "error");
      await addTransaction(session, {
        type: asExpense ? "expense" : "withdrawal",
        amount,
        description: data.description,
        category: data.category || "",
      });
      UI.toast(t("withdraw_done"));
      render();
    });

    view.querySelector("[data-close-register]")?.addEventListener("click", async () => {
      const data = UI.formData(form("#close-form"));
      const counted = Number(data.counted);
      if (!Number.isFinite(counted)) return UI.toast(t("invalid_amount"), "error");
      const expected = breakdown(session).expected;
      const variance = counted - expected;
      const ok = await UI.confirmDialog({
        title: t("close_register"),
        message: `${t("expected_balance")}: ${money(expected)} · ${t("final_balance")}: ${money(counted)} · ${t("variance")}: ${money(variance)}`,
        confirmText: t("close_register"),
      });
      if (!ok) return;
      await closeSession(session, counted);
      UI.toast(variance === 0 ? t("register_closed") : `${t("register_closed")} — ${t("variance")} ${money(variance)}`, variance === 0 ? "success" : "error");
      render();
    });

    view.querySelectorAll("[data-audit]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const s = byId("cashSessions", btn.dataset.audit);
        const rows = sessionTransactions(s.id);
        UI.openModal({
          title: `${t("session_log")} — ${esc(fmtDateTime(s.openedAt))}`,
          size: "lg",
          body: `<div class="stats">
              ${UI.statCard({ label: t("opening_float"), value: money(s.openingFloat), icon: "🏦" })}
              ${UI.statCard({ label: t("expected_balance"), value: money(s.status === "open" ? expectedBalance(s, rows) : s.expectedBalance), icon: "🧮" })}
              ${UI.statCard({ label: t("final_balance"), value: s.countedBalance === null ? "—" : money(s.countedBalance), icon: "💰" })}
              ${UI.statCard({ label: t("variance"), value: s.variance === null || s.variance === undefined ? "—" : money(s.variance), icon: "⚖", tone: Number(s.variance) ? "danger" : "ok" })}
            </div>
            <p class="hint">${t("transactions")}: ${num(rows.length)}</p>
            ${txTable(rows)}`,
        });
      }),
    );
  };

  render();
  void route;
}
