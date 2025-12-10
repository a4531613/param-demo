# 企业级参数配置中心（Express + SQLite + Vue3 + Vite + Element Plus）

## 功能概览
- 配置类型：多应用/多环境隔离，增删改查。
- 配置版本：待发布/已发布/归档，发布&回滚（基于已发布版本克隆）。
- 字段定义：绑定版本（不影响历史已发布版本）。
- 配置数据：按版本录入，JSON 存储动态字段。
- 版本对比：字段与数据的差异对比。
- 对外读取接口：按 appCode/typeCode/env 获取已发布配置。
- 审计日志：记录核心操作。

## 目录
- `backend/` Express + SQLite（better-sqlite3）
- `frontend/` Vite + Vue3 + Element Plus

## 启动
```bash
# 后端
cd backend
npm install
node index.js   # 端口 8000

# 前端（新终端）
cd ../frontend
npm install
npm run dev     # 端口 5173
```
前端默认请求 `http://localhost:8000/api`，后端会服务 dist 静态文件（如已 build）。

## 构建前端
```bash
cd frontend
npm run build   # 构建到 frontend/dist
```
构建后，后端可直接静态托管 dist。

## 关键 API（摘要）
- 类型：`GET/POST/PATCH/DELETE /api/types`，`/api/types/:id`
- 版本：`GET /api/types/:typeId/versions`，`POST /api/types/:typeId/versions`，`PATCH /api/versions/:id/publish`
- 字段：`GET /api/versions/:versionId/fields`，`POST /api/versions/:versionId/fields`
- 数据：`GET /api/versions/:versionId/data`，`POST /api/versions/:versionId/data`
- 对外配置：`GET /api/config/:appCode/:typeCode`，`GET /api/config/:appCode/:typeCode/:key`（?env=dev|test|pre|prod）
- 对比：`GET /api/versions/:a/diff/:b`
- 审计：`GET /api/audit`

请求头简单鉴权：`X-User`（操作者），`X-Role`（admin/appOwner/viewer，示例默认 admin）。

## 打包为 zip（Windows PowerShell）
```powershell
Compress-Archive -Path backend,frontend,README.md -DestinationPath config-center.zip -Force
```

## 注意
- SQLite 文件：`backend/config-center.db`
- 仅 PENDING_RELEASE 版本可编辑字段和数据；发布后旧 RELEASED 会被标记 ARCHIVED。
