import { describe, test, expect } from "bun:test";
import {
  summarizeCatalogDeltas,
  type ChangeEventInput,
} from "../../../src/domain/catalog/change-detector";

const now = new Date("2026-05-16T00:00:00Z");

const events: ChangeEventInput[] = [
  { changeType: "added", changedAt: "2026-05-15T10:00:00Z" },
  { changeType: "added", changedAt: "2026-05-14T10:00:00Z" },
  { changeType: "discontinued", changedAt: "2026-05-15T11:00:00Z" },
  { changeType: "tier_reclassified", changedAt: "2026-05-15T12:00:00Z" },
];

describe("summarizeCatalogDeltas", () => {
  test("counts events within window", () => {
    const r = summarizeCatalogDeltas(events, { now, withinDays: 7 });
    expect(r.added).toBe(2);
    expect(r.discontinued).toBe(1);
    expect(r.reclassified).toBe(1);
    expect(r.totalRecent).toBe(4);
  });

  test("excludes events outside window", () => {
    const old: ChangeEventInput[] = [{ changeType: "added", changedAt: "2025-01-01T00:00:00Z" }];
    const r = summarizeCatalogDeltas(old, { now, withinDays: 7 });
    expect(r.added).toBe(0);
  });

  test("isQuietPeriod true when no events in N days", () => {
    const r = summarizeCatalogDeltas([], { now, withinDays: 30 });
    expect(r.isQuietPeriod).toBe(true);
  });

  test("sizeAdded and priceChanged are counted", () => {
    const mixed: ChangeEventInput[] = [
      { changeType: "size_added", changedAt: "2026-05-15T08:00:00Z" },
      { changeType: "price_changed", changedAt: "2026-05-15T09:00:00Z" },
    ];
    const r = summarizeCatalogDeltas(mixed, { now, withinDays: 7 });
    expect(r.sizeAdded).toBe(1);
    expect(r.priceChanged).toBe(1);
    expect(r.totalRecent).toBe(2);
    expect(r.isQuietPeriod).toBe(false);
  });

  test("isQuietPeriod false when events exist", () => {
    const r = summarizeCatalogDeltas(events, { now, withinDays: 7 });
    expect(r.isQuietPeriod).toBe(false);
  });
});
