import Parser from 'rss-parser';
import { crawlWechatArticle, CrawlResult } from './wechat';

export { crawlWechatArticle, crawlMultipleArticles, CrawlResult } from './wechat';

const rssParser = new Parser();

/** 从 RSS 源采集文章列表 */
export async function crawlFromRSS(feedUrl: string): Promise<CrawlResult[]> {
  console.log(`[Crawler] 正在从 RSS 获取: ${feedUrl}`);

  const feed = await rssParser.parseURL(feedUrl);
  const results: CrawlResult[] = [];

  for (const item of feed.items) {
    if (!item.link) continue;
    try {
      const result = await crawlWechatArticle(item.link);
      results.push(result);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (err) {
      console.error(`[Crawler] RSS 文章爬取失败: ${item.link}`, err);
    }
  }

  console.log(`[Crawler] RSS 获取完成，共 ${results.length} 篇文章`);
  return results;
}
