# EGX Live Connector Ready System

هذه نسخة عملية لربط التطبيق بمصدر أسعار حقيقي.

## المهم جدًا

- GitHub Pages لا يكفي للأسعار اللحظية لأنه Static فقط.
- الربط اللحظي يحتاج Backend مثل هذا المشروع.
- لا تستخدم مفاتيح API داخل GitHub Pages.
- الربط مع مباشر يكون فقط عبر API رسمي/متعاقد عليه أو مصدر مرخص.
- لا يوجد Scraping مفعل داخل هذا المشروع لتجنب كسر الشروط أو الاعتماد على صفحات غير مستقرة.

## أوضاع التشغيل

### 1) file_csv
يقرأ الملف:

data/live-prices.csv

هذا هو الوضع الافتراضي. مناسب كبداية أو لو عندك Export من مصدر أسعار.

### 2) http_json
يقرأ أي API مرخص يرجع JSON.

ضع في `.env`:

SOURCE_MODE=http_json
EGX_API_URL=https://...
EGX_API_KEY=...

### 3) mubasher_official
لو عندك API رسمي من مباشر أو وسيطك.

ضع في `.env`:

SOURCE_MODE=mubasher_official
MUBASHER_API_URL=https://...
MUBASHER_API_TOKEN=...

### 4) egx_public_manual
Placeholder آمن. لا يجمع بيانات من الموقع مباشرة.

## التشغيل المحلي

1. ثبت Node.js 20.
2. افتح CMD داخل الفولدر.
3. شغل:

npm install
npm start

افتح:

http://localhost:3000

## تشغيل سريع على ويندوز

افتح:

scripts/START_LOCAL.bat

## شكل CSV

symbol,name,sector,price,previousClose,high,low,volume,avg20Volume,support,resistance,date
COMI,Commercial International Bank,Banks,132.52,132.10,133.00,131.95,2284054,1600000,128.00,136.50,2026-07-01

## تطوير لاحق

بعد الحصول على API رسمي:
- نضبط mapping الحقول حسب شكل استجابة API.
- نضيف watchlist.
- نضيف historical candles.
- نضيف backtest server-side.
- نضيف alerts.
