import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';

/** Agent 提示词定义 */
export interface AgentPrompt {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  defaultSystemPrompt: string; // 只读，用于还原默认值
}

const PROMPTS_FILE = path.join(config.knowledgeBasePath, 'agent_prompts.json');

/** 内置默认 Prompt */
const DEFAULT_PROMPTS: Omit<AgentPrompt, 'defaultSystemPrompt'>[] = [
  {
    id: 'analyst',
    name: 'Analyst（分析师）',
    description: '从文章中提取核心观点、主题和摘要',
    systemPrompt: `你是一位专业的知识分析师（Analyst Agent）。
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
- 只输出 JSON，不要其他内容`,
  },
  {
    id: 'critic',
    name: 'Critic（评论家）',
    description: '对观点进行批判性分析，识别有效观点和弱观点',
    systemPrompt: `你是一位严谨的评论家（Critic Agent）。
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
- 只输出 JSON，不要其他内容`,
  },
  {
    id: 'strategist',
    name: 'Strategist（策略师）',
    description: '综合多 Agent 结果，给出知识整合建议',
    systemPrompt: `你是一位知识整合策略师（Strategist Agent）。
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
- 只输出 JSON，不要其他内容`,
  },
];

/** 加载所有 Prompt（若文件不存在则返回默认值） */
export function loadPrompts(): AgentPrompt[] {
  const defaults = DEFAULT_PROMPTS.map((p) => ({ ...p, defaultSystemPrompt: p.systemPrompt }));

  if (!fs.existsSync(PROMPTS_FILE)) return defaults;

  try {
    const saved: Record<string, string> = JSON.parse(fs.readFileSync(PROMPTS_FILE, 'utf-8'));
    return defaults.map((p) => ({
      ...p,
      systemPrompt: saved[p.id] ?? p.systemPrompt,
    }));
  } catch {
    return defaults;
  }
}

/** 获取单个 Agent 的 system prompt */
export function getPrompt(agentId: string): string {
  const prompts = loadPrompts();
  return prompts.find((p) => p.id === agentId)?.systemPrompt ?? '';
}

/** 保存单个 Agent 的 system prompt */
export function savePrompt(agentId: string, systemPrompt: string): boolean {
  const prompts = loadPrompts();
  if (!prompts.find((p) => p.id === agentId)) return false;

  fs.mkdirSync(path.dirname(PROMPTS_FILE), { recursive: true });

  let saved: Record<string, string> = {};
  if (fs.existsSync(PROMPTS_FILE)) {
    try {
      saved = JSON.parse(fs.readFileSync(PROMPTS_FILE, 'utf-8'));
    } catch {}
  }

  saved[agentId] = systemPrompt;
  fs.writeFileSync(PROMPTS_FILE, JSON.stringify(saved, null, 2), 'utf-8');
  return true;
}

/** 还原单个 Agent 的 prompt 为默认值 */
export function resetPrompt(agentId: string): boolean {
  const def = DEFAULT_PROMPTS.find((p) => p.id === agentId);
  if (!def) return false;
  return savePrompt(agentId, def.systemPrompt);
}
