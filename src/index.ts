#!/usr/bin/env node

import { Command } from 'commander';
import { config, ensureDirectories } from './config';
import { initDB, closeDB, getAllArticles, getArticle } from './storage';
import { crawlWechatArticle, crawlFromRSS } from './crawler';
import { parseAndSave } from './parser';
import { indexArticle, searchSimilar } from './embedding';
import { runAgentPipeline } from './agents';
import { generateEvolution } from './evolution';
import { processArticle, processMultipleArticles, startScheduler } from './scheduler';
import { isFeishuConfigured, createFeishuDoc } from './feishu';
import * as fs from 'fs';

const program = new Command();

program
  .name('wkb')
  .description('微信公众号知识演化系统 CLI')
  .version('1.0.0');

/** crawl 命令：爬取文章 */
program
  .command('crawl')
  .description('爬取微信公众号文章')
  .argument('<urls...>', '文章 URL 列表')
  .option('--rss', '使用 RSS 模式采集')
  .action(async (urls: string[], options: { rss?: boolean }) => {
    await initDB();
    try {
      if (options.rss) {
        for (const feedUrl of urls) {
          const results = await crawlFromRSS(feedUrl);
          for (const result of results) {
            await parseAndSave(result);
          }
        }
      } else {
        for (const url of urls) {
          const result = await crawlWechatArticle(url);
          await parseAndSave(result);
        }
      }
      console.log('\n爬取完成！');
    } finally {
      closeDB();
    }
  });

/** analyze 命令：分析文章 */
program
  .command('analyze')
  .description('对文章进行多Agent分析')
  .argument('<doc_id>', '文章 ID')
  .action(async (docId: string) => {
    await initDB();
    try {
      const result = await runAgentPipeline(docId);
      console.log('\n分析结果:');
      console.log(JSON.stringify(result, null, 2));
    } finally {
      closeDB();
    }
  });

/** evolve 命令：生成观点演化链 */
program
  .command('evolve')
  .description('生成观点演化链')
  .argument('<doc_id>', '文章 ID')
  .action(async (docId: string) => {
    await initDB();
    try {
      const article = getArticle(docId);
      if (!article) {
        console.error(`文章不存在: ${docId}`);
        return;
      }
      // 需要先获取观点（从之前的分析结果）
      const { getAllClaims } = await import('./storage');
      const claims = getAllClaims()
        .filter((c) => c.doc_id === docId)
        .map((c) => c.claim);

      if (claims.length === 0) {
        console.log('该文章没有已分析的观点，请先运行 analyze 命令');
        return;
      }

      await generateEvolution(docId, claims);
      console.log('\n演化链生成完成！');
    } finally {
      closeDB();
    }
  });

/** index 命令：向量化索引 */
program
  .command('index')
  .description('为文章生成向量化索引')
  .argument('<doc_id>', '文章 ID')
  .action(async (docId: string) => {
    await initDB();
    try {
      const article = getArticle(docId);
      if (!article || !article.markdown_path) {
        console.error(`文章不存在或无 Markdown: ${docId}`);
        return;
      }
      const markdown = fs.readFileSync(article.markdown_path, 'utf-8');
      await indexArticle(docId, markdown);
      console.log('\n向量化索引完成！');
    } finally {
      closeDB();
    }
  });

/** search 命令：语义检索 */
program
  .command('search')
  .description('语义检索知识库')
  .argument('<query>', '查询内容')
  .option('-k, --top-k <number>', '返回结果数量', '5')
  .action(async (query: string, options: { topK: string }) => {
    await initDB();
    try {
      const results = await searchSimilar(query, parseInt(options.topK));
      if (results.length === 0) {
        console.log('未找到相关内容');
      } else {
        console.log(`\n找到 ${results.length} 条相关结果:\n`);
        results.forEach((r, i) => {
          console.log(`--- 结果 ${i + 1} (相似度: ${r.score.toFixed(4)}) ---`);
          console.log(`文章ID: ${r.doc_id}`);
          console.log(`内容: ${(r.text || '').slice(0, 200)}...\n`);
        });
      }
    } finally {
      closeDB();
    }
  });

/** pipeline 命令：完整管线 */
program
  .command('pipeline')
  .description('运行完整处理管线（爬取→转换→索引→分析→演化）')
  .argument('<urls...>', '文章 URL 列表')
  .action(async (urls: string[]) => {
    await initDB();
    try {
      await processMultipleArticles(urls);
      console.log('完整管线执行完成！');
    } finally {
      closeDB();
    }
  });

/** start 命令：启动定时任务 */
program
  .command('start')
  .description('启动定时采集任务')
  .option('--rss <feeds...>', 'RSS 源列表')
  .action(async (options: { rss?: string[] }) => {
    ensureDirectories();
    await initDB();
    console.log('微信公众号知识演化系统已启动');
    console.log(`定时任务: ${config.cronSchedule}`);
    if (options.rss) {
      console.log(`RSS 源: ${options.rss.join(', ')}`);
    }
    startScheduler(options.rss || []);
  });

/** list 命令：列出所有文章 */
program
  .command('list')
  .description('列出所有已采集的文章')
  .action(async () => {
    await initDB();
    try {
      const articles = getAllArticles();
      if (articles.length === 0) {
        console.log('暂无文章');
      } else {
        console.log(`\n共 ${articles.length} 篇文章:\n`);
        articles.forEach((a) => {
          console.log(`[${a.status}] ${a.title}`);
          console.log(`  ID: ${a.doc_id}`);
          console.log(`  来源: ${a.source || '-'}`);
          console.log(`  时间: ${a.created_at}\n`);
        });
      }
    } finally {
      closeDB();
    }
  });

/** web 命令：启动 Web 管理界面 */
program
  .command('web')
  .description('启动 Web 管理界面（前端 + API + 定时任务）')
  .option('-p, --port <number>', '端口号', '3000')
  .action(async (options: { port: string }) => {
    ensureDirectories();
    process.env.WEB_PORT = options.port;
    const { startWebServer } = await import('./web/server');
    await startWebServer();
  });

/** 初始化并运行 */
async function main() {
  ensureDirectories();
  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error('系统错误:', err);
  process.exit(1);
});
