# param-demo

参数配置

- [动态参数配置数据结构设计](docs/data-model.md)
- 轻量级运行示例：Vue + Python（SQLite）全栈 Demo

## 快速开始

本仓库自带一个无需额外依赖的轻量级配置中心 Demo，使用 Python 标准库 + SQLite 提供 API，并用 Vue 单页页面操作。

### 启动
```bash
# 1) 启动后端（包含静态文件服务）
python backend/server.py

# 2) 打开浏览器访问
# http://localhost:8000/
```

服务启动后：
- API 入口：`http://localhost:8000/api`
- 前端页面：`http://localhost:8000/`

### 主要 API
- `GET /api/health` 健康检查
- `POST /api/types` 创建配置类型与字段
- `GET /api/types` 查询类型
- `POST /api/versions` 创建配置版本（草稿）
- `POST /api/versions/{id}/publish` 发布版本并标记当前
- `GET /api/versions` 查询版本列表
- `GET /api/config?appCode=...&envCode=...&typeCode=...` 获取当前/指定版本配置

### 目录结构
```
backend/   # Python + SQLite API 服务（同时服务前端静态文件）
frontend/  # Vue 单页页面，演示创建类型/版本/发布/查询
docs/      # 数据模型设计文档
```
