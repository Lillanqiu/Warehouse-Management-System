# 测试机拉取与一键启动

这份文档用于在一台新的测试机上从 GitHub 拉取项目、生成本地配置、启动 Docker 服务，并进行后续更新调试。

## 前置要求

测试机需要先安装：

- Git
- Docker Desktop 或 Docker Engine
- 浏览器

确认命令可用：

```powershell
git --version
docker --version
docker compose version
```

## Windows PowerShell 一键拉取启动

在测试机打开 PowerShell，执行：

```powershell
$repo = "https://github.com/Lillanqiu/Warehouse-Management-System.git"
$dir = "Warehouse-Management-System"
git clone $repo $dir
Set-Location $dir
Copy-Item .env.example .env
docker compose -p warehouse up --build -d
Write-Host "启动完成，打开：http://127.0.0.1:38280"
```

首次空库登录：

```text
账号：admin
密码：change-me-before-use
```

登录后请立即在系统里修改密码。正式测试前，也可以直接编辑本地 `.env`：

```text
WAREHOUSE_HOST_PORT=38280
WAREHOUSE_ADMIN_PASSWORD=请在测试机本地填写
WAREHOUSE_IMPORTED_USER_PASSWORD=请在测试机本地填写
```

`.env` 已被 `.gitignore` 忽略，不要上传到 GitHub。

## 修改端口启动

如果 `38280` 被占用，可以修改 `.env`：

```text
WAREHOUSE_HOST_PORT=18080
```

然后重启：

```powershell
docker compose -p warehouse up --build -d
```

打开：

```text
http://127.0.0.1:18080
```

## 更新测试机代码

已经拉取过项目后，在项目目录执行：

```powershell
git pull origin main
docker compose -p warehouse up --build -d
```

## 查看运行状态

```powershell
docker compose -p warehouse ps
```

查看日志：

```powershell
docker compose -p warehouse logs --tail 80
```

实时看日志：

```powershell
docker compose -p warehouse logs -f
```

停止服务：

```powershell
docker compose -p warehouse down
```

## 测试机重置为空库

此操作会删除测试机上的业务数据，只适合测试环境使用。

```powershell
docker compose -p warehouse down
docker volume rm warehouse_data
docker compose -p warehouse up --build -d
```

重置后会重新创建空数据库，并只生成默认管理员账号。

## 常见问题

如果 GitHub 页面提示 `master had recent pushes`，说明分支没有统一。测试机只使用：

```powershell
git pull origin main
```

如果 Docker 提示端口占用，修改 `.env` 里的 `WAREHOUSE_HOST_PORT` 后重新启动。

如果页面没有更新，先确认容器已重新构建：

```powershell
docker compose -p warehouse up --build -d
```

然后浏览器强制刷新页面。
