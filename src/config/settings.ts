import * as fs from 'fs';
import * as path from 'path';

export type EmbeddingProvider = 'openai' | 'siliconflow';

export interface RuntimeSettings {
  api?: {
    deepseekApiKey?: string;
    deepseekBaseUrl?: string;
    embeddingApiKey?: string;
    embeddingProvider?: EmbeddingProvider;
    embeddingBaseUrl?: string;
  };
  feishu?: {
    appId?: string;
    appSecret?: string;
    wikiSpaceId?: string;
    wikiParentNodeToken?: string;
  };
}

const knowledgeBasePath = path.resolve(process.env.KNOWLEDGE_BASE_PATH || './knowledge_base');
const settingsPath = path.join(knowledgeBasePath, 'app_settings.json');

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function cleanProvider(value: unknown): EmbeddingProvider | undefined {
  if (value === 'openai' || value === 'siliconflow') return value;
  if (value === 'OPENAI') return 'openai';
  return undefined;
}

function mergeDefined<T extends Record<string, any>>(target: T, patch: Record<string, unknown>): T {
  const next = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    const cleaned = key === 'embeddingProvider' ? cleanProvider(value) : cleanString(value);
    if (cleaned !== undefined) (next as any)[key] = cleaned;
  }
  return next;
}

export function loadRuntimeSettings(): RuntimeSettings {
  if (!fs.existsSync(settingsPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as RuntimeSettings;
  } catch {
    return {};
  }
}

export function saveApiSettings(input: Record<string, unknown>): RuntimeSettings {
  const current = loadRuntimeSettings();
  const api = mergeDefined(current.api || {}, {
    deepseekApiKey: input.deepseekApiKey,
    deepseekBaseUrl: input.deepseekBaseUrl,
    embeddingApiKey: input.embeddingApiKey,
    embeddingProvider: input.embeddingProvider,
    embeddingBaseUrl: input.embeddingBaseUrl,
  });
  return writeRuntimeSettings({ ...current, api });
}

export function saveFeishuSettings(input: Record<string, unknown>): RuntimeSettings {
  const current = loadRuntimeSettings();
  const feishu = mergeDefined(current.feishu || {}, {
    appId: input.appId,
    appSecret: input.appSecret,
    wikiSpaceId: input.wikiSpaceId,
    wikiParentNodeToken: input.wikiParentNodeToken,
  });
  return writeRuntimeSettings({ ...current, feishu });
}

function writeRuntimeSettings(settings: RuntimeSettings): RuntimeSettings {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  return settings;
}

export function defaultEmbeddingBaseUrl(provider: EmbeddingProvider): string {
  return provider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.siliconflow.cn/v1';
}

export function defaultEmbeddingModel(provider: EmbeddingProvider): string {
  return provider === 'openai' ? 'text-embedding-3-small' : 'BAAI/bge-m3';
}

export function inferEmbeddingProvider(baseUrl: string): EmbeddingProvider {
  return /openai/i.test(baseUrl) ? 'openai' : 'siliconflow';
}

export function applyRuntimeSettings(config: any): void {
  const runtime = loadRuntimeSettings();
  const provider = runtime.api?.embeddingProvider || inferEmbeddingProvider(config.embedding.baseUrl);

  if (runtime.api?.deepseekApiKey) config.deepseek.apiKey = runtime.api.deepseekApiKey;
  if (runtime.api?.deepseekBaseUrl) config.deepseek.baseUrl = runtime.api.deepseekBaseUrl;
  if (runtime.api?.embeddingApiKey) config.embedding.apiKey = runtime.api.embeddingApiKey;
  if (runtime.api?.embeddingProvider) config.embedding.model = defaultEmbeddingModel(provider);
  if (runtime.api?.embeddingBaseUrl) {
    config.embedding.baseUrl = runtime.api.embeddingBaseUrl;
  } else if (runtime.api?.embeddingProvider) {
    config.embedding.baseUrl = defaultEmbeddingBaseUrl(provider);
  }
  config.embedding.enabled = !!(config.embedding.apiKey || config.embedding.baseUrl);

  if (runtime.feishu?.appId) config.feishu.appId = runtime.feishu.appId;
  if (runtime.feishu?.appSecret) config.feishu.appSecret = runtime.feishu.appSecret;
  if (runtime.feishu?.wikiSpaceId) config.feishu.wikiSpaceId = runtime.feishu.wikiSpaceId;
  if (runtime.feishu?.wikiParentNodeToken) config.feishu.wikiParentNodeToken = runtime.feishu.wikiParentNodeToken;
}

export function getSettingsStatus(config: any) {
  const runtime = loadRuntimeSettings();
  const provider = runtime.api?.embeddingProvider || inferEmbeddingProvider(config.embedding.baseUrl);
  return {
    api: {
      deepseekApiKeyConfigured: !!config.deepseek.apiKey,
      deepseekBaseUrl: runtime.api?.deepseekBaseUrl || '',
      deepseekBaseUrlEffective: config.deepseek.baseUrl,
      embeddingApiKeyConfigured: !!config.embedding.apiKey,
      embeddingProvider: provider,
      embeddingBaseUrl: runtime.api?.embeddingBaseUrl || '',
      embeddingBaseUrlEffective: config.embedding.baseUrl,
    },
    feishu: {
      appIdConfigured: !!config.feishu.appId,
      appSecretConfigured: !!config.feishu.appSecret,
      wikiSpaceIdConfigured: !!config.feishu.wikiSpaceId,
      wikiParentNodeTokenConfigured: !!config.feishu.wikiParentNodeToken,
    },
  };
}
