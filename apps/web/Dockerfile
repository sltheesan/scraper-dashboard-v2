FROM node:20-slim AS builder

WORKDIR /app

COPY package.json package-lock.json turbo.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/database/package.json ./packages/database/

RUN npm ci

COPY packages/database ./packages/database
COPY apps/web ./apps/web
COPY apps/api ./apps/api

RUN npx prisma generate --schema=packages/database/prisma/schema.prisma

ENV INTERNAL_API_URL=http://api:4000
RUN npm run build -w @scraper/web

# ---------------------------------------------------------------------------
FROM node:20-slim AS runner

WORKDIR /app

COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static

ENV HOSTNAME=0.0.0.0
ENV PORT=3000

WORKDIR /app/apps/web

EXPOSE 3000

CMD ["node", "server.js"]
