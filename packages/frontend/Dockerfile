FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json ./
# Retry once: esbuild postinstall can hit a transient ETXTBSY on overlayfs.
RUN npm install --no-audit --no-fund || (sleep 3 && npm install --no-audit --no-fund)

COPY . .
# vite build bundles heavy libs (mermaid, cytoscape, exceljs, katex) and can hit
# Node's default heap ceiling under Docker Desktop's memory limits, especially
# on Windows/WSL2 — "JavaScript heap out of memory" mid-build. Raise it
# explicitly; this only affects the build step, not the runtime (the runner
# stage below is plain nginx serving static files, no Node at all).
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN npm run build

# ── Production: Nginx serve ───────────────────────────────
FROM nginx:alpine AS runner

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx-limits.conf /etc/nginx/conf.d/00-limits.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
