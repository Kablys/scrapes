// Barbora (barbora.lt, Maxima's online shop) product + nutrition scraper.
//
//   deno run --allow-net --allow-read --allow-write scrape.ts                 # full run
//   deno run --allow-net --allow-read --allow-write scrape.ts --cached        # reuse today's list dump
//   deno run --allow-net --allow-read --allow-write scrape.ts --no-details    # prices only, no nutrition
//   deno run --allow-net --allow-read --allow-write scrape.ts --max-details 500  # cap product-page fetches
//
// How the site works (2026-11):
//   - category tree: GET production-elb.barbora.lt/api/cache/v1/country/LT/categories (JSON)
//   - product lists are server-rendered: each category page embeds `window.b_productList = [...]`,
//     52 per page, `?page=N`; past the last page the list is empty. Root categories list their
//     whole subtree, so 11 roots cover the catalogue.
//   - prices: `price` is what you pay now; `promotion.oldPrice` is the shelf price when a promo
//     applies, `promotion.loyaltyCardRequired` marks Ačiū-card prices. `comparative_unit_price`
//     is the current price per kg/l/vnt.
//   - nutrition only on product pages (`window.product.attributes.list`, group 2), so those are
//     fetched for food categories and kept in data_cache/barbora_details.json across runs.
//   - /api/eshop/v1/product/GetInventories (POST [ids]) returns the list shape, no nutrition.
//
// Output: data/barbora_products_<date>.csv, same columns as the IKI CSV.

import {
  cached, Detail, flag, getText, Input, nutritionFromRows, option, pool, quantityKg, sleep, toRow,
  withDetailCache, writeCsv,
} from "../lib/grocery.ts";

const BASE = "https://barbora.lt";
const CATEGORIES =
  "https://production-elb.barbora.lt/api/cache/v1/country/LT/categories?languageId=e8d3e291-bb2e-47e6-a827-a2189b00a441&shopcode=";
const NON_FOOD = ["kosmetika-ir-higiena", "svaros-ir-gyvunu-prekes", "namai-ir-laisvalaikis"];

const here = new URL(".", import.meta.url).pathname;
const today = new Date().toISOString().slice(0, 10);

type Cat = { id: string; parentId: string; fullUrl: string; name: string; children?: Cat[] };

/** Pull a JSON literal assigned to `window.<name>` out of a page. */
function windowJson(html: string, name: string): any {
  const i = html.indexOf(`window.${name}`);
  if (i < 0) return undefined;
  const start = html.slice(i).search(/[\[{]/) + i;
  // Scan to the matching bracket, skipping strings.
  let depth = 0, inStr = false;
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    if (inStr) {
      if (c === "\\") j++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") {
      if (--depth === 0) return JSON.parse(html.slice(start, j + 1));
    }
  }
  throw new Error(`unterminated window.${name}`);
}

async function fetchCategories(): Promise<Cat[]> {
  return JSON.parse(await getText(CATEGORIES));
}

async function fetchList(roots: Cat[]) {
  const byId = new Map<string, any>();
  await pool(roots, 3, async (root) => {
    for (let page = 1;; page++) {
      const html = await getText(`${BASE}/${root.fullUrl}?page=${page}`);
      const list: any[] = windowJson(html, "b_productList") ?? [];
      if (!list.length) break;
      for (const p of list) byId.set(p.id, p);
      if (page % 20 === 0) console.error(`  ${root.fullUrl}: page ${page}, ${byId.size} products total`);
      await sleep(200);
    }
  });
  return [...byId.values()];
}

async function fetchDetail(p: any): Promise<Detail | null> {
  const html = await getText(`${BASE}/produktai/${p.Url}`);
  const prod = windowJson(html, "product");
  if (!prod) return null;
  const attrs: { id: string; value: string; group: number }[] = prod.attributes?.list ?? [];
  const attr = (re: RegExp) => attrs.find((a) => re.test(a.id))?.value?.trim() || undefined;
  return {
    fetchedAt: new Date().toISOString(),
    nutrition: attrs.filter((a) => a.group === 2).map((a) => [a.id, a.value]),
    netQuantity: attr(/^Grynasis kiekis/),
    countryOfOrigin: attr(/^Kilmės šalis/),
  };
}

// ---- main ----

console.error("categories…");
const tree = await cached(here, `raw_barbora_categories_${today}.json`, flag("cached"), fetchCategories);
const catById = new Map<string, Cat>();
const walk = (cs: Cat[]) => cs.forEach((c) => (catById.set(c.id, c), walk(c.children ?? [])));
walk(tree);

console.error("product lists…");
const raw = await cached(here, `raw_barbora_products_${today}.json`, flag("cached"), () => fetchList(tree));
console.error(`  ${raw.length} products`);

let details = new Map<string, Detail>();
if (!flag("no-details")) {
  console.error("product pages (nutrition)…");
  const food = raw.filter((p) => !NON_FOOD.some((r) => p.category_path_url?.startsWith(r)));
  const byId = new Map(food.map((p) => [p.id, p]));
  details = await withDetailCache(here, "barbora", [...byId.keys()], (id) => fetchDetail(byId.get(id)), {
    max: Number(option("max-details") ?? Infinity),
  });
}

const promoTypes = new Map<string, number>();
const rows = raw.map((p) => {
  const promo = p.promotion;
  if (promo) promoTypes.set(promo.type, (promoTypes.get(promo.type) ?? 0) + 1);
  // Multi-buy promos ("2 for X") don't change the single-unit price, so ignore them.
  const singleUnitPromo = promo && (promo.minQuantity ?? 1) <= 1 && promo.oldPrice > p.price;
  const regular = singleUnitPromo ? promo.oldPrice : p.price;
  const loyalty = singleUnitPromo && promo.loyaltyCardRequired ? p.price : null;
  const sale = singleUnitPromo && !promo.loyaltyCardRequired ? p.price : null;

  const d = details.get(p.id);
  const byWeight = p.units?.[0]?.unit === "kg";
  const perUnit = ["kg", "l"].includes(p.comparative_unit) && p.comparative_unit_price > 0;
  const packKg = byWeight ? 1 : perUnit ? p.price / p.comparative_unit_price : quantityKg(d?.netQuantity);

  const [parentCategory, category] = (p.category_name_full_path ?? "").split("/").slice(-2);
  return toRow({
    id: p.id,
    name: p.title,
    category: category ?? catById.get(p.category_id)?.name ?? "",
    parentCategory: parentCategory ?? "",
    price: regular,
    salePrice: sale,
    loyaltyPrice: loyalty,
    packKg,
    nutrition: d ? nutritionFromRows(d.nutrition) : null,
    isActive: p.status === "active",
    isInStock: p.status === "active",
    countryOfOrigin: d?.countryOfOrigin,
    url: `${BASE}/produktai/${p.Url}`,
  } satisfies Input);
});
console.error("  promotion types:", Object.fromEntries(promoTypes));

await writeCsv(here, "barbora_products", rows);
