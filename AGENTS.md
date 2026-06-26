# AGENTS.md

本文件是本仓库的代理协作规范。所有 AI 代理在修改代码、运行命令或调整多 Agent 管线前，都必须先阅读并遵守本文。

## 项目定位

本项目是微信公众号知识库系统，目标流程是：

```text
公众号内容采集 -> 标准化存储 -> 语义索引 -> 观点分析 -> 观点验证 -> 知识整合 -> 演化追踪 -> 人工审核
```

微信公众平台登录、公众号搜索、公众号订阅、文章列表拉取属于采集入口能力；LLM Agent 只负责文章入库后的分析、评论、整合和演化阶段。

## 仓库工作规则

- 优先保持改动小而清晰，避免顺手重构无关模块。
- 修改已有功能时，先阅读相关模块和调用链，不要只改表面 UI。
- 不要提交运行态数据、账号信息、cookie、token、二维码、数据库、报告、索引或本地配置。
- 不要依赖 `.env` 作为唯一配置来源。Web UI 的“设置”页可以保存 API 和飞书配置到运行态设置文件。
- 涉及 Docker、CI、跨平台发布时，必须同时考虑 Linux、macOS、Windows 的路径、换行和 shell 差异。
- 修改前端 UI 后，至少运行 TypeScript 构建；有条件时用浏览器实际打开页面检查布局。
- 如果本地工作区已有用户改动，不得回滚或覆盖。先看 `git status`，只处理与任务相关的文件。

## 常用命令

```bash
npm run build
npm run dev
npm run wx:login
npm run wx:status
npm run wx:search -- <keyword>
npm run wx:sync
```

验证要求：

- TypeScript 或后端逻辑改动后运行 `npm run build`。
- Dockerfile 或 compose 改动后确认 `docker compose up --build` 的写法仍成立。
- GitHub Actions 改动后检查 YAML 语法、触发条件、secret 名称和产物路径。

## 目录约定

| 路径 | 说明 |
|------|------|
| `src/web/` | Web API、前端静态页面、登录和设置页 |
| `src/wechat-platform/` | 微信公众平台登录、搜索、订阅和文章列表拉取 |
| `src/scheduler/` | 文章处理管线入口 |
| `src/agents/` | Analyst、Critic、Strategist 和协调器 |
| `src/embedding/` | 向量索引 |
| `src/evolution/` | 观点演化 |
| `src/storage/` | 数据库和文章存储 |
| `knowledge_base/` | 本地运行态数据目录，不提交运行产物 |
| `.github/workflows/` | Docker 和 release 自动化 |

## 不应提交的文件

以下文件或目录属于本地运行态或敏感数据，必须被 `.gitignore` 覆盖：

- `.env`
- `knowledge_base/db/`
- `knowledge_base/embeddings/`
- `knowledge_base/raw/`
- `knowledge_base/markdown/`
- `knowledge_base/images/`
- `knowledge_base/evolution/`
- `knowledge_base/reports/`
- `knowledge_base/index.json`
- `knowledge_base/execution_history.json`
- `knowledge_base/scheduled_tasks.json`
- `knowledge_base/wechat_platform_session.json`
- `knowledge_base/wechat_qrcode.png`
- `knowledge_base/wechat_subscriptions.json`
- `knowledge_base/web_auth.json`
- `knowledge_base/llm_usage.json`
- `knowledge_base/app_settings.json`
- `*.log`

## 配置约定

API 和飞书配置有两个来源：

1. 环境变量，适合容器、CI 或一次性部署。
2. Web UI “设置”页，适合运行后配置和覆盖。

设置页保存的运行态配置不应提交。保存后应立即刷新内存配置；涉及 LLM API Key 或 base URL 的更新，应重置已缓存的 LLM 客户端。

关键配置项：

