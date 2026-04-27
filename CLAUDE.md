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
All search monitors are defined in the `SEARCH_CONFIGS` array in `index.js` (starts around line 55).

Each monitor has:
- `name` - Display name for logs/notifications
- `searchQuery` - The eBay search query
- `webhookUrl` - Discord webhook (from env var)
- `dataFile` - JSON file to track seen listings
- `requiredKeywords` - ALL keywords must match (array)
- `category` - eBay category ID (optional, e.g., 2536 for Trading Card Games)

## Current Monitors (24 total)

### Spongebob Cards (6)
- Sketch, Superfractor, 1/1, /5, /10 Black, License
- Webhooks: `DISCORD_WEBHOOK_SKETCH`, `_SUPERFRACTOR`, `_1OF1`, `_5`

### Dragon Ball Super (1)
- God Rare cards
- Webhook: `DISCORD_WEBHOOK_DBS_GDR`

### Webkinz (9)
- English Cream Retriever, Salt Pepper Dalmatian, Cinnamon Beagle, Corgi Dog
- Red Velvet Fox, Merry Go Round Pony, Love Giraffe, Lovely Leopard, Blue Bay Dolphin
- Webhook: `DISCORD_WEBHOOK_WEBKINZ` (shared)

### Lorcana Cards (6)
- Iconic Mickey, Iconic Minnie, Hunny Wizard Enchanted
- Elsa Enchanted PSA 10, Golden Mickey Serial, D23 Elsa Promo
- Webhook: `DISCORD_WEBHOOK_LORCANA` (shared)

### Riftbound (2)
- Prize Wall, GGEZ Teemo
- Webhook: `DISCORD_WEBHOOK_RIFTBOUND`

## Configuration (via env vars)
- `CHECK_INTERVAL` - Minutes between checks (default: 15)
- `BROWSER_RESTART_HOURS` - Restart browser every N hours (default: 2)
- `MAX_RETRIES` - Retry attempts on failure (default: 3)
- `HEALTH_CHECK_HOURS` - Health notification interval (default: 6)
- `HARD_RESTART_THRESHOLD` - Force full restart after N consecutive failures (default: 10)

## Proxy Support (Recommended)
To avoid eBay CAPTCHA detection, configure a residential proxy:

```env
# Single proxy
PROXY_URL=http://username:password@proxy.example.com:8080

# Or rotating proxy pool
PROXY_POOL=http://user:pass@proxy1.com:8080,http://user:pass@proxy2.com:8080
```

Recommended services: Smartproxy, Bright Data, IPRoyal (residential IPs)

## Anti-Detection Features
- **Stealth Plugin** - puppeteer-extra-plugin-stealth
- **User Agent Rotation** - 6 different browser user agents
- **Randomized Viewport** - Slight random variations in window size
- **Navigator Overrides** - Spoofs webdriver, plugins, languages, platform
- **Human-like Behavior:**
  - Random delays between page loads (1-3 seconds)
  - Random delays between searches (10-25 seconds)
  - Simulated mouse movements
  - Human-like scrolling with random scroll distances and timing
- **CAPTCHA Cooldown** - 5 minute pause when challenge detected
- **Proxy Support** - Optional residential proxy rotation

## Crash Recovery & Stability
- **Running Lock** - Prevents overlapping check cycles
- **CAPTCHA Detection** - Auto-pauses when eBay challenge detected
- **setTimeout Pattern** - Schedules next check only after current completes
- **Automatic Browser Restart** - Restarts Chromium every 2 hours
- **Retry with Exponential Backoff** - Failed scrapes retry 3 times (10s, 20s, 40s)
- **Hard Restart** - After 10 consecutive failures, exits for Railway to restart
- **Chrome Force Kill** - Uses `pkill` to clean up zombie Chrome processes

## Adding New Monitors

### Step 1: Add to SEARCH_CONFIGS in index.js
```javascript
{
  name: 'Your Monitor Name',
  searchQuery: 'your search terms here',
  webhookUrl: process.env.DISCORD_WEBHOOK_YOURNAME,
  dataFile: path.join(__dirname, 'seen_listings_your_name.json'),
  requiredKeywords: ['must', 'match', 'all']
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

## Tips for Claude
- The main file is `index.js` - read it first
- Similar monitors share webhooks (e.g., all Webkinz use one webhook)
- Use exact phrase matching with quotes in searchQuery for specific items
- Always update `.env.example` when adding new webhook variables
- Commit and push to deploy - Railway handles the rest
- If CAPTCHA issues persist, recommend user adds a residential proxy
