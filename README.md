# 厂库出入库管理系统

一个 Docker 化的厂库出入库管理系统，包含浏览器前端、Python 标准库后端 API 和 SQLite 数据库。适合做资产、耗材、出入库、出借、归还、导入留档和操作记录管理。

## 功能概览

- 多用户登录：管理员和普通用户
- 管理员查看全部资产、耗材、出入库记录、用户、操作记录
- 普通用户查看自己的出入库状态，并可提交资产申请和采购需求
- 资产/耗材区分管理
- 入库、出库/出借、归还记录
- Excel 入库导入
- Word 出库/出借单导入
- 导入电子档留档
- 浏览器内资产表打印
- 按模板生成资产/耗材申请确认单
- 纸质/手写材料电子化待复核队列
- 后台操作记录和请求 IP 记录
- 开发者模式下可清空业务数据，用户保留

## 依赖

运行依赖：

- Docker Engine
- Docker Compose
- 浏览器

容器内使用：

- Python 3.12 slim
- SQLite
- Python 标准库

项目无 npm 依赖，无前端构建步骤。详细说明见 [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md)。

## 快速启动

### 新测试机第一次下载并启动

在测试机打开 PowerShell，执行：

```powershell
git clone https://github.com/Lillanqiu/Warehouse-Management-System.git
cd Warehouse-Management-System
Copy-Item .env.example .env
docker compose -p warehouse up --build -d
```

启动完成后打开：

```text
http://127.0.0.1:38280
```

如果不方便使用 Git，也可以在 GitHub 页面点击绿色 `Code` -> `Download ZIP`，解压后进入项目目录，再执行：

```powershell
Copy-Item .env.example .env
docker compose -p warehouse up --build -d
```

### 已经下载过项目后的启动

```powershell
cd Warehouse-Management-System
docker compose -p warehouse up --build -d
```

### 后续更新测试机代码

在项目目录执行：

```powershell
git pull origin main
docker compose -p warehouse up --build -d
```

更详细的测试机部署说明见 [docs/TEST_MACHINE_SETUP.md](docs/TEST_MACHINE_SETUP.md)。

修改端口：

```powershell
$env:WAREHOUSE_HOST_PORT='18080'
docker compose -p warehouse up --build -d
```

或修改本地 `.env`：

```text
WAREHOUSE_HOST_PORT=18080
```

## 默认账号

空库首次启动只创建一个管理员账号：

```text
账号：admin
密码：由本地 .env 的 WAREHOUSE_ADMIN_PASSWORD 控制
```

首次部署后请立即修改临时密码。不要把真实密码写入要上传 GitHub 的文件。

## 数据库与脱敏

SQLite 数据库位于容器内：

```text
/data/warehouse.db
```

Docker Compose 使用命名卷持久化：

```text
warehouse_data
```

本仓库不提交真实业务数据库。已通过 `.gitignore` 排除：

- `.env`
- `data/`
- `*.db`
- `*.sqlite`
- 导入留档目录
- 截图和浏览器缓存

数据库结构说明见 [docs/DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md)。
隐私和敏感文件清单见 [docs/PRIVACY_AND_GITHUB_CHECKLIST.md](docs/PRIVACY_AND_GITHUB_CHECKLIST.md)。

## 上传 GitHub 前检查

运行：

```powershell
git status --short --ignored
```

确保没有提交以下内容：

- 真实 SQLite 数据库
- 导入的 Word/Excel 原始业务文件
- 包含人员、资产、价格、内网地址的截图
- 本地 `.env`

如果需要完全空库运行，直接使用新的 Docker volume 启动即可；后端会自动建表并只创建默认管理员账号。

## 常用命令

查看容器状态：

```powershell
docker compose -p warehouse ps
```

查看日志：

```powershell
docker compose -p warehouse logs --tail 50
```

停止：

```powershell
docker compose -p warehouse down
```

重新构建：

```powershell
docker compose -p warehouse up --build -d
```
