FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY test ./test
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd --system --gid 10001 authbff && useradd --system --uid 10001 --gid authbff --home-dir /nonexistent authbff
COPY --from=build --chown=authbff:authbff /app/node_modules ./node_modules
COPY --from=build --chown=authbff:authbff /app/dist ./dist
COPY --chown=authbff:authbff package.json ./package.json
COPY --chown=authbff:authbff migrations ./migrations
USER authbff
EXPOSE 8323
CMD ["node", "dist/src/server.js"]
