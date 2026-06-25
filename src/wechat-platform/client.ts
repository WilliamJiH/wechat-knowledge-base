import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import {
  WechatPlatformSession,
  cookiesToHeader,
  inferCookieExpiry,
  loadWechatSession,
  saveWechatSession,
} from './session';

export interface WechatBizSearchResult {
  fakeId: string;
  nickname: string;
  alias?: string;
  roundHeadImg?: string;
  serviceType?: number;
  signature?: string;
}

export interface WechatPublishedArticle {
  id: string;
  title: string;
  link: string;
  cover?: string;
  digest?: string;
  createTime?: number;
  updateTime?: number;
  fakeId: string;
}

const LOGIN_URL = 'https://mp.weixin.qq.com/';
const HOME_URL = 'https://mp.weixin.qq.com/cgi-bin/home';
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function requireSession(): WechatPlatformSession {
  const session = loadWechatSession();
  if (!session?.token || !session.cookie) {
    throw new Error('微信公众平台尚未登录，请先运行 wx-login 扫码授权');
  }
  return session;
}

function headers(session: WechatPlatformSession, referer = LOGIN_URL): Record<string, string> {
  return {
    Cookie: session.cookie,
    'User-Agent': session.userAgent || DEFAULT_USER_AGENT,
    Referer: referer,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  };
}

function parseTokenFromUrl(url: string): string {
  const match = url.match(/[?&]token=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function writeDataUrlImage(dataUrl: string, filePath: string): boolean {
  const match = dataUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
  if (!match) return false;
  const buffer = Buffer.from(match[1], 'base64');
  if (buffer.length === 0) return false;
  fs.writeFileSync(filePath, buffer);
  return true;
}

async function loadPlaywright(): Promise<any> {
  const dynamicImport = new Function('specifier', 'return import(specifier)');
  try {
    return await dynamicImport('playwright');
  } catch {
    throw new Error('缺少 playwright。请先执行: npm install playwright && npx playwright install chromium');
  }
}

async function extractAccount(page: any): Promise<Record<string, string>> {
  const selectors: Record<string, string[]> = {
    name: ['.weui-desktop_name', '.account_box-panel-head__nickname', '.acount_box-nickname'],
    logo: ['.weui-desktop-account__img', '.weui-desktop-account__thumb', '.account_box-panel-head__thumb'],
  };
  const data: Record<string, string> = {};
  for (const [key, candidates] of Object.entries(selectors)) {
    for (const selector of candidates) {
      const element = page.locator(selector).first();
      if ((await element.count()) === 0) continue;
      data[key] = key === 'logo' ? (await element.getAttribute('src')) || '' : ((await element.textContent()) || '').trim();
      if (data[key]) break;
    }
  }
  return data;
}

export async function loginWechatPlatform(options: { qrcodePath?: string; timeoutMs?: number } = {}): Promise<WechatPlatformSession> {
  const { chromium } = await loadPlaywright();
  const qrcodePath = path.resolve(options.qrcodePath || path.join(config.knowledgeBasePath, 'wechat_qrcode.png'));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: DEFAULT_USER_AGENT });
  const page = await context.newPage();

  try {
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const qrcode = page.locator('.login__type__container__scan__qrcode img, img.js_qrcode_img, .login__type__container__scan__qrcode').first();
    await qrcode.waitFor({ state: 'visible', timeout: 60000 });

    fs.mkdirSync(path.dirname(qrcodePath), { recursive: true });
    const qrcodeSrc = await qrcode.getAttribute('src');
    if (qrcodeSrc?.startsWith('data:image/')) {
      const ok = writeDataUrlImage(qrcodeSrc, qrcodePath);
      if (!ok) await qrcode.screenshot({ path: qrcodePath });
    } else if (qrcodeSrc && !qrcodeSrc.startsWith('blob:')) {
      const qrcodeUrl = new URL(qrcodeSrc, LOGIN_URL).toString();
      const imageResponse = await axios.get(qrcodeUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
        headers: {
          Referer: LOGIN_URL,
          'User-Agent': DEFAULT_USER_AGENT,
        },
      });
      const imageBuffer = Buffer.from(imageResponse.data);
      if (imageBuffer.length > 0) fs.writeFileSync(qrcodePath, imageBuffer);
      else await qrcode.screenshot({ path: qrcodePath });
    } else {
      await qrcode.screenshot({ path: qrcodePath });
    }
    console.log(`[Wechat] 二维码已保存: ${qrcodePath}`);
    console.log('[Wechat] 请使用微信扫码并确认登录，等待时间最多 5 分钟');

    await page.waitForURL((url: URL) => url.href.startsWith(HOME_URL), { timeout: options.timeoutMs || 5 * 60 * 1000 });
    const token = parseTokenFromUrl(page.url());
    if (!token) throw new Error('登录成功但未能从 URL 提取 token');

    const cookies = await context.cookies();
    const session: WechatPlatformSession = {
      token,
      cookies,
      cookie: cookiesToHeader(cookies),
      userAgent: DEFAULT_USER_AGENT,
      expiresAt: inferCookieExpiry(cookies),
      account: await extractAccount(page),
      updatedAt: new Date().toISOString(),
    };

    saveWechatSession(session);
    return session;
  } finally {
    await browser.close();
  }
}

