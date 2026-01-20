require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

// Use stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

// Global Configuration
const CONFIG = {
  checkIntervalMinutes: parseInt(process.env.CHECK_INTERVAL) || 10,
  browserRestartHours: parseFloat(process.env.BROWSER_RESTART_HOURS) || 2,
  maxRetries: parseInt(process.env.MAX_RETRIES) || 3,
  healthCheckHours: parseFloat(process.env.HEALTH_CHECK_HOURS) || 6,
};

// Multi-search configuration
// Each search has its own query, Discord webhook, and data file
const SEARCH_CONFIGS = [
  {
    name: 'Sketch',
    searchQuery: 'Spongebob Topps Sketch',
    webhookUrl: process.env.DISCORD_WEBHOOK_SKETCH,
    dataFile: path.join(__dirname, 'seen_listings_sketch.json')
  },
  {
    name: 'Superfractor',
    searchQuery: 'Spongebob Topps "Superfractor"',
    webhookUrl: process.env.DISCORD_WEBHOOK_SUPERFRACTOR,
    dataFile: path.join(__dirname, 'seen_listings_superfractor.json')
  },
  {
    name: '1/1',
    searchQuery: 'Spongebob Topps 1/1',
    webhookUrl: process.env.DISCORD_WEBHOOK_1OF1,
    dataFile: path.join(__dirname, 'seen_listings_1of1.json')
  },
  {
    name: '/5',
    searchQuery: 'Spongebob Topps /5',
    webhookUrl: process.env.DISCORD_WEBHOOK_5,
    dataFile: path.join(__dirname, 'seen_listings_5.json')
  },
  {
    name: 'DBS God Rare',
    searchQuery: 'dragon ball super card "God Rare"',
    webhookUrl: process.env.DISCORD_WEBHOOK_DBS_GDR,
    dataFile: path.join(__dirname, 'seen_listings_dbs_gdr.json')
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

// State per search
const searchStates = new Map();

// Build eBay search URL (sorted by newly listed)
function buildEbayUrl(query) {
  const encodedQuery = encodeURIComponent(query);
  return `https://www.ebay.com/sch/i.html?_nkw=${encodedQuery}&_sop=10`;
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

// Launch browser with stealth settings
async function launchBrowser() {
  console.log('[INFO] Launching browser with stealth mode...');

  if (browser) {
    try {
      await browser.close();
    } catch (e) {
      console.log('[WARN] Error closing old browser:', e.message);
    }
  }

  browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process'
    ]
  });

  page = await browser.newPage();

  // Set viewport and user agent
  await page.setViewport({ width: 1920, height: 1080 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

  // Set extra headers
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
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
async function scrapeListings(searchQuery, retryCount = 0) {
  const url = buildEbayUrl(searchQuery);

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
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
    }

    console.log(`[INFO] Navigating to eBay for: "${searchQuery}"`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // Wait for search results to load
    await page.waitForSelector('.srp-results', { timeout: 30000 }).catch(() => {
      console.log('[WARN] Search results container not found, trying anyway...');
    });

    // Small delay to ensure dynamic content loads
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Scroll down the page to trigger lazy-loading of images
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 300;
        const timer = setInterval(() => {
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= document.body.scrollHeight || totalHeight > 3000) {
            clearInterval(timer);
            window.scrollTo(0, 0); // Scroll back to top
            resolve();
          }
        }, 100);
      });
    });

    // Wait for images to load after scrolling
    await new Promise(resolve => setTimeout(resolve, 1000));

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

    if (retryCount < CONFIG.maxRetries) {
      console.log(`[INFO] Retrying in 10 seconds... (${retryCount + 1}/${CONFIG.maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, 10000));

      // Restart browser on retry
      await launchBrowser();
      return scrapeListings(searchQuery, retryCount + 1);
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
    const listings = await scrapeListings(searchConfig.searchQuery);

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
  const timestamp = new Date().toLocaleString();
  console.log(`\n[${timestamp}] Running check #${totalChecks + 1} for all ${SEARCH_CONFIGS.length} searches...`);

  let totalNew = 0;

  for (const searchConfig of SEARCH_CONFIGS) {
    const newCount = await checkSearch(searchConfig);
    totalNew += newCount;

    // Small delay between searches to be respectful to eBay
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  totalChecks++;
  lastSuccessfulCheck = Date.now();

  console.log(`[INFO] All searches completed. Total new listings: ${totalNew}`);
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

  // Schedule periodic checks
  const checkIntervalMs = CONFIG.checkIntervalMinutes * 60 * 1000;
  console.log(`\n[INFO] Next check in ${CONFIG.checkIntervalMinutes} minutes...`);

  setInterval(async () => {
    await checkAllSearches();
    console.log(`[INFO] Next check in ${CONFIG.checkIntervalMinutes} minutes...`);
  }, checkIntervalMs);

  // Schedule health check notifications
  const healthCheckMs = CONFIG.healthCheckHours * 60 * 60 * 1000;
  setInterval(async () => {
    await sendHealthCheckNotification();
  }, healthCheckMs);

  // Handle graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\n[INFO] Received ${signal}, shutting down gracefully...`);
    try {
      if (browser) await browser.close();
    } catch (e) {}
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Handle uncaught errors
  process.on('uncaughtException', async (error) => {
    console.error('[FATAL] Uncaught exception:', error.message);
    await sendErrorNotification(`Uncaught exception: ${error.message}`);
    // Don't exit - try to keep running
  });

  process.on('unhandledRejection', async (reason) => {
    console.error('[FATAL] Unhandled rejection:', reason);
    await sendErrorNotification(`Unhandled rejection: ${reason}`);
    // Don't exit - try to keep running
  });

  console.log('[INFO] Monitor is running. Will notify on new listings.');
}

main().catch(async (error) => {
  console.error('[FATAL] Startup failed:', error);
  await sendErrorNotification(`Startup failed: ${error.message}`);
  process.exit(1);
});
