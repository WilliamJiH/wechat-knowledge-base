# agent.md --- 公众号知识演化系统（完整可执行规范）

## 0. 系统定义

本系统是一个多Agent协同的知识处理管线，用于：

> 持续采集公众号内容 → 转换为 Markdown → 写入飞书知识库 →
> 与历史内容进行语义对比 → 生成观点演化链 → 人工校正反馈

**技术栈：** TypeScript 5 + Node.js + sql.js (SQLite) + vectra (本地向量) + DeepSeek API (兼容 OpenAI)

------------------------------------------------------------------------

## 1. 输入定义

### 1.1 用户输入

```json
{
  "source_type": "wechat",
  "source": "公众号名称 or URL or RSS",
  "schedule": "cron表达式（可选，默认 0 8 * * *）",
  "mode": "latest | full"
}
```

### 1.2 环境变量配置 (.env)

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 | （必填） |
| `DEEPSEEK_BASE_URL` | API 基地址 | `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | 聊天模型名 | `deepseek-chat` |
| `KNOWLEDGE_BASE_PATH` | 知识库根路径 | `./knowledge_base` |
| `DB_PATH` | SQLite 数据库路径 | `./knowledge_base/db/knowledge.db` |
| `FEISHU_APP_ID` | 飞书应用 ID | （可选） |
| `FEISHU_APP_SECRET` | 飞书应用密钥 | （可选） |
| `FEISHU_WIKI_SPACE_ID` | 飞书知识库空间 ID | （可选） |
| `CRON_SCHEDULE` | 定时采集 cron 表达式 | `0 8 * * *` |

------------------------------------------------------------------------

## 2. 输出定义

系统最终输出 4 类结果：

### 2.1 原始知识存储

- Markdown 文章（含 YAML frontmatter 元信息头）
- 图片本地化存储（按 `images/{doc_id}/` 目录组织）
- 飞书知识库文档（可选，需配置飞书凭据）
- 原始 HTML 备份（`raw/{doc_id}.html`）

### 2.2 结构化知识（articles 表 + index.json）

```json
{
  "doc_id": "uuid",
  "title": "文章标题",
  "url": "原文 URL",
  "source": "来源公众号名称",
  "markdown_path": "knowledge_base/markdown/{doc_id}.md",
  "feishu_doc_id": "飞书文档 ID（可选）",
  "image_assets": ["本地图片路径列表"],
  "status": "crawled | parsed | analyzed | evolved",
  "created_at": "ISO 时间戳"
}
```

### 2.3 观点分析结果（Analyst + Critic + Strategist 管线输出）

```json
{
  "claims": ["核心观点列表"],
  "topics": ["主题/领域列表"],
  "summary": "文章精炼摘要（200字以内）",
  "validated_claims": ["有证据支撑的观点"],
  "weak_claims": ["证据不足的观点"],
  "key_insights": ["高价值洞察"],
  "final_summary": "整合后最终摘要"
}
```

### 2.4 观点演化结果（evolution_chains 表 + evolution/{doc_id}.json）

```json
{
  "evolution_chain": [
    { "version": "v1", "claim": "初始观点" },
    { "version": "v2", "claim": "演化后观点" }
  ],
  "change_type": "extend | refine | contradict",
  "explanation": "演化原因说明"
}
```

------------------------------------------------------------------------

## 3. 系统总流程

```
Scheduler (node-cron)
  → Crawler (axios + cheerio / rss-parser)
    → raw/{doc_id}.html 保存原始 HTML
  → Parser (turndown)
    → HTML 清洗（去除 script/style/广告）
    → HTML → Markdown 转换
    → 图片本地化（下载并替换为相对路径）
    → markdown/{doc_id}.md 保存（含 YAML frontmatter）
  → Feishu（可选）
    → 飞书知识库创建/写入文档
  → Embedding (vectra + OpenAIEmbeddings)
    → 文章切分为语义段落
    → 调用 DeepSeek API 生成向量
    → 存储到 embeddings/ 本地向量索引
  → Agents（多 Agent 串行管线）
    → Analyst Agent：提取 claims / topics / summary
    → Critic Agent：批判性验证观点
    → Strategist Agent：综合整合，输出 key_insights
    → 将 validated_claims 写入 claims 表
  → Evolution
    → 新观点与历史观点语义对比（LLM 判断）
    → 判定 change_type：extend / refine / contradict
    → 生成演化链，写入 evolution_chains 表
    → 保存 evolution/{doc_id}.json
  → Human Review（人工审核，通过 CLI 查看/校正）
