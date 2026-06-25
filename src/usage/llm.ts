import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';

export interface LLMUsageRecord {
  id: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  createdAt: string;
}

const USAGE_FILE = path.join(config.knowledgeBasePath, 'llm_usage.json');

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
  const records = readRecords();
  records.unshift({
    ...input,
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    createdAt: new Date().toISOString(),
  });
  writeRecords(records);
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
