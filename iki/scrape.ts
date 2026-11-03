// IKI (lastmile.lt) product + nutrition scraper.
// Script version of "2025 scrape.ipynb": same API, same cleaning rules, plus
// price-per-kg and protein/kcal-per-euro columns for meal planning.
//
//   deno run --allow-net --allow-read --allow-write scrape.ts            # fetch fresh data
//   deno run --allow-net --allow-read --allow-write scrape.ts --cached   # reuse today's raw dump
//
// Output (dated, next to this script):
//   data_cache/raw_iki_products_<date>.json   raw API dump (large, not committed)
//   data/iki_products_<date>.csv              every product: prices, price/kg, nutrition per
//                                              100 g where the label parses (nutritionValid)
//
// 2026-11: the API moved from search-952707942140... to searchservice-952707942140...
// (lastmile.lt exposes it as NEXT_PUBLIC_SEARCH_URL in the page's __NEXT_DATA__).

import { stringify } from "jsr:@std/csv@1";

const SEARCH_URL = "https://searchservice-952707942140.europe-north1.run.app";
const IKI_CHAIN_ID = "CvKfTzV4TN5U8BTMF1Hl";
const PAGE = 100; // the API rejects limit >= 200 ("search_limit_too_large")

type Category = { id: string; parentId: string; name: { en?: string; lt?: string }; storeIds?: string[] };

const here = new URL(".", import.meta.url).pathname;
const today = new Date().toISOString().slice(0, 10);
const useCache = Deno.args.includes("--cached");

