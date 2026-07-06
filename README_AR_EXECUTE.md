# V8.10.4 PWA Cache Rescue + Runtime Globals

يرفع ملفين فقط:
- index.html
- service-worker.js

الهدف:
- كسر كاش PWA القديم الذي قد يعرض index.html قديمًا.
- تعريف `$class` و `$text` كمتغيرات global حقيقية قبل تشغيل التطبيق.
- جعل Service Worker يستخدم network-first للصفحة وملفات data.

بعد الرفع:
1. Commit: Install V8.10.4 PWA cache rescue
2. افتح: https://rasheadsca-star.github.io/RAS-EGX0.1/?v=8104
3. اعمل Ctrl + Shift + R
4. لو بقي الخطأ: Settings/DevTools → Application → Storage → Clear site data → Service Workers → Unregister
