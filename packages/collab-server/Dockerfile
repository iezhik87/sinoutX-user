FROM node:22-alpine
WORKDIR /app

COPY package.json ./
# No @tiptap deps here — the server only uses TiptapTransformer.fromYdoc (generic,
# schema-less). npm auto-installs the hocuspocus@4 peer set (incl. its own
# @tiptap/core), so a normal install resolves cleanly.
RUN npm install --omit=dev --no-audit --no-fund || (sleep 3 && npm install --omit=dev --no-audit --no-fund)

COPY src ./src

EXPOSE 3012

CMD ["node", "src/server.js"]
