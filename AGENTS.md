# Agent 协作规范

> 本文档定义多 Agent 系统的行为规范、工作协议与流程约定。
> 所有 AI Agent 在执行任务前必须阅读并遵守本规范。

------------------------------------------------------------------------

## 1. 系统使命

本系统通过多 Agent 协同，完成以下知识处理目标：

> 采集公众号内容 → 标准化存储 → 语义分析 → 观点验证 → 知识整合 → 演化追踪 → 人工审核

每个 Agent 是管线中的一个专职节点，只负责自己的职责，通过**结构化数据契约**向下游传递结果。

------------------------------------------------------------------------

## 2. Agent 角色清单

| Agent | 角色定位 | 核心职责 |
|-------|---------|---------|
| **Crawler** | 采集员 | 抓取原始文章内容，提取元数据 |
| **Parser** | 清洗员 | HTML→Markdown 转换，图片本地化 |
| **Analyst** | 分析师 | 从文章中提取观点、主题、摘要 |
| **Critic** | 评论家 | 批判性验证 Analyst 的输出 |
| **Strategist** | 策略师 | 综合多 Agent 结果，输出整合建议 |
| **Evolution** | 演化分析员 | 对比新旧观点，判定演化方向 |
| **Human** | 人工审核员 | 对 Agent 产出进行最终校正 |

------------------------------------------------------------------------

## 3. 协作流程

### 3.1 总管线

所有 Agent 按以下顺序串行执行，前一个 Agent 的输出是后一个 Agent 的输入：

```
Crawler → Parser → [Feishu] → Embedding → Analyst → Critic → Strategist → Evolution → Human
```

方括号 `[Feishu]` 表示可选节点，仅在配置了飞书凭据时执行。

### 3.2 阶段划分

管线分为三个阶段，每个阶段完成后更新文章状态：

| 阶段 | 包含 Agent | 完成后状态 |
|------|-----------|-----------|
| 采集阶段 | Crawler → Parser → Feishu | `parsed` |
| 索引阶段 | Embedding | （状态不变） |
| 分析阶段 | Analyst → Critic → Strategist | `analyzed` |
| 演化阶段 | Evolution | `evolved` |

**状态只能单向流转，不可回退：** `crawled → parsed → analyzed → evolved`

------------------------------------------------------------------------

## 4. Agent 间数据契约

### 4.1 Crawler → Parser

Crawler 输出一个 `CrawlResult` 对象：

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

### 4.2 Parser → 下游所有 Agent

Parser 产出标准化的 Markdown 文件（含 YAML frontmatter），并写入数据库：

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

### 4.3 Analyst → Critic

Analyst 输出 `AnalysisResult`：

```json
{
  "claims": ["具体观点1", "具体观点2"],
  "topics": ["主题关键词1", "主题关键词2"],
  "summary": "200字以内的精炼摘要"
}
```

**约束：**
- `claims` 必须具体、可验证，禁止笼统描述
- `topics` 用简短关键词，不超过 5 个
- `summary` 保留关键信息，去除冗余

### 4.4 Critic → Strategist

Critic 输出 `CritiqueResult`：

```json
{
  "validated_claims": ["有证据支撑的观点"],
  "weak_claims": ["证据不足或过于笼统的观点"],
  "contradictions": ["观点间的逻辑矛盾（无则为空数组）"],
  "overall_assessment": "100字以内的整体评价"
}
```

**评判标准：**
- 观点是否有具体数据或案例支撑
- 逻辑推理链是否完整
- 是否存在自相矛盾
- 与常识或已知事实是否冲突

### 4.5 Strategist → Evolution

Strategist 输出 `StrategyResult`：

```json
{
  "key_insights": ["最有价值的2-3条洞察"],
  "knowledge_gaps": ["需要进一步研究的知识空白"],
  "recommended_actions": ["建议后续追踪的行动"],
  "final_summary": "150字以内的整合摘要"
}
```

**约束：**
- `key_insights` 必须从 `validated_claims` 中提炼，不能凭空创造
- `knowledge_gaps` 必须具体，便于后续定向采集
- 只有 `validated_claims`（Critic 确认的）才会进入演化阶段

### 4.6 Evolution → Human

Evolution 对每条可匹配的历史观点生成演化记录：

```json
{
  "evolution_chain": [
    { "version": "v1", "claim": "初始观点" },
    { "version": "v2", "claim": "演化后观点" }
  ],
  "change_type": "extend | refine | contradict"
}
```

------------------------------------------------------------------------

## 5. Agent 行为规范

### 5.1 通用规则

