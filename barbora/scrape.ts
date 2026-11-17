// Barbora (barbora.lt, Maxima's online shop) product + nutrition scraper.
//
//   deno run --allow-net --allow-read --allow-write scrape.ts                 # full run
//   deno run --allow-net --allow-read --allow-write scrape.ts --cached        # reuse today's list dump
//   deno run --allow-net --allow-read --allow-write scrape.ts --no-details    # prices only, no nutrition
//   deno run --allow-net --allow-read --allow-write scrape.ts --max-details 500  # cap product fetches
//
// How the site works (2026-11-17, after Barbora moved to a Remix front end): a JSON API behind
// https://barbora.lt/proxy/api/v1/ (the paths are in the site's JS bundle):
//   - categories/category-tree → {categories: [{shortId, url, name, children}]}; 11 roots
//   - inventory/category/{shortId}?Offset=&Limit= (Limit ≤ 200) → {count, inventories}; a root
//     category lists its whole subtree
//   - product/by-url/{url} → one product with `nutrients` ({calories: {value}, protein, …}),
//     `netAmount` and `countryOfOrigin`; fetched for food products and kept in
//     data_cache/barbora_details.json across runs
//   - prices: `price` is what you pay now. A single-unit `promotion` has `oldPrice` (the shelf
//     price); `loyaltyCardRequired` marks Ačiū-card prices. Multi-buy promos (XForY, or
//     CategoryPercentage with minQuantity > 1) have no oldPrice and are ignored.
//     `comparativeUnit` is the current price per kg / l / unit.
//
// Output: data/barbora_products_<date>.csv, same columns as the IKI CSV.

import {
  cached, Detail, flag, getText, Input, nutritionFromRows, option, pool, quantityKg, sleep, toRow,
  withDetailCache, writeCsv,
} from "../lib/grocery.ts";

const API = "https://barbora.lt/proxy/api/v1/";
const PAGE = 200; // the API rejects larger limits
const NON_FOOD = ["kosmetika-ir-higiena", "svaros-ir-gyvunu-prekes", "namai-ir-laisvalaikis"];

const here = new URL(".", import.meta.url).pathname;
const today = new Date().toISOString().slice(0, 10);

type Cat = { shortId: string; url: string; name: string; children?: Cat[] };

const api = async (path: string) => JSON.parse(await getText(API + path));

async function fetchList(roots: Cat[]) {
  const byId = new Map<string, any>();
  await pool(roots, 3, async (root) => {
    for (let offset = 0;; offset += PAGE) {
      const page = await api(`inventory/category/${root.shortId}?Offset=${offset}&Limit=${PAGE}`);
      for (const p of page.inventories ?? []) byId.set(p.id, { ...p, rootUrl: root.url });
      if (!page.inventories?.length || offset + PAGE >= page.count) break;
      await sleep(200);
    }
    console.error(`  ${root.url}: ${byId.size} products total`);
  });
  return [...byId.values()];
}

// Stored as label rows so the shared parser (and details cached before 2026-11-17) still work.
const LABELS: [string, string, string][] = [
  ["calories", "Energinė vertė", "kcal"], ["fat", "Riebalai", "g"], ["saturatedFat", "Sočiosios riebalų rūgštys", "g"],
  ["carbohydrates", "Angliavandeniai", "g"], ["sugar", "Cukrūs", "g"], ["protein", "Baltymai", "g"], ["salt", "Druska", "g"],
];

async function fetchDetail(url: string): Promise<Detail | null> {
  const p = await api(`product/by-url/${encodeURIComponent(url)}`);
  const n = p.nutrients ?? {};
  return {
    fetchedAt: new Date().toISOString(),
    nutrition: LABELS.filter(([k]) => n[k]?.value != null).map(([k, label, unit]) => [label, `${n[k].value} ${unit}`]),
    netQuantity: p.netAmount != null ? String(p.netAmount) : undefined, // grams or ml
    countryOfOrigin: p.countryOfOrigin || undefined,
  };
}

// ---- main ----

console.error("categories…");
const tree: Cat[] = await cached(here, `raw_barbora_categories_${today}.json`, flag("cached"), async () =>
  (await api("categories/category-tree")).categories);
const catById = new Map<string, { name: string; parent?: string }>();
const walk = (cs: Cat[], parent?: string) =>
  cs.forEach((c) => (catById.set(c.shortId, { name: c.name, parent }), walk(c.children ?? [], c.shortId)));
walk(tree);

console.error("product lists…");
const raw = await cached(here, `raw_barbora_products_${today}.json`, flag("cached"), () => fetchList(tree));
console.error(`  ${raw.length} products`);

let details = new Map<string, Detail>();
if (!flag("no-details")) {
  console.error("product details (nutrition)…");
  const food = raw.filter((p) => !NON_FOOD.includes(p.rootUrl));
  const byId = new Map(food.map((p) => [p.id, p]));
  details = await withDetailCache(here, "barbora", [...byId.keys()], (id) => fetchDetail(byId.get(id).url), {
    max: Number(option("max-details") ?? Infinity),
  });
}

const promoTypes = new Map<string, number>();
const rows = raw.map((p) => {
  const promo = p.promotion;
  if (promo) promoTypes.set(promo.type, (promoTypes.get(promo.type) ?? 0) + 1);
  const singleUnitPromo = promo && (promo.minQuantity ?? 1) <= 1 && promo.oldPrice > p.price;
  const regular = singleUnitPromo ? promo.oldPrice : p.price;
  const loyalty = singleUnitPromo && promo.loyaltyCardRequired ? p.price : null;
  const sale = singleUnitPromo && !promo.loyaltyCardRequired ? p.price : null;

  const d = details.get(p.id);
  const cu = p.comparativeUnit;
  const byWeight = p.unit?.type === "kg";
  const perUnit = ["kg", "l"].includes(cu?.type) && cu.price > 0;
  const packKg = byWeight ? 1 : perUnit ? p.price / cu.price : quantityKg(d?.netQuantity);

  const cat = catById.get(p.categoryShortId);
  return toRow({
    id: p.id,
    name: p.title,
    category: cat?.name ?? "",
    parentCategory: (cat?.parent && catById.get(cat.parent)?.name) || "",
    price: regular,
    salePrice: sale,
    loyaltyPrice: loyalty,
    packKg,
    nutrition: d ? nutritionFromRows(d.nutrition) : null,
    isActive: p.status !== "suspended",
    isInStock: p.status === "active",
    countryOfOrigin: d?.countryOfOrigin,
    url: `https://barbora.lt/p/${p.url}`,
  } satisfies Input);
});
console.error("  promotion types:", Object.fromEntries(promoTypes));

await writeCsv(here, "barbora_products", rows);
