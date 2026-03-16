# SKALO Intel Platform

AI market intelligence dashboard that aggregates news, tools, tips, and an interactive AI coach — all in one place.

**Live:** [intel.skalo-ai.com](https://intel.skalo-ai.com)

---

## Features

- **AI News** — Auto-fetched every 6 hours from Hacker News and Product Hunt
- **Tools Research** — Curated AI tools directory
- **Blogs & YouTube** — Handpicked content resources
- **Tips & Tricks** — AI-generated tips from Anthropic documentation, refreshed weekly
- **AI Coach** — Claude-powered chat assistant trained on 56 Anthropic documentation pages
- **GitHub Advice** — Daily intelligence reports on trending GitHub repos sourced from Instagram (@github.awesome). Scrapes video posts, transcribes audio via Whisper, extracts repo references, fetches GitHub metadata, and generates USE/EVALUATE/SKIP recommendations via Claude

---

## Tech Stack

- **Runtime:** Node.js 22
- **Framework:** Express + EJS templating
- **AI:** Anthropic Claude API (`claude-sonnet-4-5`)
- **Process manager:** PM2
- **Reverse proxy:** Nginx + Let's Encrypt (HTTPS)

---

## Project Structure

```
skalo-intel-platform/
├── agents/
│   ├── news_fetcher.js           # Pulls AI news from HN + Product Hunt
│   ├── tips_generator.js         # Generates tips via Claude API
│   └── github_intel_fetcher.js   # Scrapes Instagram, transcribes, analyses GitHub repos
├── data/
│   ├── news.json                 # Cached news articles
│   ├── tips.json                 # Tips data
│   ├── tools.json                # Tools directory
│   ├── blogs.json                # Blog/YouTube resources
│   ├── github-intel.json         # GitHub Advice reports (displayed on /github)
│   └── github-intel-raw.json     # Raw Instagram scrape + transcript data
├── knowledge/
│   └── anthropic-knowledge.json  # Knowledge base for AI Coach
├── public/
│   ├── css/style.css
│   └── js/
├── routes/                       # Express route handlers
├── views/                        # EJS templates
├── server.js                     # App entry point
└── ecosystem.config.js           # PM2 config
```

---

## Local Setup

**Prerequisites:** Node.js 22+

```bash
git clone https://github.com/generativeaiengineer/skalo-intel-platform.git
cd skalo-intel-platform
npm install
cp .env.example .env
```

Fill in `.env`:

```env
PORT=3000

# Core
ANTHROPIC_API_KEY=your_key        # Required for AI Coach, Tips, GitHub reports
YOUTUBE_API_KEY=your_key          # Required for YouTube content
PH_CLIENT_ID=your_producthunt_client_id
PH_CLIENT_SECRET=your_producthunt_client_secret

# GitHub Advice feature
APIFY_API_TOKEN=your_key          # Required: scrapes @github.awesome on Instagram
OPENAI_API_KEY=your_key           # Required: transcribes video audio via Whisper
GITHUB_TOKEN=your_personal_token  # Optional: raises GitHub API limit from 60 to 5000 req/hr
```

```bash
npm run dev
```

App runs at `http://localhost:3000`

---

## Available Scripts

| Command | Description |
|---|---|
| `npm start` | Start production server |
| `npm run dev` | Start with auto-reload |
| `npm run fetch-news` | Manually fetch latest AI news |
| `npm run generate-tips` | Generate new tips via Claude |
| `npm run fetch-github` | Run GitHub intel pipeline (scrape → transcribe → analyse) |
| `npm run cron-setup` | Show cron job setup instructions |

---

## Automated Jobs

Set up cron jobs to keep content fresh:

```bash
# Fetch AI news every 6 hours
0 */6 * * * cd /root/skalo-intel-platform/web && /usr/bin/node agents/news_fetcher.js >> /root/skalo-intel-platform/logs/cron.log 2>&1

# Generate tips every Monday at 9 AM
0 9 * * 1 cd /root/skalo-intel-platform/web && /usr/bin/node agents/tips_generator.js >> /root/skalo-intel-platform/logs/cron.log 2>&1

# Fetch GitHub intel daily at 6 AM
0 6 * * * cd /root/skalo-intel-platform/web && npm run fetch-github >> /root/skalo-intel-platform/logs/github-intel.log 2>&1
```

Run `npm run cron-setup` for the full instructions with copy-pasteable output.

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/news` | Fetch cached news JSON |
| POST | `/api/refresh-news` | Trigger news fetch on demand |
| POST | `/api/tools/add` | Add a new tool |
| POST | `/api/tips/add` | Add a new tip |
| GET | `/api/github-intel` | Fetch GitHub Advice reports JSON |
| POST | `/api/refresh-github` | Trigger GitHub intel pipeline on demand |
