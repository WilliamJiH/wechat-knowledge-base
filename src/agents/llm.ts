import OpenAI from 'openai';
import { config } from '../config';
import { recordLLMUsage } from '../usage/llm';

let client: OpenAI | null = null;

/** 获取 OpenAI 客户端（兼容 DeepSeek API） */
export function getLLMClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: config.deepseek.apiKey,
      baseURL: `${config.deepseek.baseUrl}/v1`,
    });
  }
  return client;
}

export function resetLLMClient(): void {
  client = null;
}

/** 发送聊天请求 */
export async function chatCompletion(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  options?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
  }
): Promise<string> {
  const llm = getLLMClient();
  const model = options?.model || config.deepseek.model;
  const trackUsage = (response: any) => {
    const usage = response?.usage;
    if (!usage) return;
    recordLLMUsage({
      model,
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
      totalTokens: usage.total_tokens || 0,
    });
  };

  try {
    const response = await llm.chat.completions.create({
      model,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 4096,
    });

    trackUsage(response);
    return response.choices[0]?.message?.content || '';
  } catch (err: any) {
    // 重试一次
    if (err?.status === 429 || err?.status >= 500) {
      console.log(`[LLM] 请求失败 (${err.status})，3秒后重试...`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const response = await llm.chat.completions.create({
        model,
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 4096,
      });
      trackUsage(response);
      return response.choices[0]?.message?.content || '';
    }
    throw err;
  }
}

/** 发送 JSON 格式的聊天请求，期望返回 JSON */
export async function chatCompletionJSON<T>(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  options?: { model?: string; temperature?: number; maxTokens?: number }
): Promise<T> {
  const content = await chatCompletion(messages, options);
  // 尝试提取 JSON
  const jsonMatch = content.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error(`LLM 返回的不是有效 JSON:\n${content}`);
  }
  return JSON.parse(jsonMatch[0]) as T;
}
