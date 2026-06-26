import { randomBytes, pbkdf2Sync, timingSafeEqual } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

interface AuthStore {
  username: string;
  passwordHash: string;
  salt: string;
  iterations: number;
  mustChangePassword: boolean;
  updatedAt: string;
}

interface Session {
  username: string;
  createdAt: number;
}

const AUTH_FILE = path.join(config.knowledgeBasePath, 'web_auth.json');
const DEFAULT_USERNAME = 'root';
const DEFAULT_PASSWORD = '123456';
const COOKIE_NAME = 'wkb_session';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const sessions = new Map<string, Session>();

function validateNewPassword(password: string): string | null {
  if (password.length < 8) return '新密码至少 8 位';
  if (!/[a-z]/.test(password)) return '新密码必须包含小写字母';
  if (!/[A-Z]/.test(password)) return '新密码必须包含大写字母';
  if (!/[0-9]/.test(password)) return '新密码必须包含数字';
  if (!/^[A-Za-z0-9]+$/.test(password)) return '新密码只能包含大小写字母和数字';
  return null;
}

function hashPassword(password: string, salt = randomBytes(16).toString('hex'), iterations = 120000) {
  const passwordHash = pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('hex');
  return { passwordHash, salt, iterations };
}

function defaultStore(): AuthStore {
  return {
    username: DEFAULT_USERNAME,
    ...hashPassword(DEFAULT_PASSWORD),
    mustChangePassword: true,
    updatedAt: new Date().toISOString(),
  };
}

export function loadAuthStore(): AuthStore {
  if (!fs.existsSync(AUTH_FILE)) {
    const store = defaultStore();
    saveAuthStore(store);
    return store;
  }
  try {
    return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8')) as AuthStore;
  } catch {
    const store = defaultStore();
    saveAuthStore(store);
    return store;
  }
}

function saveAuthStore(store: AuthStore): void {
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

function verifyPassword(password: string, store: AuthStore): boolean {
  const candidate = pbkdf2Sync(password, store.salt, store.iterations, 32, 'sha256');
  const expected = Buffer.from(store.passwordHash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

function getSession(req: Request): Session | null {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function setSessionCookie(res: Response, token: string): void {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
}

function clearSessionCookie(res: Response): void {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function authStatus(req: Request, res: Response): void {
  const store = loadAuthStore();
  const session = getSession(req);
  res.json({
    authenticated: !!session,
    username: session?.username || null,
    mustChangePassword: session ? store.mustChangePassword : false,
  });
}

export function login(req: Request, res: Response): void {
  const { username, password } = req.body || {};
  const store = loadAuthStore();
  if (username !== store.username || typeof password !== 'string' || !verifyPassword(password, store)) {
    res.status(401).json({ error: '用户名或密码错误' });
    return;
  }
  const token = randomBytes(32).toString('hex');
  sessions.set(token, { username: store.username, createdAt: Date.now() });
  setSessionCookie(res, token);
  res.json({ authenticated: true, username: store.username, mustChangePassword: store.mustChangePassword });
}

export function logout(req: Request, res: Response): void {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (token) sessions.delete(token);
  clearSessionCookie(res);
  res.json({ success: true });
}

export function clearAuthSessions(): void {
  sessions.clear();
}

export function changePassword(req: Request, res: Response): void {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: '未登录' });
    return;
  }
  const { oldPassword, newPassword } = req.body || {};
  if (typeof oldPassword !== 'string' || typeof newPassword !== 'string') {
    res.status(400).json({ error: '参数不完整' });
    return;
  }
  const passwordError = validateNewPassword(newPassword);
  if (passwordError) {
    res.status(400).json({ error: passwordError });
    return;
  }
  if (newPassword === DEFAULT_PASSWORD) {
    res.status(400).json({ error: '新密码不能继续使用默认密码' });
    return;
  }
  const store = loadAuthStore();
  if (!verifyPassword(oldPassword, store)) {
    res.status(401).json({ error: '原密码错误' });
    return;
  }
  saveAuthStore({
    username: store.username,
    ...hashPassword(newPassword),
    mustChangePassword: false,
    updatedAt: new Date().toISOString(),
  });
  res.json({ success: true });
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.path.startsWith('/api/auth/')) {
    next();
    return;
  }
  if (!req.path.startsWith('/api/')) {
    next();
    return;
  }
  const store = loadAuthStore();
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: '未登录' });
    return;
  }
  if (store.mustChangePassword && req.path !== '/api/auth/change-password') {
    res.status(403).json({ error: '首次登录必须修改密码', mustChangePassword: true });
    return;
  }
  next();
}
