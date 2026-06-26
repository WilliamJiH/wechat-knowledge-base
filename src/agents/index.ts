import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { analyzeArticle, AnalysisResult } from './analyst';
import { critiqueAnalysis, CritiqueResult } from './critic';
import { strategize, StrategyResult } from './strategist';
import { getArticle, insertClaim, updateArticleStatus } from '../storage';
import { config } from '../config';
import { withLLMUsageRound } from '../usage/llm';

export type { AnalysisResult } from './analyst';
export type { CritiqueResult } from './critic';
export type { StrategyResult } from './strategist';

/** 完整的多Agent分析结果 */
export interface AgentPipelineResult {
  doc_id: string;
  analysis: AnalysisResult;
  critique: CritiqueResult;
  strategy: StrategyResult;
  reportPath: string;
}

/** 运行多Agent分析管线 */
export async function runAgentPipeline(
  docId: string,
  onProgress?: (step: string, message: string) => void
): Promise<AgentPipelineResult> {
  const article = getArticle(docId);
  if (!article) throw new Error(`文章不存在: ${docId}`);
  if (!article.markdown_path) throw new Error(`文章 Markdown 路径为空: ${docId}`);

  // 读取 Markdown 内容
  if (!fs.existsSync(article.markdown_path)) {
    throw new Error(`Markdown 文件不存在: ${article.markdown_path}`);
  }
  const markdown = fs.readFileSync(article.markdown_path, 'utf-8');

  console.log(`\n========== 开始多Agent分析: ${article.title} ==========\n`);

  // 1. Analyst: 提取观点
  onProgress?.('analyst', 'Analyst 正在分析观点...');
  const { analysis, critique, strategy } = await withLLMUsageRound(article.doc_id, article.title, async () => {
  const analysis = await analyzeArticle(markdown, article.title);

  // 2. Critic: 批判性分析
  onProgress?.('critic', 'Critic 正在评估观点...');
  const critique = await critiqueAnalysis(article.title, analysis);

  // 3. Strategist: 知识整合
  onProgress?.('strategist', 'Strategist 正在整合知识...');
  const strategy = await strategize(article.title, analysis, critique);
  return { analysis, critique, strategy };
  });

  // 4. 将有效观点保存到数据库
  for (const claim of critique.validated_claims) {
    const topic = analysis.topics[0] || null;
    insertClaim({
      id: uuidv4(),
      doc_id: docId,
      claim,
      topic,
      version: 1,
    });
  }

  // 5. 更新文章状态
  updateArticleStatus(docId, 'analyzed');

  // 6. 生成分析报告 Markdown 文件
  const reportPath = saveAnalysisReport(article.title, docId, analysis, critique, strategy);
  console.log(`[Agents] 分析报告已保存: ${reportPath}`);

  console.log(`\n========== 多Agent分析完成 ==========\n`);

  return {
    doc_id: docId,
    analysis,
    critique,
    strategy,
    reportPath,
  };
}

/** 将分析结果写入 Markdown 报告文件 */
function saveAnalysisReport(
  title: string,
  docId: string,
  analysis: AnalysisResult,
  critique: CritiqueResult,
  strategy: StrategyResult
): string {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  // 文件名：日期_标题（去除特殊字符）
  const safeName = title
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, 60);
  const filename = `${dateStr}_${safeName}.md`;
  const reportsDir = path.join(config.knowledgeBasePath, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  const filePath = path.join(reportsDir, filename);

  const lines: string[] = [
    `# ${title}`,
    ``,
    `> **分析时间**: ${now.toLocaleString('zh-CN')}  `,
    `> **文档 ID**: \`${docId}\``,
    ``,
    `---`,
    ``,
    `## 📊 Analyst — 分析师`,
    ``,
    `### 摘要`,
    ``,
    analysis.summary,
    ``,
    `### 核心观点`,
    ``,
    ...analysis.claims.map((c, i) => `${i + 1}. ${c}`),
    ``,
    `### 涉及主题`,
    ``,
    analysis.topics.map((t) => `\`${t}\``).join('  '),
    ``,
    `---`,
    ``,
    `## 🔍 Critic — 评论家`,
    ``,
    `### ✅ 有效观点`,
    ``,
    ...(critique.validated_claims.length
      ? critique.validated_claims.map((c) => `- ${c}`)
      : ['- （无）']),
    ``,
    `### ⚠️ 弱观点`,
    ``,
    ...(critique.weak_claims.length
      ? critique.weak_claims.map((c) => `- ${c}`)
      : ['- （无）']),
    ``,
    `### ⚡ 逻辑矛盾`,
    ``,
    ...(critique.contradictions.length
      ? critique.contradictions.map((c) => `- ${c}`)
      : ['- （无）']),
    ``,
    `### 整体评价`,
    ``,
    critique.overall_assessment,
    ``,
    `---`,
    ``,
    `## 🧭 Strategist — 策略师`,
    ``,
    `### 关键洞察`,
    ``,
    ...strategy.key_insights.map((k) => `- ${k}`),
    ``,
    `### 知识空白`,
    ``,
    ...(strategy.knowledge_gaps.length
      ? strategy.knowledge_gaps.map((g) => `- ${g}`)
      : ['- （无）']),
    ``,
    `### 建议行动`,
    ``,
    ...strategy.recommended_actions.map((a) => `- ${a}`),
    ``,
    `### 最终整合摘要`,
    ``,
    strategy.final_summary,
    ``,
  ];

  fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
  return filePath;
}
