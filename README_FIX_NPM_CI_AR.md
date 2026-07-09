# إصلاح فشل GitHub Actions بسبب npm ci

## سبب الفشل

الـ Action فشل في خطوة `Install optional local tooling` بسبب الأمر:

```bash
npm ci
```

هذا الأمر لا يعمل إلا إذا كان `package.json` و `package-lock.json` متطابقين تمامًا. بعد إضافة `serve` وبعض scripts الجديدة، أصبح `package-lock.json` غير متزامن، فظهر الخطأ:

```text
npm ci can only install packages when your package.json and package-lock.json are in sync
Missing: serve@14.2.6 from lock file
```

## الإصلاح داخل هذا الباتش

تم تعديل `.github/workflows/update-market-data.yml` بحيث لا يستخدم `npm ci` نهائيًا في GitHub Actions، لأن سكربتات جمع البيانات وقرار /GOAL لا تحتاج تثبيت مكتبات خارجية؛ هي تعمل بقدرات Node.js المدمجة.

الخطوة القديمة:

```yaml
- name: Install optional local tooling
  run: |
    if [ -f package-lock.json ]; then
      npm ci
    elif [ -f package.json ]; then
      npm install --no-audit --no-fund
    fi
```

تم استبدالها بـ:

```yaml
- name: Validate Node.js runtime
  run: |
    node --version
    npm --version
    echo "No npm install is required in CI; all data/decision scripts use built-in Node.js APIs."
    echo "This avoids npm ci failing when package-lock.json is stale."
```

## ماذا تفعل الآن؟

ارفع محتويات الباتش إلى الريبو، ووافق على استبدال الملفات، ثم شغّل الـ Action مرة أخرى.

علامة النجاح: الخطوة التي فشلت سابقًا لن تظهر كـ `npm ci`، وستكمل إلى جمع البيانات ثم `/GOAL integrated quality and decision gate`.
