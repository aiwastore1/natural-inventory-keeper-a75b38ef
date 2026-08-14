import { download } from "./format.js";

export function toCSV(rows, headers) {
  const cols = headers || Object.keys(rows[0] || {});
  const escape = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(",")];
  for (const row of rows) lines.push(cols.map((c) => escape(row[c])).join(","));
  return `\uFEFF${lines.join("\n")}`;
}

export function exportCSV(filename, rows, headers) {
  download(filename, toCSV(rows, headers), "text/csv;charset=utf-8");
}

/** Robust small CSV parser: quotes, escaped quotes, CRLF. */
export function parseCSV(text) {
  const clean = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < clean.length; i += 1) {
    const c = clean[i];
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === "," || c === ";") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0].map((h) => h.trim());
  const records = rows
    .slice(1)
    .filter((r) => r.some((v) => String(v).trim() !== ""))
    .map((r) => {
      const obj = {};
      headers.forEach((h, idx) => (obj[h] = (r[idx] ?? "").trim()));
      return obj;
    });
  return { headers, records };
}

export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, "utf-8");
  });
}

export function readFileDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
