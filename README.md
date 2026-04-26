# Umami API Wrapper

API بسيط تحط فيه credentials بتاع Umami وتستخدمه في موقعك الأساسي.

---

## خطوات الـ Deploy على Vercel

### 1. رفع الكود على GitHub
```bash
git init
git add .
git commit -m "first commit"
git remote add origin https://github.com/USERNAME/umami-api.git
git push -u origin main
```

### 2. ربطه بـ Vercel
- روح على [vercel.com](https://vercel.com) وسجل دخول
- اضغط "New Project" → اختار الـ repo
- اضغط Deploy

### 3. حط الـ Environment Variables
في Vercel Dashboard → Settings → Environment Variables، حط:

| Variable | Value |
|----------|-------|
| `UMAMI_API_KEY` | API Key بتاعك من Umami Cloud |
| `UMAMI_WEBSITE_ID` | Website ID بتاعك |
| `CLIENT_API_KEY` | (اختياري) مفتاح سري لتأمين الـ API |
| `ALLOWED_ORIGIN` | domain موقعك الأساسي |

#### فين تلاقي الـ API Key؟
cloud.umami.is → Settings → API Keys → Create API Key

#### فين تلاقي الـ Website ID؟
cloud.umami.is → Settings → Websites → اضغط على موقعك → هتلاقي الـ ID في الـ URL أو في إعدادات الموقع

---

## استخدام الـ API

**Base URL:** `https://your-project.vercel.app/api/analytics`

### Parameters

| Parameter | القيم المتاحة | Default |
|-----------|--------------|---------|
| `period` | `0day`, `24hour`, `0week`, `7day`, `0month`, `30day`, `0year`, `6month` | `24hour` |
| `view` | `summary`, `country`, `region`, `os`, `path`, `browser`, `device`, `referrer`, `all` | `summary` |
| `websiteId` | (اختياري) لو مش حاطه في الـ env | - |

---

## أمثلة

### الإحصائيات الرئيسية (views, visits, visitors, duration)
```
GET /api/analytics?period=0day&view=summary
```
```json
{
  "views": 1250,
  "visits": 430,
  "visitors": 310,
  "visitDuration": 145,
  "bounceRate": 52,
  "period": "0day",
  "fetchedAt": "2024-01-15T10:30:00.000Z"
}
```

### أكتر الصفحات زيارة
```
GET /api/analytics?period=7day&view=path
```
```json
{
  "items": [
    { "x": "/home", "y": 520 },
    { "x": "/blog", "y": 310 },
    { "x": "/contact", "y": 89 }
  ],
  "view": "path",
  "period": "7day",
  "fetchedAt": "2024-01-15T10:30:00.000Z"
}
```

### البلاد
```
GET /api/analytics?period=0month&view=country
```

### كل الداتا مع بعض
```
GET /api/analytics?period=24hour&view=all
```

---

## استخدامه في موقعك الأساسي

### JavaScript عادي
```javascript
async function getAnalytics(period = '24hour', view = 'summary') {
  const res = await fetch(
    `https://your-project.vercel.app/api/analytics?period=${period}&view=${view}`,
    {
      headers: {
        'X-API-Key': 'your_secret_key' // لو حطيت CLIENT_API_KEY
      }
    }
  );
  return res.json();
}

// مثال الاستخدام
const stats = await getAnalytics('0day', 'summary');
console.log(`Views اليوم: ${stats.views}`);
```

### React
```jsx
import { useState, useEffect } from 'react';

function Analytics() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    fetch('https://your-project.vercel.app/api/analytics?period=0day&view=summary')
      .then(r => r.json())
      .then(setStats);
  }, []);

  if (!stats) return <p>Loading...</p>;

  return (
    <div>
      <p>Views: {stats.views}</p>
      <p>Visitors: {stats.visitors}</p>
      <p>Visits: {stats.visits}</p>
    </div>
  );
}
```

---

## الـ Cache

- الداتا بتتخزن في الـ memory لمدة **دقيقة واحدة**
- الـ header `X-Cache: HIT` معناه الداتا من الـ cache
- الـ header `X-Cache: MISS` معناه جابها من Umami دلوقتي
