// ===========================================
// PostHog Analytics API Wrapper
// ===========================================

const CACHE_DURATION = 60 * 1000; // 1 minute
const TIMEZONE = "Africa/Cairo";
const cache = new Map();

// ---- Cairo-aware date helpers ----
function getCairoDateStr() {
  return new Date().toLocaleDateString("en-CA", { timeZone: TIMEZONE });
}

function getCairoMidnight() {
  return new Date(`${getCairoDateStr()}T00:00:00+03:00`);
}

function getCairoWeekStart() {
  const weekdays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const cairoWeekday = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE, weekday: 'short'
  }).format(new Date());
  const cairoDay = weekdays.indexOf(cairoWeekday);
  const d = new Date(`${getCairoDateStr()}T00:00:00+03:00`);
  const diff = cairoDay === 0 ? -6 : 1 - cairoDay;
  d.setDate(d.getDate() + diff);
  return d;
}

function getCairoMonthStart() {
  const [y, m] = getCairoDateStr().split("-");
  return new Date(`${y}-${m}-01T00:00:00+03:00`);
}

function getCairoYearStart() {
  const [y] = getCairoDateStr().split("-");
  return new Date(`${y}-01-01T00:00:00+03:00`);
}

function getDateRange(period) {
  const now = new Date();
  const ranges = {
    "0day":   { start: getCairoMidnight(),          end: now },
    "24hour": { start: new Date(now - 86400000),    end: now },
    "0week":  { start: getCairoWeekStart(),         end: now },
    "7day":   { start: new Date(now - 604800000),   end: now },
    "0month": { start: getCairoMonthStart(),        end: now },
    "30day":  { start: new Date(now - 2592000000),  end: now },
    "0year":  { start: getCairoYearStart(),         end: now },
    "6month": { start: new Date(now - 15552000000), end: now },
  };
  return ranges[period] || ranges["24hour"];
}

// ---- PostHog HogQL Query Helper ----
async function hogQuery(sql) {
  const host   = process.env.POSTHOG_HOST || "https://us.posthog.com";
  const projId = process.env.POSTHOG_PROJECT_ID;
  const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;

  const res = await fetch(`${host}/api/projects/${projId}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query: sql } }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PostHog API error ${res.status}: ${err}`);
  }

  const json = await res.json();
  return json.results ?? [];
}

