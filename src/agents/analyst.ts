import { chatCompletionJSON } from './llm';
import { getPrompt } from './prompts';

/** 分析结果 */
export interface AnalysisResult {
  claims: string[];
  topics: string[];
  summary: string;
}

const ANALYST_SYSTEM_PROMPT = `你是一位专业的知识分析师（Analyst Agent）。
你的任务是从给定的文章内容中提取核心信息，包括：
1. **claims**：文章中的核心观点/主张（列表，每个观点一句话概括）
2. **topics**：文章涉及的主题/领域（列表）
3. **summary**：文章的精炼摘要（200字以内）

请严格按照以下 JSON 格式输出：
{
  "claims": ["观点1", "观点2", ...],
  "topics": ["主题1", "主题2", ...],
  "summary": "摘要内容"
}

要求：
- 观点必须具体、可验证，不要过于笼统
- 主题用简短的关键词描述
- 摘要保留关键信息，去除冗余描述
- 只输出 JSON，不要其他内容`;

/** 分析师 Agent：提取观点、主题和摘要 */
export async function analyzeArticle(markdown: string, title: string): Promise<AnalysisResult> {
  console.log(`[Analyst] 正在分析: ${title}`);

  const result = await chatCompletionJSON<AnalysisResult>(
    [
      { role: 'system', content: getPrompt('analyst') },
      {
        role: 'user',
        content: `请分析以下文章：\n\n标题：${title}\n\n内容：\n${markdown.slice(0, 8000)}`,
      },
    ],
    { temperature: 0.3 }
  );

  console.log(`[Analyst] 分析完成: ${result.claims.length} 个观点, ${result.topics.length} 个主题`);
  return result;
}