```

------------------------------------------------------------------------

## 4. Agent 定义

### 4.1 Analyst Agent（分析师）

**文件：** `src/agents/analyst.ts`
**职责：** 从文章 Markdown 中提取结构化知识
**输入：** 文章标题 + Markdown 内容（截断 8000 字）
**输出：** `{ claims: string[], topics: string[], summary: string }`
**Prompt 策略：** temperature=0.3，要求观点具体可验证、主题用关键词描述

### 4.2 Critic Agent（评论家）

**文件：** `src/agents/critic.ts`
**职责：** 对 Analyst 提取的观点进行批判性分析
**输入：** 文章标题 + AnalysisResult（Analyst 的输出）
**输出：** `{ validated_claims, weak_claims, contradictions, overall_assessment }`
**评判标准：** 是否有数据/案例支撑、逻辑推理是否合理、是否存在自相矛盾

### 4.3 Strategist Agent（策略师）

**文件：** `src/agents/strategist.ts`
**职责：** 综合 Analyst 和 Critic 的结果，给出知识整合建议
**输入：** 文章标题 + AnalysisResult + CritiqueResult
**输出：** `{ key_insights, knowledge_gaps, recommended_actions, final_summary }`

### 4.4 Agent 协调器

**文件：** `src/agents/index.ts`
**函数：** `runAgentPipeline(docId)`
**流程：** 读取 Markdown → Analyst → Critic → Strategist → 保存 validated_claims 到数据库 → 更新状态为 `analyzed`

### 4.5 Evolution Agent（演化分析）

**文件：** `src/evolution/index.ts`
**职责：** 对比新旧观点，判断知识演化方向
**change_type 类型：**
- `extend`：新观点扩展了旧观点的范围或内容
- `refine`：新观点精炼/细化了旧观点
- `contradict`：新观点与旧观点存在矛盾或冲突

------------------------------------------------------------------------

## 5. 数据库 Schema

使用 sql.js（纯 JS SQLite），数据库文件：`knowledge_base/db/knowledge.db`

### articles 表

| 字段 | 类型 | 说明 |
|------|------|------|
| `doc_id` | TEXT PK | UUID 文章唯一标识 |
| `title` | TEXT NOT NULL | 文章标题 |
| `url` | TEXT | 原文 URL |
| `source` | TEXT | 来源公众号名称 |
| `markdown_path` | TEXT | Markdown 文件本地路径 |
| `feishu_doc_id` | TEXT | 飞书文档 ID |
| `status` | TEXT | crawled / parsed / analyzed / evolved |
| `created_at` | TEXT | 创建时间 |

### claims 表

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | TEXT PK | UUID |
| `doc_id` | TEXT FK | 关联文章 |
| `claim` | TEXT NOT NULL | 观点内容 |
| `topic` | TEXT | 所属主题 |
| `version` | INTEGER | 版本号（默认 1） |
| `created_at` | TEXT | 创建时间 |

### evolution_chains 表

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | TEXT PK | UUID |
| `claim_id` | TEXT FK | 关联观点 |
| `version` | INTEGER | 演化版本号 |
| `claim_text` | TEXT NOT NULL | 该版本观点内容 |
| `change_type` | TEXT NOT NULL | extend / refine / contradict |
| `created_at` | TEXT | 创建时间 |

### image_assets 表

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | TEXT PK | UUID |
| `doc_id` | TEXT FK | 关联文章 |
| `original_url` | TEXT | 图片原始 URL |
| `local_path` | TEXT | 本地存储路径 |

------------------------------------------------------------------------

## 6. CLI 命令

```bash
wkb crawl <urls...>         # 爬取微信公众号文章（支持 --rss 模式）
wkb analyze <doc_id>        # 对已爬取文章运行多 Agent 分析管线
wkb evolve <doc_id>         # 基于已分析观点生成演化链
wkb index <doc_id>          # 为文章生成向量化索引
wkb search <query>          # 语义检索知识库（支持 -k 参数）
wkb pipeline <urls...>      # 一键完整管线：爬取→转换→索引→分析→演化
wkb start [--rss <feeds>]   # 启动定时采集调度器
wkb list                    # 列出所有已采集文章及状态
```

**快速开始：**

```bash
# 1. 复制配置并填入 API Key
cp .env.example .env

