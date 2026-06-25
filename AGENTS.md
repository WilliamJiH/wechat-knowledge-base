# Agent 协作规范

本文档定义本项目的多 Agent 管线、数据契约、行为约束和运行约定。

## 1. 系统使命

系统目标：

```text
公众号内容采集 -> 标准化存储 -> 语义分析 -> 观点验证 -> 知识整合 -> 演化追踪 -> 人工审核
```

各 Agent 只负责自己的职责，通过结构化数据向下游传递结果。

## 2. 角色

| Agent | 角色 | 职责 |
|-------|------|------|
| Crawler | 采集员 | 抓取原始文章内容和元数据 |
| Parser | 清洗员 | HTML 转 Markdown，图片本地化 |
| Embedding | 索引员 | 生成向量索引 |
| Analyst | 分析师 | 提取观点、主题、摘要 |
| Critic | 评论家 | 校验 Analyst 输出 |
| Strategist | 策略师 | 整合评论结果，输出洞察和行动建议 |
| Evolution | 演化分析员 | 对比新旧观点并判定变化类型 |
| Human | 人工审核员 | 最终审核和校正 |

微信公众平台登录、搜索公众号、订阅公众号、拉取文章链接属于采集入口能力，不属于 Agent 分析阶段。

## 3. 总流程

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

`[Feishu]` 为可选节点，仅在配置了飞书凭据时执行。

状态只能单向流转：

```text
crawled -> parsed -> analyzed -> evolved
```

## 4. 数据契约

### 4.1 Crawler -> Parser

```json
{
  "doc_id": "uuid",
  "title": "文章标题",
  "url": "原文URL",
  "html": "正文HTML片段",
  "author": "作者/公众号名称",
  "publish_date": "ISO时间戳",
  "source": "来源标识"
}
```

### 4.2 Parser 输出

Parser 产出 Markdown 文件，并写入数据库：

```markdown
---
title: "文章标题"
source: "公众号名称"
url: "https://mp.weixin.qq.com/s/xxx"
doc_id: "uuid"
date: "2025-01-01T00:00:00Z"
---

正文 Markdown 内容（图片已本地化）...
```

### 4.3 Analyst -> Critic

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

### 4.4 Critic -> Strategist

```json
{
  "validated_claims": ["有证据支撑的观点"],
  "weak_claims": ["证据不足或过于笼统的观点"],
  "contradictions": ["观点间逻辑矛盾，无则为空数组"],
  "overall_assessment": "100字以内整体评价"
}
```

Critic 必须对每条 claim 判定为 validated 或 weak，不允许遗漏，也不允许新增观点。

### 4.5 Strategist -> Evolution

```json
{
  "key_insights": ["最有价值的2-3条洞察"],
  "knowledge_gaps": ["需要进一步研究的知识空白"],
  "recommended_actions": ["建议后续追踪的行动"],
  "final_summary": "150字以内整合摘要"
}
```

`key_insights` 必须从 `validated_claims` 提炼，不能凭空创造。

### 4.6 Evolution -> Human

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

## 5. Agent 行为规范

- 单一职责：每个 Agent 只处理自己的阶段。
- 结构化输出：Agent 输出必须符合契约 JSON。
- 无状态：跨调用上下文必须通过输入参数传递。
- 幂等性：同一输入在相同配置下应得到稳定结果。
- 不越权：下游 Agent 不得修改上游原始输出，只能生成自己的结果。

温度建议：

| Agent | temperature |
|-------|-------------|
| Analyst | 0.3 |
| Critic | 0.4 |
| Strategist | 0.5 |
| Evolution | 0.3 |

## 6. 知识演化铁律

1. 不允许重复观点：同一语义观点不能重复存储。
2. 必须递进式演化：演化链必须是 v1 -> v2 -> v3。
3. 原文不可篡改：Parser 只清理非正文元素，不改写正文含义。
4. 图片必须本地化：远程图片应下载到本地并以相对路径引用。
5. 观点来源可追溯：每条 claim 必须关联 `doc_id`。

## 7. 微信公众平台约定

微信公众平台能力位于 `src/wechat-platform/`：

- `client.ts`：扫码登录、搜索公众号、拉取文章列表。
- `session.ts`：保存和读取 token/cookie。
- `subscriptions.ts`：保存和读取订阅列表。

运行约定：

- 登录二维码保存为 `knowledge_base/wechat_qrcode.png`，属于临时文件，进程退出时清理。
- 登录会话保存为 `knowledge_base/wechat_platform_session.json`，包含 token/cookie，不得提交到 Git。
- 订阅列表保存为 `knowledge_base/wechat_subscriptions.json`，属于本地运行状态，不得提交到 Git。
- Web 定时任务从已订阅公众号拉取文章链接，不再依赖手工 URL 列表。
- 微信登录失败在前端只展示短错误，例如“登录超时”，不得透出 Playwright 长堆栈。

## 8. 错误处理

| 场景 | 处理方式 |
|------|----------|
| LLM API 429 | 等待 3 秒后重试一次 |
| LLM API 5xx | 等待 3 秒后重试一次 |
| LLM 返回非法 JSON | 记录错误，跳过当前文章 |
| 文章爬取超时 | 记录错误，跳过当前文章 |
| 图片下载失败 | 保留原始 URL，不中断处理 |
| 飞书同步失败 | 记录错误，不影响本地存储和分析 |
| 数据库中文章已存在 | 跳过，不重复处理 |
| 微信登录超时 | 前端展示“登录超时” |

单个环节失败不应阻塞整个队列。

## 9. 协调器职责

`src/agents/index.ts` 中的 `runAgentPipeline` 负责：

1. 按 Analyst -> Critic -> Strategist 顺序执行。
2. 将前一 Agent 完整输出传给后一 Agent。
3. 将 Critic 确认的 `validated_claims` 写入数据库。
4. 管线完成后将文章状态更新为 `analyzed`。
5. 任一 Agent 调用失败时中断并报告具体失败节点。

## 10. 人工审核

CLI 操作：

| 命令 | 说明 |
|------|------|
| `list` | 查看文章列表 |
| `analyze <doc_id>` | 查看分析结果 |
| `search <query>` | 语义检索 |
| `evolve <doc_id>` | 查看演化链 |

人工审核员可以确认观点准确性、标记需要修正的观点，并触发重新分析。
