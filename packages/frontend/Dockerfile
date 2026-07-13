FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json ./
# Retry once: esbuild postinstall can hit a transient ETXTBSY on overlayfs.
RUN npm install --no-audit --no-fund || (sleep 3 && npm install --no-audit --no-fund)

COPY . .
RUN npm run build

# ── Production: Nginx serve ───────────────────────────────
FROM nginx:alpine AS runner

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
