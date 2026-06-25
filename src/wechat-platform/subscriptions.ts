import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';

export interface WechatSubscription {
  fakeId: string;
  nickname: string;
  alias?: string;
  roundHeadImg?: string;
  serviceType?: number;
  signature?: string;
  createdAt: string;
  updatedAt: string;
}

const SUBSCRIPTIONS_FILE = path.join(config.knowledgeBasePath, 'wechat_subscriptions.json');

function readSubscriptions(): WechatSubscription[] {
  if (!fs.existsSync(SUBSCRIPTIONS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(SUBSCRIPTIONS_FILE, 'utf-8')) as WechatSubscription[];
  } catch {
    return [];
  }
}

function writeSubscriptions(subscriptions: WechatSubscription[]): void {
  fs.mkdirSync(path.dirname(SUBSCRIPTIONS_FILE), { recursive: true });
  fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(subscriptions, null, 2), 'utf-8');
}

export function listWechatSubscriptions(): WechatSubscription[] {
  return readSubscriptions();
}

export function getWechatSubscription(fakeId: string): WechatSubscription | undefined {
  return readSubscriptions().find((item) => item.fakeId === fakeId);
}

export function upsertWechatSubscription(input: Omit<WechatSubscription, 'createdAt' | 'updatedAt'>): WechatSubscription {
  const subscriptions = readSubscriptions();
  const now = new Date().toISOString();
  const index = subscriptions.findIndex((item) => item.fakeId === input.fakeId);
  const next: WechatSubscription = {
    ...input,
    createdAt: index >= 0 ? subscriptions[index].createdAt : now,
    updatedAt: now,
  };

  if (index >= 0) subscriptions[index] = next;
  else subscriptions.push(next);

  writeSubscriptions(subscriptions);
  return next;
}

export function removeWechatSubscription(fakeId: string): boolean {
  const subscriptions = readSubscriptions();
  const next = subscriptions.filter((item) => item.fakeId !== fakeId);
  if (next.length === subscriptions.length) return false;
  writeSubscriptions(next);
  return true;
}
