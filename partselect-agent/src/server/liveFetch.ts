/**
 * Live fallback: when a model or part isn't in the local catalog, fetch it
 * straight from partselect.com, parse it, and ingest it (a self-growing KB).
 *
 * Important operational reality: partselect.com sits behind edge bot-protection
 * (Akamai/Cloudflare) that returns HTTP 403 to datacenter IPs — verified that
 * even a real headless Chromium from our EC2 host gets "Access Denied". This is
 * the exact same wall that breaks naive HTTP scrapers. So a reliable live fetch
 * needs a residential egress: set SCRAPE_PROXY_URL to a residential proxy and a
 * real-browser engine passes (the same parse logic already harvested 620 parts
 * through a real browser session). Without it, this layer degrades gracefully —
 * the agent says it checked, then falls back to the catalog answer.
 *
 * Enable with LIVE_FETCH=1 (and ideally SCRAPE_PROXY_URL). Disabled by default
 * so dev and tests don't reach the network.
 */

export type LiveListingPart = {
  ps: string; mfr: string | null; name: string; price: number; stock: string | null; slug: string;
};
export type LiveModelResult = {
  modelNo: string;
  appliance_type: "refrigerator" | "dishwasher";
  brand: string;
  parts: LiveListingPart[];
};

function enabled(): boolean {
  return process.env.LIVE_FETCH === "1";
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// playwright-core is an optional runtime dependency installed on the server only;
// kept loosely typed so the project type-checks and bundles without it present.
/* eslint-disable @typescript-eslint/no-explicit-any */
type PwPage = { goto: (url: string, opts: object) => Promise<{ status: () => number } | null>; title: () => Promise<string>; url: () => string; evaluate: (fn: string) => Promise<unknown> };

async function withBrowser<T>(fn: (page: PwPage) => Promise<T>): Promise<T | null> {
  let browser: { newContext: (o: object) => Promise<{ newPage: () => Promise<PwPage> }>; close: () => Promise<void> } | null = null;
  try {
    const mod = ["playwright", "core"].join("-");
    const { chromium } = (await import(/* webpackIgnore: true */ mod as string)) as any;
    const proxy = process.env.SCRAPE_PROXY_URL
      ? { server: process.env.SCRAPE_PROXY_URL }
      : undefined;
    browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
      proxy,
    });
    const ctx = await browser!.newContext({
      userAgent: UA,
      viewport: { width: 1920, height: 1080 },
      locale: "en-US",
    });
    return await fn(await ctx.newPage());
  } catch (err) {
    console.error("liveFetch browser error:", (err as Error).message);
    return null;
  } finally {
    await browser?.close().catch(() => {});
  }
}

const PARSE_LISTING = `(() => {
  const seen = new Map();
  for (const a of document.querySelectorAll('a[href*="PS"]')) {
    const path = a.pathname || "";
    const m = path.match(/^\\/(PS\\d+)-([^/?]+)\\.htm/);
    if (!m) continue;
    const ps = m[1];
    if (!seen.has(ps)) seen.set(ps, { ps, slug: m[2], name: null, price: null, stock: null, mfr: null });
    const e = seen.get(ps);
    const t = (a.textContent || '').trim();
    if (!e.name && t.length > 5 && !/^\\$/.test(t)) e.name = t;
    if (!e.price) {
      let card = a;
      for (let i = 0; i < 7 && card.parentElement; i++) {
        card = card.parentElement;
        const txt = card.textContent || '';
        if (txt.includes('$')) {
          e.price = (txt.match(/\\$\\s*([\\d,]+\\.\\d{2})/) || [])[1] || null;
          e.stock = (txt.match(/\\b(In Stock|Special Order|Out of Stock|No Longer Available|On Order)\\b/) || [])[1] || null;
          e.mfr = (txt.match(/Manufacturer\\s*#:?\\s*(\\S+)/) || [])[1] || null;
          break;
        }
      }
    }
  }
  return [...seen.values()].filter(p => p.name && p.price);
})()`;

/** Fetch the parts catalog of a model page, with appliance type + brand from the title. */
export async function fetchModel(modelNo: string): Promise<LiveModelResult | null> {
  if (!enabled()) return null;
  const m = modelNo.trim().toUpperCase();
  return withBrowser(async (page) => {
    const resp = await page.goto(`https://www.partselect.com/Models/${m}/Parts/`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    if (!resp || resp.status() !== 200) {
      console.error(`liveFetch fetchModel ${m}: status ${resp?.status()}`);
      return null;
    }
    const title = await page.title();
    if (!/All Parts for/i.test(title)) return null;
    const appliance_type = /Refrigerator/i.test(title) ? "refrigerator" : "dishwasher";
    const brand = (title.match(/All Parts for (\w+)/i) || [])[1] ?? "Unknown";
    const rawParts = (await page.evaluate(PARSE_LISTING)) as Array<{
      ps: string; mfr: string | null; name: string; price: string; stock: string | null; slug: string;
    }>;
    const parts: LiveListingPart[] = rawParts
      .map((p) => ({ ...p, price: Number(String(p.price).replace(/,/g, "")) }))
      .filter((p) => Number.isFinite(p.price) && p.price > 0);
    return parts.length > 0 ? { modelNo: m, appliance_type, brand, parts } : null;
  });
}

/** Resolve a bare part number to its full page and pull its core fields. */
export async function fetchPart(partNo: string): Promise<{
  ps: string; mfr: string | null; name: string; price: number; stock: string | null;
  appliance_type: "refrigerator" | "dishwasher" | null; description: string | null; url: string;
} | null> {
  if (!enabled()) return null;
  const ps = partNo.trim().toUpperCase();
  return withBrowser(async (page) => {
    const resp = await page.goto(`https://www.partselect.com/${ps}.htm`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    if (!resp || resp.status() !== 200) return null;
    const data = (await page.evaluate(`(() => {
      const bodyText = document.body.innerText;
      const name = document.querySelector('h1')?.textContent?.trim() || null;
      const price = (bodyText.match(/\\$\\s*([\\d,]+\\.\\d{2})/) || [])[1] || null;
      const stock = (bodyText.match(/\\b(In Stock|Special Order|Out of Stock|No Longer Available)\\b/) || [])[1] || null;
      const mfr = (bodyText.match(/Manufacturer Part Number\\s+(\\S+)/) || [])[1] || null;
      const d = document.querySelector('[itemprop="description"]');
      const description = d ? d.textContent.trim().slice(0, 400) : null;
      const isFridge = /refrigerator/i.test(document.title);
      const isDish = /dishwasher/i.test(document.title);
      return { name, price, stock, mfr, description, appliance: isFridge ? 'refrigerator' : isDish ? 'dishwasher' : null };
    })()`)) as {
      name: string | null; price: string | null; stock: string | null;
      mfr: string | null; description: string | null; appliance: "refrigerator" | "dishwasher" | null;
    };
    if (!data.name || !data.price) return null;
    return {
      ps, mfr: data.mfr, name: data.name,
      price: Number(data.price.replace(/,/g, "")),
      stock: data.stock,
      appliance_type: data.appliance,
      description: data.description,
      url: page.url(),
    };
  });
}
