import axios from 'axios';
import { config } from '../config';
import { getArticle, updateFeishuDocId, updateFeishuReportDocId } from '../storage';

/** 飞书 API 基地址 */
const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis';

/** 获取 tenant_access_token */
async function getTenantAccessToken(): Promise<string> {
  const { appId, appSecret } = config.feishu;
  if (!appId || !appSecret) {
    throw new Error('飞书配置不完整，请设置 FEISHU_APP_ID 和 FEISHU_APP_SECRET');
  }

  const response = await axios.post(`${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`, {
    app_id: appId,
    app_secret: appSecret,
  });

  return response.data.tenant_access_token;
}

/** 创建飞书知识库文档 */
export async function createFeishuDoc(docId: string, title: string, markdown: string): Promise<string> {
  const token = await getTenantAccessToken();
  const spaceId = config.feishu.wikiSpaceId;

  if (!spaceId) {
    throw new Error('飞书知识库空间ID未配置，请设置 FEISHU_WIKI_SPACE_ID');
  }

  // 创建知识库节点
  const response = await axios.post(
    `${FEISHU_API_BASE}/wiki/v2/spaces/${spaceId}/nodes`,
    {
      obj_type: 'docx',
      title: title,
      node_type: 'origin',
      ...(config.feishu.wikiParentNodeToken
        ? { parent_node_token: config.feishu.wikiParentNodeToken }
        : {}),
    },
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  const feishuDocId = response.data.data?.node?.obj_token;
  if (!feishuDocId) {
    throw new Error('创建飞书文档失败');
  }

  // 写入文档内容（简化版：使用纯文本块）
  await writeDocContent(token, feishuDocId, markdown);

  // 记录到数据库
  updateFeishuDocId(docId, feishuDocId);

  console.log(`[Feishu] 文档已同步: ${title} (doc_id: ${feishuDocId})`);
  return feishuDocId;
}

/** Create a Wiki document for the analysis report and retain its document token. */
export async function syncAnalysisReport(docId: string, title: string, markdown: string): Promise<string> {
  const article = getArticle(docId);
  if (!article) throw new Error(`Article not found: ${docId}`);

  if (article.feishu_report_doc_id) {
    return article.feishu_report_doc_id;
  }

  const token = await getTenantAccessToken();
  const spaceId = config.feishu.wikiSpaceId;
  if (!spaceId) {
    throw new Error('Feishu Wiki space ID is not configured');
  }

  const response = await axios.post(
    `${FEISHU_API_BASE}/wiki/v2/spaces/${spaceId}/nodes`,
    {
      obj_type: 'docx',
      title: `Analysis report - ${title}`,
      node_type: 'origin',
      ...(config.feishu.wikiParentNodeToken
        ? { parent_node_token: config.feishu.wikiParentNodeToken }
        : {}),
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  const reportDocId = response.data.data?.node?.obj_token;
  if (!reportDocId) throw new Error('Failed to create Feishu analysis report document');

  await writeDocContent(token, reportDocId, markdown);
  updateFeishuReportDocId(docId, reportDocId);
  console.log(`[Feishu] Analysis report synced: ${title} (doc_id: ${reportDocId})`);
  return reportDocId;
}

/** Append the newly generated evolution result to the associated report document. */
export async function appendEvolutionToFeishuReport(
  docId: string,
  evolution: Array<{ evolution_chain: { version: string; claim: string }[]; change_type: string }>
): Promise<void> {
  if (!evolution.length) return;
  const article = getArticle(docId);
  if (!article?.feishu_report_doc_id) return;

  const markdown = [
    '## Knowledge evolution',
    '',
    ...evolution.flatMap((item, index) => [
      `### Evolution ${index + 1}: ${item.change_type}`,
      '',
      ...item.evolution_chain.map((entry) => `- ${entry.version}: ${entry.claim}`),
      '',
    ]),
  ].join('\n');

  await writeDocContent(await getTenantAccessToken(), article.feishu_report_doc_id, markdown);
  console.log(`[Feishu] Knowledge evolution appended: ${article.feishu_report_doc_id}`);
}

/** Convert Markdown into structured Feishu document blocks. */
async function writeDocContent(token: string, docId: string, markdown: string): Promise<void> {
  await axios.post(
    `${FEISHU_API_BASE}/docx/v1/documents/${docId}/blocks/convert`,
    {
      content_type: 'markdown',
      content: markdown,
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );
}

/** 检查飞书配置是否可用 */
export function isFeishuConfigured(): boolean {
  return !!(config.feishu.appId && config.feishu.appSecret && config.feishu.wikiSpaceId);
}
