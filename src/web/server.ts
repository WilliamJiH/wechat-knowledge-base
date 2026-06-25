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
  shutdownTaskManager,
} from './tasks';

const app = express();
const PORT = process.env.WEB_PORT ? parseInt(process.env.WEB_PORT) : 3000;

app.use(cors());
app.use(express.json());

// 静态文件
app.use(express.static(path.join(__dirname, 'public')));

// ===== API 路由 =====

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

  crawlNow(urls);
  res.json({ message: `已开始爬取 ${urls.length} 个链接`, urls });
});

/** 获取执行历史 */
app.get('/api/history', (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
  const history = getHistory(limit);
  res.json({ history });
});

/** 健康检查 */
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    activeTasks: getTasks().filter((t) => t.enabled).length,
  });
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
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}
