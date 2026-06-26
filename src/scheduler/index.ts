import cron from 'node-cron';
import { config } from '../config';
import { crawlFromRSS, crawlMultipleArticles } from '../crawler';
import { parseAndSave } from '../parser';
import { indexArticle } from '../embedding';
import { runAgentPipeline } from '../agents';
import { generateEvolution } from '../evolution';
import { appendEvolutionToFeishuReport, formatFeishuError, isFeishuConfigured, syncAnalysisReport } from '../feishu';
import { getAllArticles, getArticle } from '../storage';
import * as fs from 'fs';

/** 完整管线：处理单篇文章 */
export interface ProcessArticleResult {
  docId: string;
  reportPath: string;
}

export async function processArticleWithReport(url: string): Promise<ProcessArticleResult> {
  const { crawlWechatArticle } = await import('../crawler');

  // 1. 爬取
  const crawlResult = await crawlWechatArticle(url);

  // 2. 解析转换
  const mdPath = await parseAndSave(crawlResult);

  // 3. 向量化索引
  const markdown = fs.readFileSync(mdPath, 'utf-8');
  await indexArticle(crawlResult.doc_id, markdown);

  // 4. 多Agent分析
  const pipelineResult = await runAgentPipeline(crawlResult.doc_id);

  // 5. 观点演化
  const evolution = await generateEvolution(crawlResult.doc_id, pipelineResult.analysis.claims);

  // 6. 飞书同步（可选）：报告在演进完成后写入知识库。
  if (isFeishuConfigured()) {
    try {
      const report = fs.readFileSync(pipelineResult.reportPath, 'utf-8');
      await syncAnalysisReport(crawlResult.doc_id, crawlResult.title, report);
      await appendEvolutionToFeishuReport(crawlResult.doc_id, evolution);
    } catch (err) {
      console.error(`[Feishu] 报告同步失败: ${formatFeishuError(err)}`);
    }
  }

  return { docId: crawlResult.doc_id, reportPath: pipelineResult.reportPath };
}

export async function processArticle(url: string): Promise<string> {
  const result = await processArticleWithReport(url);
  return result.docId;
}

/** 批量处理管线 */
export async function processMultipleArticles(urls: string[]): Promise<void> {
  console.log(`\n[Pipeline] 开始批量处理 ${urls.length} 篇文章\n`);
  for (const url of urls) {
    try {
      const docId = await processArticle(url);
      console.log(`[Pipeline] 文章处理完成: ${docId}\n`);
    } catch (err) {
      console.error(`[Pipeline] 文章处理失败: ${url}`, err);
    }
  }
  console.log(`\n[Pipeline] 批量处理完成\n`);
}

/** 启动定时任务 */
export function startScheduler(rssFeeds: string[] = []): void {
  const schedule = config.cronSchedule;
  console.log(`[Scheduler] 启动定时任务: ${schedule}`);

  cron.schedule(schedule, async () => {
    console.log(`[Scheduler] 定时任务执行: ${new Date().toISOString()}`);

    for (const feed of rssFeeds) {
      try {
        const results = await crawlFromRSS(feed);
        for (const result of results) {
          try {
            await parseAndSave(result);
            const md = fs.readFileSync(
              result.doc_id ? `knowledge_base/markdown/${result.doc_id}.md` : '',
              'utf-8'
            );
            await indexArticle(result.doc_id, md);
            const pipeline = await runAgentPipeline(result.doc_id);
            const evolution = await generateEvolution(result.doc_id, pipeline.analysis.claims);
            if (isFeishuConfigured()) {
              try {
                const report = fs.readFileSync(pipeline.reportPath, 'utf-8');
                await syncAnalysisReport(result.doc_id, result.title, report);
                await appendEvolutionToFeishuReport(result.doc_id, evolution);
              } catch (err) {
                console.error(`[Feishu] 报告同步失败: ${formatFeishuError(err)}`);
              }
            }
          } catch (err) {
            console.error(`[Scheduler] 处理文章失败: ${result.title}`, err);
          }
        }
      } catch (err) {
        console.error(`[Scheduler] RSS 采集失败: ${feed}`, err);
      }
    }
  });

  console.log(`[Scheduler] 调度器已启动，等待下次执行...`);
}
