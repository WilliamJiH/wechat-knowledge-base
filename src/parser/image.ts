import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { insertImageAsset } from '../storage/db';

/** 下载单张图片到本地 */
export async function downloadImage(url: string, docId: string): Promise<string> {
  // 生成本地文件名
  const ext = path.extname(url.split('?')[0]) || '.jpg';
  const fileName = `${uuidv4()}${ext}`;
  const localDir = path.join(config.paths.images, docId);
  fs.mkdirSync(localDir, { recursive: true });
  const localPath = path.join(localDir, fileName);

  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      headers: {
        Referer: 'https://mp.weixin.qq.com/',
      },
    });
    fs.writeFileSync(localPath, response.data);
    console.log(`[Image] 已下载: ${fileName}`);
    return localPath;
  } catch (err) {
    console.error(`[Image] 下载失败: ${url}`, err);
    return '';
  }
}

/** 本地化 Markdown 中的所有图片 */
export async function localizeImages(
  markdown: string,
  docId: string
): Promise<{ markdown: string; imagePaths: string[] }> {
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const matches = [...markdown.matchAll(imageRegex)];
  const imagePaths: string[] = [];
  let result = markdown;

  for (const match of matches) {
    const [fullMatch, alt, imgUrl] = match;
    if (!imgUrl || imgUrl.startsWith('./') || imgUrl.startsWith('../')) continue;

    const localPath = await downloadImage(imgUrl, docId);
    if (localPath) {
      // 使用相对路径
      const relativePath = path.relative(config.paths.markdown, localPath).replace(/\\/g, '/');
      result = result.replace(fullMatch, `![${alt}](${relativePath})`);
      imagePaths.push(localPath);

      // 记录到数据库
      insertImageAsset(uuidv4(), docId, imgUrl, localPath);
    }
  }

  return { markdown: result, imagePaths };
}
