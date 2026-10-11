FROM node:25-alpine AS deps
WORKDIR /app


COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN npm run build

FROM node:25-alpine AS runner
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/dist ./dist
COPY --from=deps /app/package.json ./package.json

EXPOSE 3000
CMD ["node", "/app/dist/src/main.js"]
