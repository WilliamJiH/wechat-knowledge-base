import { LocalIndex, OpenAIEmbeddings } from 'vectra';
import * as fs from 'fs';
import { config } from '../config';

let embeddingsModel: OpenAIEmbeddings | null = null;
let localIndex: LocalIndex | null = null;

/** 获取 Embedding 模型实例 */
export function getEmbeddingsModel(): OpenAIEmbeddings {
  if (!embeddingsModel) {
    const { apiKey, baseUrl, model } = config.embedding;
    if (!apiKey) {
      throw new Error(
        '[Embedding] 未配置 Embedding API Key。\n' +
        '请在 .env 中添加 EMBEDDING_API_KEY=<你的key>\n' +
        '推荐使用硬基流动(siliconflow.cn)或 OpenAI。\n' +
        '详情见 .env.example'
      );
    }
    embeddingsModel = new OpenAIEmbeddings({
      apiKey,
      model,
      endpoint: baseUrl,
    });
  }
  return embeddingsModel;
}

/** 获取本地向量索引实例 */
export async function getLocalIndex(): Promise<LocalIndex> {
  if (!localIndex) {
    const indexPath = config.paths.embeddings;
    fs.mkdirSync(indexPath, { recursive: true });
    localIndex = new LocalIndex(indexPath);

    // 创建索引（如果不存在）
    if (!(await localIndex.isIndexCreated())) {
      await localIndex.createIndex();
    }
  }
  return localIndex;
}

/** 将文章切分为语义段落 */
export function splitIntoChunks(markdown: string, maxChunkSize: number = 1000): string[] {
  const chunks: string[] = [];

  // 按段落分割
  const paragraphs = markdown.split(/\n\n+/).filter((p) => p.trim().length > 0);

  let currentChunk = '';
  for (const para of paragraphs) {
    if (currentChunk.length + para.length > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = '';
    }
    currentChunk += (currentChunk ? '\n\n' : '') + para;
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/** 为文章生成向量并存储 */
export async function indexArticle(docId: string, markdown: string): Promise<void> {
  console.log(`[Embedding] 正在索引文章: ${docId}`);

  const model = getEmbeddingsModel();
  const index = await getLocalIndex();
  const chunks = splitIntoChunks(markdown);

  for (let i = 0; i < chunks.length; i++) {
    try {
      const response = await model.createEmbeddings(chunks[i]);
      if (response.status === 'success' && response.output && response.output.length > 0) {
        await index.insertItem({
          vector: response.output[0],
          metadata: {
            doc_id: docId,
            chunk_index: i,
            text: chunks[i],
          },
        });
      }
    } catch (err) {
      console.error(`[Embedding] chunk ${i} 索引失败:`, err);
    }
  }

  console.log(`[Embedding] 索引完成: ${docId}, ${chunks.length} 个段落`);
}

/** 语义检索：查找相似文章/段落 */
export async function searchSimilar(query: string, topK: number = 5): Promise<any[]> {
  const model = getEmbeddingsModel();
  const index = await getLocalIndex();

  try {
    const response = await model.createEmbeddings(query);
    if (response.status === 'success' && response.output && response.output.length > 0) {
      const results = await index.queryItems(response.output[0], '', topK);
      return results.map((r) => ({
        score: r.score,
        doc_id: r.item.metadata?.doc_id,
        chunk_index: r.item.metadata?.chunk_index,
        text: r.item.metadata?.text,
      }));
    }
  } catch (err) {
    console.error(`[Embedding] 检索失败:`, err);
  }

  return [];
}
