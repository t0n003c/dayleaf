# ---- build the web app ----
FROM node:26-alpine AS webbuild
WORKDIR /app/web
COPY web/package*.json ./
RUN npm install --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---- runtime ----
FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server ./server
COPY --from=webbuild /app/web/dist ./web/dist

# Drop root: run as the built-in `node` user and give it the data volume.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=60s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3000/api/me >/dev/null || exit 1

CMD ["node", "server/index.js"]
