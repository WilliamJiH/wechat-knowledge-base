# syntax=docker/dockerfile:1

# ======================
# Builder
# ======================
FROM node:20-bookworm AS builder

WORKDIR /app

# 不能在这里设置 NODE_ENV=production，否则 npm ci 会跳过 devDependencies，
# typescript/tsc 就不会安装。
COPY package*.json ./
RUN npm ci --include=dev

COPY tsconfig.json ./
COPY types ./types
COPY src ./src

RUN npm run build \
  && mkdir -p dist/src/web \
  && cp -r src/web/public dist/src/web/public \
  && npm prune --omit=dev


# ======================
# Runtime
# ======================
FROM mcr.microsoft.com/playwright:v1.61.1-noble

WORKDIR /app

ENV NODE_ENV=production
ENV KNOWLEDGE_BASE_PATH=/data/knowledge_base
ENV DB_PATH=/data/knowledge_base/db/knowledge.db

RUN mkdir -p /data/knowledge_base/db

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/src/index.js", "web", "-p", "3000"]