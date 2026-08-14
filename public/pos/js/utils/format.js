import { getLocale } from "../i18n.js";
import { state } from "../state.js";

export function num(value, digits = 0) {
  const n = Number(value) || 0;
  return n.toLocaleString(getLocale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function money(value) {
  const n = Number(value) || 0;
  const cur = state.settings.currency || "DZD";
  return `${n.toLocaleString(getLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
}

export function pct(value, digits = 1) {
  return `${(Number(value) || 0).toFixed(digits)}%`;
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function fmtDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const fmt = state.settings.dateFormat || "YYYY-MM-DD";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  if (fmt === "DD/MM/YYYY") return `${day}/${m}/${y}`;
  if (fmt === "MM/DD/YYYY") return `${m}/${day}/${y}`;
  return `${y}-${m}-${day}`;
}

export function fmtDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  return `${fmtDate(value)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function daysBetween(a, b) {
  const d1 = new Date(a).setHours(0, 0, 0, 0);
  const d2 = new Date(b).setHours(0, 0, 0, 0);
  return Math.round((d2 - d1) / 86400000);
}

export function daysUntil(date) {
  return daysBetween(new Date(), date);
}

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function debounce(fn, ms = 260) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function download(filename, content, type = "application/json") {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function sum(list, pick) {
  return list.reduce((acc, item) => acc + (Number(pick ? pick(item) : item) || 0), 0);
}

export function groupBy(list, pick) {
  const map = new Map();
  for (const item of list) {
    const key = pick(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

export function monthKey(value) {
  return String(value).slice(0, 7);
}
