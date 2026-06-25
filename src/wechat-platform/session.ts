import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';

export interface WechatPlatformSession {
  token: string;
  cookie: string;
  cookies: Array<Record<string, any>>;
  userAgent: string;
  expiresAt?: string;
  account?: Record<string, string>;
  updatedAt: string;
}

const SESSION_FILE = path.join(config.knowledgeBasePath, 'wechat_platform_session.json');

export function getWechatSessionFile(): string {
  return SESSION_FILE;
}

export function loadWechatSession(): WechatPlatformSession | null {
  if (!fs.existsSync(SESSION_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8')) as WechatPlatformSession;
  } catch {
    return null;
  }
}

export function saveWechatSession(session: WechatPlatformSession): void {
  fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
  fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), 'utf-8');
}

export function removeWechatSession(): void {
  if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
}

export function cookiesToHeader(cookies: Array<Record<string, any>>): string {
  return cookies
    .filter((cookie) => cookie.name && cookie.value)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

export function inferCookieExpiry(cookies: Array<Record<string, any>>): string | undefined {
  const expiries = cookies
    .map((cookie) => Number(cookie.expires || cookie.expiry || 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (expiries.length === 0) return undefined;
  return new Date(Math.min(...expiries) * 1000).toISOString();
}
