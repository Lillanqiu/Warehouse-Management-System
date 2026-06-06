# 数据库架构说明

系统使用 SQLite。首次启动时，如果 `/data/warehouse.db` 不存在，后端会自动建表。

为了上传 GitHub 时避免泄露业务数据，本仓库不包含真实数据库文件，只保留建表逻辑和空库初始化能力。

纯建表 SQL 见 [schema.sql](schema.sql)。

## 默认空库行为

首次启动后只创建一个管理员账号：

```text
账号：admin
密码：由本地 .env 的 WAREHOUSE_ADMIN_PASSWORD 控制
```

上线或共享前请登录后立即修改临时密码。不要把真实密码写入要上传 GitHub 的文件。

## 数据表

### `users`

用户表。

| 字段 | 说明 |
| --- | --- |
| `id` | 用户 ID |
| `username` | 登录账号 |
| `password` | 登录密码 |
| `name` | 姓名 |
| `role` | `admin` 或 `user` |
| `department` | 部门 |
| `active` | 是否启用 |

### `assets`

资产/耗材主表。

| 字段 | 说明 |
| --- | --- |
| `id` | 资产 ID |
| `code` | 资产编号 |
| `name` | 物品名称 |
| `category` | 类别 |
| `spec` | 规格/配置 |
| `quantity` | 数量 |
| `location` | 位置 |
| `keeper_id` | 当前保管/关联用户 |
| `status` | `in_stock` 或 `checked_out` |
| `remark` | 备注 |

### `records`

出入库记录表。出库和出借按同一类业务处理。

| 字段 | 说明 |
| --- | --- |
| `id` | 记录 ID |
| `asset_id` | 资产 ID |
| `type` | 入库/出库 |
| `quantity` | 数量 |
| `user_id` | 借用/领用/归还人 |
| `operator_id` | 操作人 |
| `in_time` | 入库/归还时间 |
| `out_time` | 出库/借出时间 |
| `status` | 记录状态 |
| `paper_no` | 纸质单号 |
| `note` | 备注 |
| `photo` | 现场照片 Data URL |

### `audits`

后台操作记录表。

| 字段 | 说明 |
| --- | --- |
| `id` | 记录 ID |
| `time` | 操作时间 |
| `user_id` | 操作用户 |
| `action` | 动作 |
| `detail` | 详情 |
| `ip` | 请求 IP |

### `paper_queue`

纸质单据待复核队列表。

### `departments`

部门表。

### `import_archives`

导入文件留档表，包含原始文件二进制内容。此表可能包含敏感业务文件，真实数据库不要上传。

### `system_settings`

系统设置表。

### `admin_requests`

普通用户申请管理员权限记录。

### `asset_requests`

普通用户申请资产记录。

### `purchase_wishes`

需求清单/采购愿望清单，用于下一年度预算和采购参考。

## 上传 GitHub 前检查

确认以下内容没有被提交：

- `.env`
- `data/`
- `*.db`
- `*.sqlite`
- 导入留档文件
- 截图、测试图片、浏览器缓存

推荐命令：

```powershell
git status --ignored
```
