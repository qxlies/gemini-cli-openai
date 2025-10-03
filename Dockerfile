# Dockerfile for Gemini CLI OpenAI Worker (Node.js version)
# Production-ready multi-stage build

# --- Builder Stage ---
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files and install all dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the application code
COPY . .

# Build the TypeScript project
RUN npm run build

# --- Production Stage ---
FROM node:20-slim

# Create a non-root user for security
RUN groupadd -g 1001 nodejs && \
    useradd -r -u 1001 -g nodejs worker

WORKDIR /app

# Copy only necessary files from the builder stage
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/accounts.json ./

# Install only production dependencies
RUN npm install --omit=dev

# Set ownership for the app directory
RUN chown -R worker:nodejs /app

# Switch to the non-root user
USER worker

# Expose the port the server will run on
EXPOSE 8787

# Health check to ensure the service is running
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8787/health || exit 1

# Command to run the worker
CMD ["npm", "start"]
