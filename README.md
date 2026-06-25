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

### 3. 爬取一篇文章

```bash
npx ts-node src/index.ts crawl "https://mp.weixin.qq.com/s/xxxxx"
```

### 4. 运行完整管线（爬取 + 分析 + 演化）

```bash
npx ts-node src/index.ts pipeline "https://mp.weixin.qq.com/s/xxxxx"
```

### 5. 语义检索知识库

```bash
npx ts-node src/index.ts search "AI 大模型发展趋势"
```

### 6. 启动定时采集任务

```bash
npx ts-node src/index.ts start --rss "https://rsshub.app/wechat/mp/xxx"
```

### 7. 查看所有已采集文章

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
| `start [--rss <feeds>]` | 启动定时采集调度器 |
| `list` | 列出所有已采集文章及状态 |

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
