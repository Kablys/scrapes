# lastmile.lt product & nutrition scrape (IKI, PROMO, Assorti, Livin)

Scrapes any shop on lastmile.lt (IKI's online shop platform): prices, sale and loyalty
prices, price per kg and nutrition per 100 g, in the same CSV columns as `rimi/` and
`barbora/`. For the IKI explorer's `cleaned_products.csv`, use `iki/scrape.ts` instead.

```bash
deno run --allow-net --allow-read --allow-write scrape.ts            # IKI, fresh scrape (~2.5 min)
deno run --allow-net --allow-read --allow-write scrape.ts --cached   # rebuild CSV from today's raw dump
deno run --allow-net --allow-read --allow-write scrape.ts --chain PROMO-CashandCarry  # another shop
```

lastmile.lt is a multi-shop platform, so `--chain <slug>` scrapes any of its chains with the
same API. An unknown slug prints the active list. Grocery chains in 2026-11:

| `--chain`            | Shop                 | Products | With nutrition |
|----------------------|----------------------|---------:|---------------:|
| `IKI` (default)      | IKI                  |   27 041 |          9 967 |
| `PROMO-CashandCarry` | PROMO Cash&Carry     |   28 818 |         21 568 |
| `Assorti-by-Livin`   | Assorti (Bio Sala)   |    4 547 |          2 207 |
| `Livin`              | Livin (Bio Sala)     |    2 398 |              2 |

lastmile reports a placeholder pack size (0.2–0.3 kg, or 1 for a piece) for many PROMO,
Assorti and Livin products, which breaks price per kg. When the product name states one size
that disagrees by more than half, the script uses the name's size. Goods sold by weight
(`unitOfMeasure` KG or L) are left alone.

- Writes `data/<slug lowercased>_products_<date>.csv` (every product; `nutritionValid` marks
  rows whose label parsed) and the raw dump to `data_cache/`. Both are git-ignored.
- The API investigation is in `iki/2024 scrape.ipynb` and `iki/2025 scrape.ipynb`. Their API
  host (`search-952707942140…`) is gone; the script uses `searchservice-952707942140…`.

API notes: `POST /chains` (chain ids and URL slugs), `POST /categories` (400 per page,
`fromIndex`), `POST /v1/frontend-products` (`limit` < 200, only ~1000 results deep per query,
so the script pages per leaf category). If the host changes again, lastmile.lt exposes it as
`NEXT_PUBLIC_SEARCH_URL` in `__NEXT_DATA__`.
