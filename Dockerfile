# ===== build 阶段 =====
FROM node:20-bookworm AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# 这里 tsc 才存在
RUN npm run build \
 && mkdir -p dist/src/web \
 && cp -r src/web/public dist/src/web/public


# ===== runtime 阶段 =====
FROM mcr.microsoft.com/playwright:v1.61.1-noble

WORKDIR /app

ENV NODE_ENV=production
ENV KNOWLEDGE_BASE_PATH=/knowledge_base

RUN mkdir -p /knowledge_base

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules

CMD ["node", "dist/src/index.js", "web", "-p", "3000"]