import { chatCompletionJSON } from './llm';
import { AnalysisResult } from './analyst';
import { CritiqueResult } from './critic';

/** 策略建议 */
export interface StrategyResult {
  key_insights: string[];
  knowledge_gaps: string[];
  recommended_actions: string[];
  final_summary: string;
}

const STRATEGIST_SYSTEM_PROMPT = `你是一位知识整合策略师（Strategist Agent）。
你的任务是综合分析师和评论家的结果，给出知识整合建议：
1. **key_insights**：最有价值的洞察（2-3条）
2. **knowledge_gaps**：需要进一步研究的知识空白
3. **recommended_actions**：建议后续行动（如追踪相关话题、对比其他来源等）
4. **final_summary**：最终整合摘要（150字以内）

请严格按照以下 JSON 格式输出：
{
  "key_insights": ["洞察1", "洞察2"],
  "knowledge_gaps": ["空白1"],
  "recommended_actions": ["行动1", "行动2"],
  "final_summary": "最终摘要"
}

要求：
- 聚焦于高价值、可操作的知识
- 知识空白要具体，便于后续追踪
- 只输出 JSON，不要其他内容`;

/** 策略师 Agent：综合多Agent结果，给出知识整合建议 */
export async function strategize(
  title: string,
  analysis: AnalysisResult,
  critique: CritiqueResult
): Promise<StrategyResult> {
  console.log(`[Strategist] 正在整合: ${title}`);

  const result = await chatCompletionJSON<StrategyResult>(
    [
      { role: 'system', content: STRATEGIST_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `请综合以下分析结果，给出知识整合建议：

标题：${title}

== 分析师结果 ==
摘要：${analysis.summary}
观点：
${analysis.claims.map((c, i) => `${i + 1}. ${c}`).join('\n')}
主题：${analysis.topics.join(', ')}

== 评论家结果 ==
有效观点：${critique.validated_claims.join('; ')}
弱观点：${critique.weak_claims.join('; ')}
矛盾：${critique.contradictions.length > 0 ? critique.contradictions.join('; ') : '无'}
整体评价：${critique.overall_assessment}`,
      },
    ],
    { temperature: 0.5 }
  );

  console.log(`[Strategist] 整合完成`);
  return result;
}
