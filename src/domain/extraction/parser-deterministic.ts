import type { CanonicalSizeChart } from "./canonical";

const COL_MATCHERS = {
  size: /\bsize\b/i,
  chest: /\bchest|bust\b/i,
  waist: /\bwaist\b/i,
  hip: /\bhip\b/i,
};

type ColKey = "size" | "chest" | "waist" | "hip";
type ColMap = Record<ColKey, number | null>;

interface Row {
  size: string;
  values: Record<"chest" | "waist" | "hip", [number, number] | null>;
}

// Parses a cell like "36-38", "36–38", "38" into a [lo, hi] pair.
// Uses indexOf-based scanning to avoid slow-regex backtracking.
function parseCell(raw: string): [number, number] | null {
  // Strip non-numeric characters except digit-separators
  const cleaned = raw.replaceAll(/[^\d.\-–—]/g, " ").trim();
  if (!cleaned) return null;

  // Look for a range separator: hyphen, en-dash, em-dash
  const dashIdx = cleaned.search(/[-–—]/);
  if (dashIdx !== -1) {
    const loStr = cleaned.slice(0, dashIdx).trim();
    const hiStr = cleaned.slice(dashIdx + 1).trim();
    const lo = Number.parseFloat(loStr);
    const hi = Number.parseFloat(hiStr);
    if (!Number.isNaN(lo) && !Number.isNaN(hi)) return [lo, hi];
  }

  // Single number
  const v = Number.parseFloat(cleaned);
  if (!Number.isNaN(v) && /^\d+(?:\.\d+)?$/.test(cleaned)) {
    return [v, v];
  }
  return null;
}

function matchColHeaders(cols: string[]): ColMap {
  const colMap: ColMap = { size: null, chest: null, waist: null, hip: null };
  for (const [c, col] of cols.entries()) {
    for (const key of Object.keys(COL_MATCHERS) as ColKey[]) {
      if (colMap[key] === null && COL_MATCHERS[key].test(col)) {
        colMap[key] = c;
        break;
      }
    }
  }
  return colMap;
}

function cellAt(cells: string[], idx: number | null): [number, number] | null {
  return idx === null ? null : parseCell(cells[idx] ?? "");
}

function parseBodyRows(lines: string[], startIdx: number, colMap: ColMap): Row[] {
  const sizeColIdx = colMap.size;
  if (sizeColIdx === null) return [];

  const rows: Row[] = [];
  for (let j = startIdx; j < lines.length; j++) {
    const line = (lines[j] ?? "").trim();
    if (!line.startsWith("|")) break;
    const cells = line
      .slice(1, -1)
      .split("|")
      .map((c) => c.trim());
    const size = cells[sizeColIdx]?.trim();
    if (!size) continue;
    rows.push({
      size,
      values: {
        chest: cellAt(cells, colMap.chest),
        waist: cellAt(cells, colMap.waist),
        hip: cellAt(cells, colMap.hip),
      },
    });
  }
  return rows;
}

function buildMeasurements(rows: Row[]): CanonicalSizeChart["measurements"] | null {
  const measurements: CanonicalSizeChart["measurements"] = {};
  for (const r of rows) {
    const { chest, waist, hip } = r.values;
    if (chest && waist && hip) {
      measurements[r.size] = { chest_in: chest, waist_in: waist, hip_in: hip };
    }
  }
  return measurements;
}

export function parseDeterministic(markdown: string, sourceUrl: string): CanonicalSizeChart | null {
  const lines = markdown.split("\n");
  for (const [i, rawLine] of lines.entries()) {
    const header = rawLine.trim();
    const sep = (lines[i + 1] ?? "").trim();
    if (!header.startsWith("|") || !sep.startsWith("|")) continue;
    if (!/^\|[\s\-:|]+\|$/.test(sep)) continue;

    const cols = header
      .slice(1, -1)
      .split("|")
      .map((c) => c.trim());
    const colMap = matchColHeaders(cols);
    if (colMap.size === null) continue;

    const rows = parseBodyRows(lines, i + 2, colMap);
    if (rows.length === 0) continue;

    const allParsable = rows.every((r) => r.values.chest && r.values.waist && r.values.hip);
    if (!allParsable) return null;

    const measurements = buildMeasurements(rows);
    if (!measurements) return null;

    return {
      source_url: sourceUrl,
      extracted_at: new Date().toISOString(),
      method: "deterministic",
      size_labels: rows.map((r) => r.size),
      measurements,
      size_availability: [],
      notes: "",
      gender_specific: false,
    };
  }
  return null;
}
