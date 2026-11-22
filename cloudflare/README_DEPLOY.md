# Tuitio — Cloudflare Free-Tier Deployment Guide

## Verified Free-Tier Limits (Zero Compulsory Cost)
- **Cloudflare Workers**: 100,000 requests/day, 10 ms CPU/request, 128 MB RAM, free `*.workers.dev` subdomain.
- **Cloudflare Workers Static Assets**: Up to 20,000 static files (25 MiB max/file) served free from the edge.
- **Cloudflare D1 (SQLite)**: 5M rows read/day, 100,000 rows written/day, 5 GB total storage (500 MB per DB), 7-day Time Travel recovery.
- **Cloudflare Cron Triggers**: Up to 3 triggers per Worker (2 used: 5:30 PM IST & 8:00 PM IST).

## Step-by-Step Deployment
1. Install Wrangler: `npm install -g wrangler` and authenticate: `wrangler login`.
2. Create D1 database: `wrangler d1 create tuitio-db` and paste the returned `database_id` into `cloudflare/wrangler.toml`.
3. Apply migrations: `wrangler d1 execute tuitio-db --remote --file=./cloudflare/migrations/0001_initial.sql`.
4. Set session secret: `wrangler secret put SESSION_SECRET` (enter a 32+ char random string).
5. Build the React + PWA frontend: `npm run build`.
6. Deploy Worker + Static Assets: `wrangler deploy --config cloudflare/wrangler.toml`.
7. Open your `https://tuitio-smart-tuition.<subdomain>.workers.dev` URL and complete the First-Run Teacher Setup Wizard.

## Backup & Restore
- **Export from UI**: Go to Settings → Data & Backup → Download Full JSON Backup.
- **D1 Time Travel**: `wrangler d1 time-travel restore tuitio-db --timestamp=<ISO_TIMESTAMP>` (free 7-day window).
- **Avoid accidental paid usage**: Keep your Cloudflare Workers plan on "Free" (D1 hard-caps at free limits instead of billing automatically).
