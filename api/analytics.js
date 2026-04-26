// ===========================================
// Umami Analytics API Wrapper
// ===========================================

const UMAMI_API_BASE = "https://api.umami.is/v1";
const CACHE_DURATION = 60 * 1000; // 1 minute

// In-memory cache
const cache = new Map();

// ---- Helper: get token from Umami ----
async function getToken(apiKey) {
  // Umami Cloud uses API key directly as Bearer token
  return apiKey;
}

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

// ---- Helper: date ranges ----
function getDateRange(period) {
  const now = Date.now();
  const ranges = {
    "0day":    { startAt: startOfDay(),      endAt: now },
    "24hour":  { startAt: now - 86400000,    endAt: now },
    "0week":   { startAt: startOfWeek(),     endAt: now },
    "7day":    { startAt: now - 604800000,   endAt: now },
    "0month":  { startAt: startOfMonth(),    endAt: now },
    "30day":   { startAt: now - 2592000000,  endAt: now },
    "0year":   { startAt: startOfYear(),     endAt: now },
    "6month":  { startAt: now - 15552000000, endAt: now },
  };
  return ranges[period] || ranges["24hour"];
}

function startOfDay() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfWeek() {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfMonth() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfYear() {
  const d = new Date();
  d.setMonth(0, 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// ---- Main handler ----
export default async function handler(req, res) {
  // CORS headers - تعديل الـ origin بتاعك
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // Auth check (اختياري - تأمان إضافي لو حبيت)
  const clientKey = req.headers["x-api-key"];
  if (process.env.CLIENT_API_KEY && clientKey !== process.env.CLIENT_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { period = "24hour", view = "summary", websiteId } = req.query;

  const siteId = websiteId || process.env.UMAMI_WEBSITE_ID;
  if (!siteId) return res.status(400).json({ error: "websiteId is required" });

  // Check cache
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
    const timeParams = `startAt=${startAt}&endAt=${endAt}`;

    let data;

    switch (view) {
      case "summary": {
        // Stats الرئيسية: views, visits, visitors, visit duration
        const stats = await umamiRequest(
          `/websites/${siteId}/stats?${timeParams}`,
          token
        );
        // Umami بيرجع الداتا بشكلين: { value: X } أو رقم مباشر
        const val = (field) => {
          if (field === null || field === undefined) return 0;
          if (typeof field === "object") return field.value ?? 0;
          return field;
        };
        const views   = val(stats.pageviews);
        const visits  = val(stats.visits);
        const total   = val(stats.totaltime);
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

      case "country": {
        const result = await umamiRequest(
          `/websites/${siteId}/metrics?type=country&${timeParams}&limit=20`,
          token
        );
        data = { items: result, view: "country", period, fetchedAt: new Date().toISOString() };
        break;
      }

      case "region": {
        const result = await umamiRequest(
          `/websites/${siteId}/metrics?type=region&${timeParams}&limit=20`,
          token
        );
        data = { items: result, view: "region", period, fetchedAt: new Date().toISOString() };
        break;
      }

      case "os": {
        const result = await umamiRequest(
          `/websites/${siteId}/metrics?type=os&${timeParams}&limit=20`,
          token
        );
        data = { items: result, view: "os", period, fetchedAt: new Date().toISOString() };
        break;
      }

      case "path": {
        const result = await umamiRequest(
          `/websites/${siteId}/metrics?type=url&${timeParams}&limit=20`,
          token
        );
        data = { items: result, view: "path", period, fetchedAt: new Date().toISOString() };
        break;
      }

      case "browser": {
        const result = await umamiRequest(
          `/websites/${siteId}/metrics?type=browser&${timeParams}&limit=20`,
          token
        );
        data = { items: result, view: "browser", period, fetchedAt: new Date().toISOString() };
        break;
      }

      case "device": {
        const result = await umamiRequest(
          `/websites/${siteId}/metrics?type=device&${timeParams}&limit=20`,
          token
        );
        data = { items: result, view: "device", period, fetchedAt: new Date().toISOString() };
        break;
      }

      case "referrer": {
        const result = await umamiRequest(
          `/websites/${siteId}/metrics?type=referrer&${timeParams}&limit=20`,
          token
        );
        data = { items: result, view: "referrer", period, fetchedAt: new Date().toISOString() };
        break;
      }

      case "all": {
        // جيب كل حاجة مع بعض
        const [stats, countries, os, paths, browsers, devices] = await Promise.all([
          umamiRequest(`/websites/${siteId}/stats?${timeParams}`, token),
          umamiRequest(`/websites/${siteId}/metrics?type=country&${timeParams}&limit=10`, token),
          umamiRequest(`/websites/${siteId}/metrics?type=os&${timeParams}&limit=10`, token),
          umamiRequest(`/websites/${siteId}/metrics?type=url&${timeParams}&limit=10`, token),
          umamiRequest(`/websites/${siteId}/metrics?type=browser&${timeParams}&limit=10`, token),
          umamiRequest(`/websites/${siteId}/metrics?type=device&${timeParams}&limit=10`, token),
        ]);

        const v = (f) => (f === null || f === undefined) ? 0 : (typeof f === 'object' ? (f.value ?? 0) : f);
        const allVisits = v(stats.visits);
        const allTime   = v(stats.totaltime);
        data = {
          summary: {
            views:         v(stats.pageviews),
            visits:        allVisits,
            visitors:      v(stats.visitors),
            visitDuration: allTime && allVisits ? Math.round(allTime / allVisits) : 0,
          },
          countries,
          os,
          topPages: paths,
          browsers,
          devices,
          period,
          fetchedAt: new Date().toISOString(),
        };
        break;
      }

      default:
        return res.status(400).json({
          error: `Unknown view: ${view}`,
          validViews: ["summary", "country", "region", "os", "path", "browser", "device", "referrer", "all"],
        });
    }

    // Save to cache
    cache.set(cacheKey, { data, timestamp: Date.now() });

    res.setHeader("X-Cache", "MISS");
    res.setHeader("Cache-Control", "public, max-age=60");
    return res.status(200).json(data);

  } catch (err) {
    console.error("Umami API Error:", err.message);
    return res.status(500).json({
      error: "Failed to fetch analytics",
      message: err.message,
    });
  }
}
