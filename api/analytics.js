// ===========================================
// Umami Analytics API Wrapper
// ===========================================

const UMAMI_API_BASE = "https://api.umami.is/v1";
const CACHE_DURATION = 60 * 1000; // 1 minute
const TIMEZONE = "Africa/Cairo"; // UTC+3

// In-memory cache
const cache = new Map();

// ---- Helper: fetch from Umami API ----
async function umamiRequest(path, token) {
  const res = await fetch(`${UMAMI_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Umami API error ${res.status}: ${err}`);
  }
  return res.json();
}

// ---- Helper: Cairo-aware date ranges ----
function getCairoMidnight() {
  const now = new Date();
  const cairoStr = now.toLocaleDateString("en-CA", { timeZone: TIMEZONE });
  return new Date(`${cairoStr}T00:00:00+03:00`).getTime();
}

function getCairoWeekStart() {
  const now = new Date();
  const cairoStr = now.toLocaleDateString("en-CA", { timeZone: TIMEZONE });
  const d = new Date(`${cairoStr}T00:00:00+03:00`);
  d.setDate(d.getDate() - d.getDay());
  return d.getTime();
}

function getCairoMonthStart() {
  const now = new Date();
  const cairoStr = now.toLocaleDateString("en-CA", { timeZone: TIMEZONE });
  const [y, m] = cairoStr.split("-");
  return new Date(`${y}-${m}-01T00:00:00+03:00`).getTime();
}

function getCairoYearStart() {
  const now = new Date();
  const cairoStr = now.toLocaleDateString("en-CA", { timeZone: TIMEZONE });
  const [y] = cairoStr.split("-");
  return new Date(`${y}-01-01T00:00:00+03:00`).getTime();
}

function getDateRange(period) {
  const now = Date.now();
  const ranges = {
    "0day":   { startAt: getCairoMidnight(),   endAt: now },
    "24hour": { startAt: now - 86400000,       endAt: now },
    "0week":  { startAt: getCairoWeekStart(),  endAt: now },
    "7day":   { startAt: now - 604800000,      endAt: now },
    "0month": { startAt: getCairoMonthStart(), endAt: now },
    "30day":  { startAt: now - 2592000000,     endAt: now },
    "0year":  { startAt: getCairoYearStart(),  endAt: now },
    "6month": { startAt: now - 15552000000,    endAt: now },
  };
  return ranges[period] || ranges["24hour"];
}

// ---- Helper: normalize value ----
const val = (f) =>
  f === null || f === undefined ? 0 : typeof f === "object" ? (f.value ?? 0) : f;

// ---- Helper: format expanded metrics ----
function formatExpanded(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    name:          item.name ?? item.x ?? "Unknown",
    visitors:      item.visitors  ?? 0,
    visits:        item.visits    ?? 0,
    views:         item.pageviews ?? item.y ?? 0,
    bounceRate:    item.visits > 0 ? Math.round((item.bounces / item.visits) * 100) : 0,
    visitDuration: item.visits > 0 ? Math.round(item.totaltime / item.visits) : 0,
  }));
}

