# 学校资产与厂库出入库管理系统

一个 Docker 化的资产、耗材、出入库和盘点管理系统。项目使用原生 HTML/CSS/JavaScript 前端、Python 标准库后端 API 和 SQLite 数据库，不需要 npm 打包流程。

默认访问地址：

```text
http://127.0.0.1:38280
```

默认登录：

```text
账号：admin
密码：admin
```

## 功能概览

- 用户与权限：支持管理员、资产管理员、部门负责人、普通教师、普通用户等角色，包含角色表、权限表和菜单权限控制。
- 资产台账：支持资产编号、名称、分类、规格、品牌、单位、数量、单价、总金额、购置日期、入库日期、供应商、使用部门、使用人、资产来源、创建人、更新时间、资产图片等字段。
- 资产状态：按资产/耗材归类展示，支持状态筛选、分类筛选、责任人/出借人筛选、分页、排序、资产详情抽屉和独立详情链接。
- 二维码与标签：资产详情页可生成二维码标签，扫码/链接可进入资产详情；资产状况里的标签显示可在“设置 -> 实验室功能”里单独开关。
- 出入库与出借：支持手动登记、Excel 入库导入、Word 出库/出借单导入、按人员查看领取资产和耗材；导入记录优先使用文档里的业务时间，导入时间只作为留档信息。
- 库存管理：耗材按可出借状态管理，仓库数量统一显示为“-”；支持入库/出库流水登记，登记时可输入耗材名称、编号、规格或资产详情链接，不需要长列表滚动选择。
- 盘点管理：支持创建盘点任务、录入明细、自动识别数量差异、位置异常和状态异常。
- 业务单据：支持资产申请、领用/借用、调拨、维修、报废等流程雏形，部分流程已接入审批状态和资产流转日志。
- 纸质单据：纸质/手写材料电子化待复核队列可在“设置 -> 实验室功能”里单独开关。
- 疑似重复档：导入内容接近或文档内容接近时，会归纳到“疑似重复档”，并支持展开、收起、隐藏三个挡位。
- 报表与导出：支持资产总账、分类/部门/位置/责任人统计、出入库明细、盘点差异等 CSV 导出能力。
- 操作日志：记录操作人、时间、IP、对象、业务单号和操作详情。

## 快速启动

确认本机已安装 Docker Desktop 或 Docker Engine，然后在项目目录执行：

```powershell
Copy-Item .env.example .env
docker compose -p warehouse up --build -d
```

启动完成后打开：

```text
http://127.0.0.1:38280
```

如果是第一次从 GitHub 拉取：

```powershell
git clone https://github.com/Lillanqiu/Warehouse-Management-System.git
cd Warehouse-Management-System
Copy-Item .env.example .env
docker compose -p warehouse up --build -d
```

如果已经下载过项目，后续更新代码后执行：

```powershell
git pull origin main
docker compose -p warehouse up --build -d
```

## 快速上线

这套项目可以先按 Docker 单机方式上线，优先保证能登录、能导入、能查台账、能查看健康状态。已经在项目目录里时，执行：

```powershell
Copy-Item .env.example .env -ErrorAction SilentlyContinue
docker compose -p warehouse up --build -d
docker compose -p warehouse ps
Invoke-RestMethod http://127.0.0.1:38280/api/health
```

看到 `docker compose ps` 里的 `warehouse-system` 为 `Up`，并且健康检查接口返回 `"ok": true`，就说明容器、后端和 SQLite 数据库都已经正常。

上线前建议至少确认：

- 能用 `admin / admin` 登录。
- 打开“资产状态”“库存管理”“出入库登记”“设置”四个页面没有报错。
- `http://127.0.0.1:38280/api/health` 返回 `ok: true`。
- 正式使用前把 `.env` 里的 `WAREHOUSE_ADMIN_PASSWORD` 改成强密码，再重新执行 `docker compose -p warehouse up --build -d`。

## 更新容器命令

已经在项目目录里时，直接执行：

```powershell
git pull origin main
docker compose -p warehouse up --build -d
docker compose -p warehouse ps
```

如果只是改了本地文件，不需要拉取 GitHub 代码，只执行：

```powershell
docker compose -p warehouse up --build -d
docker compose -p warehouse ps
```

更新后打开：

```text
http://127.0.0.1:38280
```

## 默认账号

系统默认管理员为：

```text
账号：admin
密码：admin
```

`docker-compose.yml` 和 `.env.example` 已将 `WAREHOUSE_ADMIN_PASSWORD` 默认设为 `admin`。后端启动时会同步校正 `admin` 账号的登录密码，所以旧数据库重启后也会跟随当前环境变量生效。

正式部署或共享给他人使用前，建议把本地 `.env` 里的管理员密码改成自己的强密码：

```text
WAREHOUSE_ADMIN_PASSWORD=请在本机填写强密码
```

`.env` 是本地配置文件，已被 `.gitignore` 忽略，不要提交到 GitHub。

## 修改端口

默认端口是 `38280`。如果端口被占用，可以修改本地 `.env`：

```text
WAREHOUSE_HOST_PORT=18080
```

然后重启：

```powershell
docker compose -p warehouse up --build -d
```

访问地址会变成：

```text
http://127.0.0.1:18080
```

## 常用命令

查看容器状态：

```powershell
docker compose -p warehouse ps
```

查看日志：

```powershell
docker compose -p warehouse logs --tail 50
```

重新构建并启动：

```powershell
docker compose -p warehouse up --build -d
```

停止服务：

```powershell
docker compose -p warehouse down
```

如果测试环境需要清空业务数据，可以删除 Docker volume 后重新启动：

```powershell
docker compose -p warehouse down
docker volume rm warehouse_warehouse_data
docker compose -p warehouse up --build -d
```

## 查看容器和数据卷位置

查看当前容器状态和端口：

```powershell
docker compose -p warehouse ps
```

查看容器详细信息：

```powershell
docker inspect warehouse-system
```

查看容器挂载了哪些数据卷，以及数据卷在宿主机上的位置。输出顺序是：容器路径、数据卷名、宿主机位置。

```powershell
docker inspect warehouse-system --format '{{range .Mounts}}{{.Destination}} {{.Name}} {{.Source}}{{println}}{{end}}'
```

查看所有 Docker 数据卷：

```powershell
docker volume ls
```

查看本系统数据卷详情。使用 `-p warehouse` 启动时，数据卷通常叫 `warehouse_warehouse_data`：

```powershell
docker volume inspect warehouse_warehouse_data
```

如果本机之前没有使用 `-p warehouse` 启动过，也可以先用 `docker volume ls` 找到名字里带 `warehouse_data` 的数据卷，再执行：

```powershell
docker volume inspect 数据卷名称
```

系统数据库在容器内部的位置是：

```text
/data/warehouse.db
```

在 Windows Docker Desktop 里，`docker volume inspect` 显示的 `Mountpoint` 通常是 Docker Linux 虚拟机内部路径，不一定能像普通 Windows 文件夹一样直接打开。日常备份或排查优先用 Docker 命令查看。

## 数据与隐私

SQLite 数据库位于容器内：

```text
/data/warehouse.db
```

Docker Compose 使用命名卷持久化数据：

```text
warehouse_warehouse_data
```

不要提交真实业务数据、导入原始文件、截图、`.env`、数据库文件或包含人员/资产/价格信息的导出文件。

更多说明：

- [依赖说明](docs/DEPENDENCIES.md)
- [测试机部署说明](docs/TEST_MACHINE_SETUP.md)
- [数据库结构说明](docs/DATABASE_SCHEMA.md)
