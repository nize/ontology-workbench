FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN npm install

# Copy source (excluding node_modules and dist)
COPY --chown=node:node . .

# Build
RUN npm run build

# Remove node_modules and install only production deps
RUN npm ci --production

# Expose port
EXPOSE 3000

# Run
CMD ["npm", "run", "start"]