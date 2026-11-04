// Rimi (rimi.lt/e-parduotuve) product + nutrition scraper.
//
//   deno run --allow-net --allow-read --allow-write scrape.ts                 # full run
//   deno run --allow-net --allow-read --allow-write scrape.ts --cached        # reuse today's list dump
//   deno run --allow-net --allow-read --allow-write scrape.ts --no-details    # prices only, no nutrition
//   deno run --allow-net --allow-read --allow-write scrape.ts --max-details 500  # cap product-page fetches
//
// How the site works (2026-11):
//   - category tree: GET /e-parduotuve/api/v1/content/category-tree (JSON; codes like SH-11-6)
//   - no product JSON API: category pages are server-rendered HTML, `pageSize` up to 100
//     (larger values redirect), `currentPage=N`. Each card carries
//     data-gtm-eec-product='{"id","name","category","price"}' where price is what you pay now;
//     `card__old-price` holds the shelf price during a sale, a `price-label` with the
//     rimi-card image is the Mano RIMI card price, `card__price-per` the current €/kg|l|vnt.
//   - nutrition only on product pages (/p/<id>), inside a JS-escaped HTML string, so those are
//     fetched for food categories and kept in data_cache/rimi_details.json across runs.
//
// Output: data/rimi_products_<date>.csv, same columns as the IKI CSV.

import {
  cached, Detail, flag, getText, Input, nutritionFromRows, num, option, pool, quantityKg, sleep, toRow,
  withDetailCache, writeCsv,
} from "../lib/grocery.ts";

const BASE = "https://www.rimi.lt";
const PAGE = 100;
// Gift cards, cosmetics, cleaning, pets, household: no nutrition labels worth fetching.
const NON_FOOD = ["SH-20", "SH-6", "SH-16", "SH-5", "SH-10"];

const here = new URL(".", import.meta.url).pathname;
const today = new Date().toISOString().slice(0, 10);

type Cat = { name: string; url: string; descendants: Cat[] };
type Card = {
  id: string; name: string; category: string; price: number; oldPrice: number | null;
  cardPrice: number | null; otherLabel: string | null; perUnit: number; perUnitMeasure: string;
  url: string; available: boolean;
};

const code = (c: Cat) => c.url.split("/c/")[1];
// A few cards link to /lt/c/<slug>/p/<id>, which 404s; any slug under /produktai/ redirects
// to the right page.
const productUrl = (p: Card) =>
  p.url.includes("/produktai/") ? p.url : `${BASE}/e-parduotuve/lt/produktai/x/p/${p.id}`;

