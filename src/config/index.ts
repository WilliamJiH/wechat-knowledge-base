import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { applyRuntimeSettings } from './settings';

dotenv.config();

export const config = {
  // DeepSeek API
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  },

  // Embedding 服务（默认不启用，需独立配置 API Key）
  // 推荐: 硬基流动 https://siliconflow.cn 或 OpenAI text-embedding-3-small
  embedding: {
    apiKey: process.env.EMBEDDING_API_KEY || process.env.DEEPSEEK_API_KEY || '',
    baseUrl: process.env.EMBEDDING_BASE_URL || 'https://api.siliconflow.cn/v1',
    model: process.env.EMBEDDING_MODEL || 'BAAI/bge-m3',
    enabled: !!(process.env.EMBEDDING_API_KEY || process.env.EMBEDDING_BASE_URL),
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
    wikiParentNodeToken: process.env.FEISHU_WIKI_PARENT_NODE_TOKEN || '',
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
applyRuntimeSettings(config);

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
