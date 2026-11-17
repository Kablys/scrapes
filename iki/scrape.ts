// IKI / LastMile product scraper. Run: deno run -A scrape.ts
// Extracted from "2025 scrape.ipynb" and fixed for the 2026 API:
//   - host renamed  search-...  ->  searchservice-952707942140.europe-north1.run.app
//   - /categories is now POST (with {chainIds}) instead of GET
//   - /v1/frontend-products "count" is now the TOTAL, not the batch size, so
//     pagination advances by the returned array length instead of by count.
import { stringify } from "jsr:@std/csv";

const BASE = "https://searchservice-952707942140.europe-north1.run.app";
const IKI_CHAIN = "CvKfTzV4TN5U8BTMF1Hl";

async function post(path: string, body: unknown) {
  const r = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`);
  return r.json();
}

// ---- categories (id -> English name) --------------------------------------
// limit defaults to 2000; IKI has ~5015 categories, so ask for all of them
const raw_categories = await post("/categories", { chainIds: [IKI_CHAIN], limit: 100000 });
const categories_names: Record<string, string> = {};
for (const c of raw_categories.data) categories_names[c.id] = c.name?.en ?? c.name?.lt;
console.log(`categories: ${raw_categories.data.length}`);
// minimal tree for the explorer's hierarchical category filter
await Deno.writeTextFile(
  "categories.json",
  JSON.stringify(
    raw_categories.data.map((c: any) => ({
      id: c.id,
      parentId: c.parentId,
      name: c.name?.en ?? c.name?.lt ?? "",
    })),
  ),
);

// ---- bulk products --------------------------------------------------------
async function get_bulk_products() {
  const limit = 1000;
  let from = 0;
  let all: any[] = [];
  while (true) {
    const res = await post("/v1/frontend-products", {
      params: { type: "view_products", chainIds: [IKI_CHAIN], categoryIds: [] },
      limit,
      fromIndex: from,
    });
    const batch = res.products.map((p: any) => p.frontEndProduct);
    all = all.concat(batch);
    console.log(`  fetched ${all.length}/${res.count}`);
    from += batch.length;
    if (batch.length < limit) break; // last page (fixed: count is now the total)
  }
  return all;
}
const all_products = await get_bulk_products();
await Deno.writeTextFile(
  "raw_iki_product_data.json",
  JSON.stringify(all_products),
);

// ---- cleaning (verbatim from notebook) ------------------------------------
function extract_energy_value(value: string) {
  if (!/\d/.test(value)) return false;
  const digitsMatch = value.match(/(^1 )?\d+([.,](\d+))?/g);
  if (!digitsMatch || digitsMatch.length === 0) return null;
  else if (digitsMatch.length === 1) return digitsMatch[0];
  else if (digitsMatch.length === 2) {
    return Math.min(
      ...digitsMatch.map((d) => d.replace(",", ".").replace(" ", "")).map((d) => parseInt(d)),
    );
  } else return null; // malformed (>2 number tokens, e.g. "91 6kJ / 219 kcal") -> dropped below
}

function isValidEnergyValue(value: string): boolean {
  const digits = value.match(/\d+/g);
  if (digits === null) return false;
  const slash = value.match(/\//g);
  if (digits.length > 2 && (slash?.length ?? 0) > 1) return false;
  const bad_energy_values: any[] = [false, "", 0, "0", "-", "in 100g", "100g", "100ml"];
  return !bad_energy_values.includes(value) && !value.startsWith("Maistingumas ");
}

function fixNum(number: string) {
  return parseFloat(String(number).replace(",", "."));
}

function isValidNutrition(p: any) {
  if (p.energy > 900) return false;
  else if (p.fat > 100) return false;
  else if (p.satFat > 100 || p.satFat > p.fat) return false;
  else if (p.carbs > 100) return false;
  else if (p.sugar > 100 || p.sugar > p.carbs) return false;
  else if (p.protein > 100) return false;
  else if (p.salt > 100) return false;
  else if (p.fat + p.carbs + p.protein + p.salt > 100) return false;
  else return true;
}

let cleaned_products = all_products
  .filter((p) => isValidEnergyValue(p.nutrition.energy))
  .map((p) => ({
    name: p.name.en,
    slug: p.slugs[0],
    id: p.id,
    category: categories_names[p.categoryId] ?? "",
    categoryId: p.categoryId ?? "",
    thumb: p.thumbUrl ?? "",
    energy: extract_energy_value(p.nutrition.energy),
    fat: fixNum(p.nutrition.fat),
    satFat: fixNum(p.nutrition.satFat),
    carbs: fixNum(p.nutrition.carbs),
    sugar: fixNum(p.nutrition.sugar),
    protein: fixNum(p.nutrition.protein),
    salt: fixNum(p.nutrition.salt),
    description: p.description.en,
    actualPrice: p.actualPrice ?? "",
    loyaltyPrice: p.loyaltyPrice ?? "",
    unitOfMeasure: p.unitOfMeasure,
    conversionMeasure: p.conversionMeasure,
    conversionValue: p.conversionValue,
    constraintCode: p.constraintCode,
  }))
  .filter((p) => p.energy !== null && p.energy !== false)
  .filter(isValidNutrition);

const missing_cat = new Set(
  all_products.filter((p) => !categories_names[p.categoryId]).map((p) => p.categoryId),
).size;

const csv = stringify(cleaned_products, { columns: Object.keys(cleaned_products[0]) });
await Deno.writeTextFile("cleaned_products.csv", csv);
console.log(
  `\nraw products: ${all_products.length}\ncleaned rows: ${cleaned_products.length}` +
    `\nunmatched category ids: ${missing_cat}\nwrote cleaned_products.csv + raw_iki_product_data.json`,
);
