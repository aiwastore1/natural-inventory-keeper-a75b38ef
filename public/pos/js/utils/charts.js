/** Local canvas charts — no external libraries, real data only. */
import { getDir } from "../i18n.js";

const PALETTE = ["#0f766e", "#b45309", "#1d4ed8", "#15803d", "#be185d", "#0891b2", "#7c3aed", "#ca8a04", "#dc2626", "#0d9488"];

function css(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function setup(canvas, height = 260) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || canvas.parentElement.clientWidth || 480;
  canvas.width = Math.max(240, w) * dpr;
  canvas.height = height * dpr;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, height);
  ctx.font = "11px system-ui, sans-serif";
  return { ctx, w: Math.max(240, w), h: height };
}

function niceMax(value) {
  if (value <= 0) return 10;
  const pow = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / pow) * pow;
}

function truncate(ctx, text, maxWidth) {
  let s = String(text);
  while (s.length > 3 && ctx.measureText(s).width > maxWidth) s = s.slice(0, -2);
  return s === String(text) ? s : `${s}…`;
}

export function lineChart(canvas, labels, series, opts = {}) {
  const { ctx, w, h } = setup(canvas, opts.height || 260);
  const pad = { t: 16, r: 14, b: 28, l: 52 };
  const grid = css("--border", "#e5e7eb");
  const muted = css("--text-muted", "#64748b");
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.data)));
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;
  ctx.strokeStyle = grid;
  ctx.fillStyle = muted;
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.t + (plotH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(w - pad.r, y);
    ctx.stroke();
    const val = Math.round(max - (max / 4) * i);
    ctx.textAlign = getDir() === "rtl" ? "right" : "right";
    ctx.fillText(String(val), pad.l - 6, y + 4);
  }
  const step = labels.length > 1 ? plotW / (labels.length - 1) : 0;
  ctx.textAlign = "center";
  labels.forEach((label, i) => {
    if (labels.length > 12 && i % Math.ceil(labels.length / 8) !== 0) return;
    ctx.fillText(truncate(ctx, label, 60), pad.l + step * i, h - 9);
  });
  series.forEach((s, si) => {
    const color = s.color || PALETTE[si % PALETTE.length];
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    s.data.forEach((v, i) => {
      const x = pad.l + step * i;
      const y = pad.t + plotH - (v / max) * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.fillStyle = `${color}22`;
    ctx.lineTo(pad.l + step * (s.data.length - 1), pad.t + plotH);
    ctx.lineTo(pad.l, pad.t + plotH);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = color;
    s.data.forEach((v, i) => {
      const x = pad.l + step * i;
      const y = pad.t + plotH - (v / max) * plotH;
      ctx.beginPath();
      ctx.arc(x, y, 2.8, 0, Math.PI * 2);
      ctx.fill();
    });
  });
}

export function barChart(canvas, labels, series, opts = {}) {
  const { ctx, w, h } = setup(canvas, opts.height || 260);
  const pad = { t: 16, r: 14, b: 34, l: 52 };
  const grid = css("--border", "#e5e7eb");
  const muted = css("--text-muted", "#64748b");
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.data)));
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;
  ctx.strokeStyle = grid;
  ctx.fillStyle = muted;
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.t + (plotH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(w - pad.r, y);
    ctx.stroke();
    ctx.fillText(String(Math.round(max - (max / 4) * i)), pad.l - 6, y + 4);
  }
  const groupW = plotW / Math.max(1, labels.length);
  const barW = Math.max(4, (groupW * 0.62) / series.length);
  labels.forEach((label, i) => {
    series.forEach((s, si) => {
      const v = s.data[i] || 0;
      const bh = (v / max) * plotH;
      const x = pad.l + groupW * i + groupW * 0.19 + barW * si;
      ctx.fillStyle = s.color || PALETTE[si % PALETTE.length];
      const y = pad.t + plotH - bh;
      const r = Math.min(4, barW / 2);
      ctx.beginPath();
      ctx.moveTo(x, y + bh);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.lineTo(x + barW - r, y);
      ctx.quadraticCurveTo(x + barW, y, x + barW, y + r);
      ctx.lineTo(x + barW, y + bh);
      ctx.closePath();
      ctx.fill();
    });
    ctx.fillStyle = muted;
    ctx.textAlign = "center";
    ctx.fillText(truncate(ctx, label, groupW - 4), pad.l + groupW * i + groupW / 2, h - 12);
  });
}

export function hBarChart(canvas, items, opts = {}) {
  const rowH = 26;
  const { ctx, w, h } = setup(canvas, opts.height || Math.max(120, items.length * rowH + 24));
  const labelW = Math.min(150, w * 0.4);
  const max = Math.max(1, ...items.map((i) => i.value));
  const muted = css("--text-muted", "#64748b");
  items.forEach((item, i) => {
    const y = 12 + i * rowH;
    ctx.fillStyle = muted;
    ctx.textAlign = "start";
    ctx.fillText(truncate(ctx, item.label, labelW - 8), 2, y + 13);
    const bw = ((w - labelW - 60) * item.value) / max;
    ctx.fillStyle = item.color || PALETTE[i % PALETTE.length];
    ctx.beginPath();
    ctx.roundRect(labelW, y + 3, Math.max(2, bw), 14, 5);
    ctx.fill();
    ctx.fillStyle = muted;
    ctx.fillText(item.display ?? String(Math.round(item.value)), labelW + Math.max(2, bw) + 6, y + 15);
  });
  void h;
}

export function donutChart(canvas, items, opts = {}) {
  const { ctx, w, h } = setup(canvas, opts.height || 260);
  const total = items.reduce((a, b) => a + b.value, 0);
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) / 2 - 14;
  const inner = r * (opts.inner ?? 0.6);
  if (!total) {
    ctx.fillStyle = css("--text-muted", "#64748b");
    ctx.textAlign = "center";
    ctx.fillText("—", cx, cy);
    return;
  }
  let start = -Math.PI / 2;
  items.forEach((item, i) => {
    const angle = (item.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, start + angle);
    ctx.closePath();
    ctx.fillStyle = item.color || PALETTE[i % PALETTE.length];
    ctx.fill();
    start += angle;
  });
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(cx, cy, inner, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = css("--text", "#111827");
  ctx.textAlign = "center";
  ctx.font = "600 15px system-ui, sans-serif";
  ctx.fillText(opts.centerLabel ?? String(Math.round(total)), cx, cy + 5);
}

export function legendHTML(items) {
  return `<div class="legend">${items
    .map((it, i) => `<span><i style="background:${it.color || PALETTE[i % PALETTE.length]}"></i>${it.label}</span>`)
    .join("")}</div>`;
}

export { PALETTE };
