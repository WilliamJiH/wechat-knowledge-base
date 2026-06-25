import axios from 'axios';
import * as cheerio from 'cheerio';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';

/** 爬取结果 */
export interface CrawlResult {
  doc_id: string;
  title: string;
  url: string;
  html: string;
  author: string;
  publish_date: string;
  source: string;
}

/** 请求头，模拟微信内置浏览器 */
const WECHAT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

/** 爬取微信公众号文章 */
export async function crawlWechatArticle(url: string): Promise<CrawlResult> {
  console.log(`[Crawler] 正在爬取: ${url}`);

  const response = await axios.get(url, {
    headers: WECHAT_HEADERS,
    timeout: 30000,
    responseType: 'text',
  });

  const $ = cheerio.load(response.data);

  // 提取标题
  const title =
    $('h1#activity-name').text().trim() ||
    $('h1.rich_media_title').text().trim() ||
    $('meta[property="og:title"]').attr('content') ||
    $('title').text().trim();

  // 提取作者/公众号名称
  const author =
    $('a#js_name').text().trim() ||
    $('span.rich_media_meta_nickname').text().trim() ||
    $('meta[property="og:article:author"]').attr('content') ||
    '';

  // 提取发布时间（微信文章的发布时间通常在 meta 标签中或页面脚本里）
  let publishDate = '';
  const metaPubTime = $('meta[property="article:published_time"]').attr('content');
  if (metaPubTime) {
    publishDate = metaPubTime;
  } else {
    // 尝试从脚本中提取
    $('script').each((_i: number, el: any) => {
      const scriptContent = $(el).html() || '';
      const timeMatch = scriptContent.match(/var\s+ct\s*=\s*["'](\d+)["']/);
      if (timeMatch) {
        publishDate = new Date(parseInt(timeMatch[1]) * 1000).toISOString();
      }
    });
  }

  // 提取正文 HTML
  const contentEl = $('#js_content');
  const html = contentEl.html() || '';

  const docId = uuidv4();

  // 保存原始 HTML
  const rawPath = path.join(config.paths.raw, `${docId}.html`);
  fs.mkdirSync(path.dirname(rawPath), { recursive: true });
  fs.writeFileSync(rawPath, response.data, 'utf-8');

  const result: CrawlResult = {
    doc_id: docId,
    title: title || '无标题',
    url,
    html,
    author,
    publish_date: publishDate || new Date().toISOString(),
    source: author || 'wechat',
  };

  console.log(`[Crawler] 爬取完成: ${result.title}`);
  return result;
}

/** 批量爬取文章 */
export async function crawlMultipleArticles(urls: string[]): Promise<CrawlResult[]> {
  const results: CrawlResult[] = [];
  for (const url of urls) {
    try {
      const result = await crawlWechatArticle(url);
      results.push(result);
      // 间隔避免被封
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (err) {
      console.error(`[Crawler] 爬取失败: ${url}`, err);
    }
  }
  return results;
}
