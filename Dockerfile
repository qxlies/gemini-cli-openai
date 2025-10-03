# =================================================================
# FINAL, PRODUCTION-READY DOCKERFILE
# =================================================================

# STAGE 1: Build the application
FROM node:20-slim AS builder
WORKDIR /app

# Copy package files and install all dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the source code
COPY . .

# Build the TypeScript project. This will create the /app/dist folder.
RUN npm run build

# STAGE 2: Create the final production image
FROM node:20-slim
WORKDIR /app

# Create a non-root user for security
RUN groupadd -g 1001 nodejs && \
    useradd -r -u 1001 -g nodejs worker

# Copy package files for production dependency installation
COPY package*.json ./

# Install ONLY production dependencies
RUN npm install --omit=dev

# Copy the built application and necessary assets from the builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/accounts.json ./accounts.json

# Set correct ownership for the entire app directory
RUN chown -R worker:nodejs /app

# Switch to the non-root user
USER worker

# Expose the application port
EXPOSE 8787

# The command to run the application
CMD ["npm", "start"]
