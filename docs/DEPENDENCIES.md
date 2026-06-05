# 依赖说明

本项目是一个轻量级 Docker 化的厂库出入库管理系统，默认不需要前端打包工具，也不需要 Node.js 运行时。

## 运行依赖

- Docker Engine
- Docker Compose
- 浏览器：Edge、Chrome、Firefox 均可

## 容器内依赖

- Python 3.12 slim
- Python 标准库：
  - `http.server`：提供后端 HTTP 服务
  - `sqlite3`：内置 SQLite 数据库
  - `zipfile`、`xml.etree.ElementTree`：处理 Word 模板和导入文件
  - `csv`、`json`、`base64`、`pathlib`、`uuid`、`re`：数据解析和 API 支撑

项目目前没有 `requirements.txt`，因为后端只使用 Python 标准库。

## 前端依赖

- 原生 HTML、CSS、JavaScript
- 无 npm 依赖
- 无构建步骤

## 数据存储

- SQLite 数据库位于容器内 `/data/warehouse.db`
- Docker Compose 使用命名卷 `warehouse_data` 持久化数据库
- 本仓库不提交真实数据库文件

## 本地配置

复制 `.env.example` 为 `.env` 可修改宿主机端口：

```powershell
Copy-Item .env.example .env
```

默认端口：

```text
WAREHOUSE_HOST_PORT=38280
```

`.env` 是本地配置文件，已加入 `.gitignore`，不要提交到 GitHub。
