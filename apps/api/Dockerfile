FROM node:20-slim AS builder

WORKDIR /app

COPY package.json package-lock.json turbo.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/database/package.json ./packages/database/

RUN npm ci

COPY packages/database ./packages/database
COPY apps/api ./apps/api

RUN npx prisma generate --schema=packages/database/prisma/schema.prisma
RUN npm run build -w @scraper/api

# ---------------------------------------------------------------------------
FROM mcr.microsoft.com/playwright:v1.64.0-noble AS runner

RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb x11vnc novnc websockify \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/packages/database ./packages/database

RUN mkdir -p /app/apps/api/profiles

COPY apps/api/start.sh ./apps/api/start.sh
RUN chmod +x /app/apps/api/start.sh

WORKDIR /app/apps/api

EXPOSE 4000 6080

CMD ["./start.sh"]
