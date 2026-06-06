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

如果提示找不到命令，可以先用 Windows 自带的 `winget` 补齐环境：

```powershell
winget install --id Git.Git -e
winget install --id Docker.DockerDesktop -e
```

如果 Docker Desktop 提示需要 WSL，或者测试机还没有 Ubuntu 子系统，先用管理员 PowerShell 执行：

```powershell
wsl --install
wsl --install -d Ubuntu
wsl --update
wsl -l -v
```

说明：

- `wsl --install` 用于安装 Windows Subsystem for Linux。
- `wsl --install -d Ubuntu` 用于安装 Ubuntu 子系统。
- `wsl --update` 用于更新 WSL。
- `wsl -l -v` 用于查看 Ubuntu 是否安装成功，以及 WSL 版本。

第一次打开 Ubuntu 时会要求创建 Linux 用户名和密码，这个是 Ubuntu 子系统自己的账号，不是厂库系统的登录账号。

Docker Desktop 启动后，进入 `Settings` -> `Resources` -> `WSL Integration`，确认 Ubuntu 已启用。

安装完成后：

1. 重启 PowerShell。
2. 打开 Docker Desktop。
3. 等 Docker Desktop 显示正在运行后，再执行启动命令。

再次确认：

```powershell
git --version
docker --version
docker compose version
```

## 先把项目下载到测试机

测试机第一次使用时，必须先把 GitHub 上的项目下载到本机。推荐使用 Git 拉取，因为后续更新更方便。

### 方式一：Git 拉取，推荐

在测试机打开 PowerShell，执行：

```powershell
git clone https://github.com/Lillanqiu/Warehouse-Management-System.git
cd Warehouse-Management-System
Copy-Item .env.example .env
docker compose -p warehouse up --build -d
```

启动后打开：

```text
http://127.0.0.1:38280
```

以后要更新测试机，只需要在项目目录执行：

```powershell
git pull origin main
docker compose -p warehouse up --build -d
```

### 方式二：GitHub 网页下载 ZIP

如果测试机不方便用 Git，也可以在 GitHub 页面下载压缩包：

1. 打开项目页面。
2. 点击绿色 `Code` 按钮。
3. 点击 `Download ZIP`。
4. 解压到测试机上的任意目录。
5. 在解压后的项目目录打开 PowerShell。

然后执行：

```powershell
Copy-Item .env.example .env
docker compose -p warehouse up --build -d
```

ZIP 方式也能启动系统，但后续更新不如 Git 方便。需要更新时通常要重新下载新的 ZIP。

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

注意：默认不是 `admin/admin`。管理员密码只会在第一次创建空数据库时写入一次；如果数据库已经存在，后面修改 `.env` 里的 `WAREHOUSE_ADMIN_PASSWORD` 不会自动修改数据库里的旧密码。

登录后请立即在系统里修改密码。正式测试前，也可以直接编辑本地 `.env`：

```text
WAREHOUSE_HOST_PORT=38280
WAREHOUSE_ADMIN_PASSWORD=请在测试机本地填写
WAREHOUSE_IMPORTED_USER_PASSWORD=请在测试机本地填写
```

`.env` 已被 `.gitignore` 忽略，不要上传到 GitHub。

## 登录密码不对怎么办

先确认你输入的是本机 `.env` 里的 `WAREHOUSE_ADMIN_PASSWORD`。如果测试机只是复制了 `.env.example`，请用：

```text
账号：admin
密码：change-me-before-use
```

如果这个测试库不需要保留业务数据，可以重置为空库：

```powershell
docker compose -p warehouse down
docker volume rm warehouse_data
docker compose -p warehouse up --build -d
```

如果要保留测试数据，只重置管理员密码，可以在项目目录执行：

```powershell
docker compose -p warehouse exec warehouse python -c "import sqlite3; c=sqlite3.connect('/data/warehouse.db'); c.execute('update users set password=?, active=1 where username=?', ('change-me-before-use','admin')); c.commit(); print('admin password reset')"
```

然后用：

```text
账号：admin
密码：change-me-before-use
```

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
