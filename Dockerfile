FROM node:24-bookworm-slim AS web-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/package-lock.json ./client/
RUN npm ci && npm --prefix client ci
COPY client ./client
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=8787 DATA_DIR=/app/data COOKIE_SECURE=true
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force && mkdir -p /app/data && chown -R node:node /app
COPY --chown=node:node server ./server
COPY --from=web-build --chown=node:node /app/client/dist ./client/dist
USER node
EXPOSE 8787
VOLUME /app/data
CMD ["node", "server/index.js"]
