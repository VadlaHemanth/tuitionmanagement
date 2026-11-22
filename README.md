# Tuitio — Smart Tuition Management

> One teacher. Every student. Every fee. Every homework. Every examination. Every minute. Beautifully organized in one intelligent workspace.

Tuitio is a production-ready, zero-compulsory-cost Progressive Web App (PWA) designed for an individual tuition teacher in India managing Class 3–10 students (SSC, CBSE, ICSE) during a configurable daily tuition session (default: 6:00 PM – 8:00 PM IST).

---

## Architecture & Verified Free-Tier Stack

- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS v4 + Motion
- **Dual Themes**: Light Blue Liquid Glass (light) & Pure Luxury Monochrome Black & White (dark)
- **Local Dev Runtime**: Express + Node built-in SQLite (`node:sqlite`)
- **Cloudflare Edge Deployment**: Cloudflare Workers + Static Assets + Cloudflare D1 (SQLite) + Cron Triggers
- **PWA**: Installable on Android, iOS, Windows, and macOS with offline mutation queue

---

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Run engine unit tests
npm run test

# 3. Start local development server (http://localhost:3000)
npm run dev
```

---

## Deploying to Cloudflare Workers from Git

Tuitio is configured to deploy directly from a connected private GitHub repository using Cloudflare's verified free tier.

### Step 1: Create a Cloudflare D1 Database

You can create your D1 database via Cloudflare Dashboard or Wrangler CLI:

```bash
# Using Wrangler CLI:
npx wrangler d1 create tuitio-db
```

Copy the returned `database_id` and paste it into `wrangler.toml`:
```toml
[[d1_databases]]
binding = "DB"
database_name = "tuitio-db"
database_id = "YOUR_ACTUAL_D1_DATABASE_ID"
```

Apply the initial database migration:
```bash
npx wrangler d1 execute tuitio-db --remote --file=./cloudflare/migrations/0001_initial.sql
```

---

### Step 2: Connect Git to Cloudflare (Two Options)

#### Option A: Cloudflare Workers Builds (Recommended & Zero Configuration)
1. Go to the [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Compute (Workers & Pages)**.
2. Click **Create** → **Import from Git** (or connect your GitHub account).
3. Select your private **Tuitio** repository.
4. Cloudflare automatically detects the root `wrangler.toml`:
   - **Build command**: `npm run build`
   - **Deploy command**: `wrangler deploy`
   - **Output directory**: `dist`
5. Under **Settings → Bindings**, ensure the D1 Database binding `DB` is linked to `tuitio-db`.
6. Click **Save and Deploy**. Every push to `main` will automatically build and deploy!

#### Option B: GitHub Actions CI/CD
Tuitio includes a ready `.github/workflows/deploy.yml` workflow.
1. In your GitHub repository, go to **Settings → Secrets and variables → Actions**.
2. Add the following repository secrets:
   - `CLOUDFLARE_API_TOKEN`: Your Cloudflare API token with Workers and D1 edit permissions.
   - `CLOUDFLARE_ACCOUNT_ID`: Your Cloudflare Account ID (found in the Cloudflare Dashboard URL or Workers overview).
3. On every push to `main`, GitHub Actions will run tests, build the frontend, and deploy your Worker to Cloudflare.

---

## Configuration & Secrets

In Cloudflare Dashboard (or via `npx wrangler secret put`):
- `SESSION_SECRET`: A random 32+ character string for signing session tokens.
- `TEACHER_ADMIN_PASSCODE` (optional): An administrative fallback passcode for claiming or logging into the single-teacher workspace.
