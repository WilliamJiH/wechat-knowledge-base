import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { analyzeArticle, AnalysisResult } from './analyst';
import { critiqueAnalysis, CritiqueResult } from './critic';
import { strategize, StrategyResult } from './strategist';
import { getArticle, insertClaim, updateArticleStatus } from '../storage';

export type { AnalysisResult } from './analyst';
export type { CritiqueResult } from './critic';
export type { StrategyResult } from './strategist';

/** 完整的多Agent分析结果 */
export interface AgentPipelineResult {
  doc_id: string;
  analysis: AnalysisResult;
  critique: CritiqueResult;
  strategy: StrategyResult;
}

/** 运行多Agent分析管线 */
export async function runAgentPipeline(docId: string): Promise<AgentPipelineResult> {
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
  const analysis = await analyzeArticle(markdown, article.title);

  // 2. Critic: 批判性分析
  const critique = await critiqueAnalysis(article.title, analysis);

  // 3. Strategist: 知识整合
  const strategy = await strategize(article.title, analysis, critique);

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

  console.log(`\n========== 多Agent分析完成 ==========\n`);

  return {
    doc_id: docId,
    analysis,
    critique,
    strategy,
  };
}
