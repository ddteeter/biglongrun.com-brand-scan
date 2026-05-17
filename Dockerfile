# syntax=docker/dockerfile:1
FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production=false

FROM oven/bun:1-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run typecheck

FROM oven/bun:1-alpine
WORKDIR /app
ENV BUN_ENV=production
COPY --from=build /app /app
RUN mkdir -p /data/artifacts
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD wget -qO- http://localhost:3000/api/v1/health || exit 1
CMD ["bun", "src/main.ts"]
