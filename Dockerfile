# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci && npm cache clean --force

COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Install Chromium and dependencies
RUN apk add --no-cache \
    dumb-init \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    && rm -rf /var/cache/apk/*

# Puppeteer config
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Copy package files
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy built app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/templates ./dist/templates

# Create storage directories
RUN mkdir -p storage/uploads storage/cotizaciones-pdfs

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
