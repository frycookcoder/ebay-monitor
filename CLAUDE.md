# eBay Monitor - Project Guide for Claude

## Overview
This is an eBay listing monitor that scrapes eBay search results and sends Discord notifications when new listings appear. It runs on Railway and auto-deploys from GitHub.

## Repository
- **GitHub:** https://github.com/frycookcoder/ebay-monitor.git
- **Hosting:** Railway (auto-deploys on push to main)

## Project Structure
```
ebay monitor/
├── index.js          # Main application - ALL monitor logic is here
├── package.json      # Dependencies (puppeteer, puppeteer-extra-plugin-stealth)
├── .env.example      # Template for environment variables
├── .env              # Local env vars (not in git)
├── Dockerfile        # Railway deployment config
└── seen_listings_*.json  # Tracks seen listings per search (auto-generated)
```

## How Monitors Work
All search monitors are defined in the `SEARCH_CONFIGS` array in `index.js` (starts around line 43).

Each monitor has:
- `name` - Display name for logs/notifications
- `searchQuery` - The eBay search query
- `webhookUrl` - Discord webhook (from env var)
- `dataFile` - JSON file to track seen listings

## Adding New Monitors

### Step 1: Add to SEARCH_CONFIGS in index.js
```javascript
{
  name: 'Your Monitor Name',
  searchQuery: 'your search terms here',
  webhookUrl: process.env.DISCORD_WEBHOOK_YOURNAME,
  dataFile: path.join(__dirname, 'seen_listings_your_name.json')
}
```

### Step 2: Add webhook to .env.example
```
DISCORD_WEBHOOK_YOURNAME=https://discord.com/api/webhooks/...
```

### Step 3: Deploy
```bash
git add index.js .env.example
git commit -m "Add [description] monitors"
git push origin main
```

### Step 4: Add env var in Railway
Add `DISCORD_WEBHOOK_YOURNAME` in Railway dashboard under Variables.

## Current Monitors (18 total)

### Spongebob Cards (4)
- Sketch, Superfractor, 1/1, /5
- Webhooks: `DISCORD_WEBHOOK_SKETCH`, `_SUPERFRACTOR`, `_1OF1`, `_5`

### Dragon Ball Super (1)
- God Rare cards
- Webhook: `DISCORD_WEBHOOK_DBS_GDR`

### Webkinz (13)
- Various plush items (Tuxedo Cat, English Cream Retriever, etc.)
- Webhook: `DISCORD_WEBHOOK_WEBKINZ` (shared)

### Lorcana Cards (5) - Added 2026-02-01
- Iconic Mickey
- Iconic Minnie
- Hunny Wizard Enchanted
- Elsa Enchanted PSA 10
- Golden Mickey Serial
- Webhook: `DISCORD_WEBHOOK_LORCANA` (shared)

## Configuration (via env vars)
- `CHECK_INTERVAL` - Minutes between checks (default: 10)
- `BROWSER_RESTART_HOURS` - Restart browser every N hours (default: 2)
- `MAX_RETRIES` - Retry attempts on failure (default: 3)
- `HEALTH_CHECK_HOURS` - Health notification interval (default: 6)
- `HARD_RESTART_THRESHOLD` - Force full restart after N consecutive failures (default: 10)

## Anti-Detection Features
The monitor uses `puppeteer-extra-plugin-stealth` plus additional measures to avoid eBay blocking:

- **User Agent Rotation** - Randomly selects from 6 different browser user agents each session
- **Randomized Viewport** - Slight random variations in window size to avoid fingerprinting
- **Navigator Overrides** - Spoofs webdriver, plugins, languages, platform, hardware concurrency
- **Human-like Behavior:**
  - Random delays between page loads (1-3 seconds)
  - Random delays between searches (3-8 seconds)
  - Simulated mouse movements
  - Human-like scrolling with random scroll distances and timing
- **Stealth Headers** - Sets sec-ch-ua, Sec-Fetch-* headers to match real Chrome

## Crash Recovery & Stability
The monitor has multiple layers of recovery to stay running 24/7:

1. **Automatic Browser Restart** - Restarts Chromium every 2 hours to prevent memory leaks
2. **Retry with Exponential Backoff** - Failed scrapes retry 3 times (10s, 20s, 40s delays)
3. **Page Recovery** - Detects closed pages and recreates them
4. **Safe Browser Close** - Timeout-protected browser.close() with force kill fallback
5. **Hard Restart** - After 10 consecutive failures, exits process (Railway auto-restarts)
6. **Chrome Force Kill** - Uses `pkill` to clean up zombie Chrome processes
7. **Error Notifications** - Sends Discord alerts when errors occur

Key functions for crash handling:
- `safeBrowserClose()` - Graceful close with timeout
- `forceKillChrome()` - Nuclear option to kill all Chrome processes
- `hardRestart()` - Exits process for Railway to restart fresh

## Tips for Claude
- The main file is `index.js` - read it first
- Similar monitors share webhooks (e.g., all Webkinz use one webhook)
- Use exact phrase matching with quotes in searchQuery for specific items
- Always update `.env.example` when adding new webhook variables
- Commit and push to deploy - Railway handles the rest
