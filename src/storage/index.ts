export { initDB, closeDB, saveDB, getDB } from './db';
export type { Article, Claim, EvolutionChain } from './db';
export {
  insertArticle,
  getArticle,
  getAllArticles,
  updateArticleStatus,
  updateFeishuDocId,
  updateFeishuReportDocId,
  insertClaim,
  getClaimsByDocId,
  getAllClaims,
  insertEvolutionChain,
  getEvolutionChainsByClaimId,
  insertImageAsset,
  getImageAssetsByDocId,
} from './db';

import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';

/** index.json 索引条目 */
export interface IndexEntry {
  doc_id: string;
  title: string;
  markdown_path: string;
  image_assets: string[];
  created_at: string;
}

/** 读取 index.json */
export function readIndex(): IndexEntry[] {
  const filePath = config.paths.indexFile;
  if (!fs.existsSync(filePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return [];
  }
}

/** 写入 index.json */
export function writeIndex(entries: IndexEntry[]): void {
  const filePath = config.paths.indexFile;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(entries, null, 2), 'utf-8');
}

/** 添加索引条目 */
export function addIndexEntry(entry: IndexEntry): void {
  const entries = readIndex();
  // 避免重复
  const existing = entries.findIndex((e) => e.doc_id === entry.doc_id);
  if (existing >= 0) {
    entries[existing] = entry;
  } else {
    entries.push(entry);
  }
  writeIndex(entries);
}
