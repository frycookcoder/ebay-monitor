const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const fetch = require('node-fetch');

// Configuration
const SEARCH_QUERY = 'Spongebob Topps Sketch';
const CHECK_INTERVAL_MS = 7 * 60 * 1000; // 7 minutes
const SEEN_LISTINGS_FILE = path.join(__dirname, 'seen_listings.json');
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// eBay search URL sorted by newly listed (_sop=10)
const EBAY_SEARCH_URL = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(SEARCH_QUERY)}&_sop=10`;

// Load seen listings from file
function loadSeenListings() {
  try {
    if (fs.existsSync(SEEN_LISTINGS_FILE)) {
      const data = fs.readFileSync(SEEN_LISTINGS_FILE, 'utf8');
      return new Set(JSON.parse(data));
    }
  } catch (error) {
    console.error('[ERROR] Failed to load seen listings:', error.message);
  }
  return new Set();
}

// Save seen listings to file
function saveSeenListings(seenListings) {
  try {
    fs.writeFileSync(SEEN_LISTINGS_FILE, JSON.stringify([...seenListings], null, 2));
  } catch (error) {
    console.error('[ERROR] Failed to save seen listings:', error.message);
  }
}

// Send Discord webhook with screenshot attachment
async function sendDiscordNotification(listing, screenshotBuffer) {
  if (!DISCORD_WEBHOOK_URL) {
    console.error('[ERROR] DISCORD_WEBHOOK_URL environment variable not set');
    return;
  }

  try {
    const form = new FormData();

    // Create embed for the listing
    const embed = {
      title: listing.title,
      url: listing.url,
      color: 0x0066cc,
      fields: [
        {
          name: 'Price',
          value: listing.price || 'Price not available',
          inline: true
        }
      ],
      image: {
        url: 'attachment://listing.png'
      },
      footer: {
        text: 'eBay Listing Monitor'
      },
      timestamp: new Date().toISOString()
    };

    const payload = {
      content: '**New eBay Listing Found!**',
      embeds: [embed]
    };

    form.append('payload_json', JSON.stringify(payload));
    form.append('file', screenshotBuffer, {
      filename: 'listing.png',
      contentType: 'image/png'
    });

    const response = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      body: form
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Discord API error: ${response.status} - ${errorText}`);
    }

    console.log(`[SUCCESS] Discord notification sent for: ${listing.title}`);
  } catch (error) {
    console.error('[ERROR] Failed to send Discord notification:', error.message);
  }
}

// Take screenshot of a listing
async function takeListingScreenshot(browser, url) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Wait for main content to load
    await page.waitForSelector('.x-item-title', { timeout: 10000 }).catch(() => {});

    const screenshot = await page.screenshot({ type: 'png' });
    return screenshot;
  } catch (error) {
    console.error('[ERROR] Failed to take screenshot:', error.message);
    return null;
  } finally {
    await page.close();
  }
}

// Scrape eBay listings
async function scrapeListings(page) {
  try {
    console.log(`[INFO] Navigating to eBay search: ${SEARCH_QUERY}`);
    await page.goto(EBAY_SEARCH_URL, { waitUntil: 'networkidle2', timeout: 60000 });

    // Wait for search results
    await page.waitForSelector('.srp-results', { timeout: 30000 }).catch(() => {
      console.log('[WARN] Search results container not found, page might have different structure');
    });

    // Extract listings
    const listings = await page.evaluate(() => {
      const items = [];
      const listingElements = document.querySelectorAll('.s-item');

      listingElements.forEach((element) => {
        // Skip the first "Shop on eBay" placeholder item
        const titleElement = element.querySelector('.s-item__title');
        if (!titleElement || titleElement.textContent.includes('Shop on eBay')) {
          return;
        }

        const linkElement = element.querySelector('.s-item__link');
        const priceElement = element.querySelector('.s-item__price');

        if (linkElement && linkElement.href) {
          // Extract item ID from URL
          const urlMatch = linkElement.href.match(/\/itm\/(\d+)/);
          const itemId = urlMatch ? urlMatch[1] : null;

          if (itemId) {
            items.push({
              id: itemId,
              title: titleElement.textContent.trim(),
              url: linkElement.href.split('?')[0], // Clean URL
              price: priceElement ? priceElement.textContent.trim() : 'N/A'
            });
          }
        }
      });

      return items;
    });

    console.log(`[INFO] Found ${listings.length} listings`);
    return listings;
  } catch (error) {
    console.error('[ERROR] Failed to scrape listings:', error.message);
    return [];
  }
}

// Main monitoring function
async function monitor() {
  console.log('[INFO] Starting eBay listing monitor...');
  console.log(`[INFO] Search query: "${SEARCH_QUERY}"`);
  console.log(`[INFO] Check interval: ${CHECK_INTERVAL_MS / 1000 / 60} minutes`);

  if (!DISCORD_WEBHOOK_URL) {
    console.warn('[WARN] DISCORD_WEBHOOK_URL not set - notifications will be disabled');
  }

  let seenListings = loadSeenListings();
  console.log(`[INFO] Loaded ${seenListings.size} previously seen listings`);

  // Launch browser with cloud-compatible settings
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  let isFirstRun = seenListings.size === 0;

  async function check() {
    const timestamp = new Date().toISOString();
    console.log(`\n[${timestamp}] Running check...`);

    try {
      const listings = await scrapeListings(page);

      if (listings.length === 0) {
        console.log('[WARN] No listings found - eBay might be blocking or page structure changed');
        return;
      }

      let newListingsCount = 0;

      for (const listing of listings) {
        if (!seenListings.has(listing.id)) {
          seenListings.add(listing.id);
          newListingsCount++;

          if (isFirstRun) {
            console.log(`[INFO] Initial scan - marking as seen: ${listing.title}`);
          } else {
            console.log(`[NEW] New listing found: ${listing.title} - ${listing.price}`);
            console.log(`[NEW] URL: ${listing.url}`);

            // Take screenshot and send notification
            const screenshot = await takeListingScreenshot(browser, listing.url);
            if (screenshot) {
              await sendDiscordNotification(listing, screenshot);
            } else {
              // Send notification without screenshot
              await sendDiscordNotification(listing, Buffer.from([]));
            }
          }
        }
      }

      if (isFirstRun) {
        console.log(`[INFO] Initial scan complete - marked ${newListingsCount} listings as seen`);
        isFirstRun = false;
      } else if (newListingsCount === 0) {
        console.log('[INFO] No new listings found');
      } else {
        console.log(`[INFO] Found ${newListingsCount} new listing(s)`);
      }

      // Save updated seen listings
      saveSeenListings(seenListings);

    } catch (error) {
      console.error('[ERROR] Check failed:', error.message);
    }
  }

  // Run initial check
  await check();

  // Schedule periodic checks
  setInterval(check, CHECK_INTERVAL_MS);

  console.log('[INFO] Monitor is running. Press Ctrl+C to stop.');

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n[INFO] Shutting down...');
    await browser.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n[INFO] Shutting down...');
    await browser.close();
    process.exit(0);
  });
}

// Start the monitor
monitor().catch((error) => {
  console.error('[FATAL] Monitor failed to start:', error.message);
  process.exit(1);
});
