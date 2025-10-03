# Dockerfile for Development Environment
FROM node:20-slim

# Set working directory
WORKDIR /app

# Create a non-root user for security
RUN groupadd -g 1001 nodejs && \
    useradd -r -u 1001 -g nodejs worker

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the app for initial setup (will be overwritten by volume mount)
COPY . .

# Change ownership
RUN chown -R worker:nodejs /app

# Switch to non-root user
USER worker

# Expose the application port
EXPOSE 3000

# The CMD will be overridden by docker-compose, but this is a good default
CMD [ "npm", "run", "dev" ]