1. **单一职责**：每个 Agent 只做自己的事，不越权修改其他 Agent 的输出
2. **结构化输出**：所有 Agent 必须严格按照契约格式输出 JSON，不得附加自由文本
3. **无状态**：Agent 不保留跨次调用的内部状态，所有上下文通过输入参数传递
4. **幂等性**：对同一输入多次调用同一 Agent，应产出相同结果（temperature 参数控制）

### 5.2 Analyst 行为规范

- 输入截断：最多读取文章前 8000 字符，超出部分忽略
- temperature = 0.3（偏保守，减少随机性）
- 观点数量：不少于 2 条，不超过 10 条
- 禁止输出主观评价，只提取文章中的客观主张

### 5.3 Critic 行为规范

- temperature = 0.4
- 必须对每条 claim 给出判定（validated 或 weak），不允许遗漏
- 如果观点间存在矛盾，必须在 `contradictions` 中明确说明哪两条冲突及原因
- 不允许新增观点，只能对 Analyst 的输出做评判

### 5.4 Strategist 行为规范

- temperature = 0.5（允许更多创造性）
- `key_insights` 必须从 `validated_claims` 中提炼，不能凭空创造
- `knowledge_gaps` 要指向具体的信息缺失，而非泛泛而谈
- `final_summary` 要综合三方视角（原文、分析、评论），不是简单复述

### 5.5 Evolution 行为规范

- temperature = 0.3
- 只对比**相同或相似主题**下的观点，不做跨主题对比
- 如果没有可匹配的历史观点，输出空 `comparisons` 数组，不强行匹配
- `change_type` 必须是三选一，不允许自定义类型：
  - **extend**：新观点扩展了旧观点的范围、场景或应用
  - **refine**：新观点使旧观点更精确、更细化或修正了细节
  - **contradict**：新观点与旧观点在核心主张上存在直接冲突

------------------------------------------------------------------------

## 6. 知识演化铁律

以下规则是系统的核心约束，任何 Agent 不得违反：

1. **不允许重复观点** —— 同一语义的观点不能在系统中存在两份，Critic 负责检测，Evolution 负责标记
2. **必须递进式演化** —— 每条观点的演化链必须是递进的（v1 → v2 → v3），不允许平级重复
3. **原文不可篡改** —— Markdown 文件保留原文内容，Parser 只清洗非正文元素（脚本/广告/导航），不删改正文
4. **图片必须本地化** —— 所有远程图片必须下载到本地，Markdown 中引用本地相对路径
5. **观点来源可追溯** —— 每条 claim 必须关联 `doc_id`，可追溯到原始文章

------------------------------------------------------------------------

## 7. 错误处理协议

| 场景 | 处理方式 |
|------|---------|
| LLM API 返回 429（限流） | 等待 3 秒后重试一次 |
| LLM API 返回 5xx（服务端错误） | 等待 3 秒后重试一次 |
| LLM 返回非法 JSON | 抛出错误，记录日志，跳过当前文章 |
| 文章爬取超时（30s） | 记录错误，跳过该文章，继续处理队列 |
| 图片下载失败 | 保留原始 URL，不中断文章处理流程 |
| 飞书同步失败 | 记录错误，不影响本地存储和分析流程 |
| 数据库中文章已存在 | 跳过，不重复处理 |

**原则：** 单个环节的失败不应阻塞整条管线。每个 Agent 独立捕获异常，记录后继续。

------------------------------------------------------------------------

## 8. 协调器职责

Agent 协调器（`src/agents/index.ts` 中的 `runAgentPipeline`）负责：

1. **按序调度**：严格按照 Analyst → Critic → Strategist 的顺序执行，不可并行或乱序
2. **传递上下文**：将前一个 Agent 的完整输出作为后一个 Agent 的输入
3. **持久化结果**：将 Critic 确认的 `validated_claims` 写入数据库
4. **状态更新**：管线完成后将文章状态更新为 `analyzed`
5. **异常中断**：任一 Agent 调用失败时，中断管线并报告具体失败节点

------------------------------------------------------------------------

## 9. 人工审核协议

Human Review 是管线的最终环节，通过 CLI 交互完成：

| 操作 | 对应命令 | 说明 |
|------|---------|------|
| 查看文章列表 | `list` | 查看所有文章及其状态 |
| 查看分析结果 | `analyze <doc_id>` | 输出完整的 Agent 分析 JSON |
| 语义检索 | `search <query>` | 基于向量相似度检索相关内容 |
| 查看演化链 | `evolve <doc_id>` | 生成并展示观点演化路径 |

人工审核员可以：
- 确认 Agent 产出的观点是否准确
- 标记需要修正的观点（未来扩展：通过 `claims` 表的 status 字段）
- 触发重新分析（删除旧记录后重新运行 `analyze`）
