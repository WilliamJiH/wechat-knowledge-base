FROM mcr.microsoft.com/playwright:v1.61.1-noble

WORKDIR /app

ENV NODE_ENV=production
ENV KNOWLEDGE_BASE_PATH=/data/knowledge_base

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY types ./types
COPY src ./src

RUN npm run build \
  && mkdir -p dist/src/web \
  && cp -r src/web/public dist/src/web/public \
  && npm prune --omit=dev

EXPOSE 3000

CMD ["node", "dist/src/index.js", "web", "-p", "3000"]
