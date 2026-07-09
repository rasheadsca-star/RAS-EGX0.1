# /GOAL Integrated Patch — RAS EGX Pro Hub

هذا الباتش ينفذ التحسينات في إجراء واحد متكامل بدل تعديلات متفرقة.

## الملفات التي يتم رفعها

```text
package.json
.github/workflows/update-market-data.yml
scripts/apply-quality-hardening.js
scripts/build-goal-integrated-decision.js
scripts/build-version-manifest.js
index.html
app.js
styles.css
README_GOAL_INTEGRATED_AR.md
```

## ماذا يضيف؟

1. شاشة **قرار اليوم** بفصل واضح بين:
   - مضاربة داخل الجلسة: شراء وبيع في نفس الجلسة.
   - فرصة جلسة قادمة: مراقبة للجلسة التالية وليست أمر شراء تلقائي.
   - مراقبة فقط.
   - مستبعد.

2. بوابة جودة صارمة تمنع التنفيذ إذا ظهر:
   - تعارض سعر.
   - مخاطر دقة السعر.
   - مصدر بيانات غير صالح.
   - تاريخ أقل من 20 جلسة.

3. تخفيض الثقة إذا كان التاريخ أقل من 50 جلسة.

4. ملف مستبعدين:

```text
data/excluded-opportunities.json
```

5. مركز قرار موحد:

```text
data/today-decision-center.json
```

6. سجل قياس دقة مبدئي:

```text
data/recommendation-backtest-ledger.json
```

7. ملف نسخة واضح:

```text
VERSION.json
```

## طريقة الرفع

ارفع محتويات هذا المجلد إلى جذر الريبو بنفس المسارات، ثم شغّل:

```text
Actions → Update EGX Market Data → Run workflow
```

## علامات النجاح

بعد نجاح الـ workflow، يجب أن تجد الملفات التالية داخل `data`:

```text
hardening-report.json
today-decision-center.json
excluded-opportunities.json
recommendation-backtest-ledger.json
```

وفي `VERSION.json` يجب أن تظهر:

```json
"build": "GOAL Integrated Decision Center"
```

## ملاحظة مهمة

هذا لا يحول التطبيق إلى مستشار مالي ولا إلى نظام تداول آلي. هو فقط يجعل القرار أكثر وضوحًا وأمانًا ويمنع ظهور توصيات تنفيذية عندما تكون البيانات غير كافية.
