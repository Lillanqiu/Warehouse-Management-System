# GitHub 隐私与敏感文件清单

本项目可以上传到 GitHub 的内容应该只包含源码、空数据库结构说明、脱敏文档模板和部署说明。真实业务数据、个人信息、导入留档文件和本地运行配置不要提交。

## 绝对不要提交

- 本地配置：`.env`、任何包含真实端口、真实密码、密钥、Token 的配置文件。
- 数据库：`data/`、`warehouse.db`、`*.db`、`*.sqlite`、`*.sqlite3`、`*.sqlitedb`、数据库 dump。
- 导入留档：用户上传的 Word、Excel、PDF、图片、压缩包，以及 `uploads/`、`archives/`、`import_archives/`、`imports/`、`exports/`、`downloads/` 等目录。
- 业务导出：资产表、耗材表、出借记录、打印后的文档、截图、核对用表格。
- 个人隐私：真实姓名、手机号、身份证号、邮箱、内网 IP、部门真实清单、资产价格、资产编号、借用/归还记录。
- 运行痕迹：日志、浏览器缓存、测试截图、临时文件、备份文件。

## 可以提交

- 源码：`server.py`、`app.js`、`index.html`、`styles.css`、`Dockerfile`、`docker-compose.yml`。
- 文档：`README.md`、`docs/*.md`、`docs/schema.sql`。
- 示例配置：`.env.example`，只能写占位值，不能写真实密码。
- 脱敏模板：`templates/*.docx`，只能保留空表结构，不要保留真实申请人、部门、资产编号、作者信息。

## 默认账号与密码规则

- 公开仓库不要写真实默认密码。
- 首次空库启动的管理员临时密码由本地 `.env` 的 `WAREHOUSE_ADMIN_PASSWORD` 控制。
- 导入时自动创建用户的临时密码由本地 `.env` 的 `WAREHOUSE_IMPORTED_USER_PASSWORD` 控制。
- `.env.example` 只保留占位值；真正部署时复制为 `.env` 后再改成本机密码。

## 提交前检查命令

```powershell
git status --short --ignored
```

确认敏感文件只出现在 `!!` 忽略列表里，不要出现在可提交列表。

```powershell
rg --hidden -g "!.git" -g "!.env" -n "password|secret|token|api[_-]?key|密钥|密码|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|[0-9]{11}|身份证|手机号|电话|邮箱"
```

命中后逐条判断：字段名和说明可以保留，真实密码、真实联系人、真实业务记录必须删除或改成占位。

```powershell
git ls-files
```

确认跟踪文件里没有真实数据库、真实导入文件、截图、导出文件。

## 模板检查

提交 Word 模板前要确认：

- 模板是空表，不包含真实申请记录。
- 文档属性里没有真实作者、单位、路径。
- 文件名不包含客户、部门、人员等隐私信息。

## 已配置的保护

`.gitignore` 和 `.dockerignore` 已默认排除数据库、导入导出文件、截图、日志、备份和本地配置。由于项目需要保留两个空模板，规则中特别允许 `templates/*.docx`。