// ---- Main handler ----
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const clientKey = req.headers["x-api-key"];
  if (process.env.CLIENT_API_KEY && clientKey !== process.env.CLIENT_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { period = "24hour", view = "summary", websiteId } = req.query;
  const siteId = websiteId || process.env.UMAMI_WEBSITE_ID;
  if (!siteId) return res.status(400).json({ error: "websiteId is required" });

  const cacheKey = `${siteId}:${period}:${view}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    res.setHeader("X-Cache", "HIT");
    res.setHeader("X-Cache-Age", Math.floor((Date.now() - cached.timestamp) / 1000) + "s");
    return res.status(200).json(cached.data);
  }

  try {
    const token = process.env.UMAMI_API_KEY;
    if (!token) return res.status(500).json({ error: "UMAMI_API_KEY not configured" });

    const { startAt, endAt } = getDateRange(period);
    const timeParams = `startAt=${startAt}&endAt=${endAt}&timezone=${encodeURIComponent(TIMEZONE)}`;

    let data;

    switch (view) {
      case "summary": {
        const stats = await umamiRequest(`/websites/${siteId}/stats?${timeParams}`, token);
        const views  = val(stats.pageviews);
        const visits = val(stats.visits);
        const total  = val(stats.totaltime);
        data = {
          views,
          visits,
          visitors:      val(stats.visitors),
          visitDuration: total && visits ? Math.round(total / visits) : 0,
          bounceRate:    val(stats.bounces),
          period,
          fetchedAt: new Date().toISOString(),
        };
        break;
      }

      case "path": {
        const result = await umamiRequest(
          `/websites/${siteId}/metrics/expanded?type=url&${timeParams}&limit=20`, token
        );
        data = { items: formatExpanded(result), view: "path", period, fetchedAt: new Date().toISOString() };
        break;
      }

      case "country": {
        const result = await umamiRequest(
          `/websites/${siteId}/metrics/expanded?type=country&${timeParams}&limit=20`, token
        );
        data = { items: formatExpanded(result), view: "country", period, fetchedAt: new Date().toISOString() };
        break;
      }

      case "region": {
        const result = await umamiRequest(
          `/websites/${siteId}/metrics/expanded?type=region&${timeParams}&limit=20`, token
        );
        data = { items: formatExpanded(result), view: "region", period, fetchedAt: new Date().toISOString() };
        break;
      }

      case "os": {
        const result = await umamiRequest(
          `/websites/${siteId}/metrics/expanded?type=os&${timeParams}&limit=20`, token
        );
        data = { items: formatExpanded(result), view: "os", period, fetchedAt: new Date().toISOString() };
        break;
      }

      case "browser": {
        const result = await umamiRequest(
          `/websites/${siteId}/metrics/expanded?type=browser&${timeParams}&limit=20`, token
        );
        data = { items: formatExpanded(result), view: "browser", period, fetchedAt: new Date().toISOString() };
        break;
      }

      case "device": {
        const result = await umamiRequest(
          `/websites/${siteId}/metrics/expanded?type=device&${timeParams}&limit=20`, token
        );
        data = { items: formatExpanded(result), view: "device", period, fetchedAt: new Date().toISOString() };
        break;
      }

      case "referrer": {
        const result = await umamiRequest(
          `/websites/${siteId}/metrics/expanded?type=referrer&${timeParams}&limit=20`, token
        );
        data = { items: formatExpanded(result), view: "referrer", period, fetchedAt: new Date().toISOString() };
        break;
      }

      case "all": {
        const [stats, paths, countries, os, browsers, devices] = await Promise.all([
          umamiRequest(`/websites/${siteId}/stats?${timeParams}`, token),
          umamiRequest(`/websites/${siteId}/metrics/expanded?type=url&${timeParams}&limit=10`, token),
          umamiRequest(`/websites/${siteId}/metrics/expanded?type=region&${timeParams}&limit=10`, token),
          umamiRequest(`/websites/${siteId}/metrics/expanded?type=os&${timeParams}&limit=10`, token),
          umamiRequest(`/websites/${siteId}/metrics/expanded?type=browser&${timeParams}&limit=10`, token),
          umamiRequest(`/websites/${siteId}/metrics/expanded?type=device&${timeParams}&limit=10`, token),
        ]);
        const allVisits = val(stats.visits);
        const allTime   = val(stats.totaltime);
        data = {
          summary: {
            views:         val(stats.pageviews),
            visits:        allVisits,
            visitors:      val(stats.visitors),
            visitDuration: allTime && allVisits ? Math.round(allTime / allVisits) : 0,
            bounceRate:    val(stats.bounces),
          },
          topPages:  formatExpanded(paths),
          countries: formatExpanded(countries),
          os:        formatExpanded(os),
          browsers:  formatExpanded(browsers),
          devices:   formatExpanded(devices),
          period,
          fetchedAt: new Date().toISOString(),
        };
        break;
      }

      default:
        return res.status(400).json({
          error: `Unknown view: ${view}`,
          validViews: ["summary","country","region","os","path","browser","device","referrer","all"],
        });
    }

    cache.set(cacheKey, { data, timestamp: Date.now() });
    res.setHeader("X-Cache", "MISS");
    res.setHeader("Cache-Control", "public, max-age=60");
    return res.status(200).json(data);

  } catch (err) {
    console.error("Umami API Error:", err.message);
    return res.status(500).json({ error: "Failed to fetch analytics", message: err.message });
  }
}
