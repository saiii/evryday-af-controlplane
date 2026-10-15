FROM node:25-alpine AS deps
WORKDIR /app


COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN npm run build

# Only the packages the server needs at run time (express and yaml), so the
# image does not ship the build tools and the page libraries.
FROM node:25-alpine AS prod-deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:25-alpine AS runner
WORKDIR /app
ENV AF_DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=deps /app/dist ./dist
COPY --from=deps /app/package.json ./package.json

USER node
EXPOSE 3000
CMD ["node", "/app/dist/src/main.js"]
