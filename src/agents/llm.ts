import OpenAI from 'openai';
import { config } from '../config';
import { recordLLMUsage } from '../usage/llm';

let client: OpenAI | null = null;

export function getLLMClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: config.deepseek.apiKey,
      baseURL: `${config.deepseek.baseUrl}`,
    });
  }
  return client;
}

export function resetLLMClient(): void {
  client = null;
}

function isRetryableLLMError(err: any): boolean {
  const message = String(err?.message || err || '');
  return (
    err?.status === 429 ||
    err?.status >= 500 ||
    /premature close/i.test(message) ||
    /fetch failed/i.test(message) ||
    /network/i.test(message) ||
    /socket hang up/i.test(message) ||
    /ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR/i.test(message)
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function serializeError(err: any): Record<string, unknown> {
  const result: Record<string, unknown> = {
    name: err?.name,
    message: err?.message || String(err),
    status: err?.status,
    code: err?.code,
    type: err?.type,
  };

  if (err?.cause) {
    result.cause = {
      name: err.cause?.name,
      message: err.cause?.message || String(err.cause),
      code: err.cause?.code,
      errno: err.cause?.errno,
      syscall: err.cause?.syscall,
      address: err.cause?.address,
      port: err.cause?.port,
    };
  }

  if (err?.headers) result.headers = err.headers;
  if (err?.stack) result.stack = err.stack;
  return result;
}

function logLLMError(err: any, context: { attempt: number; maxAttempts: number; model: string }): void {
  const details = {
    attempt: context.attempt,
    maxAttempts: context.maxAttempts,
    model: context.model,
    baseURL: config.deepseek.baseUrl,
    retryable: isRetryableLLMError(err),
    error: serializeError(err),
  };
  console.error('[LLM] Detailed request failure:', JSON.stringify(details, null, 2));
}

export async function chatCompletion(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  options?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
  }
): Promise<string> {
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

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await getLLMClient().chat.completions.create({
        model,
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 4096,
      });

      trackUsage(response);
      return response.choices[0]?.message?.content || '';
    } catch (err: any) {
      logLLMError(err, { attempt, maxAttempts, model });
      if (attempt >= maxAttempts || !isRetryableLLMError(err)) {
        throw err;
      }

      const delayMs = 2000 * attempt;
      const status = err?.status ? `HTTP ${err.status}` : 'network';
      console.log(`[LLM] Request failed (${status}), retrying in ${delayMs / 1000}s...`);
      resetLLMClient();
      await wait(delayMs);
    }
  }

  throw new Error('LLM request failed');
}

export async function chatCompletionJSON<T>(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  options?: { model?: string; temperature?: number; maxTokens?: number }
): Promise<T> {
  const content = await chatCompletion(messages, options);
  const jsonMatch = content.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error(`LLM returned invalid JSON:\n${content}`);
  }
  return JSON.parse(jsonMatch[0]) as T;
}
