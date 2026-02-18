FROM node:20-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy workspace config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy packages
COPY packages/shared ./packages/shared
COPY packages/frontend ./packages/frontend

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build shared package first, then frontend package
WORKDIR /app
RUN pnpm --filter ./packages/shared build
RUN pnpm --filter ./packages/frontend build

# Expose port
EXPOSE 3000

# Run
CMD ["pnpm", "--filter", "./packages/frontend", "start"]
