import express from 'express';
import cors from 'cors';
import * as path from 'path';
import {
  initTaskManager,
  getTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  runTaskNow,
  crawlNow,
  getHistory,
  addHistoryRecord,
  updateHistoryRecord,
  clearHistory,
  shutdownTaskManager,
  crawlEvents,
  CrawlProgressEvent,
} from './tasks';
import { loadPrompts, savePrompt, resetPrompt } from '../agents/prompts';
import {
  getWechatPublishedArticles,
  listWechatSubscriptions,
  loadWechatSession,
  loginWechatPlatform,
  removeWechatSession,
  removeWechatSubscription,
  searchWechatBiz,
  upsertWechatSubscription,
} from '../wechat-platform';
import { processArticleWithReport } from '../scheduler';
import { config } from '../config';
import { initDB } from '../storage';
import { closeDB } from '../storage/db';
import { cleanupRuntimeArtifacts } from '../runtime/cleanup';
import * as fs from 'fs';
import { authStatus, changePassword, clearAuthSessions, login, logout, requireAuth } from './auth';
import { getLLMUsage } from '../usage/llm';
import { applyRuntimeSettings, getSettingsStatus, saveApiSettings, saveFeishuSettings } from '../config/settings';
import { resetLLMClient } from '../agents/llm';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const PORT = process.env.WEB_PORT ? parseInt(process.env.WEB_PORT) : 3000;
const WECHAT_QRCODE_PATH = path.join(config.knowledgeBasePath, 'wechat_qrcode.png');
let wechatLoginState: {
  running: boolean;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
} = { running: false, error: null, startedAt: null, finishedAt: null };

function getReportsDir(): string {
  return path.join(config.knowledgeBasePath, 'reports');
}

function listReportFiles() {
  const reportsDir = getReportsDir();
  if (!fs.existsSync(reportsDir)) return [];
  return fs.readdirSync(reportsDir)
    .filter((name) => name.toLowerCase().endsWith('.md'))
    .map((name) => {
      const filePath = path.join(reportsDir, name);
      const stat = fs.statSync(filePath);
      return { name, size: stat.size, updatedAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function createZip(files: { name: string; data: Buffer; mtime: Date }[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf-8');
    const checksum = crc32(file.data);
    const stamp = dosDateTime(file.mtime);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(file.data.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, file.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(file.data.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + file.data.length;
  }

  const centralOffset = offset;
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function removeKnowledgeBaseEntry(relativePath: string): void {
  const base = path.resolve(config.knowledgeBasePath);
  const target = path.resolve(base, relativePath);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error(`Refusing to delete outside knowledge base: ${relativePath}`);
  }
  fs.rmSync(target, { recursive: true, force: true });
}

function resetProjectData(): void {
  shutdownTaskManager();
  closeDB();
  cleanupRuntimeArtifacts();

  [
    'db',
    'embeddings',
    'raw',
    'markdown',
    'images',
    'evolution',
    'reports',
  ].forEach(removeKnowledgeBaseEntry);

  [
    'execution_history.json',
    'index.json',
    'scheduled_tasks.json',
    'wechat_platform_session.json',
    'wechat_qrcode.png',
    'wechat_subscriptions.json',
    'web_auth.json',
    'llm_usage.json',
    'app_settings.json',
    'agent_prompts.json',
  ].forEach(removeKnowledgeBaseEntry);

  clearAuthSessions();
  config.deepseek.apiKey = process.env.DEEPSEEK_API_KEY || '';
  config.embedding.apiKey = process.env.EMBEDDING_API_KEY || process.env.DEEPSEEK_API_KEY || '';
  config.embedding.baseUrl = process.env.EMBEDDING_BASE_URL || 'https://api.siliconflow.cn/v1';
  config.embedding.model = process.env.EMBEDDING_MODEL || 'BAAI/bge-m3';
  config.embedding.enabled = !!(process.env.EMBEDDING_API_KEY || process.env.EMBEDDING_BASE_URL);
  config.feishu.appId = process.env.FEISHU_APP_ID || '';
  config.feishu.appSecret = process.env.FEISHU_APP_SECRET || '';
  config.feishu.wikiSpaceId = process.env.FEISHU_WIKI_SPACE_ID || '';
  resetLLMClient();
}

function normalizeWechatLoginError(err: any): string {
  const message = err?.message || String(err);
  if (/timeout|timed out|Timeout/i.test(message)) return '登录超时';
  if (/qrcode|二维码/i.test(message)) return '二维码生成失败';
  if (/playwright/i.test(message)) return '浏览器自动化环境不可用';
  return '登录失败';
}

app.use(cors());
app.use(express.json());

// 静态文件
app.use(express.static(path.join(__dirname, 'public')));

// ===== API 路由 =====

app.get('/api/auth/status', authStatus);
app.post('/api/auth/login', login);
app.post('/api/auth/logout', logout);
app.post('/api/auth/change-password', changePassword);

app.use(requireAuth);

app.get('/api/settings', (_req, res) => {
  res.json(getSettingsStatus(config));
});

app.put('/api/settings/api', (req, res) => {
  saveApiSettings(req.body || {});
  applyRuntimeSettings(config);
  resetLLMClient();
  res.json({ success: true, settings: getSettingsStatus(config) });
});

app.put('/api/settings/feishu', (req, res) => {
  saveFeishuSettings(req.body || {});
  applyRuntimeSettings(config);
  res.json({ success: true, settings: getSettingsStatus(config) });
});

/** 获取所有定时任务 */
app.get('/api/tasks', (_req, res) => {
  const tasks = getTasks();
  res.json({ tasks });
});

/** 获取单个任务 */
app.get('/api/tasks/:id', (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  res.json({ task });
});

/** 创建定时任务 */
app.post('/api/tasks', (req, res) => {
  const { urls, intervalHours } = req.body;

  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: '请提供至少一个 URL' });
  }
  if (!intervalHours || intervalHours < 0.1) {
    return res.status(400).json({ error: '间隔时间最少 0.1 小时（6分钟）' });
  }

  const task = createTask(urls, intervalHours);
  res.status(201).json({ task });
});

/** 更新定时任务 */
app.put('/api/tasks/:id', (req, res) => {
  const { urls, intervalHours, enabled } = req.body;
  const task = updateTask(req.params.id, { urls, intervalHours, enabled });
  if (!task) return res.status(404).json({ error: '任务不存在' });
  res.json({ task });
});

/** 删除定时任务 */
app.delete('/api/tasks/:id', (req, res) => {
  const ok = deleteTask(req.params.id);
  if (!ok) return res.status(404).json({ error: '任务不存在' });
  res.json({ success: true });
});

/** 立即执行任务 */
app.post('/api/tasks/:id/run', (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: '任务不存在' });

  runTaskNow(req.params.id);
  res.json({ message: '任务已开始执行', taskId: task.id });
});

/** 立即爬取（一次性，不创建定时任务） */
app.post('/api/crawl', (req, res) => {
  const { urls } = req.body;

  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: '请提供至少一个 URL' });
  }

  const sessionId = crawlNow(urls);
  res.json({ message: `已开始爬取 ${urls.length} 个链接`, sessionId, urls });
});

