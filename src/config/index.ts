import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

export const config = {
  // DeepSeek API
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    embeddingModel: process.env.DEEPSEEK_EMBEDDING_MODEL || 'deepseek-chat',
  },

  // 知识库路径
  knowledgeBasePath: path.resolve(process.env.KNOWLEDGE_BASE_PATH || './knowledge_base'),

  // 数据库
  dbPath: path.resolve(process.env.DB_PATH || './knowledge_base/db/knowledge.db'),

  // 飞书
  feishu: {
    appId: process.env.FEISHU_APP_ID || '',
    appSecret: process.env.FEISHU_APP_SECRET || '',
    wikiSpaceId: process.env.FEISHU_WIKI_SPACE_ID || '',
  },

  // 定时任务
  cronSchedule: process.env.CRON_SCHEDULE || '0 8 * * *',

  // 日志
  logLevel: process.env.LOG_LEVEL || 'info',

  // 子目录路径
  get paths() {
    const base = this.knowledgeBasePath;
    return {
      raw: path.join(base, 'raw'),
      markdown: path.join(base, 'markdown'),
      images: path.join(base, 'images'),
      embeddings: path.join(base, 'embeddings'),
      db: path.join(base, 'db'),
      evolution: path.join(base, 'evolution'),
      indexFile: path.join(base, 'index.json'),
    };
  },
};

// 确保目录存在
import * as fs from 'fs';

export function ensureDirectories(): void {
  const dirs = [
    config.paths.raw,
    config.paths.markdown,
    config.paths.images,
    config.paths.embeddings,
    config.paths.db,
    config.paths.evolution,
  ];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
