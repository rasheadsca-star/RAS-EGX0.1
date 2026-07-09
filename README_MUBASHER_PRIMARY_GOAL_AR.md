# /GOAL — دمج مباشر كمصدر أساسي للسعر والسيولة والدعم والمقاومة

هذا الباتش يعالج ملاحظة أن السعر والسيولة والدعم والمقاومة غير متاحة أو غير داخلة في القرار النهائي.

## ما يضيفه الباتش

1. سكربت جديد:

```text
scripts/collect-mubasher-primary-feeds.js
```

يقوم بالآتي:

- يفحص صفحات أدوات مباشر العامة:
  - مراقب حجم التداول
  - مراقب السيولة
  - الدعم والمقاومة
- إذا أعادت الصفحات قوالب Angular مثل `{{row.name}}` بدل البيانات، ينتقل تلقائيًا إلى صفحات كل سهم على مباشر English:
  - `/markets/EGX/stocks/SYMBOL/`
  - `/markets/EGX/stocks/SYMBOL/support-resistance`
- يستخرج:
  - آخر سعر
  - التغير ونسبة التغير
  - الفتح / السابق / أعلى / أدنى
  - الحجم
  - قيمة التداول Turnover
  - الدعم الأول والثاني
  - المقاومة الأولى والثانية
  - Pivot Point
- يدمج هذه الحقول داخل `data/market.json` قبل بناء التوصيات.

## الملفات التي تتولد بعد التشغيل

```text
data/mubasher-stock-pages-primary.json
data/mubasher-primary-fields-report.json
data/mubasher-volume-monitor.json
data/mubasher-liquidity-monitor.json
data/mubasher-support-resistance.json
data/hardening-report.json
data/today-decision-center.json
data/excluded-opportunities.json
VERSION.json
```

## القاعدة الجديدة

لا يظهر سهم كقرار شراء تنفيذي إلا إذا توفرت من مباشر:

- سعر صالح.
- حجم أو قيمة تداول / Turnover.
- دعم ومقاومة.
- لا يوجد تعارض سعر.
- لا توجد مخاطر دقة سعر.
- يوجد تاريخ كافٍ للتحليل.

إذا نقص أي عنصر، يتحول السهم إلى:

```text
مراقبة فقط
```

أو يظهر في:

```text
أسهم مستبعدة ولماذا
```

## التشغيل اليدوي

```bash
npm run goal
```

## التشغيل داخل GitHub Actions

بعد رفع الملفات، شغل:

```text
Actions → Update EGX Market Data → Run workflow
```

## ملاحظات مهمة

- لا يوجد `npm ci` في الـ workflow حتى لا يتكرر خطأ عدم توافق `package-lock.json`.
- السكربتات تعتمد على Node.js built-in APIs فقط.
- بيانات مباشر نفسها متأخرة أثناء الجلسة، لذلك لا يزال القرار بحاجة لمراجعة بشرية.