/** SSE 进度流 */
app.get('/api/crawl/progress/:sessionId', (req, res) => {
  const { sessionId } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  send({ type: 'connected', sessionId });

  const handler = (event: CrawlProgressEvent) => {
    if (event.sessionId !== sessionId) return;
    send({ type: 'progress', ...event });
    if (event.step === 'done' || event.step === 'error') {
      crawlEvents.off('progress', handler);
      res.end();
    }
  };

  crawlEvents.on('progress', handler);

  // 客户端断开时清理
  req.on('close', () => {
    crawlEvents.off('progress', handler);
  });
});

// ===== Prompt 管理 API =====

/** 获取所有 Agent Prompt */
app.get('/api/wechat/status', (_req, res) => {
  const session = loadWechatSession();
  const qrcodeExists = fs.existsSync(WECHAT_QRCODE_PATH) && fs.statSync(WECHAT_QRCODE_PATH).size > 0;
  res.json({
    loggedIn: !!session,
    session: session
      ? {
          token: session.token,
          updatedAt: session.updatedAt,
          expiresAt: session.expiresAt,
          account: session.account,
        }
      : null,
    qrcodeExists,
    login: wechatLoginState,
  });
});

app.post('/api/wechat/login', (_req, res) => {
  if (wechatLoginState.running) {
    res.json({ started: false, login: wechatLoginState });
    return;
  }

  try {
    removeWechatSession();
    if (fs.existsSync(WECHAT_QRCODE_PATH)) fs.unlinkSync(WECHAT_QRCODE_PATH);
  } catch {}

  wechatLoginState = {
    running: true,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };

  loginWechatPlatform({ qrcodePath: WECHAT_QRCODE_PATH })
    .then(() => {
      wechatLoginState = { ...wechatLoginState, running: false, finishedAt: new Date().toISOString() };
    })
    .catch((err: any) => {
      wechatLoginState = {
        ...wechatLoginState,
        running: false,
        error: normalizeWechatLoginError(err),
        finishedAt: new Date().toISOString(),
      };
    });

  res.json({ started: true, login: wechatLoginState });
});

app.get('/api/wechat/qrcode', (_req, res) => {
  if (!fs.existsSync(WECHAT_QRCODE_PATH) || fs.statSync(WECHAT_QRCODE_PATH).size === 0) {
    res.status(404).json({ error: '二维码尚未生成' });
    return;
  }
  res.sendFile(WECHAT_QRCODE_PATH);
});

