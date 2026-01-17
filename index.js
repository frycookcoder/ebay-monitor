const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

// Use stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

// Configuration
const CONFIG = {
  searchQuery: process.env.SEARCH_QUERY || 'Spongebob Topps Sketch',
  checkIntervalMinutes: parseInt(process.env.CHECK_INTERVAL) || 5,
  discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL,
  dataFile: process.env.DATA_FILE || './seen_listings.json',
  // Production stability settings
  browserRestartHours: parseFloat(process.env.BROWSER_RESTART_HOURS) || 2,
  maxRetries: parseInt(process.env.MAX_RETRIES) || 3,
  healthCheckHours: parseFloat(process.env.HEALTH_CHECK_HOURS) || 6,
};

// State
let browser = null;
let page = null;
let browserStartTime = null;
let lastSuccessfulCheck = null;
let totalChecks = 0;
let totalNewListings = 0;
let consecutiveFailures = 0;

// Build eBay search URL (sorted by newly listed)
function buildEbayUrl(query) {
  const encodedQuery = encodeURIComponent(query);
  return `https://www.ebay.com/sch/i.html?_nkw=${encodedQuery}&_sop=10`;
}

// Load seen listings from file
function loadSeenListings() {
  try {
    if (fs.existsSync(CONFIG.dataFile)) {
      const data = fs.readFileSync(CONFIG.dataFile, 'utf8');
      return new Set(JSON.parse(data));
    }
  } catch (error) {
    console.error('[ERROR] Failed to load seen listings:', error.message);
  }
  return new Set();
}

// Save seen listings to file
function saveSeenListings(seenSet) {
  try {
    fs.writeFileSync(CONFIG.dataFile, JSON.stringify([...seenSet]), 'utf8');
  } catch (error) {
    console.error('[ERROR] Failed to save seen listings:', error.message);
  }
}

// Format price for display
function formatPrice(priceText) {
  if (!priceText || priceText === 'N/A') return 'Price not listed';
  // Clean up the price text
  return priceText.replace(/\s+/g, ' ').trim();
}

