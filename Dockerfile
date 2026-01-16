# Use official Puppeteer image with Chrome pre-installed
FROM ghcr.io/puppeteer/puppeteer:22.0.0

# Set working directory
WORKDIR /app

# Copy package files
COPY --chown=pptruser:pptruser package*.json ./

# Install dependencies
RUN npm ci --omit=dev

# Copy application code
COPY --chown=pptruser:pptruser . .

# Start the application
CMD ["npm", "start"]
