// Shared helpers for the grocery scrapers (iki/, rimi/, barbora/).
// Every scraper writes the same CSV columns (COLUMNS) so the shops can be compared
// side by side; the file name says which shop a CSV came from.

import { stringify } from "jsr:@std/csv@1";

export const today = new Date().toISOString().slice(0, 10);
export const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch() with a browser UA and retries on 429/5xx/network errors. */
export async function get(url: string, init: RequestInit = {}, tries = 4): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { "User-Agent": UA, "Accept-Language": "lt-LT,lt;q=0.9", ...init.headers },
      });
      if (res.ok || (res.status < 500 && res.status !== 429) || attempt >= tries) return res;
      await res.body?.cancel();
    } catch (e) {
      if (attempt >= tries) throw e;
    }
    await sleep(1000 * 2 ** attempt);
  }
}

export async function getText(url: string): Promise<string> {
  const res = await get(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return await res.text();
}

/** Run fn over items with at most `n` in flight; results keep input order. */
export async function pool<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

/** JSON file cache under <dir>/data_cache. With `use` false the file is always rebuilt. */
export async function cached<T>(dir: string, file: string, use: boolean, produce: () => Promise<T>): Promise<T> {
  await Deno.mkdir(dir + "data_cache", { recursive: true });
  const path = dir + "data_cache/" + file;
  if (use) {
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

// ---- product detail cache ----
// Rimi and Barbora only show nutrition on the product page, one request per product.
// Labels rarely change, so details are kept in one persistent file per shop and only
// missing or stale (> maxAgeDays) entries are re-fetched.

export type Detail = {
  fetchedAt: string;
  nutrition: [string, string][]; // raw label rows, e.g. ["Baltymai", "3.2 g"]
  netQuantity?: string; // "250", "0.2 kg", … as printed
  countryOfOrigin?: string;
};

export async function withDetailCache(
  dir: string,
  shop: string,
  ids: string[],
  fetchOne: (id: string) => Promise<Detail | null>,
  opts: { maxAgeDays?: number; max?: number; concurrency?: number } = {},
): Promise<Map<string, Detail>> {
  const { maxAgeDays = 60, max = Infinity, concurrency = 4 } = opts;
  await Deno.mkdir(dir + "data_cache", { recursive: true });
  const path = `${dir}data_cache/${shop}_details.json`;
  let store: Record<string, Detail> = {};
  try {
    store = JSON.parse(await Deno.readTextFile(path));
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  const cutoff = Date.now() - maxAgeDays * 864e5;
  const missing = ids.filter((id) => !store[id] || Date.parse(store[id].fetchedAt) < cutoff);
  const todo = missing.slice(0, max);
  console.error(`  details: ${ids.length - missing.length} cached, ${missing.length} missing, fetching ${todo.length}`);
  let done = 0, failed = 0;
  const save = () => Deno.writeTextFile(path, JSON.stringify(store));
  await pool(todo, concurrency, async (id) => {
    try {
      const d = await fetchOne(id);
      if (d) store[id] = d;
    } catch (e) {
      failed++;
      if (failed <= 5) console.error(`  detail ${id}: ${(e as Error).message}`);
    }
    if (++done % 250 === 0) {
      console.error(`  details ${done}/${todo.length}`);
      await save(); // checkpoint so an interrupted run keeps its progress
    }
  });
  await save();
  if (failed) console.error(`  warning: ${failed} detail pages failed (re-run to retry)`);
  return new Map(Object.entries(store));
}

// ---- nutrition parsing / validation (rules from the IKI notebook) ----

export type Nutrition = {
  energy: number; fat: number; satFat: number; carbs: number; sugar: number; protein: number; salt: number;
};
export const NO_NUTRITION: Nutrition = {
  energy: NaN, fat: NaN, satFat: NaN, carbs: NaN, sugar: NaN, protein: NaN, salt: NaN,
};

/** First number in a string, "," as decimal separator allowed; "<0,5 g" -> 0.5. */
export const num = (s: string | undefined | null) => {
  const m = s?.replace(/\s/g, "").match(/\d+(?:[.,]\d+)?/);
  return m ? parseFloat(m[0].replace(",", ".")) : NaN;
};

/** kcal from an energy label: "3056 kJ/ 743 kcal", " / 20.00 Kcal", "743". */
export function energyKcal(value: string | undefined | null): number {
  if (!value) return NaN;
  const kcal = value.match(/(\d+(?:[.,]\d+)?)\s*kcal/i);
  if (kcal) return parseFloat(kcal[1].replace(",", "."));
  const nums = value.match(/\d+(?:[.,]\d+)?/g);
  if (!nums || nums.length > 2) return NaN; // "1997/265 kJ / 476/63 kcal"-style ambiguity
  const ns = nums.map((n) => parseFloat(n.replace(",", ".")));
  return ns.length === 2 ? Math.min(...ns) : /kj/i.test(value) ? NaN : ns[0];
}

/** Map Lithuanian label rows (name, value) to per-100 g numbers. */
export function nutritionFromRows(rows: [string, string][]): Nutrition {
  const n = { ...NO_NUTRITION };
  for (const [rawName, value] of rows) {
    const name = rawName.toLowerCase();
    if (name.includes("energ")) n.energy = isNaN(n.energy) ? energyKcal(value) : n.energy;
    else if (name.includes("soč") || name.includes("soc")) n.satFat = num(value);
    else if (name.includes("riebal")) n.fat = isNaN(n.fat) ? num(value) : n.fat;
    else if (name.includes("cukr")) n.sugar = num(value);
    else if (name.includes("angliavand")) n.carbs = isNaN(n.carbs) ? num(value) : n.carbs;
    else if (name.includes("baltym")) n.protein = num(value);
    else if (name.includes("druska")) n.salt = num(value);
  }
  return n;
}

export function isValidNutrition(p: Nutrition) {
  if (isNaN(p.energy) || p.energy > 900) return false;
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

/** "250" (g/ml), "0.2 kg", "1 l", "500 ml", "6 x 330 ml" -> kg (or litres). */
export function quantityKg(s: string | undefined | null): number {
  if (!s) return NaN;
  const t = s.toLowerCase().replace(",", ".");
  const m = t.match(/(?:(\d+)\s*[x×]\s*)?(\d+(?:\.\d+)?)\s*(kg|g|ml|l)?\b/);
  if (!m) return NaN;
  const count = m[1] ? parseInt(m[1]) : 1;
  const v = parseFloat(m[2]);
  const unit = m[3] ?? "g"; // Barbora's "Grynasis kiekis (g/ml)" is a bare number
  return count * (unit === "kg" || unit === "l" ? v : v / 1000);
}

export const round = (x: number, d = 2) => (isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : NaN);

// ---- output ----

export const COLUMNS = [
  "name", "category", "parentCategory", "nutritionValid",
  "energy", "fat", "satFat", "carbs", "sugar", "protein", "salt", "proteinPer100kcal",
  "price", "salePrice", "loyaltyPrice", "packKg", "pricePerKg", "bestPricePerKg",
  "proteinGPerEuro", "kcalPerEuro", "isActive", "isInStock", "countryOfOrigin", "url", "id",
] as const;

export type Input = {
  id: string;
  name: string;
  category: string;
  parentCategory: string;
  price: number; // regular shelf price
  salePrice?: number | null; // promo price anyone gets
  loyaltyPrice?: number | null; // card price (Ačiū, Mano Rimi, IKI)
  packKg: number; // kg or litres per priced unit; 1 for goods sold by weight
  nutrition?: Nutrition | null; // per 100 g/ml, unvalidated
  isActive?: boolean | "";
  isInStock?: boolean | "";
  countryOfOrigin?: string;
  url: string;
};

/** Validate nutrition and add the derived price/kg and protein-per-euro columns. */
export function toRow(p: Input) {
  let n = p.nutrition ?? NO_NUTRITION;
  // Fresh produce and counter meat carry no label; bad labels are blanked, not dropped.
  const nutritionValid = isValidNutrition(n);
  if (!nutritionValid) n = NO_NUTRITION;
  const sale = p.salePrice ?? null, loyalty = p.loyaltyPrice ?? null;
  const best = Math.min(...[p.price, sale, loyalty].filter((x): x is number => x != null && isFinite(x)));
  const pricePerKg = p.packKg > 0 ? p.price / p.packKg : NaN;
  const bestPerKg = p.packKg > 0 ? best / p.packKg : NaN;
  return {
    name: p.name,
    category: p.category,
    parentCategory: p.parentCategory,
    nutritionValid,
    ...n,
    proteinPer100kcal: round((n.protein / n.energy) * 100, 1),
    price: p.price,
    salePrice: sale ?? "",
    loyaltyPrice: loyalty ?? "",
    packKg: round(p.packKg, 3),
    pricePerKg: round(pricePerKg),
    bestPricePerKg: round(bestPerKg),
    proteinGPerEuro: round((n.protein * 10) / bestPerKg, 1),
    kcalPerEuro: round((n.energy * 10) / bestPerKg, 0),
    isActive: p.isActive ?? "",
    isInStock: p.isInStock ?? "",
    countryOfOrigin: p.countryOfOrigin ?? "",
    url: p.url,
    id: p.id,
  };
}

/** Sort like the IKI CSV, blank NaNs, write data/<prefix>_<date>.csv. */
export async function writeCsv(dir: string, prefix: string, rows: ReturnType<typeof toRow>[]) {
  const clean = rows
    .sort((a, b) =>
      (a.parentCategory + a.category + a.name).localeCompare(b.parentCategory + b.category + b.name, "lt")
    )
    .map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "number" && isNaN(v) ? "" : v])));
  await Deno.mkdir(dir + "data", { recursive: true });
  const out = `${dir}data/${prefix}_${today}.csv`;
  await Deno.writeTextFile(out, stringify(clean, { columns: [...COLUMNS] }));
  const valid = clean.filter((r) => r.nutritionValid).length;
  console.error(`${clean.length} products, ${valid} with valid nutrition -> ${out}`);
  return out;
}

export function flag(name: string): boolean {
  return Deno.args.includes(`--${name}`);
}
export function option(name: string): string | undefined {
  const i = Deno.args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return undefined;
  const a = Deno.args[i];
  return a.includes("=") ? a.slice(a.indexOf("=") + 1) : Deno.args[i + 1];
}
