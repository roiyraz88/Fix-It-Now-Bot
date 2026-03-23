This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## FixItNow – מעקב לקוח (חד־פעמי, 30 דק׳)

לאחר שהלקוח אישר חיפוש בעלי מקצוע, נשלחת התראה לבעלי מקצוע. **פעם אחת בלבד** – כ־30 דקות אחרי **ההתראה הראשונה** לבעלי המקצוע – ה־cron שולח ללקוח שאלה עם כפתורי כן/לא (לא חוזר).

- הוסף ב־Vercel (או `.env`) את **`CRON_SECRET`** (מחרוזת אקראית).
- **תזמון:** ב־Vercel **Hobby** אין cron תכוף (רק יומי) – השתמש ב־cron חיצוני (למשל [cron-job.org](https://cron-job.org)): `GET https://<your-domain>/api/cron/client-followup` כל 5 דקות, עם header `Authorization: Bearer <CRON_SECRET>`.
- ב־Vercel **Pro** אפשר להגדיר Cron Jobs מהדשבורד או ב־`vercel.json` – ראה [תיעוד Vercel](https://vercel.com/docs/cron-jobs).

אם `CRON_SECRET` לא מוגדר, הקריאה ל־cron תחזיר 503.
