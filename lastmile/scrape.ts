// lastmile.lt product + nutrition scraper: IKI by default, --chain for the platform's other shops.
// Script version of "2025 scrape.ipynb": same API, same cleaning rules, plus
// price-per-kg and protein/kcal-per-euro columns for meal planning.
//
//   deno run --allow-net --allow-read --allow-write scrape.ts            # fetch fresh data
//   deno run --allow-net --allow-read --allow-write scrape.ts --cached   # reuse today's raw dump
//   deno run --allow-net --allow-read --allow-write scrape.ts --chain PROMO-CashandCarry
//
// --chain picks another lastmile.lt chain by its URL slug (default IKI). Grocery ones in
// 2026-11: IKI, PROMO-CashandCarry, Livin, Assorti-by-Livin (POST /chains lists them all).
//
// Output (dated, next to this script):
//   data_cache/raw_<chain>_products_<date>.json   raw API dump (large, not committed)
//   data/<chain>_products_<date>.csv              every product: prices, price/kg, nutrition per
//                                              100 g where the label parses (nutritionValid)
//
// 2026-11: the API moved from search-952707942140... to searchservice-952707942140...
// (lastmile.lt exposes it as NEXT_PUBLIC_SEARCH_URL in the page's __NEXT_DATA__).

import { stringify } from "jsr:@std/csv@1";
import { isValidNutrition, nameQuantityKg } from "../lib/grocery.ts";

const SEARCH_URL = "https://searchservice-952707942140.europe-north1.run.app";
const PAGE = 100; // the API rejects limit >= 200 ("search_limit_too_large")

type Category = { id: string; parentId: string; name: { en?: string; lt?: string }; storeIds?: string[] };

const here = new URL(".", import.meta.url).pathname;
const today = new Date().toISOString().slice(0, 10);
const useCache = Deno.args.includes("--cached");
const chainArg = Deno.args[Deno.args.indexOf("--chain") + 1];
const CHAIN_SLUG_WANTED = Deno.args.includes("--chain") ? chainArg : "IKI";

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

// Resolve a chain URL slug ("IKI", "PROMO-CashandCarry", …) to its id and canonical slug.
async function resolveChain(slug: string) {
  const { data } = await post("/chains", { limit: 400 });
  const chain = data.find((c: any) => c.slugs?.some((s: string) => s.toLowerCase() === slug.toLowerCase()));
  if (!chain) {
    const names = data.filter((c: any) => c.isActive && c.slugs?.length).map((c: any) => c.slugs[0]);
    throw new Error(`unknown chain "${slug}"; active chains: ${names.join(", ")}`);
  }
  return { id: chain.id as string, slug: chain.slugs[0] as string };
}

// The API only pages ~1000 results deep per query (count says ~36k for the
// whole chain), so walk IKI's leaf categories one by one and dedupe.
async function fetchAllProducts(categories: Category[]) {
  const ids = new Set(categories.map((c) => c.id));
  const parents = new Set(categories.map((c) => c.parentId));
  const ikiLeaves = categories.filter(
    (c) => !parents.has(c.id) && c.storeIds?.some((s) => s.startsWith(CHAIN.id + "_")),
  );
  console.error(`  ${ikiLeaves.length} ${CHAIN.slug} leaf categories (of ${ids.size})`);
  const byId = new Map<string, any>();
  let truncated = 0;
  for (const [i, c] of ikiLeaves.entries()) {
    let from = 0, total = 0;
    while (true) {
      const page = await post("/v1/frontend-products", {
        params: { type: "view_products", chainIds: [CHAIN.id], categoryIds: [c.id] },
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
  return `https://www.lastmile.lt/chain/${CHAIN.slug}/product/${slug.endsWith("-" + code) ? slug : `${slug}-${code}`}`;
}

const round = (x: number, d = 2) => (isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : "");

// ---- main ----

const CHAIN = await resolveChain(CHAIN_SLUG_WANTED);
const prefix = CHAIN.slug.toLowerCase(); // "iki" keeps the original file names

console.error("categories…");
const categories = await cached(`raw_categories_${today}.json`, fetchCategories);
const cat = new Map(categories.map((c) => [c.id, c]));
const catName = (id?: string) => (id && cat.get(id)?.name?.en) || "";

console.error("products…");
const raw = await cached(`raw_${prefix}_products_${today}.json`, () => fetchAllProducts(categories));

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
    let packKg = ["KG", "L"].includes(p.unitOfMeasure)
      ? 1
      : perUnitMeasure
      ? p.conversionValue
      : p.conversionToKg;
    // Some chains (PROMO, Livin, Assorti) report a placeholder size (0.2–0.3 kg, or 1 for a piece).
    // Trust the size printed in the name when it disagrees by more than half.
    const named = nameQuantityKg(p.name?.lt);
    const byWeight = ["KG", "L"].includes(p.unitOfMeasure);
    if (!byWeight && named > 0 && !(packKg > named / 1.5 && packKg < named * 1.5)) packKg = named;
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
const out = `${here}data/${prefix}_products_${today}.csv`;
await Deno.writeTextFile(out, stringify(rows, { columns: Object.keys(rows[0]) }));
const valid = rows.filter((r) => r.nutritionValid).length;
console.error(`${rows.length} products, ${valid} with valid nutrition -> ${out}`);
