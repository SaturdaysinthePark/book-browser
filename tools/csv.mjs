// Tiny RFC-4180 CSV reader/writer (no dependencies).

// Parse CSV text into an array of rows (each row an array of string cells).
export function parseCsv(text) {
  text = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = [];
  let field = '', row = [], inQ = false, i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Parse into objects keyed by the header row. Skips blank lines.
export function parseCsvObjects(text) {
  const rows = parseCsv(text).filter((r) => !(r.length === 1 && r[0].trim() === ''));
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const o = {};
    header.forEach((h, i) => { o[h] = r[i] == null ? '' : r[i]; });
    return o;
  });
}

function cell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Serialize rows (array of objects) to CSV using the given column order.
export function toCsv(columns, rows) {
  const lines = [columns.join(',')];
  for (const r of rows) lines.push(columns.map((c) => cell(r[c])).join(','));
  return lines.join('\n') + '\n';
}