// ---- Main Handler ----
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET")     return res.status(405).json({ error: "Method not allowed" });

  const clientKey = req.headers["x-api-key"];
  if (process.env.CLIENT_API_KEY && clientKey !== process.env.CLIENT_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { period = "24hour", view = "summary" } = req.query;

  const cacheKey = `${period}:${view}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    res.setHeader("X-Cache", "HIT");
    res.setHeader("X-Cache-Age", Math.floor((Date.now() - cached.timestamp) / 1000) + "s");
    return res.status(200).json(cached.data);
  }

  try {
    const { start, end } = getDateRange(period);
    const startISO = start.toISOString();
    const endISO   = end.toISOString();

    let data;

    switch (view) {

      case "summary": {
        const rows = await hogQuery(`
          SELECT
            countIf(event = '$pageview')                                          AS views,
            uniq(distinct_id)                                                     AS visitors,
            uniqIf(properties.$session_id, event = '$pageview')                  AS visits,
            avgIf(toFloat64OrNull(properties.$session_duration),
                  event = '$pageleave'
                  AND properties.$session_duration IS NOT NULL)                   AS avgDuration
          FROM events
          WHERE timestamp >= '${startISO}'
            AND timestamp <= '${endISO}'
        `);
        const r = rows[0] ?? [];
        data = {
          views:         Number(r[0]) || 0,
          visitors:      Number(r[1]) || 0,
          visits:        Number(r[2]) || 0,
          visitDuration: Math.round(Number(r[3]) || 0),
          period,
          fetchedAt: new Date().toISOString(),
        };
        break;
      }

      case "path": {
        const rows = await hogQuery(`
          SELECT
            properties.$current_url  AS url,
            count()                   AS views,
            uniq(distinct_id)         AS visitors
          FROM events
          WHERE event = '$pageview'
            AND timestamp >= '${startISO}'
            AND timestamp <= '${endISO}'
          GROUP BY url
          ORDER BY views DESC
          LIMIT 20
        `);
        data = {
          items: rows.map(r => ({
            name:     r[0] ?? "Unknown",
            views:    Number(r[1]) || 0,
            visitors: Number(r[2]) || 0,
          })),
          view: "path", period, fetchedAt: new Date().toISOString(),
        };
        break;
      }

      case "region": {
        const rows = await hogQuery(`
          SELECT
            properties.$geoip_subdivision_1_name  AS region,
            properties.$geoip_country_name        AS country,
            count()                                AS views,
            uniq(distinct_id)                      AS visitors
          FROM events
          WHERE event = '$pageview'
            AND timestamp >= '${startISO}'
            AND timestamp <= '${endISO}'
            AND properties.$geoip_subdivision_1_name IS NOT NULL
          GROUP BY region, country
          ORDER BY views DESC
          LIMIT 20
        `);
        data = {
          items: rows.map(r => ({
            name:     r[0] ?? "Unknown",
            country:  r[1] ?? "",
            views:    Number(r[2]) || 0,
            visitors: Number(r[3]) || 0,
          })),
          view: "region", period, fetchedAt: new Date().toISOString(),
        };
        break;
      }

      case "country": {
        const rows = await hogQuery(`
          SELECT
            properties.$geoip_country_name  AS country,
            count()                          AS views,
            uniq(distinct_id)                AS visitors
          FROM events
          WHERE event = '$pageview'
            AND timestamp >= '${startISO}'
            AND timestamp <= '${endISO}'
            AND properties.$geoip_country_name IS NOT NULL
          GROUP BY country
          ORDER BY views DESC
          LIMIT 20
        `);
        data = {
          items: rows.map(r => ({
            name:     r[0] ?? "Unknown",
            views:    Number(r[1]) || 0,
            visitors: Number(r[2]) || 0,
          })),
          view: "country", period, fetchedAt: new Date().toISOString(),
        };
        break;
      }

      case "browser": {
        const rows = await hogQuery(`
          SELECT
            properties.$browser  AS browser,
            count()               AS views,
            uniq(distinct_id)     AS visitors
          FROM events
          WHERE event = '$pageview'
            AND timestamp >= '${startISO}'
            AND timestamp <= '${endISO}'
            AND properties.$browser IS NOT NULL
          GROUP BY browser
          ORDER BY views DESC
          LIMIT 20
        `);
        data = {
          items: rows.map(r => ({
            name:     r[0] ?? "Unknown",
            views:    Number(r[1]) || 0,
            visitors: Number(r[2]) || 0,
          })),
          view: "browser", period, fetchedAt: new Date().toISOString(),
        };
        break;
      }

      case "os": {
        const rows = await hogQuery(`
          SELECT
            properties.$os      AS os,
            count()              AS views,
            uniq(distinct_id)    AS visitors
          FROM events
          WHERE event = '$pageview'
            AND timestamp >= '${startISO}'
            AND timestamp <= '${endISO}'
            AND properties.$os IS NOT NULL
          GROUP BY os
          ORDER BY views DESC
          LIMIT 20
        `);
        data = {
          items: rows.map(r => ({
            name:     r[0] ?? "Unknown",
            views:    Number(r[1]) || 0,
            visitors: Number(r[2]) || 0,
          })),
          view: "os", period, fetchedAt: new Date().toISOString(),
        };
        break;
      }

      case "device": {
        const rows = await hogQuery(`
          SELECT
            properties.$device_type  AS device,
            count()                   AS views,
            uniq(distinct_id)         AS visitors
          FROM events
          WHERE event = '$pageview'
            AND timestamp >= '${startISO}'
            AND timestamp <= '${endISO}'
            AND properties.$device_type IS NOT NULL
          GROUP BY device
          ORDER BY views DESC
          LIMIT 20
        `);
        data = {
          items: rows.map(r => ({
            name:     r[0] ?? "Unknown",
            views:    Number(r[1]) || 0,
            visitors: Number(r[2]) || 0,
          })),
          view: "device", period, fetchedAt: new Date().toISOString(),
        };
        break;
      }

      case "referrer": {
        const rows = await hogQuery(`
          SELECT
            properties.$referring_domain  AS referrer,
            count()                        AS views,
            uniq(distinct_id)              AS visitors
          FROM events
          WHERE event = '$pageview'
            AND timestamp >= '${startISO}'
            AND timestamp <= '${endISO}'
            AND properties.$referring_domain IS NOT NULL
            AND properties.$referring_domain != ''
          GROUP BY referrer
          ORDER BY views DESC
          LIMIT 20
        `);
        data = {
          items: rows.map(r => ({
            name:     r[0] ?? "Direct",
            views:    Number(r[1]) || 0,
            visitors: Number(r[2]) || 0,
          })),
          view: "referrer", period, fetchedAt: new Date().toISOString(),
        };
        break;
      }

      case "live": {
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const rows = await hogQuery(`
          SELECT uniq(distinct_id) AS active
          FROM events
          WHERE timestamp >= '${fiveMinAgo}'
        `);
        data = {
          active:    Number(rows[0]?.[0]) || 0,
          fetchedAt: new Date().toISOString(),
        };
        break;
      }

      case "all": {
        const [summary, paths, regions, browsers, oses, devices] = await Promise.all([
          hogQuery(`
            SELECT
              countIf(event = '$pageview')                            AS views,
              uniq(distinct_id)                                       AS visitors,
              uniqIf(properties.$session_id, event = '$pageview')    AS visits
            FROM events
            WHERE timestamp >= '${startISO}' AND timestamp <= '${endISO}'
          `),
          hogQuery(`
            SELECT properties.$current_url, count(), uniq(distinct_id)
            FROM events WHERE event = '$pageview'
              AND timestamp >= '${startISO}' AND timestamp <= '${endISO}'
            GROUP BY 1 ORDER BY 2 DESC LIMIT 10
          `),
          hogQuery(`
            SELECT properties.$geoip_subdivision_1_name,
                   properties.$geoip_country_name,
                   count(), uniq(distinct_id)
            FROM events WHERE event = '$pageview'
              AND timestamp >= '${startISO}' AND timestamp <= '${endISO}'
              AND properties.$geoip_subdivision_1_name IS NOT NULL
            GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10
          `),
          hogQuery(`
            SELECT properties.$browser, count(), uniq(distinct_id)
            FROM events WHERE event = '$pageview'
              AND timestamp >= '${startISO}' AND timestamp <= '${endISO}'
              AND properties.$browser IS NOT NULL
            GROUP BY 1 ORDER BY 2 DESC LIMIT 10
          `),
          hogQuery(`
            SELECT properties.$os, count(), uniq(distinct_id)
            FROM events WHERE event = '$pageview'
              AND timestamp >= '${startISO}' AND timestamp <= '${endISO}'
              AND properties.$os IS NOT NULL
            GROUP BY 1 ORDER BY 2 DESC LIMIT 10
          `),
          hogQuery(`
            SELECT properties.$device_type, count(), uniq(distinct_id)
            FROM events WHERE event = '$pageview'
              AND timestamp >= '${startISO}' AND timestamp <= '${endISO}'
              AND properties.$device_type IS NOT NULL
            GROUP BY 1 ORDER BY 2 DESC LIMIT 10
          `),
        ]);

        const s = summary[0] ?? [];
        data = {
          summary: {
            views:    Number(s[0]) || 0,
            visitors: Number(s[1]) || 0,
            visits:   Number(s[2]) || 0,
          },
          topPages: paths.map(r   => ({ name: r[0], views: Number(r[1]), visitors: Number(r[2]) })),
          regions:  regions.map(r => ({ name: r[0], country: r[1], views: Number(r[2]), visitors: Number(r[3]) })),
          browsers: browsers.map(r=> ({ name: r[0], views: Number(r[1]), visitors: Number(r[2]) })),
          os:       oses.map(r    => ({ name: r[0], views: Number(r[1]), visitors: Number(r[2]) })),
          devices:  devices.map(r => ({ name: r[0], views: Number(r[1]), visitors: Number(r[2]) })),
          period,
          fetchedAt: new Date().toISOString(),
        };
        break;
      }

      default:
        return res.status(400).json({
          error: `Unknown view: ${view}`,
          validViews: ["summary","path","region","country","browser","os","device","referrer","all","live"],
        });
    }

    cache.set(cacheKey, { data, timestamp: Date.now() });
    res.setHeader("X-Cache", "MISS");
    res.setHeader("Cache-Control", "public, max-age=60");
    return res.status(200).json(data);

  } catch (err) {
    console.error("PostHog API Error:", err.message);
    return res.status(500).json({ error: "Failed to fetch analytics", message: err.message });
  }
}
