FROM node:20-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy workspace config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy packages
COPY packages/shared ./packages/shared
COPY packages/backend ./packages/backend

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build shared package first, then backend package
WORKDIR /app
RUN pnpm --filter ./packages/shared build
RUN pnpm --filter ./packages/backend build

# Expose port
EXPOSE 4000

# Run
CMD ["node", "packages/backend/dist/main.js"]
