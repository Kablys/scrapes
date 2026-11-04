# IKI product & nutrition scrape

Scrapes the IKI catalogue from lastmile.lt (IKI's online shop): prices, sale/loyalty
prices, price per kg and nutrition per 100 g.

```bash
deno run --allow-net --allow-read --allow-write scrape.ts            # fresh scrape (~2.5 min)
deno run --allow-net --allow-read --allow-write scrape.ts --cached   # rebuild CSV from today's raw dump
deno run --allow-net --allow-read --allow-write scrape.ts --chain PROMO-CashandCarry  # another lastmile.lt shop
```

lastmile.lt is a multi-shop platform, so `--chain <slug>` scrapes any of its chains with the
same API (an unknown slug prints the active list). Grocery chains in 2026-11:

| `--chain`            | Shop                 | Products | With nutrition |
|----------------------|----------------------|---------:|---------------:|
| `IKI` (default)      | IKI                  |   26 349 |          9 820 |
| `PROMO-CashandCarry` | PROMO Cash&Carry     |   28 775 |         21 908 |
| `Assorti-by-Livin`   | Assorti (Bio Sala)   |    4 547 |          2 207 |
| `Livin`              | Livin (Bio Sala)     |    2 398 |              2 |

Output goes to `data/<slug lowercased>_products_<date>.csv`, so IKI keeps `iki_products_<date>.csv`.

- `scrape.ts` — the script. Writes `data/<chain>_products_<date>.csv` (every product;
  `nutritionValid` marks rows whose label parsed) and the raw dump to `data_cache/` (git-ignored).
- `2024 scrape.ipynb`, `2025 scrape.ipynb` — the original API investigation (Deno Jupyter kernel).
  Their API host (`search-952707942140…`) is gone; the script uses `searchservice-952707942140…`.
- `cleaned_products.csv` — the 2025 notebook export.

API notes: `POST /chains` (chain ids and URL slugs), `POST /categories` (400 per page, `fromIndex`), `POST /v1/frontend-products`
(`limit` < 200, only ~1000 results deep per query, so the script pages per leaf category).
If the host changes again, lastmile.lt exposes it as `NEXT_PUBLIC_SEARCH_URL` in `__NEXT_DATA__`.
