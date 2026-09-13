import type { Comp } from "./thrift";

const FIRECRAWL = "https://api.firecrawl.dev/v2/scrape";

function parseListings(markdown: string): Comp[] {
  const lines = markdown.split("\n");
  const out: Comp[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    const link = /^\[(.+?)\]\((https?:\/\/(?:www\.)?ebay\.com\/itm\/(\d+)[^)]*)\)/.exec(line);
    if (!link) continue;
    const id = link[3] ?? "";
    const title = (link[1] ?? "").replace(/Opens in a new window or tab\s*$/i, "").trim();
    if (!title || title.startsWith("![") || /^(shop on ebay|watch )/i.test(title) || seen.has(id)) continue;

    let price = 0;
    let condition = "";
    for (let j = i + 1; j < Math.min(i + 14, lines.length); j++) {
      const t = (lines[j] ?? "").trim();
      if (!t) continue;
      if (!price) {
        const m = /^\$([\d,]+(?:\.\d{2})?)/.exec(t);
        if (m) {
          price = Number((m[1] ?? "").replace(/,/g, ""));
          continue;
        }
      }
      if (
        !condition &&
        /^(brand new|new \(other\)|new|pre-owned|open box|used|refurbished|parts only)/i.test(t)
      ) {
        condition = t;
      }
    }

    if (price > 0) {
      seen.add(id);
      out.push({
        source: "eBay (live listing)",
        title: title.slice(0, 120),
        price,
        condition: condition || "Unspecified",
        note: "Current asking price on eBay",
      });
    }
    if (out.length >= 25) break;
  }

  return out;
}


/** Live eBay listing prices via Firecrawl. Returns [] when unavailable. */
export async function fetchEbayComps(query: string): Promise<Comp[]> {
  const apiKey = process.env["FIRECRAWL_API_KEY"];
  if (!apiKey || !query.trim()) return [];

  const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query.trim())}&_sop=12`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    const res = await fetch(FIRECRAWL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: { markdown?: string } };
    const markdown = json.data?.markdown ?? "";
    return parseListings(markdown);
  } catch {
    return [];
  }
}

/** Drop outliers and summarise a price distribution. */
export function summarise(comps: Comp[]) {
  const prices = comps.map((c) => c.price).sort((a, b) => a - b);
  if (prices.length < 3) return null;
  const at = (p: number) => prices[Math.min(prices.length - 1, Math.floor(prices.length * p))] ?? 0;
  const median = at(0.5);
  // Ignore accessory/junk listings and wild outliers relative to the median.
  const kept = prices.filter((p) => p >= median * 0.25 && p <= median * 4);
  if (kept.length < 3) return null;
  const q = (p: number) => kept[Math.min(kept.length - 1, Math.floor(kept.length * p))] ?? 0;
  return { low: q(0.15), median: q(0.5), high: q(0.85), count: kept.length };
}
