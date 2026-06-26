# 微信公众号知识库

一个面向微信公众号内容的本地知识库系统。它可以登录微信公众平台、搜索并订阅公众号、同步文章链接，将文章转换为 Markdown，并通过多 Agent 流程完成观点提取、校验、整合和演化追踪。

Agent 协作规范见 [AGENTS.md](./AGENTS.md)。

## 目录

- [主要功能](#主要功能)
- [快速开始](#快速开始)
- [Docker 部署](#docker-部署)
- [环境变量](#环境变量)
- [飞书知识库同步](#飞书知识库同步)
- [Web 使用流程](#web-使用流程)
- [CLI 命令](#cli-命令)
- [GitHub Actions](#github-actions)
- [运行时数据](#运行时数据)
- [项目结构](#项目结构)
- [许可](#许可)

## 主要功能

- 微信公众平台扫码登录，保存 token/cookie。
- 搜索公众号并保存订阅列表。
- 从已订阅公众号拉取最新文章链接。
- 定时同步已订阅公众号文章。
- 微信文章采集、HTML 转 Markdown、图片本地化。
- Analyst / Critic / Strategist 多 Agent 分析。
- 观点校验、整合摘要、知识空白和后续行动建议。
- 观点演化链生成。
- 向量索引和语义检索。
- AI Token 用量统计。
- Web 管理界面、提示词管理和 CLI。
- 可选飞书同步。
- Docker 和 GitHub Actions 发布流程。

## 快速开始

### 1. 安装依赖

```bash
npm install
npx playwright install chromium
```

Playwright 用于微信公众平台二维码登录。

### 2. 配置环境变量

```bash
cp .env.example .env
```

至少需要配置 LLM API Key。Embedding、飞书为可选配置。

### 3. 启动 Web

```bash
npm run dev
```

访问：

```text
http://localhost:3000
```

默认登录账号：

```text
username: root
password: 123456
```

首次登录后必须修改密码。新密码必须至少 8 位，只能由大小写英文字母和数字组成，并同时包含大写字母、小写字母和数字。

## Docker 部署

项目提供 `Dockerfile` 和 `docker-compose.yml`。镜像基于 Playwright 官方 Node 镜像，包含 Chromium 运行环境。

### Docker 直接运行

Linux / macOS:

```bash
docker run -d \
  --name wechat-knowledge-base \
  --env-file .env \
  -p 3000:3000 \
  -v "$(pwd)/knowledge_base:/data/knowledge_base" \
  williamjih/wechat-knowledge-base:latest
```

Windows PowerShell:

```powershell
docker run -d `
  --name wechat-knowledge-base `
  --env-file .env `
  -p 3000:3000 `
  -v "${PWD}\knowledge_base:/data/knowledge_base" `
  williamjih/wechat-knowledge-base:latest
```

### Docker Compose

使用仓库中的 `docker-compose.yml`：

```bash
docker compose up -d
```

默认镜像：

```text
williamjih/wechat-knowledge-base:latest
```

如需指定版本：

```bash
IMAGE=williamjih/wechat-knowledge-base:v1.0.0 docker compose up -d
```

### 本地构建

```bash
docker compose up -d --build
```

### 访问

```text
http://localhost:3000
```

### Docker Hub

镜像地址：

```text
https://hub.docker.com/repository/docker/williamjih/wechat-knowledge-base
```

数据默认挂载：

```text
./knowledge_base:/data/knowledge_base
```

容器默认环境：

```text
KNOWLEDGE_BASE_PATH=/data/knowledge_base
DB_PATH=/data/knowledge_base/db/knowledge.db
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `WEB_PORT` | Web 端口 | `3000` |
| `KNOWLEDGE_BASE_PATH` | 知识库运行数据目录 | `./knowledge_base` |
| `DB_PATH` | sql.js 数据库路径 | `./knowledge_base/db/knowledge.db` |
| `DEEPSEEK_API_KEY` | LLM API Key | 空 |
| `DEEPSEEK_BASE_URL` | DeepSeek/OpenAI 兼容 API 地址 | `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | LLM 模型 | `deepseek-chat` |
| `EMBEDDING_API_KEY` | Embedding API Key | 空 |
| `EMBEDDING_BASE_URL` | Embedding API 地址 | `https://api.siliconflow.cn/v1` |
| `EMBEDDING_MODEL` | Embedding 模型 | `BAAI/bge-m3` |
| `FEISHU_APP_ID` | 飞书应用 ID | 空 |
| `FEISHU_APP_SECRET` | 飞书应用 Secret | 空 |
| `FEISHU_WIKI_SPACE_ID` | 飞书知识库空间 ID | 空 |
| `FEISHU_WIKI_PARENT_NODE_TOKEN` | 飞书知识库目录节点 Token；留空时创建在空间根目录 | 空 |

## 飞书知识库同步

飞书同步是可选能力。配置完成后，每篇文章完成分析和知识演进后，系统会将分析报告创建为飞书知识库中的云文档；演进结果会追加到同一份报告的“Knowledge evolution”部分。本地报告仍会保留在 `knowledge_base/reports/`。

### 1. 创建并授权飞书应用

在飞书开放平台创建企业自建应用，并将应用机器人加入目标知识库的管理员或可编辑成员。至少开通以下权限：

| 权限 | 用途 |
|------|------|
| `wiki:node:create` | 在知识库空间或指定目录中创建报告节点 |
| `wiki:space:retrieve` | 查询知识库空间信息 |
| `wiki:wiki` | 查看和管理知识库 |
| `docx:document` | 创建、读取和编辑云文档内容 |
| `docx:document.block:convert` | 将 Markdown 转换为飞书云文档块 |

权限变更后，确认应用版本已发布到当前租户。未将机器人加入知识库，或未发布权限变更，都会导致创建节点或写入文档失败。

### 2. 获取配置值

- `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET`：在飞书开放平台应用的“凭证与基础信息”中获取。
- `FEISHU_WIKI_SPACE_ID`：目标知识库的空间 ID。可由知识库管理员通过飞书开放平台的知识库空间列表 API 获取；它不是页面 URL 中的文档节点 Token。
- `FEISHU_WIKI_PARENT_NODE_TOKEN`：可选。打开希望存放报告的知识库目录，URL 中 `/wiki/` 后的值就是该目录节点的 Token。例如：

  ```text
  https://example.feishu.cn/wiki/AbCdEfGhIjKlMnOpQrStUvWxYz
  ```

  此例中的 `AbCdEfGhIjKlMnOpQrStUvWxYz` 就是父节点 Token。留空时，报告直接创建在知识库空间根目录。

### 3. 在 Web 中保存配置

1. 登录系统后打开导航栏“设置”。
2. 在“飞书配置”填写 App ID、App Secret 和知识库空间 ID。
3. 需要归档到指定目录时，再填写父节点 Token。
4. 点击“保存飞书配置”。

设置页不会回显已保存的 Secret。输入框留空表示保留已有值；填写新值会覆盖已有配置。配置保存在运行时数据目录的 `knowledge_base/app_settings.json`，不应提交到 Git。

### 4. 同步结果

点击“同步入库”或由定时任务处理文章时，流程依次执行采集、解析、索引、Agent 分析和知识演进。飞书同步在最后执行：

1. 创建标题为 `Analysis report - <文章标题>` 的知识库云文档。
2. 使用飞书 Markdown 转换接口将报告写成原生标题、列表和段落，而不是显示 Markdown 标记。
3. 有演进结果时，将其追加到同一份云文档。

飞书同步失败不会阻断文章的本地入库、分析报告或演进结果。可在执行历史和服务日志中查看同步错误；日志不会输出飞书 Access Token 或 App Secret。

## Web 使用流程

### 微信订阅

1. 打开 Web 页面，进入“微信订阅”。
2. 点击“生成登录二维码”。
3. 用微信扫码并确认登录。
4. 搜索公众号并点击“订阅”。
5. 设置文章数量。
6. 点击“只取链接”预览文章 URL，或点击“同步入库”进入完整处理管线。
7. 设置采集间隔并创建定时任务。

定时任务会从已订阅公众号拉取上方设置的文章数量，不再手动维护 URL 列表。

### 执行历史

查看每次同步、入库和处理结果。

### 用量

查看 AI Token 用量：

- 请求次数
- 输入 Tokens
- 输出 Tokens
- 总 Tokens
- 最近调用明细

### 提示词

管理 Agent system prompt。保存后下次分析生效。

## CLI 命令

### 常规命令

```bash
npx ts-node src/index.ts crawl "https://mp.weixin.qq.com/s/xxxxx"
npx ts-node src/index.ts pipeline "https://mp.weixin.qq.com/s/xxxxx"
npx ts-node src/index.ts analyze <doc_id>
npx ts-node src/index.ts evolve <doc_id>
npx ts-node src/index.ts search "关键词"
npx ts-node src/index.ts list
```

### 微信公众平台命令

```bash
npm run wx:login
npm run wx:status
npm run wx:search -- "公众号名称"
npx ts-node src/index.ts wx-subscribe --search "公众号名称"
npx ts-node src/index.ts wx-subscriptions
npm run wx:sync -- --urls-only
npm run wx:sync -- -n 5
```

## GitHub Actions

### Docker Workflow

`.github/workflows/docker.yml` 在推送 `v*` tag 时触发，并推送镜像到 Docker Hub。

需要在 GitHub 仓库配置：

| 类型 | 名称 | 说明 |
|------|------|------|
| Secret | `DOCKERHUB_USERNAME` | Docker Hub 用户名或组织名 |
| Secret | `DOCKERHUB_TOKEN` | Docker Hub Access Token |
| Variable | `DOCKERHUB_IMAGE` | 可选，完整镜像名；本项目使用 `williamjih/wechat-knowledge-base` |

建议将 `DOCKERHUB_IMAGE` 设置为：

```text
williamjih/wechat-knowledge-base
```

发布示例：

```bash
git tag v1.0.0
git push origin v1.0.0
```

Workflow 会分别构建：

- `linux/amd64`
- `linux/arm64`

并推送架构标签：

```text
williamjih/wechat-knowledge-base:v1.0.0-amd64
williamjih/wechat-knowledge-base:v1.0.0-arm64
williamjih/wechat-knowledge-base:latest-amd64
williamjih/wechat-knowledge-base:latest-arm64
```

随后创建 multi-arch manifest：

```text
williamjih/wechat-knowledge-base:v1.0.0
williamjih/wechat-knowledge-base:latest
```

用户拉取 `latest` 或版本 tag 时，Docker 会按宿主机架构自动选择镜像。

### Release Workflow

`.github/workflows/release.yml` 在推送稳定版本 tag 时创建 GitHub Release 附件。

`*-alpha*` tag 不触发正式 Release。

Release 产物：

```text
wechat-knowledge-base-v1.0.0.tar.gz
wechat-knowledge-base-v1.0.0.zip
checksums.txt
```

压缩包包含：

- `dist/`
- Web 静态资源
- `package.json`
- `package-lock.json`
- `.env.example`
- `README.md`
- `AGENTS.md`
- `LICENSE`
- `Dockerfile`
- `docker-compose.yml`
- `RUN.md`

## 运行时数据

`knowledge_base/` 是运行时数据目录，不应提交到 Git。

| 路径 | 说明 |
|------|------|
| `knowledge_base/db/` | 数据库 |
| `knowledge_base/raw/` | 原始 HTML |
| `knowledge_base/markdown/` | Markdown 文件 |
| `knowledge_base/images/` | 本地化图片 |
| `knowledge_base/embeddings/` | 向量索引 |
| `knowledge_base/evolution/` | 演化结果 |
| `knowledge_base/reports/` | 分析报告 |
| `knowledge_base/wechat_platform_session.json` | 微信 token/cookie |
| `knowledge_base/wechat_subscriptions.json` | 公众号订阅列表 |
| `knowledge_base/web_auth.json` | Web 登录密码哈希 |
| `knowledge_base/llm_usage.json` | AI Token 用量 |
| `knowledge_base/wechat_qrcode.png` | 临时登录二维码 |

`wechat_qrcode.png` 是临时文件，进程退出时会清理。

## 项目结构

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
│  ├─ usage/              # AI Token 用量记录
│  ├─ web/                # Web API 和前端
│  └─ wechat-platform/    # 微信公众平台登录、搜索、订阅、文章列表
├─ .github/workflows/     # Docker 和 Release workflow
├─ knowledge_base/        # 运行时数据目录
├─ AGENTS.md
├─ Dockerfile
├─ docker-compose.yml
├─ package.json
└─ tsconfig.json
```

## 构建

```bash
npm run build
```

## 许可

MIT
