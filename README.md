# 微信公众号知识库

用于采集微信公众号文章，标准化存储为 Markdown，并通过多 Agent 流程完成摘要、观点提取、观点校验、整合建议和演化追踪。

Agent 协作规范见 [AGENTS.md](./AGENTS.md)。

## 功能

- 微信公众平台扫码登录，保存 token/cookie
- 搜索并订阅公众号
- 从已订阅公众号拉取最新文章链接
- 定时同步订阅公众号文章
- 微信文章采集、HTML 转 Markdown、图片本地化
- 可选飞书同步
- 向量索引与语义检索
- Analyst / Critic / Strategist 多 Agent 分析
- 观点演化链生成
- Web 管理界面和 CLI

## 安装

```bash
npm install
npx playwright install chromium
```

复制并配置环境变量：

```bash
cp .env.example .env
```

至少需要配置 LLM API Key。Embedding、飞书为可选配置。

## Web 管理界面

```bash
npm run dev
```

默认访问：

```text
http://localhost:3000
```

Web 页面包含：

- 微信订阅：扫码登录、搜索公众号、订阅公众号、同步文章、创建订阅定时任务
- 执行历史：查看同步/入库结果
- 提示词：管理 Agent system prompt

定时任务不再手动维护文章 URL 列表。创建任务时会从已订阅公众号拉取上方设置的文章数量，并用这些文章链接创建周期任务。

## 微信订阅流程

1. 打开 Web 页面，进入“微信订阅”。
2. 点击“生成登录二维码”，用微信扫码并确认。
3. 搜索公众号并点击“订阅”。
4. 设置文章数量。
5. 点击“只取链接”预览文章链接，或点击“同步入库”进入完整处理管线。
6. 如需周期运行，设置采集间隔并创建定时任务。

登录二维码是临时文件，进程退出时会清理。登录会话保存在 `knowledge_base/wechat_platform_session.json`，订阅列表保存在 `knowledge_base/wechat_subscriptions.json`，均不应提交到 Git。

## CLI

```bash
# 采集单篇文章
npx ts-node src/index.ts crawl "https://mp.weixin.qq.com/s/xxxxx"

# 完整管线
npx ts-node src/index.ts pipeline "https://mp.weixin.qq.com/s/xxxxx"

# 分析已采集文章
npx ts-node src/index.ts analyze <doc_id>

# 生成演化链
npx ts-node src/index.ts evolve <doc_id>

# 语义检索
npx ts-node src/index.ts search "关键词"

# 列出文章
npx ts-node src/index.ts list
```

微信公众平台 CLI：

```bash
npm run wx:login
npm run wx:status
npm run wx:search -- "公众号名称"
npx ts-node src/index.ts wx-subscribe --search "公众号名称"
npx ts-node src/index.ts wx-subscriptions
npm run wx:sync -- --urls-only
npm run wx:sync -- -n 5
```

## 命令列表

| 命令 | 说明 |
|------|------|
| `web [-p <port>]` | 启动 Web 管理界面 |
| `crawl <urls...>` | 采集微信文章 |
| `pipeline <urls...>` | 采集、解析、索引、分析、演化 |
| `analyze <doc_id>` | 运行多 Agent 分析 |
| `evolve <doc_id>` | 生成观点演化链 |
| `index <doc_id>` | 生成向量索引 |
| `search <query>` | 语义检索 |
| `list` | 列出文章 |
| `wx-login` | 微信公众平台扫码登录 |
| `wx-status` | 查看微信登录状态 |
| `wx-search <keyword>` | 搜索公众号 |
| `wx-subscribe` | 订阅公众号 |
| `wx-subscriptions` | 管理订阅列表 |
| `wx-sync` | 同步订阅公众号文章 |

## 目录

```text
wechat-knowledge-base/
├─ src/
│  ├─ agents/             # Analyst / Critic / Strategist
│  ├─ crawler/            # 文章采集
│  ├─ embedding/          # 向量索引
│  ├─ evolution/          # 演化链
│  ├─ parser/             # Markdown 转换和图片本地化
│  ├─ runtime/            # 运行时清理
│  ├─ storage/            # sql.js 数据库
│  ├─ web/                # Web API 和前端
│  └─ wechat-platform/    # 微信公众平台登录、搜索、订阅、文章列表
├─ knowledge_base/        # 运行时数据目录
├─ AGENTS.md
├─ package.json
└─ tsconfig.json
```

## 运行时数据

`knowledge_base/` 下的数据库、原文、Markdown、图片、报告、会话、订阅、任务历史均为运行时产物，不应提交到 Git。

## 构建

```bash
npm run build
```

## 许可

MIT