// Send Discord notification for new listing
async function sendListingNotification(listing) {
  if (!CONFIG.discordWebhookUrl) {
    console.log('[WARN] No Discord webhook URL configured');
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
      text: `eBay Monitor • ${CONFIG.searchQuery}`
    }
  };

  // Add thumbnail if available
  if (listing.image && listing.image.startsWith('http')) {
    embed.thumbnail = { url: listing.image };
  }

  const payload = {
    username: 'eBay Listing Monitor',
    avatar_url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/EBay_logo.svg/300px-EBay_logo.svg.png',
    embeds: [embed]
  };

  try {
    const response = await fetch(CONFIG.discordWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Discord API returned ${response.status}`);
    }

    return true;
  } catch (error) {
    console.error('[ERROR] Failed to send Discord notification:', error.message);
    return false;
  }
}

// Send startup notification
async function sendStartupNotification() {
  if (!CONFIG.discordWebhookUrl) return;

  const embed = {
    title: '🚀 eBay Monitor Started',
    color: 0x0099FF, // Blue
    fields: [
      {
        name: '🔍 Search Query',
        value: CONFIG.searchQuery,
        inline: true
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
    await fetch(CONFIG.discordWebhookUrl, {
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
  if (!CONFIG.discordWebhookUrl) return;

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
    await fetch(CONFIG.discordWebhookUrl, {
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
  if (!CONFIG.discordWebhookUrl) return;

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
    await fetch(CONFIG.discordWebhookUrl, {
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
async function scrapeListings(retryCount = 0) {
  const url = buildEbayUrl(CONFIG.searchQuery);

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

    console.log(`[INFO] Navigating to eBay...`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // Wait for search results to load
    await page.waitForSelector('.srp-results', { timeout: 30000 }).catch(() => {
      console.log('[WARN] Search results container not found, trying anyway...');
    });

    // Small delay to ensure dynamic content loads
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Extract listings by finding all item links
    const listings = await page.evaluate(() => {
      const items = [];
      const seenIds = new Set();

      // Find all links to eBay item pages
      const allLinks = document.querySelectorAll('a[href*="/itm/"]');

      allLinks.forEach((linkElement) => {
        const href = linkElement.href;
        const urlMatch = href.match(/\/itm\/(\d+)/);
        const itemId = urlMatch ? urlMatch[1] : null;

        // Skip if no ID or already processed
        if (!itemId || seenIds.has(itemId)) return;

        // Find parent container
        let container = linkElement.closest('[class*="s-card"]') ||
                       linkElement.closest('[class*="x-item"]') ||
                       linkElement.closest('li') ||
                       linkElement.parentElement?.parentElement;

        // Get title
        let title = linkElement.textContent?.trim() ||
                   linkElement.querySelector('[class*="title"]')?.textContent?.trim() ||
                   container?.querySelector('[class*="title"]')?.textContent?.trim() ||
                   container?.querySelector('h3')?.textContent?.trim();

        // Skip invalid titles
        if (!title || title === '' || title.includes('Shop on eBay')) return;

        // Get price
        let price = container?.querySelector('[class*="price"]')?.textContent?.trim() ||
                   container?.querySelector('[class*="prc"]')?.textContent?.trim() ||
                   'N/A';

        // Get image
        let image = container?.querySelector('img[src*="ebayimg"]')?.src ||
                   container?.querySelector('img')?.src ||
                   null;

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
      return scrapeListings(retryCount + 1);
    }

    // Send error notification after max retries
    if (consecutiveFailures >= CONFIG.maxRetries) {
      await sendErrorNotification(`Failed to scrape after ${CONFIG.maxRetries} attempts: ${error.message}`);
    }

    return [];
  }
}

// Main check function
async function checkForNewListings(seenListings, isFirstRun) {
  const timestamp = new Date().toLocaleString();
  console.log(`\n[${timestamp}] Running check #${totalChecks + 1}...`);

  try {
    const listings = await scrapeListings();
    totalChecks++;

    if (listings.length === 0) {
      console.log('[WARN] No listings found');
      return { seenListings, isFirstRun, newCount: 0 };
    }

    console.log(`[INFO] Found ${listings.length} listings on page`);
    let newCount = 0;

    for (const listing of listings) {
      if (!seenListings.has(listing.id)) {
        seenListings.add(listing.id);
        newCount++;

        if (isFirstRun) {
          console.log(`[INIT] ${listing.title?.substring(0, 50)}...`);
        } else {
          console.log(`[NEW] ${listing.title?.substring(0, 60)}...`);
          console.log(`      Price: ${listing.price}`);
          console.log(`      URL: ${listing.url}`);

          // Send Discord notification
          await sendListingNotification(listing);
          totalNewListings++;

          // Rate limit: wait between notifications
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      }
    }

    if (isFirstRun) {
      console.log(`[INFO] Initial scan complete - marked ${newCount} existing listings`);
      isFirstRun = false;
    } else if (newCount === 0) {
      console.log('[INFO] No new listings');
    } else {
      console.log(`[INFO] Found ${newCount} new listing(s)!`);
    }

    // Save state
    saveSeenListings(seenListings);
    lastSuccessfulCheck = Date.now();

    // Prune old listings (keep last 2000)
    if (seenListings.size > 2000) {
      const arr = [...seenListings];
      seenListings = new Set(arr.slice(-2000));
      saveSeenListings(seenListings);
      console.log('[INFO] Pruned old listings');
    }

    return { seenListings, isFirstRun, newCount };

  } catch (error) {
    console.error('[ERROR] Check failed:', error.message);
    return { seenListings, isFirstRun, newCount: 0 };
  }
}

// Main startup
async function main() {
  console.log('='.repeat(55));
  console.log('  eBay Listing Monitor - Production Version');
  console.log('='.repeat(55));
  console.log(`  Search:     "${CONFIG.searchQuery}"`);
  console.log(`  Interval:   ${CONFIG.checkIntervalMinutes} minutes`);
  console.log(`  Restart:    Every ${CONFIG.browserRestartHours} hours`);
  console.log(`  Health:     Every ${CONFIG.healthCheckHours} hours`);
  console.log(`  Discord:    ${CONFIG.discordWebhookUrl ? 'Configured ✓' : 'NOT SET ✗'}`);
  console.log('='.repeat(55));

  if (!CONFIG.discordWebhookUrl) {
    console.log('\n[WARN] DISCORD_WEBHOOK_URL not set!');
    console.log('[WARN] Set this in Railway environment variables.\n');
  }

  // Load state
  let seenListings = loadSeenListings();
  let isFirstRun = seenListings.size === 0;
  console.log(`[INFO] Loaded ${seenListings.size} previously seen listings`);

  // Launch browser
  await launchBrowser();

  // Send startup notification
  await sendStartupNotification();

  // Run initial check
  const result = await checkForNewListings(seenListings, isFirstRun);
  seenListings = result.seenListings;
  isFirstRun = result.isFirstRun;

  // Schedule periodic checks
  const checkIntervalMs = CONFIG.checkIntervalMinutes * 60 * 1000;
  console.log(`\n[INFO] Next check in ${CONFIG.checkIntervalMinutes} minutes...`);

  setInterval(async () => {
    const result = await checkForNewListings(seenListings, isFirstRun);
    seenListings = result.seenListings;
    isFirstRun = result.isFirstRun;
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
