import { describe, test, expect } from "bun:test";
import { parseDeterministic } from "../../src/domain/extraction/parser-deterministic";

describe("parseDeterministic", () => {
  test("returns null when no recognizable table found", () => {
    expect(parseDeterministic("plain text no table", "https://x.com/size")).toBeNull();
  });

  test("parses a markdown table with size, chest, waist, hip columns", () => {
    const md = `
# Size Chart

| Size | Chest (in) | Waist (in) | Hip (in) |
|------|-----------|-----------|---------|
| S    | 36-38     | 28-30     | 36-38   |
| M    | 38-40     | 30-32     | 38-40   |
| L    | 40-42     | 32-34     | 40-42   |
`;
    const chart = parseDeterministic(md, "https://x.com/size");
    expect(chart).not.toBeNull();
    if (!chart) return;
    expect(chart.size_labels).toEqual(["S", "M", "L"]);
    expect(chart.measurements.S?.chest_in).toEqual([36, 38]);
    expect(chart.measurements.L?.waist_in).toEqual([32, 34]);
    expect(chart.method).toBe("deterministic");
  });

  test("handles single-value cells (e.g., 36) as [v,v]", () => {
    const md = `
| Size | Chest | Waist | Hip |
|------|-------|-------|-----|
| M    | 38    | 30    | 38  |
`;
    const chart = parseDeterministic(md, "https://x.com/size");
    expect(chart).not.toBeNull();
    if (!chart) return;
    expect(chart.measurements.M?.chest_in).toEqual([38, 38]);
  });

  test("returns null when measurements are non-numeric", () => {
    const md = `
| Size | Chest |
|------|-------|
| S    | small |
`;
    expect(parseDeterministic(md, "https://x.com/size")).toBeNull();
  });
});