- `DEEPSEEK_API_KEY`
- `DEEPSEEK_BASE_URL`
- `EMBEDDING_API_KEY`
- `EMBEDDING_BASE_URL`
- Embedding provider: `openai` 或 `siliconflow`
- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_WIKI_SPACE_ID`

如果 `EMBEDDING_BASE_URL` 不是自定义地址，设置页应允许留空，并按 provider 使用默认地址。

## Docker 和发布约定

- Docker 镜像必须支持 multi-arch：`linux/amd64` 和 `linux/arm64`。
- Docker Hub 登录使用 `DOCKERHUB_USERNAME` 和 `DOCKERHUB_TOKEN`。
- Compose 不应强制依赖 `.env`；没有 `.env` 时也应能启动。
- 容器内持久化目录使用 `/data/knowledge_base`。
- Docker 镜像默认命令应启动 Web UI。
- Release workflow 需要构建 Windows 和 macOS 可下载产物。
- Release 产物应包含运行所需的 `dist`、生产依赖、README、AGENTS 和运行说明。

## 多 Agent 角色

| Agent | 角色 | 职责 |
|-------|------|------|
| Crawler | 采集员 | 抓取原始文章内容和元数据 |
| Parser | 清洗员 | HTML 转 Markdown，图片本地化 |
| Embedding | 索引员 | 生成向量索引 |
| Analyst | 分析师 | 提取观点、主题、摘要 |
| Critic | 评论家 | 验证 Analyst 输出 |
| Strategist | 策略师 | 整合评论结果，输出洞察和行动建议 |
| Evolution | 演化分析员 | 对比新旧观点并判定变化类型 |
| Human | 人工审核员 | 最终审核和校正 |

## 管线顺序

```text
Wechat Platform / URL / RSS
  -> Crawler
  -> Parser
  -> [Feishu]
  -> Embedding
  -> Analyst
  -> Critic
  -> Strategist
  -> Evolution
  -> Human
```

`[Feishu]` 是可选节点，仅在配置飞书凭据时执行。

文章状态只能单向流转：

```text
crawled -> parsed -> analyzed -> evolved
```

## 数据契约

### Crawler -> Parser

```json
{
  "doc_id": "uuid",
  "title": "文章标题",
  "url": "原文URL",
  "html": "正文HTML片段",
  "author": "作者或公众号名称",
  "publish_date": "ISO时间戳",
  "source": "来源标识"
}
```

### Parser 输出

Parser 产出 Markdown 文件并写入数据库：

```markdown
---
title: "文章标题"
source: "公众号名称"
url: "https://mp.weixin.qq.com/s/xxx"
doc_id: "uuid"
date: "2025-01-01T00:00:00Z"
---

