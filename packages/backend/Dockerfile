FROM node:22-alpine AS base
WORKDIR /app
# postgresql16-client — for pg_dump/pg_restore: the backup takes the WHOLE
# database rather than a hand-written list of tables (such a list goes stale
# silently with every new entity). The client version must match the server
# declared in docker-compose.
RUN apk add --no-cache curl openssl postgresql16-client \
    chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# ── Deps ──────────────────────────────────────────────────
FROM base AS deps
COPY package.json ./
# Retry once: esbuild's postinstall can hit a transient ETXTBSY on overlayfs
# when stages install in parallel (the just-written binary is briefly busy).
RUN npm install --omit=dev --no-audit --no-fund || (sleep 3 && npm install --omit=dev --no-audit --no-fund)

# ── Build ─────────────────────────────────────────────────
FROM base AS builder
COPY package.json tsconfig.json ./
RUN npm install --no-audit --no-fund || (sleep 3 && npm install --no-audit --no-fund)
COPY src ./src
COPY prisma ./prisma
RUN npx prisma generate
RUN npm run build

# ── Production image ──────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

EXPOSE 3010

# Run migrations, then start the server
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/app.js"]
