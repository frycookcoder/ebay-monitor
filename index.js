require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Use stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

// Global Configuration
const CONFIG = {
  checkIntervalMinutes: parseInt(process.env.CHECK_INTERVAL) || 15, // Increased from 10 to reduce rate limiting
  browserRestartHours: parseFloat(process.env.BROWSER_RESTART_HOURS) || 2,
  maxRetries: parseInt(process.env.MAX_RETRIES) || 3,
  healthCheckHours: parseFloat(process.env.HEALTH_CHECK_HOURS) || 6,
  hardRestartThreshold: parseInt(process.env.HARD_RESTART_THRESHOLD) || 10,
  browserCloseTimeout: 5000,
  challengeCooldownMs: 5 * 60 * 1000, // 5 minute cooldown after CAPTCHA detection
};

// Rotating user agents to avoid detection
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
];

// Get random user agent
function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// Random delay between min and max milliseconds
function randomDelay(min, max) {
  return new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min));
}

// Multi-search configuration - CONSOLIDATED for efficiency (10 searches instead of 24)
// Each search has its own query, Discord webhook, and data file
// requiredKeywords: ALL must match | requiredKeywordsAny: at least ONE must match
const SEARCH_CONFIGS = [
  // === SPONGEBOB TOPPS (consolidated from 6 to 2) ===
  {
    name: 'Spongebob Topps Hits',
    searchQuery: 'Spongebob Topps',
    webhookUrl: process.env.DISCORD_WEBHOOK_SPONGEBOB || process.env.DISCORD_WEBHOOK_SKETCH,
    dataFile: path.join(__dirname, 'seen_listings_spongebob_topps.json'),
    requiredKeywords: ['spongebob', 'topps'],
    // Catches: sketch, superfractor, 1/1, /5, /10, license, auto, plate
    requiredKeywordsAny: ['sketch', 'superfractor', '1/1', '/5', '/10', 'license', 'auto', 'printing plate', 'one of one']
  },
  {
    name: 'Spongebob Topps Numbered',
    searchQuery: 'Spongebob Topps numbered',
    webhookUrl: process.env.DISCORD_WEBHOOK_SPONGEBOB || process.env.DISCORD_WEBHOOK_5,
    dataFile: path.join(__dirname, 'seen_listings_spongebob_numbered.json'),
    requiredKeywords: ['spongebob']
  },

  // === DRAGON BALL SUPER (keep as-is) ===
  {
    name: 'DBS God Rare',
    searchQuery: 'dragon ball super card "God Rare"',
    webhookUrl: process.env.DISCORD_WEBHOOK_DBS_GDR,
    dataFile: path.join(__dirname, 'seen_listings_dbs_gdr.json'),
    requiredKeywords: ['god rare']
  },

  // === WEBKINZ (consolidated from 9 to 2) ===
  {
    name: 'Webkinz Rare Plush',
    searchQuery: 'webkinz plush rare',
    webhookUrl: process.env.DISCORD_WEBHOOK_WEBKINZ,
    dataFile: path.join(__dirname, 'seen_listings_webkinz_rare.json'),
    requiredKeywords: ['webkinz'],
    // Filter for specific rare items
    requiredKeywordsAny: [
      'english cream retriever', 'salt pepper dalmatian', 'cinnamon beagle',
      'corgi', 'red velvet fox', 'merry go round pony',
      'love giraffe', 'lovely leopard', 'blue bay dolphin'
    ]
  },
  {
    name: 'Webkinz Retired',
    searchQuery: 'webkinz retired plush',
    webhookUrl: process.env.DISCORD_WEBHOOK_WEBKINZ,
    dataFile: path.join(__dirname, 'seen_listings_webkinz_retired.json'),
    requiredKeywords: ['webkinz'],
    requiredKeywordsAny: [
      'english cream', 'dalmatian', 'beagle', 'corgi', 'velvet fox',
      'merry go round', 'giraffe', 'leopard', 'dolphin'
    ]
  },

  // === LORCANA (consolidated from 6 to 3) ===
  {
    name: 'Lorcana Iconic',
    searchQuery: 'Lorcana Iconic',
    webhookUrl: process.env.DISCORD_WEBHOOK_LORCANA,
    dataFile: path.join(__dirname, 'seen_listings_lorcana_iconic.json'),
    category: 2536,
    requiredKeywords: ['lorcana', 'iconic']
    // Catches both Mickey and Minnie Iconic cards
  },
  {
    name: 'Lorcana Enchanted Rare',
    searchQuery: 'Lorcana Enchanted',
    webhookUrl: process.env.DISCORD_WEBHOOK_LORCANA,
    dataFile: path.join(__dirname, 'seen_listings_lorcana_enchanted.json'),
    category: 2536,
    requiredKeywords: ['lorcana', 'enchanted'],
    requiredKeywordsAny: ['hunny', 'wizard', 'elsa', 'psa']
  },
  {
    name: 'Lorcana Promo Serial',
    searchQuery: 'Lorcana promo',
    webhookUrl: process.env.DISCORD_WEBHOOK_LORCANA,
    dataFile: path.join(__dirname, 'seen_listings_lorcana_promo.json'),
    category: 2536,
    requiredKeywords: ['lorcana'],
    requiredKeywordsAny: ['golden mickey', 'd23', 'serial', 'elsa promo']
  },

  // === RIFTBOUND (consolidated from 2 to 1) ===
  {
    name: 'Riftbound Rare',
    searchQuery: 'Riftbound',
    webhookUrl: process.env.DISCORD_WEBHOOK_RIFTBOUND,
    dataFile: path.join(__dirname, 'seen_listings_riftbound.json'),
    requiredKeywords: ['riftbound'],
    requiredKeywordsAny: ['prize wall', 'ggez', 'teemo', 'promo', 'worlds']
  }
];

