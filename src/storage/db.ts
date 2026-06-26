import initSqlJs, { Database } from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';
import { config, ensureDirectories } from '../config';

let db: Database | null = null;

/** 初始化数据库 */
export async function initDB(): Promise<Database> {
  if (db) return db;

  ensureDirectories();
  const SQL = await initSqlJs();
  const dbDir = path.dirname(config.dbPath);
  fs.mkdirSync(dbDir, { recursive: true });

  // 如果数据库文件已存在，加载它
  if (fs.existsSync(config.dbPath)) {
    const buffer = fs.readFileSync(config.dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // 建表
  db.run(`
    CREATE TABLE IF NOT EXISTS articles (
      doc_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      url TEXT,
      source TEXT,
      markdown_path TEXT,
      feishu_doc_id TEXT,
      feishu_report_doc_id TEXT,
      status TEXT DEFAULT 'crawled',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  const articleColumns = db.exec(`PRAGMA table_info(articles)`)[0]?.values || [];
  if (!articleColumns.some((column: any[]) => column[1] === 'feishu_report_doc_id')) {
    db.run(`ALTER TABLE articles ADD COLUMN feishu_report_doc_id TEXT`);
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS claims (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      claim TEXT NOT NULL,
      topic TEXT,
      version INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (doc_id) REFERENCES articles(doc_id)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS evolution_chains (
      id TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      claim_text TEXT NOT NULL,
      change_type TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (claim_id) REFERENCES claims(id)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS image_assets (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      original_url TEXT,
      local_path TEXT,
      FOREIGN KEY (doc_id) REFERENCES articles(doc_id)
    );
  `);

  saveDB();
  return db;
}

/** 持久化数据库到磁盘 */
export function saveDB(): void {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(config.dbPath, buffer);
}

/** 获取数据库实例 */
export function getDB(): Database {
  if (!db) throw new Error('Database not initialized. Call initDB() first.');
  return db;
}

/** 关闭数据库 */
export function closeDB(): void {
  if (db) {
    saveDB();
    db.close();
    db = null;
  }
}

// ---- Articles CRUD ----

export interface Article {
  doc_id: string;
  title: string;
  url: string | null;
  source: string | null;
  markdown_path: string | null;
  feishu_doc_id: string | null;
  feishu_report_doc_id: string | null;
  status: string;
  created_at: string;
}

export function insertArticle(article: Omit<Article, 'created_at' | 'status'>): void {
  const d = getDB();
  d.run(
    `INSERT INTO articles (doc_id, title, url, source, markdown_path, feishu_doc_id) VALUES (?, ?, ?, ?, ?, ?)`,
    [article.doc_id, article.title, article.url, article.source, article.markdown_path, article.feishu_doc_id]
  );
  saveDB();
}

export function getArticle(docId: string): Article | undefined {
  const d = getDB();
  const result = d.exec(`SELECT * FROM articles WHERE doc_id = ?`, [docId]);
  if (result.length === 0 || result[0].values.length === 0) return undefined;
  const row = result[0].values[0];
  const cols = result[0].columns;
  const obj: Record<string, any> = {};
  cols.forEach((col: string, i: number) => (obj[col] = row[i]));
  return obj as Article;
}

export function getAllArticles(): Article[] {
  const d = getDB();
  const result = d.exec(`SELECT * FROM articles ORDER BY created_at DESC`);
  if (result.length === 0) return [];
  return result[0].values.map((row: any[]) => {
    const obj: Record<string, any> = {};
    result[0].columns.forEach((col: string, i: number) => (obj[col] = row[i]));
    return obj as Article;
  });
}

export function updateArticleStatus(docId: string, status: string): void {
  const d = getDB();
  d.run(`UPDATE articles SET status = ? WHERE doc_id = ?`, [status, docId]);
  saveDB();
}

export function updateFeishuDocId(docId: string, feishuDocId: string): void {
  const d = getDB();
  d.run(`UPDATE articles SET feishu_doc_id = ? WHERE doc_id = ?`, [feishuDocId, docId]);
  saveDB();
}

export function updateFeishuReportDocId(docId: string, feishuDocId: string): void {
  const d = getDB();
  d.run(`UPDATE articles SET feishu_report_doc_id = ? WHERE doc_id = ?`, [feishuDocId, docId]);
  saveDB();
}

// ---- Claims CRUD ----

export interface Claim {
  id: string;
  doc_id: string;
  claim: string;
  topic: string | null;
  version: number;
  created_at: string;
}

export function insertClaim(claim: Omit<Claim, 'created_at'>): void {
  const d = getDB();
  d.run(
    `INSERT INTO claims (id, doc_id, claim, topic, version) VALUES (?, ?, ?, ?, ?)`,
    [claim.id, claim.doc_id, claim.claim, claim.topic, claim.version]
  );
  saveDB();
}

export function getClaimsByDocId(docId: string): Claim[] {
  const d = getDB();
  const result = d.exec(`SELECT * FROM claims WHERE doc_id = ?`, [docId]);
  if (result.length === 0) return [];
  return result[0].values.map((row: any[]) => {
    const obj: Record<string, any> = {};
    result[0].columns.forEach((col: string, i: number) => (obj[col] = row[i]));
    return obj as Claim;
  });
}

export function getAllClaims(): Claim[] {
  const d = getDB();
  const result = d.exec(`SELECT * FROM claims ORDER BY created_at DESC`);
  if (result.length === 0) return [];
  return result[0].values.map((row: any[]) => {
    const obj: Record<string, any> = {};
    result[0].columns.forEach((col: string, i: number) => (obj[col] = row[i]));
    return obj as Claim;
  });
}

// ---- Evolution Chains CRUD ----

export interface EvolutionChain {
  id: string;
  claim_id: string;
  version: number;
  claim_text: string;
  change_type: string;
  created_at: string;
}

export function insertEvolutionChain(chain: Omit<EvolutionChain, 'created_at'>): void {
  const d = getDB();
  d.run(
    `INSERT INTO evolution_chains (id, claim_id, version, claim_text, change_type) VALUES (?, ?, ?, ?, ?)`,
    [chain.id, chain.claim_id, chain.version, chain.claim_text, chain.change_type]
  );
  saveDB();
}

export function getEvolutionChainsByClaimId(claimId: string): EvolutionChain[] {
  const d = getDB();
  const result = d.exec(`SELECT * FROM evolution_chains WHERE claim_id = ? ORDER BY version ASC`, [claimId]);
  if (result.length === 0) return [];
  return result[0].values.map((row: any[]) => {
    const obj: Record<string, any> = {};
    result[0].columns.forEach((col: string, i: number) => (obj[col] = row[i]));
    return obj as EvolutionChain;
  });
}

// ---- Image Assets CRUD ----

export function insertImageAsset(id: string, docId: string, originalUrl: string, localPath: string): void {
  const d = getDB();
  d.run(
    `INSERT INTO image_assets (id, doc_id, original_url, local_path) VALUES (?, ?, ?, ?)`,
    [id, docId, originalUrl, localPath]
  );
  saveDB();
}

export function getImageAssetsByDocId(docId: string): { id: string; original_url: string; local_path: string }[] {
  const d = getDB();
  const result = d.exec(`SELECT id, original_url, local_path FROM image_assets WHERE doc_id = ?`, [docId]);
  if (result.length === 0) return [];
  return result[0].values.map((row: any[]) => ({
    id: row[0] as string,
    original_url: row[1] as string,
    local_path: row[2] as string,
  }));
}
