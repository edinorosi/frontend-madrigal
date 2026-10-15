## Стадия сборки: Next.js статический экспорт в out/
FROM node:20-alpine AS build
WORKDIR /app

# npm ci строго по package-lock.json — воспроизводимая установка.
COPY package.json package-lock.json ./
RUN npm ci

# Исходники; next.config.ts с output: 'export' остаётся как есть.
COPY . .

# NEXT_PUBLIC_API_URL встраивается в бандл на этапе сборки (static export).
# Запросы идут из браузера пользователя, поэтому localhost:8080 —
# опубликованный порт бэка на хосте, не имя сервиса docker-compose.
ARG NEXT_PUBLIC_API_URL=http://localhost:8080
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN npm run build

## Стадия рантайма: раздача статики out/ через serve
FROM node:20-alpine
WORKDIR /app

# serve — глобально в образ, не в package.json проекта.
RUN npm install -g serve@14

COPY --from=build /app/out ./out

EXPOSE 3000

# -s: SPA-fallback на index.html; 0.0.0.0 — принимать соединения извне контейнера.
CMD ["serve", "-s", "out", "-l", "tcp://0.0.0.0:3000"]
