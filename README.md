# param-demo

轻量级参数配置中心（Express + Vue + SQLite）

- [动态参数配置数据结构设计](docs/data-model.md)
- Demo 功能：用户、应用、环境、配置类型、字段、版本、配置项维护、审计日志、配置查询

## 快速开始（Express + SQLite）
```bash
cd backend
npm install
npm start
# 浏览器访问 http://localhost:8000/
```

服务启动后：
- API 入口：`http://localhost:8000/api`
- 前端页面：`http://localhost:8000/`

## 主要 API
- `GET /api/health` 健康检查
- 用户：`GET/POST /api/users`
- 应用：`GET/POST /api/apps`
- 环境：`GET/POST /api/envs`
- 配置类型：`GET/POST /api/types`
- 类型字段：`GET /api/type-fields?typeId=...`，`POST /api/type-fields`
- 版本：`POST /api/versions`，`POST /api/versions/{id}/submit`，`POST /api/versions/{id}/publish`，`GET /api/versions`
- 配置项维护：`GET /api/items?versionId=...`，`POST /api/items/upsert`
- 配置查询：`GET /api/config?appCode=...&envCode=...&typeCode=...`
- 审计日志：`GET /api/audit`

## 目录结构
```
backend/   # Express + SQLite API 服务（同时服务前端静态文件）
frontend/  # Vue 单页界面，含管理菜单与数据维护
docs/      # 数据模型设计文档
```