app.get('/api/wechat/search', async (req, res) => {
  try {
    const keyword = String(req.query.q || '').trim();
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 5;
    if (!keyword) return res.status(400).json({ error: 'q 必填' });
    const results = await searchWechatBiz(keyword, limit);
    res.json({ results });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

app.get('/api/wechat/subscriptions', (_req, res) => {
  res.json({ subscriptions: listWechatSubscriptions() });
});

app.post('/api/wechat/subscriptions', (req, res) => {
  try {
    const { fakeId, nickname, alias, roundHeadImg, serviceType, signature } = req.body;
    if (!fakeId || !nickname) return res.status(400).json({ error: 'fakeId 和 nickname 必填' });
    const subscription = upsertWechatSubscription({ fakeId, nickname, alias, roundHeadImg, serviceType, signature });
    res.status(201).json({ subscription });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

app.delete('/api/wechat/subscriptions/:fakeId', (req, res) => {
  const ok = removeWechatSubscription(req.params.fakeId);
  if (!ok) return res.status(404).json({ error: '订阅不存在' });
  res.json({ success: true });
});

app.post('/api/wechat/sync', async (req, res) => {
  try {
    const { fakeId, count = 5, urlsOnly = false } = req.body;
    const subscriptions = listWechatSubscriptions().filter((item) => !fakeId || item.fakeId === fakeId);
    const synced: any[] = [];

    if (!urlsOnly) {
      await initDB();
    }

    for (const subscription of subscriptions) {
      const articles = await getWechatPublishedArticles(subscription.fakeId, Number(count));
      for (const article of articles) {
        const item: any = { subscription: subscription.nickname, title: article.title, url: article.link };
        if (!urlsOnly) {
          const recordId = uuidv4();
          addHistoryRecord({
            id: recordId,
            taskId: `wechat-sync-${subscription.fakeId}`,
            url: article.link,
            status: 'running',
            startedAt: new Date().toISOString(),
            source: subscription.nickname,
            title: article.title,
          });
          try {
            const result = await processArticleWithReport(article.link);
            item.docId = result.docId;
            item.reportPath = result.reportPath;
            updateHistoryRecord(recordId, {
              status: 'success',
              finishedAt: new Date().toISOString(),
              docId: result.docId,
              reportPath: result.reportPath,
            });
          } catch (err: any) {
            item.error = err?.message || String(err);
            updateHistoryRecord(recordId, {
              status: 'failed',
              error: item.error,
              finishedAt: new Date().toISOString(),
            });
          }
        }
        synced.push(item);
      }
    }

    res.json({ synced });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

app.get('/api/prompts', (_req, res) => {
  res.json({ prompts: loadPrompts() });
});

/** 保存单个 Agent Prompt */
app.put('/api/prompts/:id', (req, res) => {
  const { systemPrompt } = req.body;
  if (!systemPrompt || typeof systemPrompt !== 'string') {
    return res.status(400).json({ error: 'systemPrompt 必填' });
  }
  const ok = savePrompt(req.params.id, systemPrompt);
  if (!ok) return res.status(404).json({ error: 'Agent 不存在' });
  res.json({ success: true, prompts: loadPrompts() });
});

/** 还原 Prompt 为默认值 */
app.post('/api/prompts/:id/reset', (req, res) => {
  const ok = resetPrompt(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Agent 不存在' });
  res.json({ success: true, prompts: loadPrompts() });
});

/** 获取执行历史 */
app.get('/api/history', (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
  const history = getHistory(limit);
  res.json({ history });
});

app.delete('/api/history', (_req, res) => {
  clearHistory();
  res.json({ success: true });
});

app.post('/api/reset', (_req, res) => {
  try {
    resetProjectData();
    res.setHeader('Set-Cookie', 'wkb_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

app.get('/api/reports', (_req, res) => {
  res.json({ reports: listReportFiles() });
});

app.get('/api/reports/download-all', (_req, res) => {
  const reportsDir = getReportsDir();
  const reports = listReportFiles();
  if (!reports.length) {
    res.status(404).json({ error: '暂无报告' });
    return;
  }
  const files = reports.map((report) => {
    const filePath = path.join(reportsDir, report.name);
    return {
      name: report.name,
      data: fs.readFileSync(filePath),
      mtime: fs.statSync(filePath).mtime,
    };
  });
  const zip = createZip(files);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="analysis-reports.zip"');
  res.send(zip);
});

app.get('/api/reports/download/:name', (req, res) => {
  const reportsDir = getReportsDir();
  const name = path.basename(req.params.name);
  const filePath = path.join(reportsDir, name);
  if (!fs.existsSync(filePath) || path.dirname(filePath) !== reportsDir) {
    res.status(404).json({ error: '报告不存在' });
    return;
  }
  res.download(filePath, name);
});

/** 健康检查 */
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    activeTasks: getTasks().filter((t) => t.enabled).length,
  });
});

app.get('/api/usage/llm', (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
  res.json(getLLMUsage(limit));
});

// SPA fallback（Express 5 语法）
app.use((_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/** 启动 Web 服务器 */
export async function startWebServer(): Promise<void> {
  await initTaskManager();

  const server = app.listen(PORT, () => {
    console.log(`\n[Web] 服务器已启动: http://localhost:${PORT}`);
    console.log(`[Web] API 文档: http://localhost:${PORT}/api/health\n`);
  });

  // 优雅退出
  const cleanup = () => {
    console.log('\n[Web] 正在关闭...');
    shutdownTaskManager();
    cleanupRuntimeArtifacts();
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}
