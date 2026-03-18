# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci && npm cache clean --force

# Copy source and compile
COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Install dependencies for Puppeteer/Chromium
RUN apk add --no-cache \
    dumb-init \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    ttf-liberation \
    font-noto-emoji \
    wqy-zenhei \
    chromium-chromedriver \
    && rm -rf /var/cache/apk/*

# Tell Puppeteer to skip installing Chrome. We'll be using the installed package.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Copy package files and install production deps
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy compiled app from builder
COPY --from=builder /app/dist ./dist

# Copy templates (needed for Pug)
# Los templates deben estar accesibles desde el código compilado en dist/
COPY --from=builder /app/src/templates ./dist/templates

# Create directories for storage with proper permissions
RUN mkdir -p database storage/uploads storage/cotizaciones-pdfs && \
    chmod -R 777 storage

# Add user for running chromium (recommended for security)
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/health || exit 1

# Change ownership of the app directory
RUN chown -R nextjs:nodejs /app

# Run the application as non-root user
USER nextjs

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
