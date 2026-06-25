import TurndownService from 'turndown';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { CrawlResult } from '../crawler';
import { localizeImages } from './image';
import { insertArticle, updateArticleStatus, addIndexEntry } from '../storage';

export { localizeImages, downloadImage } from './image';

/** 创建 Turndown 实例，配置转换规则 */
function createTurndown(): TurndownService {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });

  // 移除不需要的元素
  turndown.remove(['script', 'style', 'iframe', 'nav', 'footer', '.ad-wrap', '#js_pc_qr_code']);

  return turndown;
}

/** 清洗 HTML：去除广告、脚本等无关内容 */
function cleanHtml(html: string): string {
  // 去除微信文章中的隐藏元素、空 div 等
  let cleaned = html;
  // 移除隐藏的 div
  cleaned = cleaned.replace(/<div[^>]*style="[^"]*display:\s*none[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
  // 移除 mpvoice 音频标签
  cleaned = cleaned.replace(/<mpvoice[^>]*>[\s\S]*?<\/mpvoice>/gi, '');
  // 移除 mp-miniprogram 小程序标签
  cleaned = cleaned.replace(/<mp-miniprogram[^>]*>[\s\S]*?<\/mp-miniprogram>/gi, '');
  return cleaned;
}

/** 将 HTML 转为 Markdown */
export function htmlToMarkdown(html: string): string {
  const cleaned = cleanHtml(html);
  const turndown = createTurndown();
  return turndown.turndown(cleaned);
}

/** 解析并保存文章 */
export async function parseAndSave(crawlResult: CrawlResult): Promise<string> {
  const { doc_id, title, html, url, source } = crawlResult;

  console.log(`[Parser] 正在转换: ${title}`);

  // 1. HTML → Markdown
  let markdown = htmlToMarkdown(html);

  // 2. 图片本地化
  const { markdown: mdWithImages, imagePaths } = await localizeImages(markdown, doc_id);
  markdown = mdWithImages;

  // 3. 添加元信息头
  const frontmatter = [
    '---',
    `title: "${title.replace(/"/g, '\\"')}"`,
    `source: "${source}"`,
    `url: "${url}"`,
    `doc_id: "${doc_id}"`,
    `date: "${crawlResult.publish_date}"`,
    '---',
    '',
  ].join('\n');

  const finalMarkdown = frontmatter + markdown;

  // 4. 保存 Markdown 文件
  const mdFileName = `${doc_id}.md`;
  const mdPath = path.join(config.paths.markdown, mdFileName);
  fs.mkdirSync(path.dirname(mdPath), { recursive: true });
  fs.writeFileSync(mdPath, finalMarkdown, 'utf-8');

  // 5. 写入数据库
  insertArticle({
    doc_id,
    title,
    url,
    source,
    markdown_path: mdPath,
    feishu_doc_id: null,
  });
  updateArticleStatus(doc_id, 'parsed');

  // 6. 更新 index.json
  addIndexEntry({
    doc_id,
    title,
    markdown_path: mdPath,
    image_assets: imagePaths,
    created_at: new Date().toISOString(),
  });

  console.log(`[Parser] 转换完成: ${mdPath}`);
  return mdPath;
}
