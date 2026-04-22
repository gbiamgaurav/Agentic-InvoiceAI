# Multi-stage build for Next.js application
FROM node:20-alpine AS base

# Install dependencies for the build stage
RUN apk add --no-cache libc6-compat

# Set the working directory
WORKDIR /app

# ============================================================================
# Builder Stage - Build the Next.js application
# ============================================================================
FROM base AS builder

# Copy package files
COPY package.json yarn.lock* ./

# Install dependencies
RUN yarn install --frozen-lockfile

# Copy the entire application
COPY . .

# Build the Next.js application
RUN yarn build

# ============================================================================
# Runner Stage - Production image
# ============================================================================
FROM base AS runner

# Set environment variables for production
ENV NODE_ENV=production

# Create a non-root user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001

WORKDIR /app

# Copy the built application from the builder stage
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Change ownership to nextjs user
RUN chown -R nextjs:nodejs /app

# Switch to nextjs user
USER nextjs

# Expose port 3000
EXPOSE 3000

# Set the hostname to allow external connections
ENV HOSTNAME="0.0.0.0"

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start the Next.js application
CMD ["node", "server.js"]
