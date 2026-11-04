# scrapes

Assorted scrapers. `rimi/` and `barbora/` share `lib/grocery.ts` (fetch with retry, caching,
nutrition parsing and validation, CSV output); `iki/` predates it and keeps its own copy of
the same cleaning rules. All grocery scrapers write the **same CSV columns**,
so their outputs can be concatenated and compared:

| Folder      | Shop(s)                                           | Source                                |
|-------------|---------------------------------------------------|---------------------------------------|
| `iki/`      | IKI, PROMO Cash&Carry, Assorti, Livin (`--chain`) | lastmile.lt search API (JSON)         |
| `rimi/`     | Rimi                                              | rimi.lt e-shop HTML + category API    |
| `barbora/`  | Barbora (Maxima)                                  | barbora.lt embedded page JSON         |

Coverage on 2026-11-04 (products / with a valid nutrition label / with a card price):
IKI 26 349 / 9 820 / 2 320 · PROMO Cash&Carry 28 775 / 21 908 / – · Assorti 4 547 / 2 207 / – ·
Rimi 19 151 / 8 281 / 4 092 · Barbora 23 348 / 8 860 / 2 404.

Run any of them with `mise x -- deno run --allow-net --allow-read --allow-write <dir>/scrape.ts`.

Columns: `name, category, parentCategory, nutritionValid, energy (kcal), fat, satFat, carbs,
sugar, protein, salt` (per 100 g/ml), `proteinPer100kcal, price, salePrice, loyaltyPrice,
packKg, pricePerKg, bestPricePerKg, proteinGPerEuro, kcalPerEuro, isActive, isInStock,
countryOfOrigin, url, id`. A label that doesn't parse or fails the sanity checks is blanked
(`nutritionValid=false`), not dropped. Fresh produce and counter goods usually have none.

## Lithuanian online grocers not covered (2026-11)

- **Lidl, Norfa**: no online grocery ordering in Lithuania (leaflets only).
- **Wolt Market**: closing its Lithuanian stores in 2026.
- **Bolt Market**: in-app only, no web shop.
- **Pigu.lt "maisto prekės"**: a marketplace with a thin grocery range.
