# Barbora product & nutrition scrape

Scrapes Barbora (barbora.lt, Maxima's online shop): regular and Ačiū card prices, price per
kg/l and nutrition per 100 g. The CSV has the same columns as the IKI one.

```bash
deno run --allow-net --allow-read --allow-write scrape.ts                     # full run
deno run --allow-net --allow-read --allow-write scrape.ts --cached            # reuse today's list dump
deno run --allow-net --allow-read --allow-write scrape.ts --no-details        # prices only (~1 min)
deno run --allow-net --allow-read --allow-write scrape.ts --max-details 500   # cap product fetches
```

- Product lists: ~25k products in ~130 API requests (under a minute).
- Nutrition: one request per food product (~15k). Results are kept in
  `data_cache/barbora_details.json` and only re-fetched after 60 days, so later runs fetch
  only new products. Interrupting is safe: progress is checkpointed every 250 products.
- Writes `data/barbora_products_<date>.csv` (git-ignored) and raw dumps to `data_cache/`.

How the site works (2026-11-17). Barbora moved to a Remix front end in mid-November 2026.
The old category pages with `window.b_productList` now redirect to `/c/<shortId>/<slug>`.
Behind the site there is a JSON API at `https://barbora.lt/proxy/api/v1/`, whose paths are
listed in the site's JS bundle:
- `categories/category-tree` returns `{categories: [{shortId, url, name, children}]}`, 11 roots.
- `inventory/category/{shortId}?Offset=&Limit=` (`Limit` ≤ 200) returns `{count, inventories}`.
  A root category lists its whole subtree.
- `product/by-url/{url}` returns one product with `nutrients` (`calories`, `protein`, … each
  `{value}`), `netAmount` (g/ml) and `countryOfOrigin`.
- Prices: `price` is what you pay now. A single-unit `promotion` carries `oldPrice` (the shelf
  price), and `loyaltyCardRequired` marks Ačiū-card prices. Multi-buy promos (`XForY`,
  `XPlusN`, `CategoryPercentage` with `minQuantity` > 1) have no `oldPrice` and are ignored.
  `comparativeUnit` is `{type: kg|l|units, price}` at the current price.
- Product pages are `https://barbora.lt/p/<url>` (old `/produktai/<url>` links redirect).
