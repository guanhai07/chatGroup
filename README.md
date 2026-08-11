# Chat Group - 多模型讨论工具

本地单机的 AI 中转站管理与多模型讨论工具。支持添加多个 OpenAI 兼容的中转站,进行单模型对话或多模型轮流讨论。

## 功能

### 第一阶段:站点管理与对话
- 添加/编辑/删除 AI 中转站(Base URL + API Key)
- 自动拉取中转站模型列表,也支持手动维护
- 单模型流式对话(SSE),支持系统提示词
- 会话历史本地持久化(SQLite)

### 第二阶段:多模型讨论
- 在对话框中选择多个模型
- 按固定轮次轮流发言,每个模型都能看到前面的完整讨论记录
- 讨论结束后自动生成总结
- 单个模型调用失败不会中断整个讨论

## 技术栈

- **前端**: React 18 + TypeScript + Vite
- **后端**: Node.js + Express + TypeScript
- **数据库**: SQLite (better-sqlite3)
- **流式通信**: SSE

## 快速开始

```bash
# 安装依赖
npm install

# 启动后端 (http://localhost:3001)
npm run dev -w packages/server

# 启动前端 (http://localhost:5173) - 另开一个终端
npm run dev -w packages/client
```

打开 http://localhost:5173 使用。

## 使用流程

1. **站点管理页**:添加中转站(名称、Base URL、API Key),点击"刷新模型"拉取模型列表
2. **对话页**:选择站点和模型,输入消息进行单模型流式对话
3. **多模型讨论页**:勾选多个模型、设置轮数、输入讨论话题,点击"开始讨论"

## 项目结构

```
packages/
  shared/    # 前后端共享类型定义
  server/    # Express 后端, API 代理 + SQLite 存储
  client/    # React 前端
```

## 配置说明

- 后端端口:环境变量 `PORT`,默认 3001
- 数据库:自动创建于 `packages/server/data/chat-group.db`
- 所有中转站需兼容 OpenAI Chat Completions API(`/v1/chat/completions`)

## 已实现 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/providers` | 站点列表/创建 |
| PUT/DELETE | `/api/providers/:id` | 站点修改/删除 |
| POST | `/api/providers/:id/models` | 拉取模型列表 |
| POST | `/api/chat/sessions` | 创建对话会话 |
| GET | `/api/chat/sessions/:id` | 获取会话消息 |
| POST | `/api/chat/:sessionId` | 流式对话(SSE) |
| POST | `/api/discussion/sessions` | 创建讨论会话 |
| POST | `/api/discussion/:sessionId` | 多模型讨论(SSE) |

## 冒烟测试

先启动后端，再在另一个终端运行：

```bash
npm run start -w packages/server
npm test
```

可选：`BASE_URL=http://127.0.0.1:3001 npm test`

