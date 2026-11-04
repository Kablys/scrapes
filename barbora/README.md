# Barbora product & nutrition scrape

Scrapes Barbora (barbora.lt, Maxima's online shop): regular and Ačiū card prices, price per
kg/l and nutrition per 100 g. The CSV has the same columns as the IKI one.

```bash
deno run --allow-net --allow-read --allow-write scrape.ts                     # full run
deno run --allow-net --allow-read --allow-write scrape.ts --cached            # reuse today's list dump
deno run --allow-net --allow-read --allow-write scrape.ts --no-details        # prices only (~2 min)
deno run --allow-net --allow-read --allow-write scrape.ts --max-details 500   # cap product-page fetches
```

- Product lists: ~23k products from ~450 pages (~2 min).
- Nutrition: one product page per food product (~14k). Barbora rate-limits (HTTP 429) and
  the script backs off, so the first run takes 3–4 h. Results are kept in
  `data_cache/barbora_details.json` and only re-fetched after 60 days, so later runs fetch
  only new products. Interrupting is safe: progress is checkpointed every 250 pages.
- Writes `data/barbora_products_<date>.csv` (git-ignored) and raw dumps to `data_cache/`.

How the site works (2026-11):
- Category tree: `GET https://production-elb.barbora.lt/api/cache/v1/country/LT/categories`.
- Product lists are server-rendered. Each category page embeds `window.b_productList = [...]`
  (52 per page, `?page=N`, empty past the end). A root category lists its whole subtree.
- Prices: `price` is what you pay now. With a single-unit `promotion`, `oldPrice` is the
  shelf price, and `loyaltyCardRequired` marks Ačiū-card prices (`LOYALTY_PRICE`, and
  `CATEGORY_PERCENTAGE` with `minQuantity` 1). Multi-buy promos (`X_FOR_Y`, `X_PLUS_N`, or
  `minQuantity` > 1) are ignored. `comparative_unit_price` is the current €/kg, €/l or €/vnt.
- Nutrition is only on product pages: `window.product.attributes.list`, where group 2 is the
  label. `nutrients` has the same values without energy.
- `POST /api/eshop/v1/product/GetInventories` with `[ids]` returns the list shape (no nutrition).
- Search runs on Constructor.io, but the scripts use only barbora.lt's own pages.
