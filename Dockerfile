# Dockerfile for Gemini CLI OpenAI Worker
# Production-ready build with security optimizations

FROM node:20-alpine

# Install security updates and required packages
RUN apk update && apk upgrade && \
    apk add --no-cache wget curl && \
    rm -rf /var/cache/apk/*

# Create a non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S worker -u 1001 -G nodejs

# Set working directory inside the container
WORKDIR /app

# Install wrangler globally
# Yarn is already included in the Node.js Alpine image
RUN npm install -g wrangler@4.23.0

# Copy package files first to leverage Docker cache
COPY package*.json yarn.lock* ./

# Install project dependencies with yarn
# Use --production flag for production builds, --frozen-lockfile for dev
ARG NODE_ENV=development
RUN if [ "$NODE_ENV" = "production" ]; then \
        yarn install --frozen-lockfile --production; \
    else \
        yarn install --frozen-lockfile; \
    fi

# Copy the rest of your application code
COPY . .

# Create directory for miniflare storage persistence and set proper ownership
RUN mkdir -p .mf && \
    chown -R worker:nodejs /app

# Switch to non-root user for security
USER worker

# Expose the port miniflare will run on
EXPOSE 8787

# Health check to ensure the service is running
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8787/health || exit 1

# Command to run the worker
# --host 0.0.0.0 is crucial for Docker to allow external connections
# --port 8787 matches the EXPOSE and wrangler.toml [dev] port
# --local disables proxying to Cloudflare's network, keeping everything local
# --persist-to tells miniflare to use the specified path for local storage
CMD ["wrangler", "dev", "--host", "0.0.0.0", "--port", "8787", "--local", "--persist-to", ".mf"]
