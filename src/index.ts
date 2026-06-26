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
import { appendEvolutionToFeishuReport, isFeishuConfigured, syncAnalysisReport } from './feishu';
import * as fs from 'fs';
import {
  getWechatPublishedArticles,
  getWechatSessionFile,
  listWechatSubscriptions,
  loadWechatSession,
  loginWechatPlatform,
  removeWechatSession,
  removeWechatSubscription,
  searchWechatBiz,
  upsertWechatSubscription,
} from './wechat-platform';
import { cleanupRuntimeArtifacts } from './runtime/cleanup';

const program = new Command();

process.once('exit', cleanupRuntimeArtifacts);

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
      const evolution = await generateEvolution(docId, result.analysis.claims);
      if (isFeishuConfigured()) {
        const article = getArticle(docId);
        if (article) {
          const report = fs.readFileSync(result.reportPath, 'utf-8');
          await syncAnalysisReport(docId, article.title, report);
          await appendEvolutionToFeishuReport(docId, evolution);
        }
      }
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
  .command('wx-login')
  .description('微信公众平台扫码登录，保存 token/cookie')
  .option('-o, --output <path>', '二维码图片保存路径')
  .action(async (options: { output?: string }) => {
    ensureDirectories();
    const session = await loginWechatPlatform({ qrcodePath: options.output });
    console.log('\n微信公众平台登录完成');
    console.log(`Token: ${session.token}`);
    console.log(`过期时间: ${session.expiresAt || '-'}`);
    if (session.account?.name) console.log(`账号: ${session.account.name}`);
    console.log(`会话文件: ${getWechatSessionFile()}`);
  });

program
  .command('wx-status')
  .description('查看或清除微信公众平台登录状态')
  .option('--clear', '清除已保存的微信公众平台会话')
  .action((options: { clear?: boolean }) => {
    ensureDirectories();
    if (options.clear) {
      removeWechatSession();
      console.log('已清除微信公众平台会话');
      return;
    }

    const session = loadWechatSession();
    if (!session) {
      console.log('未登录。请先运行 wx-login');
      return;
    }

    console.log('已保存微信公众平台会话');
    console.log(`Token: ${session.token}`);
    console.log(`更新时间: ${session.updatedAt}`);
    console.log(`过期时间: ${session.expiresAt || '-'}`);
    if (session.account?.name) console.log(`账号: ${session.account.name}`);
  });

program
  .command('wx-search')
  .description('搜索可订阅的微信公众号')
  .argument('<keyword>', '公众号名称或关键词')
  .option('-n, --limit <number>', '返回数量', '5')
  .action(async (keyword: string, options: { limit: string }) => {
    ensureDirectories();
    const results = await searchWechatBiz(keyword, parseInt(options.limit, 10));
    if (results.length === 0) {
      console.log('未找到公众号');
      return;
    }
    results.forEach((item, index) => {
      console.log(`\n[${index + 1}] ${item.nickname}`);
      console.log(`  fakeId: ${item.fakeId}`);
      console.log(`  alias: ${item.alias || '-'}`);
      console.log(`  signature: ${item.signature || '-'}`);
    });
  });

program
  .command('wx-subscribe')
  .description('订阅微信公众号；可传 fakeId，或用 --search 取搜索结果第一条')
  .argument('[fake_id]', '微信公众号 fakeId')
  .option('-s, --search <keyword>', '搜索公众号并订阅第一条结果')
  .option('-n, --name <name>', '公众号名称（传 fakeId 时使用）')
  .action(async (fakeId: string | undefined, options: { search?: string; name?: string }) => {
    ensureDirectories();
    let subscriptionInput;

    if (options.search) {
      const [first] = await searchWechatBiz(options.search, 1);
      if (!first) throw new Error(`未找到公众号: ${options.search}`);
      subscriptionInput = {
        fakeId: first.fakeId,
        nickname: first.nickname,
        alias: first.alias,
        roundHeadImg: first.roundHeadImg,
        serviceType: first.serviceType,
        signature: first.signature,
      };
    } else {
      if (!fakeId) throw new Error('请提供 fakeId，或使用 --search <keyword>');
      subscriptionInput = {
        fakeId,
        nickname: options.name || fakeId,
      };
    }

    const saved = upsertWechatSubscription(subscriptionInput);
    console.log(`已订阅: ${saved.nickname}`);
    console.log(`fakeId: ${saved.fakeId}`);
  });

program
  .command('wx-subscriptions')
  .description('列出或删除微信公众号订阅')
  .option('-d, --delete <fake_id>', '删除指定 fakeId 的订阅')
  .action((options: { delete?: string }) => {
    ensureDirectories();
    if (options.delete) {
      const ok = removeWechatSubscription(options.delete);
      console.log(ok ? `已删除订阅: ${options.delete}` : `未找到订阅: ${options.delete}`);
      return;
    }

    const subscriptions = listWechatSubscriptions();
    if (subscriptions.length === 0) {
      console.log('暂无订阅');
      return;
    }
    subscriptions.forEach((item) => {
      console.log(`\n${item.nickname}`);
      console.log(`  fakeId: ${item.fakeId}`);
      console.log(`  alias: ${item.alias || '-'}`);
      console.log(`  updatedAt: ${item.updatedAt}`);
    });
  });

program
  .command('wx-sync')
  .description('同步已订阅公众号的最新文章，并进入现有处理管线')
  .option('-f, --fake-id <fake_id>', '只同步指定 fakeId')
  .option('-n, --count <number>', '每个公众号拉取文章数', '5')
  .option('--urls-only', '只打印文章 URL，不进入处理管线')
  .action(async (options: { fakeId?: string; count: string; urlsOnly?: boolean }) => {
    ensureDirectories();
    await initDB();
    try {
      const subscriptions = listWechatSubscriptions().filter((item) => !options.fakeId || item.fakeId === options.fakeId);
      if (subscriptions.length === 0) {
        console.log(options.fakeId ? `未找到订阅: ${options.fakeId}` : '暂无订阅');
        return;
      }

      for (const subscription of subscriptions) {
        console.log(`\n[Wechat] 同步 ${subscription.nickname}`);
        const articles = await getWechatPublishedArticles(subscription.fakeId, parseInt(options.count, 10));
        if (articles.length === 0) {
          console.log('  未获取到文章');
          continue;
        }

        for (const article of articles) {
          console.log(`  - ${article.title}`);
          console.log(`    ${article.link}`);
          if (!options.urlsOnly) {
            try {
              const docId = await processArticle(article.link);
              console.log(`    已入库: ${docId}`);
            } catch (err: any) {
              console.error(`    处理失败: ${err?.message || String(err)}`);
            }
          }
        }
      }
    } finally {
      closeDB();
    }
  });

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
  try {
    await program.parseAsync(process.argv);
  } finally {
    cleanupRuntimeArtifacts();
  }
}

main().catch((err) => {
  cleanupRuntimeArtifacts();
  console.error('系统错误:', err);
  process.exit(1);
});
