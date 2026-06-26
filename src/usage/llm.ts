import * as fs from 'fs';
import * as path from 'path';
import { AsyncLocalStorage } from 'async_hooks';
import { config } from '../config';

export interface LLMUsageRecord {
  id: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  createdAt: string;
  docId?: string;
  title?: string;
  agents?: string[];
}

const USAGE_FILE = path.join(config.knowledgeBasePath, 'llm_usage.json');
const usageRoundStore = new AsyncLocalStorage<{
  docId: string;
  title: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requests: number;
  models: Set<string>;
}>();

function readRecords(): LLMUsageRecord[] {
  if (!fs.existsSync(USAGE_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(USAGE_FILE, 'utf-8')) as LLMUsageRecord[];
  } catch {
    return [];
  }
}

function writeRecords(records: LLMUsageRecord[]): void {
  fs.mkdirSync(path.dirname(USAGE_FILE), { recursive: true });
  fs.writeFileSync(USAGE_FILE, JSON.stringify(records.slice(0, 1000), null, 2), 'utf-8');
}

export function recordLLMUsage(input: Omit<LLMUsageRecord, 'id' | 'createdAt'>): void {
  const round = usageRoundStore.getStore();
  if (round) {
    round.promptTokens += input.promptTokens;
    round.completionTokens += input.completionTokens;
    round.totalTokens += input.totalTokens;
    round.requests += 1;
    round.models.add(input.model);
    return;
  }

  const records = readRecords();
  records.unshift({
    ...input,
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    createdAt: new Date().toISOString(),
  });
  writeRecords(records);
}

export async function withLLMUsageRound<T>(docId: string, title: string, fn: () => Promise<T>): Promise<T> {
  const round = {
    docId,
    title,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    requests: 0,
    models: new Set<string>(),
  };

  const result = await usageRoundStore.run(round, fn);

  if (round.requests > 0) {
    const records = readRecords();
    records.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      model: Array.from(round.models).join(', ') || 'unknown',
      promptTokens: round.promptTokens,
      completionTokens: round.completionTokens,
      totalTokens: round.totalTokens,
      createdAt: new Date().toISOString(),
      docId,
      title,
      agents: ['Analyst', 'Critic', 'Strategist'],
    });
    writeRecords(records);
  }

  return result;
}

export function getLLMUsage(limit = 100) {
  const records = readRecords();
  const totals = records.reduce(
    (acc, record) => {
      acc.promptTokens += record.promptTokens;
      acc.completionTokens += record.completionTokens;
      acc.totalTokens += record.totalTokens;
      acc.requests += 1;
      return acc;
    },
    { promptTokens: 0, completionTokens: 0, totalTokens: 0, requests: 0 }
  );
  return { totals, records: records.slice(0, limit) };
}
