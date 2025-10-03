# Stage 1: Build the application
FROM node:20-slim AS builder
WORKDIR /app

# Copy all source files
COPY . .

# Install dependencies and build the project
RUN npm install
RUN npm run build

# Stage 2: Create the production image
FROM node:20-slim
WORKDIR /app

# Create a non-root user
RUN groupadd -g 1001 nodejs && \
    useradd -r -u 1001 -g nodejs worker

# Copy only necessary files from the builder stage
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist/
COPY --from=builder /app/accounts.json ./accounts.json

# Install only production dependencies
RUN npm install --omit=dev

# Change ownership of the app directory
RUN chown -R worker:nodejs /app

# Switch to the non-root user
USER worker

# Expose the application port
EXPOSE 3000

# Command to run the application
CMD [ "node", "dist/server.js" ]
