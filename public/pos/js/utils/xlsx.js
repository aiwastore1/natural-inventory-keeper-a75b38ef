/**
 * Minimal dependency-free XLSX writer/reader built on the bundled JSZip build.
 * Writer: sheetsToXlsx([{ name, rows:[[...],[...]] }]) -> Blob
 * Reader: readXlsx(File) -> { sheets: { name: rows[][] }, first: rows[][] }
 */

function zipLib() {
  if (!window.JSZip) throw new Error("JSZip not loaded");
  return window.JSZip;
}

function x(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function colName(index) {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function sheetXml(rows) {
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          const ref = `${colName(c)}${r + 1}`;
          if (value === null || value === undefined || value === "") return "";
          if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${x(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

export async function sheetsToXlsx(sheets) {
  const JSZip = zipLib();
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
      .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
      .join("")}</Types>`,
  );
  zip.folder("_rels").file(
    ".rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  const xl = zip.folder("xl");
  xl.file(
    "workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
      .map((s, i) => `<sheet name="${x((s.name || `Sheet${i + 1}`).slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join("")}</sheets></workbook>`,
  );
  xl.folder("_rels").file(
    "workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
      .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join("")}</Relationships>`,
  );
  const ws = xl.folder("worksheets");
  sheets.forEach((s, i) => ws.file(`sheet${i + 1}.xml`, sheetXml(s.rows || [])));
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

export async function downloadXlsx(filename, sheets) {
  const blob = await sheetsToXlsx(sheets);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** Convert objects to a rows matrix using explicit headers [{key,label}]. */
export function objectsToRows(items, headers) {
  return [headers.map((h) => h.label), ...items.map((it) => headers.map((h) => (typeof h.value === "function" ? h.value(it) : it[h.key] ?? "")))];
}

function parseSheet(xml, shared) {
  const rows = [];
  const rowRe = /<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch;
  while ((rowMatch = rowRe.exec(xml))) {
    const index = Number(rowMatch[1]) - 1;
    const cells = [];
    const cellRe = /<c[^>]*r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>|<c[^>]*r="([A-Z]+)\d+"([^>]*)\/>/g;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[2]))) {
      const ref = cellMatch[1] || cellMatch[4];
      const attrs = cellMatch[2] || cellMatch[5] || "";
      const inner = cellMatch[3] || "";
      let col = 0;
      for (const ch of ref) col = col * 26 + (ch.charCodeAt(0) - 64);
      col -= 1;
      let value = "";
      const type = /t="([^"]+)"/.exec(attrs)?.[1];
      if (type === "inlineStr") value = decode(/<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)?.[1] || "");
      else if (type === "s") value = shared[Number(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] || 0)] || "";
      else if (type === "str") value = decode(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] || "");
      else value = decode(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] || "");
      cells[col] = value;
    }
    rows[index] = [...cells].map((c) => (c === undefined ? "" : c));
  }
  return rows.map((r) => r || []);
}

function decode(str) {
  return String(str)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export async function readXlsx(file) {
  const JSZip = zipLib();
  const zip = await JSZip.loadAsync(file);
  let shared = [];
  const sharedFile = zip.file("xl/sharedStrings.xml");
  if (sharedFile) {
    const xml = await sharedFile.async("string");
    shared = [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
      [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x2) => decode(x2[1])).join(""),
    );
  }
  const workbook = await zip.file("xl/workbook.xml")?.async("string");
  const names = workbook ? [...workbook.matchAll(/<sheet[^>]*name="([^"]*)"/g)].map((m) => decode(m[1])) : [];
  const sheets = {};
  const files = Object.keys(zip.files)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort();
  for (let i = 0; i < files.length; i += 1) {
    const xml = await zip.file(files[i]).async("string");
    sheets[names[i] || `Sheet${i + 1}`] = parseSheet(xml, shared);
  }
  const first = sheets[Object.keys(sheets)[0]] || [];
  return { sheets, first };
}

/** Rows matrix (with header row) -> array of objects keyed by lowercase header. */
export function rowsToObjects(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map((h) => String(h || "").trim().toLowerCase());
  return rows
    .slice(1)
    .filter((r) => r.some((c) => String(c || "").trim() !== ""))
    .map((r) => {
      const obj = {};
      headers.forEach((h, i) => {
        if (h) obj[h] = r[i] === undefined ? "" : String(r[i]).trim();
      });
      return obj;
    });
}