# 2. 爬取一篇文章
npx ts-node src/index.ts crawl "https://mp.weixin.qq.com/s/xxxxx"

# 3. 运行完整管线（爬取 + 分析 + 演化）
npx ts-node src/index.ts pipeline "https://mp.weixin.qq.com/s/xxxxx"

# 4. 语义检索
npx ts-node src/index.ts search "AI 大模型发展趋势"

# 5. 启动定时任务（每天早上 8 点自动采集 RSS）
npx ts-node src/index.ts start --rss "https://rsshub.app/wechat/mp/xxx"
```

------------------------------------------------------------------------

## 7. 关键规则

- **不允许重复观点**：Critic Agent 负责检查逻辑一致性，Evolution Agent 负责去重
- **必须递进式演化**：change_type 只能是 extend / refine / contradict，不允许平级重复
- **Markdown 保留原文**：转换过程不删减正文内容，仅清洗脚本/广告等非正文元素
- **图片必须本地化**：所有远程图片下载至 `images/{doc_id}/`，Markdown 中替换为相对路径
- **文章状态流转**：`crawled → parsed → analyzed → evolved`，每个阶段完成后更新状态
- **LLM 错误自动重试**：429/5xx 错误 3 秒后重试一次

------------------------------------------------------------------------

## 8. 系统目标

构建持续进化的公众号知识系统（Knowledge Evolution System）：
- 可持续采集：支持定时 RSS 自动采集，也支持手动 URL 爬取
- 标准化存储：HTML→Markdown 统一格式，图片本地化，SQLite 结构化管理
- 向量化检索：语义 embedding 索引，支持相似内容检索
- 多 Agent 协同：Analyst/Critic/Strategist 串行分析，确保观点质量
- 观点演化追踪：历史观点对比，形成知识演化链
- 飞书同步（可选）：自动将内容同步至飞书知识库

------------------------------------------------------------------------

## 9. 项目结构

```
d:\Dev\wechat-knowledge-base\
├── src/
│   ├── config/index.ts        # 统一配置管理（.env 读取 + 路径计算）
│   ├── storage/
│   │   ├── db.ts              # sql.js SQLite 数据库 CRUD（4张表）
│   │   └── index.ts           # index.json 索引文件读写
│   ├── crawler/
│   │   ├── wechat.ts          # 微信文章爬虫（axios + cheerio）
│   │   └── index.ts           # RSS 源采集（rss-parser）
│   ├── parser/
│   │   ├── index.ts           # HTML→Markdown 转换（turndown）+ 清洗
│   │   └── image.ts           # 图片下载与本地化
│   ├── embedding/index.ts     # 向量化索引（vectra + OpenAIEmbeddings）
│   ├── agents/
│   │   ├── llm.ts             # DeepSeek LLM 客户端（openai SDK 兼容）
│   │   ├── analyst.ts         # 分析师 Agent：提取观点/主题/摘要
│   │   ├── critic.ts          # 评论家 Agent：批判性验证观点
│   │   ├── strategist.ts      # 策略师 Agent：知识整合与建议
│   │   └── index.ts           # Agent 协调器：串行执行三 Agent 管线
│   ├── evolution/index.ts     # 观点演化链生成（新旧对比 + 分类）
│   ├── feishu/index.ts        # 飞书知识库 API 封装（可选）
│   ├── scheduler/index.ts     # 定时调度（node-cron）+ 完整管线编排
│   ├── types/sql.js.d.ts      # sql.js 类型声明
│   └── index.ts               # CLI 入口（commander）
├── knowledge_base/            # 数据目录（运行时自动生成）
│   ├── raw/                   # 原始 HTML 备份
│   ├── markdown/              # 转换后的 Markdown 文件
│   ├── images/                # 本地化图片（按 doc_id 分目录）
│   ├── embeddings/            # vectra 向量索引文件
│   ├── db/                    # SQLite 数据库
│   ├── evolution/             # 演化链 JSON 文件
│   └── index.json             # 文章索引清单
├── types/sql.js.d.ts          # sql.js 全局类型声明
├── .env.example               # 环境变量示例
├── .gitignore
├── tsconfig.json
├── package.json
├── agent.md                   # 本规范文件
├── README.md
└── LICENSE
```
