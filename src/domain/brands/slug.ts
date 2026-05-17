export function brandSlugFromName(name: string): string {
  return (
    name
      // Strip non-ASCII characters (™, ®, etc.) before NFKD can expand them to ASCII letters
      .replaceAll(/\P{ASCII}/gu, " ")
      .normalize("NFKD")
      // Strip combining diacritics (e.g. accents) that survive NFKD
      .replaceAll(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replaceAll(/[^\w\s-]/g, "")
      .replaceAll(/[\s_]+/g, "-")
      .replaceAll(/-+/g, "-")
      .replaceAll(/^-|-$/g, "")
  );
}

export function resolveSlugCollision(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base;
  let i = 2;
  while (existing.has(`${base}-${String(i)}`)) i++;
  return `${base}-${String(i)}`;
}
