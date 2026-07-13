FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install --no-audit --no-fund || (sleep 3 && npm install --no-audit --no-fund)
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund || (sleep 3 && npm install --omit=dev --no-audit --no-fund)
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