async function post(path: string, body: unknown) {
  const res = await fetch(SEARCH_URL + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return await res.json();
}

async function fetchCategories() {
  // Paged 400 at a time across all chains.
  const all: Category[] = [];
  while (true) {
    const page = await post("/categories", { limit: 400, fromIndex: all.length });
    if (!page.data?.length) break;
    all.push(...page.data);
    if (all.length >= page.count) break;
  }
  return all;
}

// The API only pages ~1000 results deep per query (count says ~36k for the
// whole chain), so walk IKI's leaf categories one by one and dedupe.
async function fetchAllProducts(categories: Category[]) {
  const ids = new Set(categories.map((c) => c.id));
  const parents = new Set(categories.map((c) => c.parentId));
  const ikiLeaves = categories.filter(
    (c) => !parents.has(c.id) && c.storeIds?.some((s) => s.startsWith(IKI_CHAIN_ID + "_")),
  );
  console.error(`  ${ikiLeaves.length} IKI leaf categories (of ${ids.size})`);
  const byId = new Map<string, any>();
  let truncated = 0;
  for (const [i, c] of ikiLeaves.entries()) {
    let from = 0, total = 0;
    while (true) {
      const page = await post("/v1/frontend-products", {
        params: { type: "view_products", chainIds: [IKI_CHAIN_ID], categoryIds: [c.id] },
        limit: PAGE,
        fromIndex: from,
      });
      total = page.count ?? 0;
      if (!page.products?.length) break;
      for (const p of page.products) byId.set(p.frontEndProduct.id, p.frontEndProduct);
      from += page.products.length;
      if (page.products.length < PAGE) break;
      await new Promise((r) => setTimeout(r, 150)); // be polite
    }
    if (total > from) truncated++;
    if (i % 25 === 0) console.error(`  ${i}/${ikiLeaves.length} categories, ${byId.size} products`);
  }
  if (truncated) console.error(`  warning: ${truncated} categories hit the paging cap`);
  return [...byId.values()];
}

async function cached<T>(file: string, produce: () => Promise<T>): Promise<T> {
  await Deno.mkdir(here + "data_cache", { recursive: true });
  const path = here + "data_cache/" + file;
  if (useCache) {
    try {
      return JSON.parse(await Deno.readTextFile(path));
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
  }
  const data = await produce();
  await Deno.writeTextFile(path, JSON.stringify(data));
  return data;
}

// ---- cleaning (ported from the notebook) ----

// "2084 kJ / 498 kcal" -> 498. With two numbers the smaller is kcal.
function extractEnergy(value: string): number | null {
  if (!/\d/.test(value)) return null;
  const m = value.match(/(^1 )?\d+([.,](\d+))?/g);
  if (!m) return null;
  const nums = m.map((d) => parseInt(d.replace(",", ".").replace(" ", "")));
  if (nums.length === 1) return nums[0];
  if (nums.length === 2) return Math.min(...nums);
  return null; // ambiguous, e.g. "1997/265 kJ / 476/63 kcal"
}

function isValidEnergy(value: string): boolean {
  const digits = value.match(/\d+/g);
  if (digits === null) return false;
  const slashes = value.match(/\//g);
  if (digits.length > 2 && (slashes?.length ?? 0) > 1) return false;
  const bad = ["", "0", "-", "in 100g", "100g", "100ml"];
  return !bad.includes(value) && !value.startsWith("Maistingumas ");
}

const num = (s: string | undefined) => (s ? parseFloat(s.replace(",", ".")) : NaN);

function isValidNutrition(p: Record<string, number>) {
  if (p.energy > 900) return false;
  if (p.fat > 100) return false;
  if (p.satFat > 100 || p.satFat > p.fat) return false;
  if (p.carbs > 100) return false;
  if (p.sugar > 100 || p.sugar > p.carbs) return false;
  if (p.protein > 100) return false;
  if (p.salt > 100) return false;
  const macro = [p.fat, p.carbs, p.protein, p.salt].filter((x) => !isNaN(x));
  if (macro.reduce((a, b) => a + b, 0) > 100) return false;
  return true;
}

// A price in `prc` only counts while its "till" date is in the future (or unset).
function livePrice(price: number | null | undefined, till: string | null | undefined) {
  if (price == null) return null;
  if (till && new Date(till) < new Date()) return null;
  return price;
}

function productUrl(p: any) {
  const code = String(p.erpCode ?? p.id);
  const slugs: string[] = p.slugs ?? [];
  const slug = slugs.find((s) => s.endsWith("-" + code)) ?? slugs[0] ?? "";
  return `https://www.lastmile.lt/chain/IKI/product/${slug.endsWith("-" + code) ? slug : `${slug}-${code}`}`;
}

const round = (x: number, d = 2) => (isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : "");

// ---- main ----

console.error("categories…");
const categories = await cached(`raw_categories_${today}.json`, fetchCategories);
const cat = new Map(categories.map((c) => [c.id, c]));
const catName = (id?: string) => (id && cat.get(id)?.name?.en) || "";

console.error("products…");
const raw = await cached(`raw_iki_products_${today}.json`, () => fetchAllProducts(categories));

const NO_NUTRITION = { energy: NaN, fat: NaN, satFat: NaN, carbs: NaN, sugar: NaN, protein: NaN, salt: NaN };

const rows = raw
  .map((p) => {
    const prc = p.prc ?? {};
    const regular = prc.p ?? p.actualPrice;
    const sale = livePrice(prc.s, prc.still);
    const loyalty = livePrice(prc.l, prc.ltill);
    const best = Math.min(...[regular, sale, loyalty].filter((x) => x != null));

    // Price per kg (or L). Weighed goods are already priced per kg.
    const perUnitMeasure = ["KG", "L"].includes(p.conversionMeasure);
    const packKg = ["KG", "L"].includes(p.unitOfMeasure)
      ? 1
      : perUnitMeasure
      ? p.conversionValue
      : p.conversionToKg;
    const pricePerKg = packKg > 0 ? regular / packKg : NaN;
    const bestPerKg = packKg > 0 ? best / packKg : NaN;

    const nut = p.nutrition ?? {};
    let n = {
      energy: isValidEnergy(nut.energy ?? "") ? extractEnergy(nut.energy) ?? NaN : NaN,
      fat: num(nut.fat),
      satFat: num(nut.satFat),
      carbs: num(nut.carbs),
      sugar: num(nut.sugar),
      protein: num(nut.protein),
      salt: num(nut.salt),
    };
    // Fresh produce and counter meat carry no label; bad labels are blanked, not dropped.
    const nutritionValid = !isNaN(n.energy) && isValidNutrition(n);
    if (!nutritionValid) n = NO_NUTRITION;
    return {
      name: p.name?.lt ?? p.name?.en,
      category: catName(p.categoryId),
      parentCategory: catName(cat.get(p.categoryId)?.parentId),
      nutritionValid,
      ...n,
      // per 100 g/ml values above; derived:
      proteinPer100kcal: round((n.protein / n.energy) * 100, 1),
      price: regular,
      salePrice: sale ?? "",
      loyaltyPrice: loyalty ?? "",
      packKg: round(packKg, 3),
      pricePerKg: round(pricePerKg),
      bestPricePerKg: round(bestPerKg),
      proteinGPerEuro: round((n.protein * 10) / bestPerKg, 1),
      kcalPerEuro: round((n.energy * 10) / bestPerKg, 0),
      isActive: p.isActive,
      isInStock: p.isInStock,
      countryOfOrigin: p.countryOfOrigin ?? "",
      url: productUrl(p),
      id: p.id,
    };
  })
  .sort((a, b) => (a.parentCategory + a.category + a.name).localeCompare(b.parentCategory + b.category + b.name, "lt"))
  .map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "number" && isNaN(v) ? "" : v])));

await Deno.mkdir(here + "data", { recursive: true });
const out = `${here}data/iki_products_${today}.csv`;
await Deno.writeTextFile(out, stringify(rows, { columns: Object.keys(rows[0]) }));
const valid = rows.filter((r) => r.nutritionValid).length;
console.error(`${rows.length} products, ${valid} with valid nutrition -> ${out}`);
