import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { processArticleWithReport } from '../scheduler';
import { initDB, closeDB } from '../storage/db';

/** 爬取进度事件发射器（用于 SSE） */
export const crawlEvents = new EventEmitter();

/** 进度事件类型 */
export interface CrawlProgressEvent {
  sessionId: string;
  url: string;
  step: 'crawl' | 'parse' | 'index' | 'analyst' | 'critic' | 'strategist' | 'evolve' | 'done' | 'error';
  message: string;
  docId?: string;
  reportPath?: string;
  error?: string;
}

/** 定时任务配置 */
export interface ScheduledTask {
  id: string;
  urls: string[];
  intervalHours: number;
  enabled: boolean;
  createdAt: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

/** 执行历史记录 */
export interface ExecutionRecord {
  id: string;
  taskId: string;
  url: string;
  status: 'running' | 'success' | 'failed';
  error?: string;
  startedAt: string;
  finishedAt?: string;
  docId?: string;
  reportPath?: string;
  source?: string;
  title?: string;
}

/** 任务配置文件路径 */
const TASKS_FILE = path.join(config.knowledgeBasePath, 'scheduled_tasks.json');
const HISTORY_FILE = path.join(config.knowledgeBasePath, 'execution_history.json');

/** 内存中的定时器 */
const activeTimers: Map<string, NodeJS.Timeout> = new Map();

// ===== 持久化操作 =====

function loadTasks(): ScheduledTask[] {
  if (!fs.existsSync(TASKS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveTasks(tasks: ScheduledTask[]): void {
  fs.mkdirSync(path.dirname(TASKS_FILE), { recursive: true });
  fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2), 'utf-8');
}

function loadHistory(): ExecutionRecord[] {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveHistory(history: ExecutionRecord[]): void {
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
}

export function addHistoryRecord(record: ExecutionRecord): void {
  const history = loadHistory();
  history.unshift(record);
  // 只保留最近 200 条记录
  if (history.length > 200) history.length = 200;
  saveHistory(history);
}

export function updateHistoryRecord(id: string, updates: Partial<ExecutionRecord>): void {
  const history = loadHistory();
  const idx = history.findIndex((h) => h.id === id);
  if (idx >= 0) {
    history[idx] = { ...history[idx], ...updates };
    saveHistory(history);
  }
}

// ===== 任务执行 =====

async function executeTask(task: ScheduledTask): Promise<void> {
  console.log(`[TaskManager] 开始执行任务 ${task.id}，共 ${task.urls.length} 个链接`);

  await initDB();

  for (const url of task.urls) {
    const recordId = uuidv4();
    const record: ExecutionRecord = {
      id: recordId,
      taskId: task.id,
      url,
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    addHistoryRecord(record);

    try {
      const result = await processArticleWithReport(url);
      updateHistoryRecord(recordId, {
        status: 'success',
        finishedAt: new Date().toISOString(),
        docId: result.docId,
        reportPath: result.reportPath,
      });
      console.log(`[TaskManager] 成功: ${url} → ${result.docId}`);
    } catch (err: any) {
      updateHistoryRecord(recordId, {
        status: 'failed',
        error: err?.message || String(err),
        finishedAt: new Date().toISOString(),
      });
      console.error(`[TaskManager] 失败: ${url}`, err?.message);
    }
  }

  // 更新任务的 lastRunAt / nextRunAt
  const tasks = loadTasks();
  const idx = tasks.findIndex((t) => t.id === task.id);
  if (idx >= 0) {
    tasks[idx].lastRunAt = new Date().toISOString();
    if (tasks[idx].enabled) {
      const next = new Date();
      next.setHours(next.getHours() + tasks[idx].intervalHours);
      tasks[idx].nextRunAt = next.toISOString();
    }
    saveTasks(tasks);
  }
}

/** 带进度事件的执行（用于 SSE 场景） */
async function executeTaskWithProgress(task: ScheduledTask, sessionId: string): Promise<void> {
  const emit = (
    url: string,
    step: CrawlProgressEvent['step'],
    message: string,
    extra?: Partial<CrawlProgressEvent>
  ) => {
    const event: CrawlProgressEvent = { sessionId, url, step, message, ...extra };
    crawlEvents.emit('progress', event);
  };

  await initDB();

  for (const url of task.urls) {
    const recordId = uuidv4();
    const record: ExecutionRecord = {
      id: recordId,
      taskId: task.id,
      url,
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    addHistoryRecord(record);

    try {
      emit(url, 'crawl', '正在爬取文章...');
      const { crawlWechatArticle } = await import('../crawler');
      const { parseAndSave } = await import('../parser');
      const { indexArticle } = await import('../embedding');
      const { runAgentPipeline } = await import('../agents');
      const { generateEvolution } = await import('../evolution');
      const { appendEvolutionToFeishuReport, formatFeishuError, isFeishuConfigured, syncAnalysisReport } = await import('../feishu');
      const fsModule = await import('fs');

      const crawlResult = await crawlWechatArticle(url);

      emit(url, 'parse', `正在解析转换：${crawlResult.title}`);
      const mdPath = await parseAndSave(crawlResult);
      const markdown = fsModule.readFileSync(mdPath, 'utf-8');

      emit(url, 'index', '正在向量化索引...');
      await indexArticle(crawlResult.doc_id, markdown);

      emit(url, 'analyst', 'Analyst 正在分析观点...');
      const pipelineResult = await runAgentPipeline(crawlResult.doc_id, (step: string, msg: string) => {
        emit(url, step as CrawlProgressEvent['step'], msg);
      });

      emit(url, 'evolve', '正在生成演化链...');
      const evolution = await generateEvolution(crawlResult.doc_id, pipelineResult.analysis.claims);

      if (isFeishuConfigured()) {
        try {
          const report = fsModule.readFileSync(pipelineResult.reportPath, 'utf-8');
          await syncAnalysisReport(crawlResult.doc_id, crawlResult.title, report);
          await appendEvolutionToFeishuReport(crawlResult.doc_id, evolution);
        } catch (err) {
          console.error(`[Feishu] Report sync failed: ${formatFeishuError(err)}`);
        }
      }

      updateHistoryRecord(recordId, {
        status: 'success',
        finishedAt: new Date().toISOString(),
        docId: crawlResult.doc_id,
        reportPath: pipelineResult.reportPath,
      });

      emit(url, 'done', `完成！`, {
        docId: crawlResult.doc_id,
        reportPath: pipelineResult.reportPath,
      });
      console.log(`[TaskManager] 成功: ${url} → ${crawlResult.doc_id}`);
    } catch (err: any) {
      updateHistoryRecord(recordId, {
        status: 'failed',
        error: err?.message || String(err),
        finishedAt: new Date().toISOString(),
      });
      emit(url, 'error', err?.message || String(err), { error: err?.message });
      console.error(`[TaskManager] 失败: ${url}`, err?.message);
    }
  }

  const tasks2 = loadTasks();
  const idx2 = tasks2.findIndex((t) => t.id === task.id);
  if (idx2 >= 0) {
    tasks2[idx2].lastRunAt = new Date().toISOString();
    if (tasks2[idx2].enabled) {
      const next = new Date();
      next.setHours(next.getHours() + tasks2[idx2].intervalHours);
      tasks2[idx2].nextRunAt = next.toISOString();
    }
    saveTasks(tasks2);
  }
}

// ===== 定时器管理 =====

function startTimer(task: ScheduledTask): void {
  // 清除旧定时器
  stopTimer(task.id);
  if (!task.enabled || task.urls.length === 0) return;

  const intervalMs = task.intervalHours * 60 * 60 * 1000;

  const timer = setInterval(async () => {
    try {
      await executeTask(task);
    } catch (err) {
      console.error(`[TaskManager] 任务执行异常: ${task.id}`, err);
    }
  }, intervalMs);

  activeTimers.set(task.id, timer);

  // 更新 nextRunAt
  const tasks = loadTasks();
  const idx = tasks.findIndex((t) => t.id === task.id);
  if (idx >= 0) {
    const next = new Date();
    next.setHours(next.getHours() + task.intervalHours);
    tasks[idx].nextRunAt = next.toISOString();
    saveTasks(tasks);
  }

  console.log(`[TaskManager] 定时器已启动: ${task.id}，每 ${task.intervalHours} 小时执行`);
}

function stopTimer(taskId: string): void {
  const timer = activeTimers.get(taskId);
  if (timer) {
    clearInterval(timer);
    activeTimers.delete(taskId);
  }
}

// ===== 公开 API =====

/** 初始化：加载持久化的任务并启动所有定时器 */
export async function initTaskManager(): Promise<void> {
  const tasks = loadTasks();
  console.log(`[TaskManager] 加载 ${tasks.length} 个定时任务`);

  for (const task of tasks) {
    if (task.enabled) {
      startTimer(task);
    }
  }
}

/** 获取所有任务 */
export function getTasks(): ScheduledTask[] {
  return loadTasks();
}

/** 获取单个任务 */
export function getTask(taskId: string): ScheduledTask | undefined {
  return loadTasks().find((t) => t.id === taskId);
}

/** 创建定时任务 */
export function createTask(urls: string[], intervalHours: number): ScheduledTask {
  const task: ScheduledTask = {
    id: uuidv4(),
    urls: urls.filter((u) => u.trim()),
    intervalHours,
    enabled: true,
    createdAt: new Date().toISOString(),
    lastRunAt: null,
    nextRunAt: null,
  };

  const tasks = loadTasks();
  tasks.push(task);
  saveTasks(tasks);

  startTimer(task);
  console.log(`[TaskManager] 创建任务: ${task.id}，间隔 ${intervalHours}h，${task.urls.length} 个链接`);
  return task;
}

/** 更新定时任务 */
export function updateTask(
  taskId: string,
  updates: { urls?: string[]; intervalHours?: number; enabled?: boolean }
): ScheduledTask | null {
  const tasks = loadTasks();
  const idx = tasks.findIndex((t) => t.id === taskId);
  if (idx < 0) return null;

  if (updates.urls !== undefined) tasks[idx].urls = updates.urls.filter((u) => u.trim());
  if (updates.intervalHours !== undefined) tasks[idx].intervalHours = updates.intervalHours;
  if (updates.enabled !== undefined) tasks[idx].enabled = updates.enabled;

  saveTasks(tasks);

  // 重启定时器
  if (tasks[idx].enabled) {
    startTimer(tasks[idx]);
  } else {
    stopTimer(taskId);
    tasks[idx].nextRunAt = null;
    saveTasks(tasks);
  }

  return tasks[idx];
}

/** 删除定时任务 */
export function deleteTask(taskId: string): boolean {
  stopTimer(taskId);
  const tasks = loadTasks();
  const filtered = tasks.filter((t) => t.id !== taskId);
  if (filtered.length === tasks.length) return false;
  saveTasks(filtered);
  console.log(`[TaskManager] 删除任务: ${taskId}`);
  return true;
}

/** 立即执行任务（不等待定时器） */
export async function runTaskNow(taskId: string): Promise<void> {
  const task = getTask(taskId);
  if (!task) throw new Error(`任务不存在: ${taskId}`);
  // 异步执行，不阻塞响应
  executeTask(task).catch((err) => {
    console.error(`[TaskManager] 手动执行失败: ${taskId}`, err);
  });
}

/** 立即爬取指定链接（一次性，不创建定时任务） */
export async function crawlNow(urls: string[]): Promise<void> {
  const fakeTask: ScheduledTask = {
    id: 'manual-' + uuidv4(),
    urls: urls.filter((u) => u.trim()),
    intervalHours: 0,
    enabled: false,
    createdAt: new Date().toISOString(),
    lastRunAt: null,
    nextRunAt: null,
  };
  // 异步执行
  executeTask(fakeTask).catch((err) => {
    console.error(`[TaskManager] 手动爬取失败`, err);
  });
}

/** 获取执行历史 */
export function getHistory(limit: number = 50): ExecutionRecord[] {
  return loadHistory().slice(0, limit);
}

export function clearHistory(): void {
  saveHistory([]);
}

/** 清理所有定时器（进程退出时调用） */
export function shutdownTaskManager(): void {
  for (const [id, timer] of activeTimers) {
    clearInterval(timer);
  }
  activeTimers.clear();
  console.log(`[TaskManager] 所有定时器已清理`);
}
