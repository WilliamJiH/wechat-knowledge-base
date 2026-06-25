# 微信公众号知识演化系统

本项目是一个"公众号知识演化系统"，用于自动采集公众号文章，将其转换为 Markdown 知识库，并通过多 Agent 系统进行语义分析、观点对比与知识演化，最终形成可持续更新的知识体系。

> Agent 协作规范详见 [AGENTS.md](./AGENTS.md)

## ✨ 主要特性

- 定时抓取公众号文章（wechatDownload / RSS）
- HTML → Markdown 标准化存储
- 图片本地化存储
- 飞书知识库同步（可选）
- 向量化索引（embedding）
- 多 Agent 知识分析（Analyst / Critic / Strategist）
- 观点对比与演化链生成
- 人工审核闭环

## 🚀 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入 DeepSeek API Key（必填）和飞书配置（可选）
```

### 3. 启动 Web 管理界面（推荐）

```bash
# 启动 Web 服务（默认端口 3000）
npm run web

# 自定义端口
npx ts-node src/index.ts web -p 8080
```

访问 `http://localhost:3000` 即可使用 Web 管理界面：
- **快速爬取**：输入链接立即爬取，走完整管线
- **定时任务**：设置采集间隔（1h ~ 7天）+ 链接列表，自动周期执行
- **执行历史**：查看每次爬取的成功/失败记录

> 定时任务持久化运行，关闭网页不影响后台采集。

### 4. 爬取一篇文章（CLI）

```bash
npx ts-node src/index.ts crawl "https://mp.weixin.qq.com/s/xxxxx"
```

### 5. 运行完整管线（爬取 + 分析 + 演化）

```bash
npx ts-node src/index.ts pipeline "https://mp.weixin.qq.com/s/xxxxx"
```

### 6. 语义检索知识库

```bash
npx ts-node src/index.ts search "AI 大模型发展趋势"
```

### 7. 启动定时采集任务（CLI）

```bash
npx ts-node src/index.ts start --rss "https://rsshub.app/wechat/mp/xxx"
```

### 8. 查看所有已采集文章

```bash
npx ts-node src/index.ts list
```

### 完整命令列表

| 命令 | 说明 |
|------|------|
| `crawl <urls...>` | 爬取微信公众号文章（支持 `--rss` 模式） |
| `analyze <doc_id>` | 对已爬取文章运行多 Agent 分析管线 |
| `evolve <doc_id>` | 基于已分析观点生成演化链 |
| `index <doc_id>` | 为文章生成向量化索引 |
| `search <query>` | 语义检索知识库（支持 `-k` 参数） |
| `pipeline <urls...>` | 一键完整管线：爬取→转换→索引→分析→演化 |
| `web [-p <port>]` | 启动 Web 管理界面（默认端口 3000） |
| `start [--rss <feeds>]` | 启动 CLI 定时采集调度器 |
| `list` | 列出所有已采集文章及状态 |

---

## 微信公众平台订阅采集

本项目已融合 `rachelos/we-mp-rss` 中的微信公众平台二维码登录、公众号搜索和订阅文章列表能力；RSS、PDF、主题、Webhook 等其它功能未引入。

二维码登录依赖 Playwright。首次使用前安装浏览器自动化依赖：

```bash
npm install playwright
npx playwright install chromium
```

常用命令：

```bash
# 生成二维码并等待微信扫码登录，token/cookie 会保存到 knowledge_base/wechat_platform_session.json
npm run wx:login

# 查看登录状态
npm run wx:status

# 搜索公众号，记录输出中的 fakeId
npm run wx:search -- "公众号名称"

# 订阅搜索结果第一条
npx ts-node src/index.ts wx-subscribe --search "公众号名称"

# 或直接用 fakeId 订阅
npx ts-node src/index.ts wx-subscribe <fakeId> --name "公众号名称"

# 查看订阅列表
npx ts-node src/index.ts wx-subscriptions

# 只拉取并打印订阅文章 URL
npm run wx:sync -- --urls-only

# 同步订阅文章并进入现有完整管线
npm run wx:sync -- -n 5
```

同步流程会调用当前项目已有的 `processArticle`，文章采集、Markdown 转换、图片本地化、索引、Agent 分析和演化链仍按 `AGENTS.md` 的管线执行。

---

## 🛠 开发指南

```bash
# 开发模式（启动 Web 服务 + API + 定时任务）
npm run dev          # 访问 http://localhost:3000
npm run web          # 同上，或自定义端口：npx ts-node src/index.ts web -p 8080

# 编译
npm run build        # tsc 编译到 dist/

# CLI 命令（单独使用）
npm run crawl -- "https://mp.weixin.qq.com/s/xxxxx"    # 爬取文章
npx ts-node src/index.ts pipeline "URL"                # 完整管线
npx ts-node src/index.ts search "关键词"               # 语义检索

# 环境变量
# .env 中可配置 WEB_PORT=3000 修改默认端口
```

---

## 📁 目录结构

```
wechat-knowledge-base/
├── src/                        # 源码
├── knowledge_base/             # 数据目录（运行时自动生成）
│   ├── raw/                    # 原始 HTML 备份
│   ├── markdown/               # 转换后的 Markdown 文件
│   ├── images/                 # 本地化图片
│   ├── embeddings/             # 向量索引文件
│   ├── db/                     # SQLite 数据库
│   ├── evolution/              # 演化链 JSON 文件
│   └── index.json              # 文章索引清单
├── .env.example                # 环境变量示例
├── AGENTS.md                   # Agent 协作规范
├── tsconfig.json
└── package.json
```

---

## 🤝 贡献指南

欢迎各种形式的贡献！

- 🐛 报告 Bug
- 💡 提出新功能
- 📝 改进文档
- 🔧 提交代码

---

## 📜 许可证

本项目采用 [MIT 许可证](./LICENSE) 授权。

本项目旨在处理用户提供或公开可访问的内容。用户在使用本工具获取或存储第三方内容（例如微信文章）时，有责任确保遵守适用的版权法律。
