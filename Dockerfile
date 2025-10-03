# Stage 1: Build the application
FROM node:20-slim AS builder
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install all dependencies (including dev)
RUN npm install

# Copy the rest of the application source code
COPY . .

# Build the project
RUN npm run build

# Stage 2: Create the production image
FROM node:20-slim
WORKDIR /app

# Create a non-root user for security
RUN groupadd -g 1001 nodejs && \
    useradd -r -u 1001 -g nodejs worker

# Copy only necessary files for production from the builder stage
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/accounts.json ./accounts.json

# Install production dependencies only (pruning dev dependencies)
RUN npm prune --omit=dev

# Change ownership of the app directory
RUN chown -R worker:nodejs /app

# Switch to the non-root user
USER worker

# Expose the application port
EXPOSE 3000

# Command to run the application
CMD [ "node", "dist/server.js" ]