// State
let browser = null;
let page = null;
let browserStartTime = null;
let lastSuccessfulCheck = null;
let totalChecks = 0;
let totalNewListings = 0;
let consecutiveFailures = 0;
let isCheckRunning = false; // Prevents overlapping check cycles
let challengeDetectedAt = null; // Tracks when eBay CAPTCHA was last seen

// Proxy rotation support
const PROXY_POOL = (process.env.PROXY_POOL || '').split(',').filter(p => p.trim());
let currentProxyIndex = 0;

function getNextProxy() {
  // Single proxy takes precedence
  if (process.env.PROXY_URL) return process.env.PROXY_URL;
  // Otherwise rotate through pool
  if (PROXY_POOL.length === 0) return null;
  const proxy = PROXY_POOL[currentProxyIndex];
  currentProxyIndex = (currentProxyIndex + 1) % PROXY_POOL.length;
  return proxy.trim();
}

// State per search
const searchStates = new Map();

// Build eBay search URL (sorted by newly listed)
// category 2536 = Trading Card Games
function buildEbayUrl(query, category = null) {
  const encodedQuery = encodeURIComponent(query);
  let url = `https://www.ebay.com/sch/i.html?_nkw=${encodedQuery}&_sop=10`;
  if (category) {
    url += `&_sacat=${category}`;
  }
  return url;
}

// Check if listing passes required keywords filter (ALL must match)
// Returns true if listing should be included, false if filtered out
function passesKeywordFilter(listing, requiredKeywords) {
  if (!requiredKeywords || requiredKeywords.length === 0) {
    return true; // No filter configured
  }
  const titleLower = (listing.title || '').toLowerCase();
  for (const keyword of requiredKeywords) {
    if (!titleLower.includes(keyword.toLowerCase())) {
      return false; // Missing required keyword
    }
  }
  return true;
}

// Check if listing passes ANY keyword filter (at least ONE must match)
// Returns true if listing contains ANY of the keywords
function passesAnyKeywordFilter(listing, anyKeywords) {
  if (!anyKeywords || anyKeywords.length === 0) {
    return true; // No filter configured
  }
  const titleLower = (listing.title || '').toLowerCase();
  for (const keyword of anyKeywords) {
    if (titleLower.includes(keyword.toLowerCase())) {
      return true; // Found at least one match
    }
  }
  return false; // None of the keywords found
}

// Load seen listings from file
function loadSeenListings(dataFile) {
  try {
    if (fs.existsSync(dataFile)) {
      const data = fs.readFileSync(dataFile, 'utf8');
      return new Set(JSON.parse(data));
    }
  } catch (error) {
    console.error('[ERROR] Failed to load seen listings:', error.message);
  }
  return new Set();
}

// Save seen listings to file
function saveSeenListings(dataFile, seenSet) {
  try {
    fs.writeFileSync(dataFile, JSON.stringify([...seenSet]), 'utf8');
  } catch (error) {
    console.error('[ERROR] Failed to save seen listings:', error.message);
  }
}

// Format price for display
function formatPrice(priceText) {
  if (!priceText || priceText === 'N/A') return 'Price not listed';
  return priceText.replace(/\s+/g, ' ').trim();
}

