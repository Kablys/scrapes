# Rimi product & nutrition scrape

Scrapes the Rimi e-shop (rimi.lt/e-parduotuve): regular, sale and Mano RIMI card prices,
price per kg/l and nutrition per 100 g. The CSV has the same columns as the IKI one.

```bash
deno run --allow-net --allow-read --allow-write scrape.ts                     # full run
deno run --allow-net --allow-read --allow-write scrape.ts --cached            # reuse today's list dump
deno run --allow-net --allow-read --allow-write scrape.ts --no-details        # prices only (~3 min)
deno run --allow-net --allow-read --allow-write scrape.ts --max-details 500   # cap product-page fetches
```

- Product lists: ~19k products from ~190 HTML pages (~3 min).
- Nutrition: one product page per food product (~11.7k). The site throttles, so the first run
  takes about 1.5 h. Results are kept in `data_cache/rimi_details.json` and only re-fetched after
  60 days, so later runs fetch only new products.
- Writes `data/rimi_products_<date>.csv` (git-ignored) and raw dumps to `data_cache/`.

How the site works (2026-11): there is no product JSON API. The category tree is JSON
(`/e-parduotuve/api/v1/content/category-tree`); product grids are server-rendered HTML,
`?currentPage=N&pageSize=100` (larger page sizes redirect). Each card has a
`data-gtm-eec-product` JSON blob (id, name, category code, current price), `card__old-price`
during a sale, a `price-label` with the `rimi-card` image for the Mano RIMI price, and
`card__price-per` for €/kg. Product pages embed the body as a JS-escaped string. The
nutrition table and the "Kilmės šalis" / "Grynasis kiekis" fields are parsed out of it.