export async function searchWechatBiz(keyword: string, limit = 5, offset = 0): Promise<WechatBizSearchResult[]> {
  const session = requireSession();
  const response = await axios.get('https://mp.weixin.qq.com/cgi-bin/searchbiz', {
    headers: headers(session),
    timeout: 30000,
    params: {
      action: 'search_biz',
      begin: offset,
      count: limit,
      query: keyword,
      token: session.token,
      lang: 'zh_CN',
      f: 'json',
      ajax: '1',
    },
  });

  const data = response.data;
  if (data?.base_resp?.ret && data.base_resp.ret !== 0) {
    throw new Error(`公众号搜索失败: ${data.base_resp.err_msg || data.base_resp.ret}`);
  }

  const list = data?.list || [];
  return list.map((item: any) => ({
    fakeId: item.fakeid,
    nickname: item.nickname,
    alias: item.alias,
    roundHeadImg: item.round_head_img,
    serviceType: item.service_type,
    signature: item.signature,
  }));
}

export async function getWechatPublishedArticles(fakeId: string, count = 5, offset = 0): Promise<WechatPublishedArticle[]> {
  const session = requireSession();
  const response = await axios.get('https://mp.weixin.qq.com/cgi-bin/appmsgpublish', {
    headers: headers(session, HOME_URL),
    timeout: 30000,
    params: {
      sub: 'list',
      sub_action: 'list_ex',
      begin: offset,
      count,
      fakeid: fakeId,
      token: session.token,
      lang: 'zh_CN',
      f: 'json',
      ajax: 1,
    },
  });

  const data = response.data;
  if (data?.base_resp?.ret && data.base_resp.ret !== 0) {
    throw new Error(`公众号文章列表获取失败: ${data.base_resp.err_msg || data.base_resp.ret}`);
  }

  const publishPage = typeof data.publish_page === 'string' ? JSON.parse(data.publish_page) : data.publish_page;
  const publishList = publishPage?.publish_list || [];

  const articles: WechatPublishedArticle[] = [];
  for (const item of publishList) {
    const publishInfo = typeof item.publish_info === 'string' ? JSON.parse(item.publish_info) : item.publish_info;
    const appmsgs = publishInfo?.appmsgex || [];
    for (const article of appmsgs) {
      if (!article.link) continue;
      articles.push({
        id: article.aid || article.appmsgid || article.link,
        fakeId,
        title: article.title || '',
        link: article.link,
        cover: article.cover,
        digest: article.digest,
        createTime: article.create_time,
        updateTime: article.update_time,
      });
    }
  }

  return articles;
}