// Send Discord notification for new listing
async function sendListingNotification(listing, searchConfig) {
  if (!searchConfig.webhookUrl) {
    console.log(`[WARN] No Discord webhook URL configured for ${searchConfig.name}`);
    return false;
  }

  const embed = {
    title: `🆕 ${listing.title?.substring(0, 250) || 'New eBay Listing'}`,
    url: listing.url,
    color: 0x00FF00, // Green for new listings
    fields: [
      {
        name: '💰 Price',
        value: formatPrice(listing.price),
        inline: true
      },
      {
        name: '🔗 Item ID',
        value: listing.id,
        inline: true
      }
    ],
    timestamp: new Date().toISOString(),
    footer: {
      text: `eBay Monitor • ${searchConfig.name}`
    }
  };

  // Add image if available (use 'image' instead of 'thumbnail' for larger display)
  if (listing.image && listing.image.startsWith('http')) {
    embed.image = { url: listing.image };
    console.log(`[DEBUG] Sending image: ${listing.image.substring(0, 80)}...`);
  } else {
    console.log(`[WARN] No valid image for listing ${listing.id}: ${listing.image || 'null'}`);
  }

  const payload = {
    username: 'eBay Listing Monitor',
    avatar_url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/EBay_logo.svg/300px-EBay_logo.svg.png',
    embeds: [embed]
  };

  try {
    const response = await fetch(searchConfig.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Discord API returned ${response.status}`);
    }

    return true;
  } catch (error) {
    console.error(`[ERROR] Failed to send Discord notification for ${searchConfig.name}:`, error.message);
    return false;
  }
}

// Send startup notification (to first configured webhook)
async function sendStartupNotification() {
  const firstWebhook = SEARCH_CONFIGS.find(c => c.webhookUrl)?.webhookUrl;
  if (!firstWebhook) return;

  const searchList = SEARCH_CONFIGS.map(c => `• ${c.name}: "${c.searchQuery}"`).join('\n');

  const embed = {
    title: '🚀 eBay Monitor Started',
    color: 0x0099FF, // Blue
    description: `Monitoring ${SEARCH_CONFIGS.length} searches`,
    fields: [
      {
        name: '🔍 Searches',
        value: searchList,
        inline: false
      },
      {
        name: '⏱️ Check Interval',
        value: `${CONFIG.checkIntervalMinutes} minutes`,
        inline: true
      },
      {
        name: '🔄 Browser Restart',
        value: `Every ${CONFIG.browserRestartHours} hours`,
        inline: true
      }
    ],
    timestamp: new Date().toISOString(),
    footer: {
      text: 'eBay Monitor • Railway'
    }
  };

  const payload = {
    username: 'eBay Listing Monitor',
    avatar_url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/EBay_logo.svg/300px-EBay_logo.svg.png',
    embeds: [embed]
  };

  try {
    await fetch(firstWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    console.log('[INFO] Startup notification sent to Discord');
  } catch (error) {
    console.error('[ERROR] Failed to send startup notification:', error.message);
  }
}

// Send health check notification
async function sendHealthCheckNotification() {
  const firstWebhook = SEARCH_CONFIGS.find(c => c.webhookUrl)?.webhookUrl;
  if (!firstWebhook) return;

  const uptimeHours = browserStartTime ? ((Date.now() - browserStartTime) / 1000 / 60 / 60).toFixed(1) : '0';
  const lastCheckAgo = lastSuccessfulCheck ? Math.round((Date.now() - lastSuccessfulCheck) / 1000 / 60) : 'N/A';

  const embed = {
    title: '💚 Monitor Health Check',
    color: 0x00FF00, // Green
    fields: [
      {
        name: '⏰ Uptime',
        value: `${uptimeHours} hours`,
        inline: true
      },
      {
        name: '📊 Total Checks',
        value: `${totalChecks}`,
        inline: true
      },
      {
        name: '🆕 New Listings Found',
        value: `${totalNewListings}`,
        inline: true
      },
      {
        name: '⏱️ Last Check',
        value: lastCheckAgo === 'N/A' ? 'N/A' : `${lastCheckAgo} min ago`,
        inline: true
      },
      {
        name: '🔍 Active Searches',
        value: `${SEARCH_CONFIGS.length}`,
        inline: true
      }
    ],
    timestamp: new Date().toISOString(),
    footer: {
      text: 'eBay Monitor • Health Check'
    }
  };

  const payload = {
    username: 'eBay Listing Monitor',
    avatar_url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/EBay_logo.svg/300px-EBay_logo.svg.png',
    embeds: [embed]
  };

  try {
    await fetch(firstWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    console.log('[INFO] Health check notification sent');
  } catch (error) {
    console.error('[ERROR] Failed to send health check:', error.message);
  }
}

// Send error notification
async function sendErrorNotification(errorMessage) {
  const firstWebhook = SEARCH_CONFIGS.find(c => c.webhookUrl)?.webhookUrl;
  if (!firstWebhook) return;

  const embed = {
    title: '⚠️ Monitor Error',
    description: errorMessage.substring(0, 500),
    color: 0xFF0000, // Red
    fields: [
      {
        name: '🔄 Status',
        value: 'Attempting recovery...',
        inline: true
      },
      {
        name: '❌ Consecutive Failures',
        value: `${consecutiveFailures}`,
        inline: true
      }
    ],
    timestamp: new Date().toISOString(),
    footer: {
      text: 'eBay Monitor • Error Alert'
    }
  };

  const payload = {
    username: 'eBay Listing Monitor',
    avatar_url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/EBay_logo.svg/300px-EBay_logo.svg.png',
    embeds: [embed]
  };

  try {
    await fetch(firstWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.error('[ERROR] Failed to send error notification:', error.message);
  }
}

// Force kill all Chrome/Chromium processes (nuclear option for resource cleanup)
function forceKillChrome() {
  console.log('[WARN] Force killing all Chrome processes...');
  try {
    // Linux/Docker environment
    execSync('pkill -9 -f chrome || true', { stdio: 'ignore' });
    execSync('pkill -9 -f chromium || true', { stdio: 'ignore' });
  } catch (e) {
    // Ignore errors - processes may not exist
  }
}

// Safe browser close with timeout
async function safeBrowserClose() {
  if (!browser) return;

  const browserPid = browser.process()?.pid;
  console.log(`[INFO] Closing browser (PID: ${browserPid || 'unknown'})...`);

  try {
    // Race between browser.close() and timeout
    await Promise.race([
      browser.close(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Browser close timeout')), CONFIG.browserCloseTimeout)
      )
    ]);
    console.log('[INFO] Browser closed gracefully');
  } catch (e) {
    console.log(`[WARN] Browser close failed: ${e.message}`);
    // Force kill the specific browser process if we have its PID
    if (browserPid) {
      try {
        process.kill(browserPid, 'SIGKILL');
        console.log(`[INFO] Force killed browser process ${browserPid}`);
      } catch (killError) {
        // Process may already be dead
      }
    }
  }

  browser = null;
  page = null;
}

// Hard restart - kill everything and exit (process manager should restart us)
async function hardRestart(reason) {
  console.error(`[FATAL] Hard restart triggered: ${reason}`);
  await sendErrorNotification(`Hard restart triggered after ${consecutiveFailures} consecutive failures: ${reason}`);

  // Force kill all Chrome processes
  forceKillChrome();

  // Give it a moment
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Exit - the process manager (Docker, PM2, systemd) should restart us
  process.exit(1);
}

// Launch browser with stealth settings
async function launchBrowser() {
  console.log('[INFO] Launching browser with stealth mode...');

  // Safe close existing browser
  await safeBrowserClose();

  // Small delay after closing to ensure resources are freed
  await new Promise(resolve => setTimeout(resolve, 1000));

  const userAgent = getRandomUserAgent();
  console.log(`[INFO] Using user agent: ${userAgent.substring(0, 50)}...`);

  // Build browser args
  const browserArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu',
    '--disable-blink-features=AutomationControlled',
    '--disable-web-security',
    '--disable-features=IsolateOrigins,site-per-process',
    // Crash reporter fixes - prevents EAGAIN errors
    '--disable-crash-reporter',
    '--disable-breakpad',
    '--disable-component-update',
    // Additional stealth
    '--disable-infobars',
    '--window-size=1920,1080',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    // Memory management
    '--single-process',
    '--memory-pressure-off',
    '--max_old_space_size=512'
  ];

  // Add proxy support if configured
  const proxy = getNextProxy();
  if (proxy) {
    // Extract proxy URL without credentials for the browser arg
    const proxyUrl = proxy.includes('@') ? proxy.split('@')[1] : proxy;
    browserArgs.push(`--proxy-server=${proxyUrl}`);
    console.log(`[INFO] Using proxy: ${proxyUrl.substring(0, 30)}...`);
  }

  browser = await puppeteer.launch({
    headless: 'new',
    protocolTimeout: 240000, // 4 minutes - prevents timeout errors on slow containers
    args: browserArgs
  });

  page = await browser.newPage();

  // Handle proxy authentication if credentials provided
  if (proxy && proxy.includes('@')) {
    try {
      const authMatch = proxy.match(/\/\/([^:]+):([^@]+)@/);
      if (authMatch) {
        await page.authenticate({
          username: authMatch[1],
          password: authMatch[2]
        });
        console.log('[INFO] Proxy authentication configured');
      }
    } catch (e) {
      console.log(`[WARN] Proxy auth setup failed: ${e.message}`);
    }
  }

  // Randomize viewport slightly to avoid fingerprinting
  const viewportWidth = 1920 + Math.floor(Math.random() * 100) - 50;
  const viewportHeight = 1080 + Math.floor(Math.random() * 60) - 30;
  await page.setViewport({ width: viewportWidth, height: viewportHeight });

  // Use rotated user agent
  await page.setUserAgent(userAgent);

  // Override navigator properties for better stealth
  await page.evaluateOnNewDocument(() => {
    // Override webdriver
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

    // Override plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5]
    });

    // Override languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en']
    });

    // Override platform
    Object.defineProperty(navigator, 'platform', {
      get: () => 'Win32'
    });

    // Override hardware concurrency
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: () => 8
    });

    // Override device memory
    Object.defineProperty(navigator, 'deviceMemory', {
      get: () => 8
    });

    // Spoof chrome object
    window.chrome = {
      runtime: {}
    };

    // Override permissions
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters);
  });

  // Set extra headers to look more like a real browser
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Cache-Control': 'max-age=0',
    'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1'
  });

  browserStartTime = Date.now();
  console.log('[INFO] Browser launched successfully');
}

// Check if browser needs restart
function shouldRestartBrowser() {
  if (!browserStartTime) return true;
  const hoursSinceStart = (Date.now() - browserStartTime) / 1000 / 60 / 60;
  return hoursSinceStart >= CONFIG.browserRestartHours;
}

// Scrape listings from eBay page with retry logic
async function scrapeListings(searchConfig, retryCount = 0) {
  const { searchQuery, category } = searchConfig;
  const url = buildEbayUrl(searchQuery, category);

  // Check for hard restart threshold BEFORE trying anything else
  if (consecutiveFailures >= CONFIG.hardRestartThreshold) {
    await hardRestart(`Consecutive failures reached ${consecutiveFailures}`);
  }

  // Check if we're in CAPTCHA cooldown - skip scraping to let eBay cool down
  if (challengeDetectedAt && (Date.now() - challengeDetectedAt) < CONFIG.challengeCooldownMs) {
    const remainingCooldown = Math.ceil((CONFIG.challengeCooldownMs - (Date.now() - challengeDetectedAt)) / 1000);
    console.log(`[WARN] CAPTCHA cooldown active (${remainingCooldown}s remaining) - skipping "${searchConfig.name}"`);
    return [];
  }

  try {
    // Check if browser needs restart
    if (shouldRestartBrowser()) {
      console.log('[INFO] Restarting browser for stability...');
      await launchBrowser();
    }

    // Check if page is still valid
    if (!page || page.isClosed()) {
      console.log('[INFO] Page was closed, recreating...');
      page = await browser.newPage();
      const viewportWidth = 1920 + Math.floor(Math.random() * 100) - 50;
      const viewportHeight = 1080 + Math.floor(Math.random() * 60) - 30;
      await page.setViewport({ width: viewportWidth, height: viewportHeight });
      await page.setUserAgent(getRandomUserAgent());
    }

    // Random delay before navigation (1-3 seconds) to appear more human
    await randomDelay(1000, 3000);

    // Clear page state before navigating to prevent stale DOM issues
    // This forces a clean slate and prevents previous search results from bleeding through
    await page.goto('about:blank', { waitUntil: 'load', timeout: 5000 }).catch(() => {});
    await randomDelay(200, 500);

    console.log(`[INFO] Navigating to eBay for: "${searchQuery}"`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // Verify we landed on the correct search page
    const currentUrl = page.url();
    const expectedQueryEncoded = encodeURIComponent(searchQuery).toLowerCase();
    const currentUrlLower = currentUrl.toLowerCase();

    if (!currentUrlLower.includes('ebay.com') || !currentUrlLower.includes('_nkw=')) {
      // Detect CAPTCHA/challenge page specifically and enter cooldown
      if (currentUrlLower.includes('splashui/challenge') || currentUrlLower.includes('captcha')) {
        challengeDetectedAt = Date.now();
        console.log('[WARN] CAPTCHA/Challenge detected - entering 5 minute cooldown');
      }
      throw new Error(`Navigation failed - landed on unexpected page: ${currentUrl.substring(0, 100)}`);
    }

    // Check if the URL contains our search terms (eBay may re-encode slightly)
    const searchTerms = searchQuery.toLowerCase().split(' ').filter(t => t.length > 2 && !t.startsWith('"'));
    const urlHasSearchTerms = searchTerms.some(term => currentUrlLower.includes(encodeURIComponent(term).toLowerCase()));
    if (!urlHasSearchTerms && searchTerms.length > 0) {
      throw new Error(`URL mismatch - page may have stale content. Expected: "${searchQuery}", Got: ${currentUrl.substring(0, 100)}`);
    }

    // Wait for search results to load
    await page.waitForSelector('.srp-results', { timeout: 30000 }).catch(() => {
      console.log('[WARN] Search results container not found, trying anyway...');
    });

    // Random delay to appear more human (1.5-3 seconds)
    await randomDelay(1500, 3000);

    // Simulate human-like mouse movement
    try {
      const viewport = page.viewport();
      await page.mouse.move(
        Math.floor(Math.random() * viewport.width * 0.6) + viewport.width * 0.2,
        Math.floor(Math.random() * viewport.height * 0.3) + 100
      );
    } catch (e) {
      // Ignore mouse movement errors
    }

    // Scroll down the page with human-like behavior
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        // Randomize scroll distance to appear more human
        const scrollStep = () => {
          const distance = 200 + Math.floor(Math.random() * 200); // 200-400px
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= document.body.scrollHeight || totalHeight > 3000) {
            // Scroll back to top with slight randomness
            setTimeout(() => {
              window.scrollTo(0, 0);
              resolve();
            }, 100 + Math.floor(Math.random() * 200));
          } else {
            // Random delay between scrolls (80-200ms)
            setTimeout(scrollStep, 80 + Math.floor(Math.random() * 120));
          }
        };
        scrollStep();
      });
    });

    // Random wait for images to load (800-1500ms)
    await randomDelay(800, 1500);

    // Extract listings using eBay's current card structure
    // eBay uses li.s-card as the card container with:
    // - div.s-card__title for title
    // - span.s-card__price for price
    // - img.s-card__image for image
    const listings = await page.evaluate(() => {
      const items = [];
      const seenIds = new Set();

      // Find all card containers directly
      const cards = document.querySelectorAll('li.s-card');

      cards.forEach((card) => {
        // Find item link to get ID and URL
        const itemLink = card.querySelector('a[href*="/itm/"]');
        if (!itemLink) return;

        const href = itemLink.href;
        const urlMatch = href.match(/\/itm\/(\d+)/);
        const itemId = urlMatch ? urlMatch[1] : null;

        // Skip if no ID, already processed, or placeholder
        if (!itemId || seenIds.has(itemId) || itemId === '123456') return;

        // Get title from the title div
        const titleElement = card.querySelector('.s-card__title') ||
                            card.querySelector('[class*="title"]');
        let title = titleElement?.textContent?.trim() || '';

        // Clean up title - remove "New Listing" prefix and "Opens in..." suffix
        title = title.replace(/^New Listing/, '').trim();
        title = title.replace(/Opens in a new window or tab.*$/, '').trim();

        // Skip invalid titles
        if (!title || title.includes('Shop on eBay')) return;

        // Get price
        const priceElement = card.querySelector('.s-card__price') ||
                            card.querySelector('[class*="price"]');
        const price = priceElement?.textContent?.trim() || 'N/A';

        // Get image
        const imgElement = card.querySelector('img.s-card__image') ||
                          card.querySelector('img[src*="ebayimg"]');

        let image = null;
        if (imgElement) {
          image = imgElement.src;
          // Skip placeholder images
          if (image && (image.includes('ebaystatic.com/rs/') || image.includes('data:image'))) {
            image = null;
          }
        }

        // Upgrade image size if it's an eBay image URL
        if (image && image.includes('ebayimg.com')) {
          image = image.replace(/s-l\d+/, 's-l500');
          image = image.replace('/thumbs/', '/images/');
        }

        seenIds.add(itemId);
        items.push({
          id: itemId,
          title: title.substring(0, 200),
          url: href.split('?')[0],
          price: price,
          image: image
        });
      });

      return items;
    });

    consecutiveFailures = 0; // Reset on success
    return listings;

  } catch (error) {
    console.error(`[ERROR] Scrape failed (attempt ${retryCount + 1}):`, error.message);
    consecutiveFailures++;

    // Check for hard restart threshold
    if (consecutiveFailures >= CONFIG.hardRestartThreshold) {
      await hardRestart(`Consecutive failures reached ${consecutiveFailures}`);
    }

    if (retryCount < CONFIG.maxRetries) {
      // Exponential backoff: 10s, 20s, 40s
      const backoffTime = 10000 * Math.pow(2, retryCount);
      console.log(`[INFO] Retrying in ${backoffTime / 1000} seconds... (${retryCount + 1}/${CONFIG.maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, backoffTime));

      // Force kill Chrome if we're on the last retry
      if (retryCount === CONFIG.maxRetries - 1) {
        console.log('[WARN] Last retry - forcing Chrome cleanup...');
        forceKillChrome();
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // Restart browser on retry
      await launchBrowser();
      return scrapeListings(searchConfig, retryCount + 1);
    }

    // Send error notification after max retries
    if (consecutiveFailures >= CONFIG.maxRetries) {
      await sendErrorNotification(`Failed to scrape after ${CONFIG.maxRetries} attempts: ${error.message}`);
    }

    return [];
  }
}

// Check a single search for new listings
async function checkSearch(searchConfig) {
  const state = searchStates.get(searchConfig.name);

  console.log(`[INFO] Checking: "${searchConfig.searchQuery}"`);

  try {
    const listings = await scrapeListings(searchConfig);

    if (listings.length === 0) {
      console.log(`[WARN] [${searchConfig.name}] No listings found`);
      return 0;
    }

    console.log(`[INFO] [${searchConfig.name}] Found ${listings.length} listings on page`);
    let newCount = 0;

    for (const listing of listings) {
      if (!state.seenListings.has(listing.id)) {
        state.seenListings.add(listing.id);
        newCount++;

        if (state.isFirstRun) {
          console.log(`[INIT] [${searchConfig.name}] ${listing.title?.substring(0, 50)}...`);
        } else {
          // Check if listing passes ALL required keywords filter
          if (!passesKeywordFilter(listing, searchConfig.requiredKeywords)) {
            console.log(`[FILTERED] [${searchConfig.name}] ${listing.title?.substring(0, 60)}...`);
            console.log(`           Missing required keywords: ${searchConfig.requiredKeywords.join(', ')}`);
            continue; // Skip this listing, don't notify
          }

          // Check if listing passes ANY keyword filter (if configured)
          if (searchConfig.requiredKeywordsAny && !passesAnyKeywordFilter(listing, searchConfig.requiredKeywordsAny)) {
            console.log(`[FILTERED] [${searchConfig.name}] ${listing.title?.substring(0, 60)}...`);
            console.log(`           Missing any of: ${searchConfig.requiredKeywordsAny.slice(0, 5).join(', ')}...`);
            continue; // Skip this listing, don't notify
          }

          console.log(`[NEW] [${searchConfig.name}] ${listing.title?.substring(0, 60)}...`);
          console.log(`      Price: ${listing.price}`);
          console.log(`      URL: ${listing.url}`);
          console.log(`      Image: ${listing.image ? listing.image.substring(0, 60) + '...' : 'NONE'}`);

          // Send Discord notification
          await sendListingNotification(listing, searchConfig);
          totalNewListings++;

          // Rate limit: wait between notifications
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      }
    }

    if (state.isFirstRun) {
      console.log(`[INFO] [${searchConfig.name}] Initial scan complete - marked ${newCount} existing listings`);
      state.isFirstRun = false;
    } else if (newCount === 0) {
      console.log(`[INFO] [${searchConfig.name}] No new listings`);
    } else {
      console.log(`[INFO] [${searchConfig.name}] Found ${newCount} new listing(s)!`);
    }

    // Save state
    saveSeenListings(searchConfig.dataFile, state.seenListings);

    // Prune old listings (keep last 2000)
    if (state.seenListings.size > 2000) {
      const arr = [...state.seenListings];
      state.seenListings = new Set(arr.slice(-2000));
      saveSeenListings(searchConfig.dataFile, state.seenListings);
      console.log(`[INFO] [${searchConfig.name}] Pruned old listings`);
    }

    return newCount;

  } catch (error) {
    console.error(`[ERROR] [${searchConfig.name}] Check failed:`, error.message);
    return 0;
  }
}

// Check all searches
async function checkAllSearches() {
  // Prevent overlapping check cycles - critical for stability
  if (isCheckRunning) {
    console.log('[WARN] Previous check cycle still running - skipping this interval');
    return 0;
  }

  isCheckRunning = true;
  const timestamp = new Date().toLocaleString();
  console.log(`\n[${timestamp}] Running check #${totalChecks + 1} for all ${SEARCH_CONFIGS.length} searches...`);

  let totalNew = 0;

  try {
    for (const searchConfig of SEARCH_CONFIGS) {
      // Skip remaining searches if CAPTCHA cooldown is active
      if (challengeDetectedAt && (Date.now() - challengeDetectedAt) < CONFIG.challengeCooldownMs) {
        const remainingCooldown = Math.ceil((CONFIG.challengeCooldownMs - (Date.now() - challengeDetectedAt)) / 1000);
        console.log(`[WARN] CAPTCHA cooldown active (${remainingCooldown}s) - pausing remaining searches`);
        break;
      }

      const newCount = await checkSearch(searchConfig);
      totalNew += newCount;

      // Increased delay between searches (10-25 seconds) to reduce rate limiting
      await randomDelay(10000, 25000);
    }

    totalChecks++;
    lastSuccessfulCheck = Date.now();

    // Clear CAPTCHA cooldown if we completed a full cycle without issues
    if (consecutiveFailures === 0) {
      challengeDetectedAt = null;
    }

    console.log(`[INFO] All searches completed. Total new listings: ${totalNew}`);
  } catch (error) {
    console.error(`[ERROR] Check cycle failed: ${error.message}`);
  } finally {
    isCheckRunning = false;
  }

  return totalNew;
}

// Main startup
async function main() {
  console.log('='.repeat(60));
  console.log('  eBay Listing Monitor - Multi-Search Production Version');
  console.log('='.repeat(60));
  console.log(`  Searches:   ${SEARCH_CONFIGS.length} configured`);
  SEARCH_CONFIGS.forEach((config, i) => {
    const webhookStatus = config.webhookUrl ? '✓' : '✗';
    console.log(`              ${i + 1}. ${config.name}: "${config.searchQuery}" [${webhookStatus}]`);
  });
  console.log(`  Interval:   ${CONFIG.checkIntervalMinutes} minutes`);
  console.log(`  Restart:    Every ${CONFIG.browserRestartHours} hours`);
  console.log(`  Health:     Every ${CONFIG.healthCheckHours} hours`);
  console.log('='.repeat(60));

  // Check webhook configuration
  const missingWebhooks = SEARCH_CONFIGS.filter(c => !c.webhookUrl);
  if (missingWebhooks.length > 0) {
    console.log('\n[WARN] Missing Discord webhooks for:');
    missingWebhooks.forEach(c => console.log(`       - ${c.name}`));
    console.log('[WARN] Set these in Railway environment variables.\n');
  }

  // Initialize state for each search
  for (const config of SEARCH_CONFIGS) {
    const seenListings = loadSeenListings(config.dataFile);
    searchStates.set(config.name, {
      seenListings,
      isFirstRun: seenListings.size === 0
    });
    console.log(`[INFO] Loaded ${seenListings.size} previously seen listings for "${config.name}"`);
  }

  // Launch browser
  await launchBrowser();

  // Send startup notification
  await sendStartupNotification();

  // Run initial check
  await checkAllSearches();

  // Schedule periodic checks using setTimeout (prevents overlapping cycles)
  const checkIntervalMs = CONFIG.checkIntervalMinutes * 60 * 1000;
  console.log(`\n[INFO] Next check in ${CONFIG.checkIntervalMinutes} minutes...`);

  const scheduleNextCheck = () => {
    setTimeout(async () => {
      await checkAllSearches();
      console.log(`[INFO] Next check in ${CONFIG.checkIntervalMinutes} minutes...`);
      scheduleNextCheck(); // Only schedule next after current completes
    }, checkIntervalMs);
  };
  scheduleNextCheck();

  // Schedule health check notifications
  const healthCheckMs = CONFIG.healthCheckHours * 60 * 60 * 1000;
  setInterval(async () => {
    await sendHealthCheckNotification();
  }, healthCheckMs);

  // Handle graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\n[INFO] Received ${signal}, shutting down gracefully...`);
    await safeBrowserClose();
    forceKillChrome(); // Ensure all Chrome processes are dead
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Handle uncaught errors
  process.on('uncaughtException', async (error) => {
    console.error('[FATAL] Uncaught exception:', error.message);
    consecutiveFailures++;
    await sendErrorNotification(`Uncaught exception: ${error.message}`);

    // Trigger hard restart if too many failures
    if (consecutiveFailures >= CONFIG.hardRestartThreshold) {
      await hardRestart(`Uncaught exception after ${consecutiveFailures} failures: ${error.message}`);
    }

    // Try to recover by restarting browser
    try {
      forceKillChrome();
      await new Promise(resolve => setTimeout(resolve, 2000));
      await launchBrowser();
    } catch (e) {
      console.error('[FATAL] Recovery failed:', e.message);
    }
  });

  process.on('unhandledRejection', async (reason) => {
    console.error('[FATAL] Unhandled rejection:', reason);
    consecutiveFailures++;
    await sendErrorNotification(`Unhandled rejection: ${reason}`);

    // Trigger hard restart if too many failures
    if (consecutiveFailures >= CONFIG.hardRestartThreshold) {
      await hardRestart(`Unhandled rejection after ${consecutiveFailures} failures: ${reason}`);
    }
  });

  console.log('[INFO] Monitor is running. Will notify on new listings.');
}

main().catch(async (error) => {
  console.error('[FATAL] Startup failed:', error);
  await sendErrorNotification(`Startup failed: ${error.message}`);
  process.exit(1);
});