const unescapeHtml = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const text = (s: string) => unescapeHtml(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const euro = (s: string) => num(s.replace(/\s/g, ""));

function parseCards(html: string): Card[] {
  const chunks = html.split('<div data-product-code="').slice(1);
  return chunks.map((chunk) => {
    const gtm = JSON.parse(unescapeHtml(chunk.match(/data-gtm-eec-product='([^']+)'/)![1]));
    const old = chunk.match(/card__old-price">[\s\S]*?<span aria-hidden="true">([^<]+)</);
    // Promo label: an image plus a big price. Only the rimi-card image means a card price.
    const label = chunk.match(/class="price-label"[\s\S]*?<img src="([^"]+)"[\s\S]*?class="major">(\d+)<[\s\S]*?class="cents">(\d+)</);
    const perUnit = chunk.match(/card__price-per">[\s\S]*?<span aria-hidden="true">\s*([\d,]+)\s*€\/([^\s<]+)/);
    const href = chunk.match(/class="card__url[^"]*" href="([^"]+)"/);
    const isCard = label && /rimi-card/.test(label[1]);
    return {
      id: String(gtm.id),
      name: gtm.name,
      category: gtm.category,
      price: gtm.price,
      oldPrice: old ? euro(old[1]) : null,
      cardPrice: isCard ? parseFloat(`${label![2]}.${label![3]}`) : null,
      otherLabel: label && !isCard ? label[1].split("/").pop()! : null,
      perUnit: perUnit ? euro(perUnit[1]) : NaN,
      perUnitMeasure: perUnit?.[2] ?? "",
      url: href ? BASE + href[1] : `${BASE}/e-parduotuve/lt/p/${gtm.id}`,
      available: !/js-add-to-cart/.test(chunk) ? false : true,
    };
  });
}

async function fetchList(roots: Cat[]) {
  const byId = new Map<string, Card>();
  await pool(roots, 3, async (root) => {
    for (let page = 1;; page++) {
      const html = await getText(`${BASE}${root.url}?currentPage=${page}&pageSize=${PAGE}`);
      const cards = parseCards(html);
      const before = byId.size;
      for (const c of cards) byId.set(c.id, c);
      // Stop on a short page, or if an out-of-range page repeats ones we already have.
      if (cards.length < PAGE || byId.size === before) break;
      if (page % 10 === 0) console.error(`  ${code(root)}: page ${page}, ${byId.size} products total`);
      await sleep(200);
    }
  });
  return [...byId.values()];
}

/** The product body is embedded as a JS string: undo \uXXXX, \/ and \n escapes first. */
const unescapeJs = (s: string) =>
  s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\\//g, "/").replace(/\\n/g, "\n").replace(/\\"/g, '"');

async function fetchDetail(url: string): Promise<Detail | null> {
  const html = unescapeJs(await getText(url));
  const table = html.match(/<div class="product__table">([\s\S]*?)<\/table>/);
  const nutrition: [string, string][] = table
    ? [...table[1].matchAll(/<tr>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => [
      text(m[1]),
      text(m[2]),
    ])
    : [];
  const dd = (label: string) => {
    const m = html.match(new RegExp(`<dt>${label}</dt>\\s*<dd[^>]*>([\\s\\S]*?)</dd>`));
    return m ? text(m[1]) : undefined;
  };
  return {
    fetchedAt: new Date().toISOString(),
    nutrition,
    netQuantity: dd("Grynasis kiekis"),
    countryOfOrigin: dd("Kilmės šalis"),
  };
}

// ---- main ----

console.error("categories…");
const tree: Cat[] = await cached(
  here,
  `raw_rimi_categories_${today}.json`,
  flag("cached"),
  async () => JSON.parse(await getText(`${BASE}/e-parduotuve/api/v1/content/category-tree?locale=lt`)).categories,
);
const catByCode = new Map<string, { name: string; parent?: string }>();
const walk = (cs: Cat[], parent?: string) =>
  cs.forEach((c) => (catByCode.set(code(c), { name: c.name.trim(), parent }), walk(c.descendants, code(c))));
walk(tree);

console.error("product lists…");
const raw = await cached(here, `raw_rimi_products_${today}.json`, flag("cached"), () => fetchList(tree));
console.error(`  ${raw.length} products`);

let details = new Map<string, Detail>();
if (!flag("no-details")) {
  console.error("product pages (nutrition)…");
  const root = (c: string): string => {
    const parent = catByCode.get(c)?.parent;
    return parent ? root(parent) : c;
  };
  const food = raw.filter((p) => !NON_FOOD.includes(root(p.category)));
  const byId = new Map(food.map((p) => [p.id, p]));
  details = await withDetailCache(here, "rimi", [...byId.keys()], (id) => fetchDetail(productUrl(byId.get(id)!)), {
    max: Number(option("max-details") ?? Infinity),
  });
}

const otherLabels = new Map<string, number>();
const rows = raw.map((p) => {
  if (p.otherLabel) otherLabels.set(p.otherLabel, (otherLabels.get(p.otherLabel) ?? 0) + 1);
  const onSale = p.oldPrice != null && p.oldPrice > p.price;
  const d = details.get(p.id);
  const perKg = ["kg", "l"].includes(p.perUnitMeasure) && p.perUnit > 0;
  const packKg = perKg ? p.price / p.perUnit : quantityKg(d?.netQuantity);
  const cat = catByCode.get(p.category);
  return toRow({
    id: p.id,
    name: p.name,
    category: cat?.name ?? p.category,
    parentCategory: (cat?.parent && catByCode.get(cat.parent)?.name) || "",
    price: onSale ? p.oldPrice! : p.price,
    salePrice: onSale ? p.price : null,
    loyaltyPrice: p.cardPrice,
    packKg,
    nutrition: d ? nutritionFromRows(d.nutrition) : null,
    isActive: "",
    isInStock: p.available,
    countryOfOrigin: d?.countryOfOrigin,
    url: productUrl(p),
  } satisfies Input);
});
if (otherLabels.size) console.error("  non-card promo labels (ignored):", Object.fromEntries(otherLabels));

await writeCsv(here, "rimi_products", rows);
