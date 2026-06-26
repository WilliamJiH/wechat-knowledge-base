import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { chatCompletionJSON } from '../agents/llm';
import {
  getAllClaims,
  getEvolutionChainsByClaimId,
  insertEvolutionChain,
  updateArticleStatus,
  Claim,
} from '../storage';

/** 演化类型 */
export type ChangeType = 'extend' | 'refine' | 'contradict';

/** 观点对比结果 */
export interface ComparisonResult {
  old_claim_id: string;
  old_claim: string;
  new_claim: string;
  change_type: ChangeType;
  explanation: string;
}

/** 演化链 */
export interface EvolutionChainResult {
  evolution_chain: { version: string; claim: string }[];
  change_type: ChangeType;
}

const EVOLUTION_SYSTEM_PROMPT = `你是一位知识演化分析专家（Evolution Agent）。
你的任务是对比新旧观点，判断知识的演化方向：

**change_type** 必须是以下之一：
- **extend**：新观点扩展了旧观点的范围或内容
- **refine**：新观点精炼/细化了旧观点
- **contradict**：新观点与旧观点存在矛盾或冲突

请严格按照以下 JSON 格式输出：
{
  "comparisons": [
    {
      "old_claim_id": "旧观点ID",
      "old_claim": "旧观点内容",
      "new_claim": "新观点内容",
      "change_type": "extend|refine|contradict",
      "explanation": "演化原因说明"
    }
  ]
}

规则：
- 不允许重复观点
- 必须递进式演化
- 只对比相同/相似主题的观点
- 如果没有可对比的历史观点，返回空 comparisons 数组
- 只输出 JSON，不要其他内容`;

/** 对比新观点与历史观点 */
async function compareWithHistory(
  newClaims: string[],
  historicalClaims: Claim[]
): Promise<ComparisonResult[]> {
  if (historicalClaims.length === 0) return [];

  const result = await chatCompletionJSON<{ comparisons: ComparisonResult[] }>(
    [
      { role: 'system', content: EVOLUTION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `请对比以下新旧观点：

== 新文章的观点 ==
${newClaims.map((c, i) => `${i + 1}. ${c}`).join('\n')}

== 历史观点库 ==
${historicalClaims.map((c) => `[${c.id}] ${c.claim} (主题: ${c.topic || '无'}, 版本: ${c.version})`).join('\n')}`,
      },
    ],
    { temperature: 0.3 }
  );

  return result.comparisons || [];
}

/** 生成演化链并保存 */
export async function generateEvolution(docId: string, newClaims: string[]): Promise<EvolutionChainResult[]> {
  console.log(`[Evolution] 开始生成演化链: ${docId}`);

  // 获取所有历史观点（排除当前文章）
  const allClaims = getAllClaims().filter((c) => c.doc_id !== docId);

  // 对比新旧观点
  const comparisons = await compareWithHistory(newClaims, allClaims);

  if (comparisons.length === 0) {
    console.log(`[Evolution] 没有可对比的历史观点，跳过演化`);
    updateArticleStatus(docId, 'evolved');
    return [];
  }

  // 保存演化结果
  const evolutionResults: EvolutionChainResult[] = [];

  for (const comp of comparisons) {
    const chainId = uuidv4();

    // 获取该观点的历史演化链
    const existingChain = getEvolutionChainsByClaimId(comp.old_claim_id);
    const nextVersion = existingChain.length + 1;

    // 插入新的演化记录
    insertEvolutionChain({
      id: chainId,
      claim_id: comp.old_claim_id,
      version: nextVersion,
      claim_text: comp.new_claim,
      change_type: comp.change_type,
    });

    evolutionResults.push({
      evolution_chain: [
        ...existingChain.map((ec) => ({
          version: `v${ec.version}`,
          claim: ec.claim_text,
        })),
        { version: `v${nextVersion}`, claim: comp.new_claim },
      ],
      change_type: comp.change_type,
    });

    console.log(
      `[Evolution] ${comp.change_type}: "${comp.old_claim.slice(0, 30)}..." → "${comp.new_claim.slice(0, 30)}..."`
    );
  }

  // 保存演化结果到文件
  const evolutionPath = path.join(config.paths.evolution, `${docId}.json`);
  fs.mkdirSync(path.dirname(evolutionPath), { recursive: true });
  fs.writeFileSync(evolutionPath, JSON.stringify(evolutionResults, null, 2), 'utf-8');

  updateArticleStatus(docId, 'evolved');
  console.log(`[Evolution] 演化完成: ${evolutionPath}`);
  return evolutionResults;
}
