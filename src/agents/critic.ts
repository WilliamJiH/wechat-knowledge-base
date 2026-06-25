import { chatCompletionJSON } from './llm';
import { AnalysisResult } from './analyst';

/** 评论结果 */
export interface CritiqueResult {
  validated_claims: string[];
  weak_claims: string[];
  contradictions: string[];
  overall_assessment: string;
}

const CRITIC_SYSTEM_PROMPT = `你是一位严谨的评论家（Critic Agent）。
你的任务是对分析师提取的观点进行批判性分析：
1. **validated_claims**：有充分证据支持的观点
2. **weak_claims**：证据不足或过于笼统的观点
3. **contradictions**：观点之间的逻辑矛盾（如果有）
4. **overall_assessment**：整体评价（100字以内）

请严格按照以下 JSON 格式输出：
{
  "validated_claims": ["观点1", "观点2"],
  "weak_claims": ["观点3"],
  "contradictions": ["矛盾描述"],
  "overall_assessment": "整体评价"
}

评判标准：
- 观点是否有具体数据/案例支撑
- 逻辑推理是否合理
- 是否存在自相矛盾
- 只输出 JSON，不要其他内容`;

/** 评论家 Agent：对分析结果进行批判性分析 */
export async function critiqueAnalysis(
  title: string,
  analysis: AnalysisResult
): Promise<CritiqueResult> {
  console.log(`[Critic] 正在评论: ${title}`);

  const result = await chatCompletionJSON<CritiqueResult>(
    [
      { role: 'system', content: CRITIC_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `请对以下文章的分析结果进行批判性评估：

标题：${title}

摘要：${analysis.summary}

提取的观点：
${analysis.claims.map((c, i) => `${i + 1}. ${c}`).join('\n')}

涉及主题：${analysis.topics.join(', ')}`,
      },
    ],
    { temperature: 0.4 }
  );

  console.log(
    `[Critic] 评论完成: ${result.validated_claims.length} 个有效, ${result.weak_claims.length} 个弱观点`
  );
  return result;
}