正文 Markdown 内容，图片已本地化。
```

### Analyst -> Critic

```json
{
  "claims": ["具体观点1", "具体观点2"],
  "topics": ["主题关键词1", "主题关键词2"],
  "summary": "200字以内摘要"
}
```

约束：

- `claims` 必须具体、可验证。
- `topics` 不超过 5 个。
- `summary` 保留关键信息，去除冗余。
- Analyst 最多读取文章前 8000 字符。
- claims 数量不少于 2 条，不超过 10 条。

### Critic -> Strategist

```json
{
  "validated_claims": ["有证据支撑的观点"],
  "weak_claims": ["证据不足或过于笼统的观点"],
  "contradictions": ["观点间逻辑矛盾，无则为空数组"],
  "overall_assessment": "100字以内整体评价"
}
```

Critic 必须对每条 claim 判定为 `validated` 或 `weak`，不得遗漏，也不得新增观点。

### Strategist -> Evolution

```json
{
  "key_insights": ["最有价值的2-3条洞察"],
  "knowledge_gaps": ["需要进一步研究的知识空白"],
  "recommended_actions": ["建议后续追踪的行动"],
  "final_summary": "150字以内整合摘要"
}
```

`key_insights` 必须从 `validated_claims` 提炼，不能凭空创造。

### Evolution -> Human

```json
{
  "evolution_chain": [
    { "version": "v1", "claim": "初始观点" },
    { "version": "v2", "claim": "演化后观点" }
  ],
  "change_type": "extend | refine | contradict"
}
```

`change_type` 只能是：

- `extend`
- `refine`
- `contradict`

## Agent 行为规范

- 单一职责：每个 Agent 只处理自己的阶段。
- 结构化输出：Agent 输出必须符合约定 JSON。
- 无状态：跨调用上下文必须通过输入参数传递。
- 幂等性：同一输入在相同配置下应得到稳定结果。
- 不越权：下游 Agent 不得修改上游原始输出，只能生成自己的结果。

建议 temperature：

| Agent | temperature |
|-------|-------------|
| Analyst | 0.3 |
| Critic | 0.4 |
| Strategist | 0.5 |
| Evolution | 0.3 |

## 知识演化规则

1. 不允许重复观点：同一语义观点不能重复存储。
2. 必须递进式演化：演化链必须是 `v1 -> v2 -> v3`。
3. 原文不可篡改：Parser 只清理非正文元素，不改写正文含义。
4. 图片必须本地化：远程图片应下载到本地并以相对路径引用。
5. 观点来源可追溯：每条 claim 必须关联 `doc_id`。

## 微信公众平台约定

微信公众平台能力位于 `src/wechat-platform/`：

- `client.ts`：扫码登录、搜索公众号、拉取文章列表。
- `session.ts`：保存和读取 token/cookie。
- `subscriptions.ts`：保存和读取订阅列表。

运行约定：

- 登录二维码保存为 `knowledge_base/wechat_qrcode.png`，属于临时文件，进程退出时清理。
- 登录会话保存为 `knowledge_base/wechat_platform_session.json`，包含 token/cookie，不得提交。
- 订阅列表保存为 `knowledge_base/wechat_subscriptions.json`，属于本地运行状态，不得提交。
- Web 定时任务从已订阅公众号拉取文章链接，不依赖手工 URL 列表。
- 微信登录失败时，前端只显示短错误，例如“登录超时”，不得透出 Playwright 长堆栈。

## 错误处理

| 场景 | 处理方式 |
|------|----------|
| LLM API 429 | 等待 3 秒后重试一次 |
| LLM API 5xx | 等待 3 秒后重试一次 |
| LLM 返回非法 JSON | 记录错误，跳过当前文章 |
| 文章爬取超时 | 记录错误，跳过当前文章 |
| 图片下载失败 | 保留原始 URL，不中断处理 |
| 飞书同步失败 | 记录错误，不影响本地存储和分析 |
| 数据库中文章已存在 | 跳过，不重复处理 |
| 微信登录超时 | 前端显示“登录超时” |

单个环节失败不应阻塞整个队列。

## 协调器职责

`src/agents/index.ts` 中的 `runAgentPipeline` 负责：

1. 按 Analyst -> Critic -> Strategist 顺序执行。
2. 将前一个 Agent 的完整输出传给后一个 Agent。
3. 将 Critic 确认的 `validated_claims` 写入数据库。
4. 管线完成后将文章状态更新为 `analyzed`。
5. 任一 Agent 调用失败时中断并报告具体失败节点。

## Web UI 约定

- Navbar 当前包含微信订阅、执行历史、用量、设置、提示词。
- 登录弹窗以外的页面内容应模糊并禁用交互。
- 首次登录默认账号为 `root` / `123456`，首次登录后必须修改密码。
- 新密码必须至少 8 位，且只由大小写英文字母和数字组成，并同时包含大写、小写和数字。
- 设置页不得回显已保存的 secret，只显示“已配置/未配置”状态。
- 执行历史应展示同步入库结果。
- 报告文件应支持单个下载和批量下载。

## 人工审核

CLI 操作：

| 命令 | 说明 |
|------|------|
| `list` | 查看文章列表 |
| `analyze <doc_id>` | 查看分析结果 |
| `search <query>` | 语义检索 |
| `evolve <doc_id>` | 查看演化链 |

人工审核员可以确认观点准确性、标记需要修正的观点，并触发重新分析。
