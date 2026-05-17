import { describe, test, expect } from "bun:test";
import { isLikelyShopify, parseShopifyProductsJson } from "../../../src/domain/catalog/shopify";

const SAMPLE = {
  products: [
    {
      id: 123,
      handle: "storm-jacket",
      title: "Storm Jacket",
      product_type: "Outerwear",
      variants: [
        { id: 1, title: "S", available: true, price: "120.00", option1: "S" },
        { id: 2, title: "M", available: true, price: "120.00", option1: "M" },
        { id: 3, title: "L", available: false, price: "120.00", option1: "L" },
      ],
      options: [{ name: "Size", values: ["S", "M", "L"] }],
      images: [{ src: "https://cdn.shopify.com/x.jpg" }],
    },
    {
      id: 124,
      handle: "tee",
      title: "Cotton Tee",
      product_type: "Tops",
      variants: [
        { id: 10, title: "Default", available: true, price: "35.00", option1: "S" },
        { id: 11, title: "Default", available: true, price: "35.00", option1: "M" },
      ],
      options: [{ name: "Size", values: ["S", "M"] }],
      images: [],
    },
  ],
};

describe("shopify catalog parser", () => {
  test("isLikelyShopify true for valid /products.json response", () => {
    expect(isLikelyShopify({ products: [] })).toBe(true);
    expect(isLikelyShopify({ items: [] })).toBe(false);
    expect(isLikelyShopify(null)).toBe(false);
    expect(isLikelyShopify("string")).toBe(false);
  });

  test("parseShopifyProductsJson returns ItemDrafts for each product", () => {
    const drafts = parseShopifyProductsJson(SAMPLE, {
      brandId: 1,
      brandHost: "tracksmith.com",
    });
    expect(drafts.length).toBe(2);
    const jacket = drafts.find((d) => d.name === "Storm Jacket");
    expect(jacket?.sourceUrl).toBe("https://tracksmith.com/products/storm-jacket");
    expect(jacket?.basePriceUsd).toBe(120);
    expect(jacket?.externalId).toBe("storm-jacket");
    expect(jacket?.category).toBe("Outerwear");
    expect(jacket?.perSizeData.S?.available).toBe(true);
    expect(jacket?.perSizeData.L?.available).toBe(false);
  });
});
