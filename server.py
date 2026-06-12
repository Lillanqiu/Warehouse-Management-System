import json
import os
import sqlite3
import uuid
import secrets
import base64
import csv
import io
import zipfile
import contextvars
import copy
import traceback
import hashlib
from datetime import datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse
from xml.etree import ElementTree
import re


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("DATA_DIR", BASE_DIR / "data"))
DB_PATH = Path(os.environ.get("DB_PATH", DATA_DIR / "warehouse.db"))
TEMPLATE_DIR = BASE_DIR / "templates"
ASSET_REQUEST_TEMPLATE = TEMPLATE_DIR / "asset-request-template.docx"
CONSUMABLE_REQUEST_TEMPLATE = TEMPLATE_DIR / "consumable-request-template.docx"
CONFIG_FILE = Path(os.environ.get("CONFIG_FILE", "/config/port.env"))
PORT = int(os.environ.get("PORT", "8000"))
PUBLIC_PORT = os.environ.get("PUBLIC_PORT") or os.environ.get("WAREHOUSE_HOST_PORT") or os.environ.get("PORT", "8000")
DEFAULT_ADMIN_PASSWORD = os.environ.get("WAREHOUSE_ADMIN_PASSWORD", "admin")
DEFAULT_IMPORTED_USER_PASSWORD = os.environ.get("WAREHOUSE_IMPORTED_USER_PASSWORD", "change-me-before-use")
BEIJING_TZ = timezone(timedelta(hours=8))
APP_VERSION = "20260612-dashboard-overview-v134"
REQUEST_IP = contextvars.ContextVar("request_ip", default="")
W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
XML_NS = "http://www.w3.org/XML/1998/namespace"
ElementTree.register_namespace("w", W_NS)


class AuthError(PermissionError):
    pass

ROLE_DEFINITIONS = [
    ("admin", "系统管理员", "拥有全部菜单、数据和系统设置权限"),
    ("asset_manager", "资产管理员", "维护资产台账、出入库、盘点、调拨、维修和报废"),
    ("department_head", "部门负责人", "查看本部门资产并审批本部门申请"),
    ("teacher", "普通教师", "查看本人资产并提交领用、借用、维修和采购需求"),
    ("user", "普通用户", "兼容旧版普通用户权限"),
]

MENU_DEFINITIONS = [
    ("dashboard", "总览"),
    ("assets", "资产状态"),
    ("inventory", "库存管理"),
    ("records", "出入库登记"),
    ("checks", "盘点管理"),
    ("orders", "业务单据"),
    ("reports", "报表统计"),
    ("assetRequests", "资产申请"),
    ("purchaseWishes", "需求清单"),
    ("paper", "纸质单据方案"),
    ("users", "用户管理"),
    ("baseData", "基础数据"),
    ("settings", "设置"),
    ("audit", "操作记录"),
]

PERMISSION_DEFINITIONS = [
    ("system.admin", "系统管理"),
    ("dashboard.view", "查看总览"),
    ("assets.view", "查看资产"),
    ("assets.view.all", "查看全部资产"),
    ("assets.manage", "维护资产"),
    ("inventory.view", "查看库存"),
    ("inventory.manage", "维护库存"),
    ("records.view", "查看出入库"),
    ("records.manage", "登记出入库"),
    ("checks.view", "查看盘点"),
    ("checks.manage", "维护盘点"),
    ("orders.view", "查看业务单据"),
    ("orders.manage", "维护业务单据"),
    ("orders.approve", "审批业务单据"),
    ("reports.view", "查看报表"),
    ("reports.export", "导出报表"),
    ("asset_requests.view", "查看资产申请"),
    ("asset_requests.manage", "处理资产申请"),
    ("purchase_wishes.view", "查看采购需求"),
    ("purchase_wishes.manage", "处理采购需求"),
    ("paper.view", "查看纸质单据"),
    ("paper.manage", "维护纸质单据"),
    ("users.view", "查看用户"),
    ("users.manage", "维护用户"),
    ("base_data.view", "查看基础数据"),
    ("base_data.manage", "维护基础数据"),
    ("settings.view", "查看设置"),
    ("settings.manage", "维护设置"),
    ("audit.view", "查看操作记录"),
]

ROLE_PERMISSION_MAP = {
    "admin": [code for code, _ in PERMISSION_DEFINITIONS],
    "asset_manager": [
        "dashboard.view", "assets.view", "assets.view.all", "assets.manage",
        "inventory.view", "inventory.manage", "records.view", "records.manage",
        "checks.view", "checks.manage", "orders.view", "orders.manage",
        "orders.approve", "reports.view", "reports.export",
        "asset_requests.view", "asset_requests.manage",
        "purchase_wishes.view", "purchase_wishes.manage",
        "paper.view", "paper.manage", "base_data.view", "base_data.manage",
        "audit.view",
    ],
    "department_head": [
        "dashboard.view", "assets.view", "inventory.view", "records.view",
        "checks.view", "orders.view", "orders.approve", "reports.view",
        "asset_requests.view", "asset_requests.manage", "purchase_wishes.view",
        "paper.view",
    ],
    "teacher": [
        "dashboard.view", "assets.view", "records.view", "orders.view",
        "asset_requests.view", "purchase_wishes.view", "paper.view",
    ],
    "user": [
        "dashboard.view", "assets.view", "records.view", "orders.view",
        "asset_requests.view", "purchase_wishes.view", "paper.view",
    ],
}

ROLE_MENU_MAP = {
    "admin": [key for key, _ in MENU_DEFINITIONS],
    "asset_manager": [
        "dashboard", "assets", "inventory", "records", "checks", "orders",
        "reports", "assetRequests", "purchaseWishes", "paper", "baseData",
        "audit",
    ],
    "department_head": [
        "dashboard", "assets", "inventory", "records", "checks", "orders",
        "reports", "assetRequests", "purchaseWishes", "paper",
    ],
    "teacher": ["dashboard", "assets", "records", "orders", "assetRequests", "purchaseWishes", "paper"],
    "user": ["dashboard", "assets", "records", "orders", "assetRequests", "purchaseWishes", "paper"],
}

STATUS_LABELS = {
    "in_stock": "在库",
    "checked_out": "出库/出借",
    "repair": "维修中",
    "retired": "报废",
}


def now_local():
    return datetime.now(BEIJING_TZ).replace(tzinfo=None, microsecond=0).isoformat(timespec="minutes")


def add_hours_to_timestamp(value, hours):
    if not value:
        return value
    text = str(value).strip()
    for fmt in ("%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M"):
        try:
            shifted = datetime.strptime(text[:16], fmt) + timedelta(hours=hours)
            return shifted.isoformat(timespec="minutes")
        except ValueError:
            continue
    return value


def is_consumable_text(*values):
    text = " ".join(str(value or "") for value in values)
    return "耗材" in text


def parsed_number(value):
    text = str(value or "").strip()
    if not text:
        return None
    match = re.search(r"-?\d+(?:\.\d+)?", text.replace(",", ""))
    if not match:
        return None
    return int(float(match.group(0)))


def asset_original_value(row):
    for label in ("资产原值（元）", "资产原值(元)", "资产原值", "原值", "金额", "单价", "价格"):
        value = first_value(row, (label,)) if isinstance(row, dict) else ""
        parsed = parsed_number(value)
        if parsed is not None:
            return parsed
    return None


def safe_asset_quantity(row, default=1):
    quantity = parsed_number(first_value(row, ("数量", "qty", "quantity"))) if isinstance(row, dict) else None
    if quantity is None or quantity <= 0:
        return default
    original_value = asset_original_value(row)
    kind_text = " ".join(first_value(row, (name,)) for name in ("资产分类", "分类", "类别", "category", "资产名称", "名称", "物品名称"))
    if not is_consumable_text(kind_text) and (quantity > 100 or (original_value is not None and quantity == original_value)):
        return 1
    return quantity


def money_value(value, default=0):
    parsed = parsed_number(value)
    if parsed is None:
        try:
            return float(str(value or "").strip() or default)
        except ValueError:
            return float(default)
    return float(parsed)


def clean_date_text(value):
    text = str(value or "").strip()
    if not text:
        return ""
    normalized = normalize_time(text)
    if normalized:
        return normalized[:10]
    return text[:10] if re.match(r"^\d{4}[-/]\d{1,2}[-/]\d{1,2}", text) else text


def excel_serial_to_time(value):
    try:
        serial = float(str(value).strip())
    except ValueError:
        return ""
    if not 20000 <= serial <= 60000:
        return ""
    date = datetime(1899, 12, 30) + timedelta(days=serial)
    return date.replace(hour=0, minute=0, second=0, microsecond=0).isoformat(timespec="minutes")


def migrate_server_times_to_beijing(conn):
    marker = conn.execute("select value from system_settings where key = 'server_time_zone'").fetchone()
    if marker and marker["value"] == "Asia/Shanghai":
        return

    audits = rows_to_list(conn.execute("select id, time from audits"))
    for item in audits:
        conn.execute("update audits set time = ? where id = ?", (add_hours_to_timestamp(item["time"], 8), item["id"]))

    archives = rows_to_list(conn.execute("select id, uploaded_at from import_archives"))
    for item in archives:
        conn.execute(
            "update import_archives set uploaded_at = ? where id = ?",
            (add_hours_to_timestamp(item["uploaded_at"], 8), item["id"]),
        )

    conn.execute(
        "insert into system_settings values ('server_time_zone', 'Asia/Shanghai') "
        "on conflict(key) do update set value = excluded.value"
    )


def migrate_multi_department_default_off(conn):
    marker = conn.execute("select value from system_settings where key = 'multi_department_default_off_applied'").fetchone()
    if marker and marker["value"] == "1":
        return
    conn.execute(
        "insert into system_settings values ('multi_department_enabled', '0') "
        "on conflict(key) do update set value = '0'"
    )
    conn.execute("insert or ignore into system_settings values ('multi_department_default_off_applied', '1')")


def migrate_factory_blank_config(conn):
    marker = conn.execute("select value from system_settings where key = 'factory_blank_applied'").fetchone()
    if marker and marker["value"] == "1":
        return

    conn.execute("delete from import_archives")
    conn.execute("delete from paper_queue")
    conn.execute("delete from records")
    conn.execute("delete from assets")
    conn.execute("delete from audits")
    conn.execute(
        "insert into system_settings values ('developer_mode_enabled', '0') "
        "on conflict(key) do update set value = '0'"
    )
    conn.execute("insert or ignore into system_settings values ('factory_blank_applied', '1')")


def migrate_imported_asset_names(conn):
    marker = conn.execute("select value from system_settings where key = 'imported_asset_name_cleanup_v1'").fetchone()
    if marker and marker["value"] == "1":
        return
    replacements = {
        "USB-CTOHDMI": "USB-C TO HDMI",
        "M.2--HITAI-TiPro7000": "M.2-HITAI-TiPro7000",
        "罗技键盘K120": "罗技键盘 K120",
        "腹灵键盘F2750": "腹灵键盘 F2750",
        "绿联M.2双协议硬盘盒": "绿联 M.2 双协议硬盘盒",
        "三星970": "三星 970",
        "漫步者EDF-200l02": "漫步者 EDF-200102",
    }
    for old, new in replacements.items():
        conn.execute("update assets set name = ? where name = ?", (new, old))
    conn.execute("insert or ignore into system_settings values ('imported_asset_name_cleanup_v1', '1')")


def migrate_imported_asset_names_v2(conn):
    marker = conn.execute("select value from system_settings where key = 'imported_asset_name_cleanup_v2'").fetchone()
    if marker and marker["value"] == "1":
        return
    replacements = {
        "USB-CTOHDMI": "USB-C TO HDMI",
        "M.2--HITAI-TiPro7000": "M.2-HITAI-TiPro7000",
        "罗技键盘K120": "罗技键盘 K120",
        "腹灵键盘F2750": "腹灵键盘 F2750",
        "绿联M.2双协议硬盘盒": "绿联 M.2 双协议硬盘盒",
        "三星970": "三星 970",
        "漫步者EDF-200l02": "漫步者 EDF-200102",
    }
    for old, new in replacements.items():
        conn.execute("update assets set name = ? where name = ?", (new, old))
    conn.execute("insert or ignore into system_settings values ('imported_asset_name_cleanup_v2', '1')")


def migrate_imported_asset_names_v3(conn):
    marker = conn.execute("select value from system_settings where key = 'imported_asset_name_cleanup_v3'").fetchone()
    if marker and marker["value"] == "1":
        return
    replacements = {
        "USB-CTOHDMI": "USB-C TO HDMI",
        "M.2--HITAI-TiPro7000": "M.2-HITAI-TiPro7000",
        "罗技键盘K120": "罗技键盘 K120",
        "腹灵键盘F2750": "腹灵键盘 F2750",
        "绿联M.2双协议硬盘盒": "绿联 M.2 双协议硬盘盒",
        "三星970": "三星 970",
        "漫步者EDF-200l02": "漫步者 EDF-200102",
    }
    for old, new in replacements.items():
        conn.execute("update assets set name = ? where name = ?", (new, old))
    conn.execute("insert or ignore into system_settings values ('imported_asset_name_cleanup_v3', '1')")


def migrate_blank_placeholder_values(conn):
    marker = conn.execute("select value from system_settings where key = 'blank_placeholder_values_v1'").fetchone()
    if marker and marker["value"] == "1":
        return
    conn.execute("update assets set location = '' where location in ('未填写', '未填', '无')")
    conn.execute("update assets set spec = '' where spec in ('未填写', '未填', '无')")
    conn.execute("update assets set remark = '' where remark in ('未填写', '未填', '无')")
    conn.execute("insert or ignore into system_settings values ('blank_placeholder_values_v1', '1')")


def migrate_remove_template_noise_assets(conn):
    marker = conn.execute("select value from system_settings where key = 'remove_template_noise_assets_v1'").fetchone()
    if marker and marker["value"] == "1":
        return
    invalid_names = ("领用日期", "归还日期", "备注", "项目负责人审核", "负责人审核", "审核", "申请人", "申领人", "序号")
    placeholders = ",".join("?" for _ in invalid_names)
    asset_ids = [item["id"] for item in rows_to_list(conn.execute(f"select id from assets where name in ({placeholders})", invalid_names))]
    if asset_ids:
        id_placeholders = ",".join("?" for _ in asset_ids)
        conn.execute(f"delete from records where asset_id in ({id_placeholders})", asset_ids)
        conn.execute(f"delete from assets where id in ({id_placeholders})", asset_ids)
    conn.execute("insert or ignore into system_settings values ('remove_template_noise_assets_v1', '1')")


def migrate_remove_template_noise_assets_v2(conn):
    marker = conn.execute("select value from system_settings where key = 'remove_template_noise_assets_v2'").fetchone()
    if marker and marker["value"] == "1":
        return
    invalid_keys = {field_key(item) for item in INVALID_FIELD_VALUES}
    assets = rows_to_list(conn.execute("select id, code, name, spec, remark from assets"))
    asset_ids = [
        item["id"]
        for item in assets
        if any(field_key(item.get(field)) in invalid_keys for field in ("code", "name", "spec"))
        or "申请人：序号" in clean_docx_text(item.get("remark"))
    ]
    if asset_ids:
        id_placeholders = ",".join("?" for _ in asset_ids)
        conn.execute(f"delete from records where asset_id in ({id_placeholders})", asset_ids)
        conn.execute(f"delete from assets where id in ({id_placeholders})", asset_ids)
    records = rows_to_list(conn.execute("select id, note from records"))
    noisy_record_ids = [
        item["id"]
        for item in records
        if "申请人：序号" in clean_docx_text(item.get("note")) or "负责人：申请人：" in clean_docx_text(item.get("note"))
    ]
    if noisy_record_ids:
        id_placeholders = ",".join("?" for _ in noisy_record_ids)
        conn.execute(f"delete from records where id in ({id_placeholders})", noisy_record_ids)
    conn.execute("insert or ignore into system_settings values ('remove_template_noise_assets_v2', '1')")


def migrate_clean_word_record_notes(conn):
    marker = conn.execute("select value from system_settings where key = 'clean_word_record_notes_v1'").fetchone()
    if marker and marker["value"] == "1":
        return
    records = rows_to_list(
        conn.execute(
            """
            select r.id, r.note, r.paper_no, u.name as user_name
            from records r
            left join users u on u.id = r.user_id
            where r.note like '%Word领用单导入%' or r.note like '%模板序号%'
            """
        )
    )
    for record in records:
        note = clean_docx_text(record["note"])
        parts = []
        if "Word领用单导入" in note:
            parts.append("Word领用单导入")
        sequence = template_sequence(note)
        if sequence != 999999:
            parts.append(f"模板序号：{sequence}")
        if record.get("user_name"):
            parts.append(f"出借人：{record['user_name']}")
        if record.get("paper_no"):
            parts.append(f"单号：{record['paper_no']}")
        conn.execute("update records set note = ? where id = ?", ("；".join(parts) or note, record["id"]))
    conn.execute("insert or ignore into system_settings values ('clean_word_record_notes_v1', '1')")


def migrate_link_word_asset_groups(conn):
    marker = conn.execute("select value from system_settings where key = 'link_word_asset_groups_v1'").fetchone()
    if marker and marker["value"] == "1":
        return
    rows = rows_to_list(
        conn.execute(
            """
            select a.id as asset_id, a.remark, r.paper_no, r.note
            from assets a
            join records r on r.asset_id = a.id
            where r.paper_no <> '' or r.note like '%单号%'
            order by r.out_time, r.id
            """
        )
    )
    for row in rows:
        paper_no = clean_docx_text(row.get("paper_no") or document_key_from_text(row.get("note")))
        if not paper_no:
            continue
        conn.execute(
            "update assets set remark = ? where id = ?",
            (append_unique_note(row["remark"], f"单号：{paper_no}"), row["asset_id"]),
        )
    conn.execute("insert or ignore into system_settings values ('link_word_asset_groups_v1', '1')")


def migrate_tag_word_import_groups(conn):
    marker = conn.execute("select value from system_settings where key = 'tag_word_import_groups_v1'").fetchone()
    if marker and marker["value"] == "1":
        return
    archives = rows_to_list(conn.execute("select * from import_archives where file_type = 'docx' order by uploaded_at, id"))
    for archive in archives:
        try:
            rows = parse_requisition_docx(parse_docx(archive["content"]))
        except Exception:
            continue
        actor = conn.execute("select * from users where id = ?", (archive["uploaded_by"],)).fetchone()
        if not actor:
            continue
        for row in rows:
            name = first_value(row, ("资产名称", "名称", "物品名称"))
            sequence = first_value(row, ("模板序号", "序号"))
            paper_no = first_value(row, ("纸质单号", "单号", "paper_no"))
            user = ensure_import_user(conn, row, actor)
            asset = find_asset(conn, row)
            if not asset and name:
                asset = conn.execute("select * from assets where name = ?", (name,)).fetchone()
            if not asset:
                continue
            records = rows_to_list(
                conn.execute(
                    """
                    select * from records
                    where asset_id = ? and user_id = ?
                    and (? = '' or paper_no = ?)
                    and (? = '' or note like ?)
                    """,
                    (asset["id"], user["id"], paper_no, paper_no, sequence, f"%模板序号：{sequence}%"),
                )
            )
            for record in records:
                note = append_unique_note(record["note"], f"导入文件：{archive['file_name']}")
                note = append_unique_note(note, f"导入时间：{archive['uploaded_at']}")
                conn.execute("update records set note = ? where id = ?", (note, record["id"]))
                remark = append_unique_note(asset["remark"], f"导入文件：{archive['file_name']}")
                remark = append_unique_note(remark, f"导入时间：{archive['uploaded_at']}")
                conn.execute("update assets set remark = ? where id = ?", (remark, asset["id"]))
    conn.execute("insert or ignore into system_settings values ('tag_word_import_groups_v1', '1')")


def compact_match_key(value):
    return re.sub(r"\s+", "", clean_docx_text(value)).lower()


def find_asset_by_import_name(conn, row):
    asset = find_asset(conn, row)
    if asset:
        return asset
    name = first_value(row, ("资产名称", "名称", "物品名称"))
    if not name:
        return None
    key = compact_match_key(name)
    for candidate in rows_to_list(conn.execute("select * from assets")):
        if compact_match_key(candidate["name"]) == key:
            return candidate
    return None


def migrate_tag_word_import_groups_v2(conn):
    marker = conn.execute("select value from system_settings where key = 'tag_word_import_groups_v2'").fetchone()
    if marker and marker["value"] == "1":
        return
    archives = rows_to_list(conn.execute("select * from import_archives where file_type = 'docx' order by uploaded_at, id"))
    for archive in archives:
        try:
            rows = parse_requisition_docx(parse_docx(archive["content"]))
        except Exception:
            continue
        for row in rows:
            asset = find_asset_by_import_name(conn, row)
            if not asset:
                continue
            sequence = first_value(row, ("模板序号", "序号"))
            paper_no = first_value(row, ("纸质单号", "单号", "paper_no"))
            records = rows_to_list(
                conn.execute(
                    """
                    select * from records
                    where asset_id = ?
                    and (? = '' or paper_no = ?)
                    and (? = '' or note like ?)
                    """,
                    (asset["id"], paper_no, paper_no, sequence, f"%模板序号：{sequence}%"),
                )
            )
            for record in records:
                note = append_unique_note(record["note"], f"导入文件：{archive['file_name']}")
                note = append_unique_note(note, f"导入时间：{archive['uploaded_at']}")
                conn.execute("update records set note = ? where id = ?", (note, record["id"]))
                remark = append_unique_note(asset["remark"], f"导入文件：{archive['file_name']}")
                remark = append_unique_note(remark, f"导入时间：{archive['uploaded_at']}")
                conn.execute("update assets set remark = ? where id = ?", (remark, asset["id"]))
    conn.execute("insert or ignore into system_settings values ('tag_word_import_groups_v2', '1')")


def migrate_tag_word_import_groups_v3(conn):
    marker = conn.execute("select value from system_settings where key = 'tag_word_import_groups_v3'").fetchone()
    if marker and marker["value"] == "1":
        return
    archives = rows_to_list(conn.execute("select * from import_archives where file_type = 'docx' order by uploaded_at, id"))
    for archive in archives:
        try:
            rows = parse_requisition_docx(parse_docx(archive["content"]))
        except Exception:
            continue
        for row in rows:
            asset = find_asset_by_import_name(conn, row)
            sequence = first_value(row, ("模板序号", "序号"))
            if not asset or not sequence:
                continue
            records = rows_to_list(
                conn.execute(
                    "select * from records where asset_id = ? and note like ?",
                    (asset["id"], f"%模板序号：{sequence}%"),
                )
            )
            for record in records:
                note = append_unique_note(record["note"], f"导入文件：{archive['file_name']}")
                note = append_unique_note(note, f"导入时间：{archive['uploaded_at']}")
                conn.execute("update records set note = ? where id = ?", (note, record["id"]))
                remark = append_unique_note(asset["remark"], f"导入文件：{archive['file_name']}")
                remark = append_unique_note(remark, f"导入时间：{archive['uploaded_at']}")
                conn.execute("update assets set remark = ? where id = ?", (remark, asset["id"]))
    conn.execute("insert or ignore into system_settings values ('tag_word_import_groups_v3', '1')")


def migrate_tag_word_import_groups_v4(conn):
    marker = conn.execute("select value from system_settings where key = 'tag_word_import_groups_v4'").fetchone()
    if marker and marker["value"] == "1":
        return
    conn.execute("insert or ignore into system_settings values ('tag_word_import_groups_v4', '1')")


def append_unique_note(current, text):
    current = clean_docx_text(current)
    if not text or text in current:
        return current
    return f"{current}；{text}" if current else text


def migrate_word_import_order_and_users(conn):
    marker = conn.execute("select value from system_settings where key = 'word_import_order_user_v1'").fetchone()
    if marker and marker["value"] == "1":
        return
    archives = rows_to_list(conn.execute("select * from import_archives where file_type = 'docx'"))
    for archive in archives:
        try:
            rows = parse_requisition_docx(parse_docx(archive["content"]))
        except Exception:
            continue
        actor = conn.execute("select * from users where id = ?", (archive["uploaded_by"],)).fetchone()
        if not actor:
            actor = conn.execute("select * from users where role = 'admin' and active = 1 order by name limit 1").fetchone()
        if not actor:
            continue
        for row in rows:
            sequence = first_value(row, ("模板序号", "序号"))
            name = first_value(row, ("资产名称", "名称", "物品名称"))
            spec = first_value(row, ("规格型号", "规格", "配置"))
            if not name:
                continue
            candidates = rows_to_list(conn.execute("select * from assets where name = ?", (name,)))
            if spec:
                exact = [item for item in candidates if clean_docx_text(item.get("spec", "")) == clean_docx_text(spec)]
                candidates = exact or candidates
            if not candidates:
                continue
            asset = candidates[0]
            user = ensure_import_user(conn, row, actor)
            conn.execute(
                "update assets set keeper_id = ?, remark = ? where id = ?",
                (user["id"], append_unique_note(asset["remark"], f"模板序号：{sequence}") if sequence else asset["remark"], asset["id"]),
            )
            records = rows_to_list(conn.execute("select * from records where asset_id = ?", (asset["id"],)))
            for record in records:
                conn.execute(
                    "update records set user_id = ?, note = ? where id = ?",
                    (user["id"], append_unique_note(record["note"], f"模板序号：{sequence}") if sequence else record["note"], record["id"]),
                )
    conn.execute("insert or ignore into system_settings values ('word_import_order_user_v1', '1')")


def template_sequence(value):
    match = re.search(r"模板序号[:：]\s*(\d+)", str(value or ""))
    return int(match.group(1)) if match else 999999


def document_key_from_text(value):
    text = str(value or "")
    for label in ("导入时间", "导入文件", "单号", "纸质单号"):
        match = re.search(rf"{label}[:：]\s*([^；,\s]+)", text)
        if match:
            return clean_docx_text(match.group(1))
    return ""


def template_group_key(item):
    return clean_docx_text(document_key_from_text(item.get("remark")) or document_key_from_text(item.get("note")) or item.get("paper_no") or item.get("id") or "")


def sort_assets_for_display(items):
    return sorted(items, key=lambda item: (item.get("remark", "").count("模板序号") == 0, template_group_key(item), template_sequence(item.get("remark")), item.get("code", "")))


def sort_records_for_display(items):
    return sorted(items, key=lambda item: (item.get("note", "").count("模板序号") == 0, template_group_key(item), template_sequence(item.get("note")), item.get("id", "")))


def new_id(prefix):
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def row_to_dict(row):
    return dict(row) if row else None


def rows_to_list(rows):
    return [dict(row) for row in rows]


PINYIN_INITIALS = {
    "张": "z", "王": "w", "李": "l", "赵": "z", "陈": "c", "刘": "l", "杨": "y", "黄": "h", "周": "z", "吴": "w",
    "徐": "x", "孙": "s", "胡": "h", "朱": "z", "高": "g", "林": "l", "何": "h", "郭": "g", "马": "m", "罗": "l",
    "梁": "l", "宋": "s", "郑": "z", "谢": "x", "韩": "h", "唐": "t", "冯": "f", "于": "y", "董": "d", "萧": "x",
    "程": "c", "曹": "c", "袁": "y", "邓": "d", "许": "x", "傅": "f", "沈": "s", "曾": "z", "彭": "p", "吕": "l",
    "苏": "s", "卢": "l", "蒋": "j", "蔡": "c", "贾": "j", "丁": "d", "魏": "w", "薛": "x", "叶": "y", "阎": "y",
    "余": "y", "潘": "p", "杜": "d", "戴": "d", "夏": "x", "钟": "z", "汪": "w", "田": "t", "任": "r", "姜": "j",
    "范": "f", "方": "f", "石": "s", "姚": "y", "谭": "t", "廖": "l", "邹": "z", "熊": "x", "金": "j", "陆": "l",
    "郝": "h", "孔": "k", "白": "b", "崔": "c", "康": "k", "毛": "m", "邱": "q", "秦": "q", "江": "j", "史": "s",
    "顾": "g", "侯": "h", "邵": "s", "孟": "m", "龙": "l", "万": "w", "段": "d", "雷": "l", "钱": "q", "汤": "t",
    "尹": "y", "黎": "l", "易": "y", "常": "c", "武": "w", "乔": "q", "贺": "h", "赖": "l", "龚": "g", "文": "w",
    "涛": "t", "远": "y", "宇": "y", "涵": "h",
    "系": "x", "统": "t", "管": "g", "理": "l", "员": "y", "三": "s", "四": "s",
}


GB2312_INITIAL_RANGES = [
    (-20319, "a"), (-20283, "b"), (-19775, "c"), (-19218, "d"), (-18710, "e"),
    (-18526, "f"), (-18239, "g"), (-17922, "h"), (-17417, "j"), (-16474, "k"),
    (-16212, "l"), (-15640, "m"), (-15165, "n"), (-14922, "o"), (-14914, "p"),
    (-14630, "q"), (-14149, "r"), (-14090, "s"), (-13318, "t"), (-12838, "w"),
    (-12556, "x"), (-11847, "y"), (-11055, "z"),
]

PINYIN_INITIAL_OVERRIDES = {
    "曾": "z",
    "重": "c",
    "行": "x",
    "长": "c",
    "沈": "s",
    "区": "o",
    "烨": "y",
    "鑫": "x",
}


def pinyin_initial(char):
    if char in PINYIN_INITIAL_OVERRIDES:
        return PINYIN_INITIAL_OVERRIDES[char]
    if char in PINYIN_INITIALS:
        return PINYIN_INITIALS[char]
    try:
        raw = char.encode("gb2312")
    except UnicodeEncodeError:
        return ""
    if len(raw) < 2:
        return ""
    code = raw[0] * 256 + raw[1] - 65536
    for index, (start, letter) in enumerate(GB2312_INITIAL_RANGES):
        end = GB2312_INITIAL_RANGES[index + 1][0] if index + 1 < len(GB2312_INITIAL_RANGES) else 0
        if start <= code < end:
            return letter
    return ""


def username_base_from_name(name):
    result = []
    for char in clean_docx_text(name):
        if char.isascii() and char.isalnum():
            result.append(char.lower())
        else:
            initial = pinyin_initial(char)
            if initial:
                result.append(initial)
    return "".join(result) or f"user{uuid.uuid4().hex[:6]}"


def unique_username(conn, base, exclude_user_id=""):
    clean = re.sub(r"[^a-z0-9_]", "", str(base or "").lower()) or "user"
    candidate = clean
    index = 2
    while True:
        existing = conn.execute("select id from users where username = ?", (candidate,)).fetchone()
        if not existing or existing["id"] == exclude_user_id:
            return candidate
        candidate = f"{clean}{index}"
        index += 1


def migrate_import_usernames_to_initials(conn):
    marker = conn.execute("select value from system_settings where key = 'import_usernames_initials_v1'").fetchone()
    if marker and marker["value"] == "1":
        return
    users = rows_to_list(conn.execute("select id, username, name from users where username like 'import_%'"))
    for user in users:
        if user["username"] == "import_unknown":
            continue
        username = unique_username(conn, username_base_from_name(user["name"]), user["id"])
        conn.execute("update users set username = ? where id = ?", (username, user["id"]))
    conn.execute("insert or ignore into system_settings values ('import_usernames_initials_v1', '1')")


def migrate_usernames_to_initials_v2(conn):
    marker = conn.execute("select value from system_settings where key = 'usernames_initials_v2'").fetchone()
    if marker and marker["value"] == "1":
        return
    users = rows_to_list(conn.execute("select id, username, name from users order by case when username = 'admin' then 0 else 1 end, name, id"))
    for user in users:
        if user["username"] in ("admin", "import_unknown"):
            continue
        username = unique_username(conn, username_base_from_name(user["name"]), user["id"])
        conn.execute("update users set username = ? where id = ?", (username, user["id"]))
    conn.execute("insert or ignore into system_settings values ('usernames_initials_v2', '1')")


def migrate_revoked_admin_requests(conn):
    conn.execute(
        """
        update admin_requests
        set status = '已撤销',
            handled_at = case when handled_at = '' then ? else handled_at end
        where status = '已批准'
          and user_id in (select id from users where role = 'user')
        """,
        (now_local(),),
    )


def migrate_asset_quantity_from_price(conn):
    marker = conn.execute("select value from system_settings where key = 'asset_quantity_from_price_v1'").fetchone()
    if marker and marker["value"] == "1":
        return
    rows = rows_to_list(conn.execute("select id, name, category, quantity, remark from assets"))
    for row in rows:
        quantity = int(row["quantity"] or 0)
        if quantity <= 100 or is_consumable_text(row["category"], row["name"], row["remark"]):
            continue
        remark = clean_docx_text(row["remark"])
        if any(label in remark for label in ("资产原值", "原值", "金额", "价格")):
            conn.execute("update assets set quantity = 1 where id = ?", (row["id"],))
    conn.execute("insert or ignore into system_settings values ('asset_quantity_from_price_v1', '1')")


def migrate_numeric_record_times(conn):
    marker = conn.execute("select value from system_settings where key = 'numeric_record_times_v1'").fetchone()
    if marker and marker["value"] == "1":
        return
    records = rows_to_list(conn.execute("select id, in_time, out_time from records"))
    for record in records:
        updates = {}
        for field in ("in_time", "out_time"):
            value = str(record.get(field) or "").strip()
            if re.fullmatch(r"\d+(?:\.\d+)?", value):
                updates[field] = normalize_time(value)
        if updates:
            conn.execute(
                "update records set in_time = ?, out_time = ? where id = ?",
                (updates.get("in_time", record["in_time"]), updates.get("out_time", record["out_time"]), record["id"]),
            )
    conn.execute("insert or ignore into system_settings values ('numeric_record_times_v1', '1')")


def record_dedupe_quantity(value):
    try:
        return int(float(str(value or 0).strip() or 0))
    except (TypeError, ValueError):
        return 0


def record_dedupe_note(note):
    skip_labels = {field_key(label) for label in ("导入文件", "导入时间", "模板序号")}
    parts = []
    for part in re.split(r"[；;]", str(note or "")):
        clean = clean_docx_text(part)
        if not clean:
            continue
        label = re.split(r"[:：]", clean, maxsplit=1)[0]
        if field_key(label) in skip_labels:
            continue
        parts.append(clean)
    return "；".join(parts)


def record_dedupe_key_from_values(asset_id, record_type, quantity, user_id, in_time, out_time, paper_no, note):
    return (
        str(asset_id or ""),
        str(record_type or ""),
        record_dedupe_quantity(quantity),
        str(in_time or ""),
        str(out_time or ""),
        clean_docx_text(paper_no or ""),
    )


def record_dedupe_key(record):
    return record_dedupe_key_from_values(
        record.get("asset_id"),
        record.get("type"),
        record.get("quantity"),
        record.get("user_id"),
        record.get("in_time"),
        record.get("out_time"),
        record.get("paper_no"),
        record.get("note"),
    )


def find_duplicate_record(conn, asset_id, record_type, quantity, user_id, in_time, out_time, paper_no, note):
    asset = conn.execute("select code, name from assets where id = ?", (asset_id,)).fetchone()
    asset_code = asset["code"] if asset else ""
    asset_name = asset["name"] if asset else ""
    row = conn.execute(
        """
        select r.id from records r
        join assets a on a.id = r.asset_id
        where r.type = ?
          and r.quantity = ?
          and coalesce(r.in_time, '') = ?
          and coalesce(r.out_time, '') = ?
          and trim(coalesce(r.paper_no, '')) = ?
          and (a.code = ? or (? = '' and a.name = ?))
        limit 1
        """,
        (
            record_type,
            record_dedupe_quantity(quantity),
            in_time or "",
            out_time or "",
            clean_docx_text(paper_no or ""),
            asset_code,
            asset_code,
            asset_name,
        ),
    ).fetchone()
    return row["id"] if row else ""


def migrate_word_record_times_from_archives(conn):
    marker = conn.execute("select value from system_settings where key = 'word_record_times_from_archives_v2'").fetchone()
    if marker and marker["value"] == "1":
        return
    archives = rows_to_list(conn.execute("select * from import_archives where file_type = 'docx' order by uploaded_at, id"))
    for archive in archives:
        try:
            parsed = parse_docx(archive["content"])
            rows = parse_requisition_docx(parsed) or parsed.get("rows", [])
            result = json.loads(archive["result_json"] or "{}")
        except Exception:
            continue
        record_ids = result.get("_recordIds") or []
        for row, record_id in zip(rows, record_ids):
            out_time = normalize_time(first_value(row, ("出库时间", "借出时间", "领用时间", "领用日期", "out_time")))
            in_time = normalize_time(first_value(row, ("入库时间", "归还时间", "return_time", "in_time")))
            if not out_time and not in_time:
                continue
            conn.execute(
                """
                update records
                set out_time = case when type = '出库' and ? <> '' then ? else out_time end,
                    in_time = case when type = '入库' and ? <> '' then ? else in_time end
                where id = ?
                """,
                (out_time, out_time, in_time, in_time, record_id),
            )
    conn.execute("insert or ignore into system_settings values ('word_record_times_from_archives_v2', '1')")


def migrate_remove_word_import_time_fallback_records(conn):
    marker = conn.execute("select value from system_settings where key = 'remove_word_import_time_fallback_records_v1'").fetchone()
    if marker and marker["value"] == "1":
        return
    archives = rows_to_list(conn.execute("select * from import_archives where file_type = 'docx' order by uploaded_at, id"))
    for archive in archives:
        try:
            parsed = parse_docx(archive["content"])
            rows = parse_requisition_docx(parsed) or parsed.get("rows", [])
            result = json.loads(archive["result_json"] or "{}")
        except Exception:
            continue
        if any(row_record_time(row) for row in rows):
            continue
        record_ids = result.get("_recordIds") or []
        if not record_ids:
            continue
        for index in range(0, len(record_ids), 500):
            chunk = record_ids[index:index + 500]
            placeholders = ",".join("?" for _ in chunk)
            conn.execute(f"delete from asset_flow_logs where source_type = 'record' and source_id in ({placeholders})", chunk)
            conn.execute(f"delete from records where id in ({placeholders})", chunk)
    conn.execute("insert or ignore into system_settings values ('remove_word_import_time_fallback_records_v1', '1')")


def migrate_remove_word_records_using_import_time(conn):
    marker = conn.execute("select value from system_settings where key = 'remove_word_records_using_import_time_v1'").fetchone()
    if marker and marker["value"] == "1":
        return
    records = rows_to_list(
        conn.execute(
            """
            select id, note, out_time, in_time
            from records
            where note like '%Word领用单导入%' and note like '%导入时间：%'
            """
        )
    )
    delete_ids = []
    for record in records:
        import_time = document_key_from_text(record.get("note"))
        if import_time and (record.get("out_time") == import_time or record.get("in_time") == import_time):
            delete_ids.append(record["id"])
    for index in range(0, len(delete_ids), 500):
        chunk = delete_ids[index:index + 500]
        placeholders = ",".join("?" for _ in chunk)
        conn.execute(f"delete from asset_flow_logs where source_type = 'record' and source_id in ({placeholders})", chunk)
        conn.execute(f"delete from records where id in ({placeholders})", chunk)
    conn.execute("insert or ignore into system_settings values ('remove_word_records_using_import_time_v1', '1')")


def migrate_deduplicate_duplicate_records(conn):
    marker = conn.execute("select value from system_settings where key = 'deduplicate_duplicate_records_v4'").fetchone()
    if marker and marker["value"] == "1":
        return
    records = rows_to_list(
        conn.execute(
            """
            select r.*, a.code as asset_code, a.name as asset_name, u.name as user_name
            from records r
            left join assets a on a.id = r.asset_id
            left join users u on u.id = r.user_id
            order by coalesce(nullif(r.in_time, ''), nullif(r.out_time, ''), r.id), r.id
            """
        )
    )
    seen = set()
    duplicate_ids = []
    for record in records:
        key = (
            clean_docx_text(record.get("asset_code") or record.get("asset_name") or record.get("asset_id")),
            record.get("type"),
            record_dedupe_quantity(record.get("quantity")),
            record.get("in_time") or "",
            record.get("out_time") or "",
            clean_docx_text(record.get("paper_no") or ""),
        )
        if key in seen:
            duplicate_ids.append(record["id"])
        else:
            seen.add(key)
    for index in range(0, len(duplicate_ids), 500):
        chunk = duplicate_ids[index:index + 500]
        placeholders = ",".join("?" for _ in chunk)
        conn.execute(f"delete from asset_flow_logs where source_type = 'record' and source_id in ({placeholders})", chunk)
        conn.execute(f"delete from records where id in ({placeholders})", chunk)
    conn.execute("insert or ignore into system_settings values ('deduplicate_duplicate_records_v4', '1')")


def seed_rbac(conn):
    now = now_local()
    for role_id, name, description in ROLE_DEFINITIONS:
        conn.execute(
            """
            insert into roles (id, name, description, active, created_at, updated_at)
            values (?, ?, ?, 1, ?, ?)
            on conflict(id) do update set
              name = excluded.name,
              description = excluded.description,
              active = 1,
              updated_at = excluded.updated_at
            """,
            (role_id, name, description, now, now),
        )
    for code, name in PERMISSION_DEFINITIONS:
        conn.execute(
            """
            insert into permissions (code, name, description)
            values (?, ?, '')
            on conflict(code) do update set name = excluded.name
            """,
            (code, name),
        )
    for key, label in MENU_DEFINITIONS:
        conn.execute(
            """
            insert into menu_permissions (menu_key, label, active)
            values (?, ?, 1)
            on conflict(menu_key) do update set label = excluded.label, active = 1
            """,
            (key, label),
        )
    conn.execute("delete from role_permissions")
    for role_id, permissions in ROLE_PERMISSION_MAP.items():
        for code in permissions:
            conn.execute("insert or ignore into role_permissions values (?, ?)", (role_id, code))
    conn.execute("delete from role_menus")
    for role_id, menus in ROLE_MENU_MAP.items():
        for menu_key in menus:
            conn.execute("insert or ignore into role_menus values (?, ?)", (role_id, menu_key))


def migrate_user_roles(conn):
    columns = {item["name"] for item in rows_to_list(conn.execute("pragma table_info(users)"))}
    if "role_id" not in columns:
        conn.execute("alter table users add column role_id text")
    conn.execute(
        """
        update users
        set role_id = case
          when role = 'admin' then 'admin'
          when role in ('asset_manager', 'department_head', 'teacher', 'user') then role
          else 'teacher'
        end
        where role_id is null or role_id = ''
        """
    )


def asset_snapshot(row):
    return json.dumps(dict(row) if row else {}, ensure_ascii=False, sort_keys=True)


def add_flow_log(conn, asset_id, action, operator_id, before=None, after=None, business_no="", source_type="", source_id="", note=""):
    conn.execute(
        """
        insert into asset_flow_logs
        (id, asset_id, action, operator_id, business_no, source_type, source_id, before_json, after_json, note, created_at)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            new_id("flow"),
            asset_id,
            action,
            operator_id,
            business_no,
            source_type,
            source_id,
            before if isinstance(before, str) else asset_snapshot(before),
            after if isinstance(after, str) else asset_snapshot(after),
            note,
            now_local(),
        ),
    )


def add_stock_record(conn, asset_id, flow_type, quantity, before_qty, after_qty, operator_id, related_type="", related_id="", note=""):
    conn.execute(
        """
        insert into stock_records
        (id, asset_id, flow_type, quantity, before_quantity, after_quantity, related_type, related_id, operator_id, note, created_at)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            new_id("stock"),
            asset_id,
            flow_type,
            int(quantity or 0),
            int(before_qty or 0),
            int(after_qty or 0),
            related_type,
            related_id,
            operator_id,
            note,
            now_local(),
        ),
    )


def update_asset_fields(conn, asset_id, updates, operator_id, action, business_no="", source_type="", source_id="", note=""):
    asset = conn.execute("select * from assets where id = ?", (asset_id,)).fetchone()
    if not asset:
        raise ValueError("资产不存在")
    new_status = updates.get("status", asset["status"])
    ok, message = status_transition_allowed(asset["status"], new_status, action=action)
    if not ok:
        raise ValueError(message)
    if not updates:
        return asset
    allowed = {
        "code", "name", "category", "spec", "quantity", "safe_stock", "brand", "unit", "unit_price",
        "total_amount", "purchase_date", "inbound_date", "supplier", "use_department", "use_user_id",
        "source", "creator_id", "created_at", "updated_at", "location", "keeper_id", "status", "remark", "image",
    }
    pairs = [(key, value) for key, value in updates.items() if key in allowed]
    if not pairs:
        return asset
    pairs.append(("updated_at", now_local()))
    before_qty = int(asset["quantity"] or 0)
    set_clause = ", ".join(f"{key} = ?" for key, _ in pairs)
    conn.execute(f"update assets set {set_clause} where id = ?", [value for _, value in pairs] + [asset_id])
    updated = conn.execute("select * from assets where id = ?", (asset_id,)).fetchone()
    after_qty = int(updated["quantity"] or 0)
    if after_qty != before_qty:
        add_stock_record(conn, asset_id, action or "库存变更", after_qty - before_qty, before_qty, after_qty, operator_id, source_type, source_id, note)
    add_flow_log(conn, asset_id, action, operator_id, before=asset, after=updated, business_no=business_no, source_type=source_type, source_id=source_id, note=note)
    return updated


def asset_payload_values(payload, actor, existing=None):
    quantity = max(0, int(payload.get("quantity", existing["quantity"] if existing else 1) or 0))
    unit_price = money_value(payload.get("unitPrice", existing["unit_price"] if existing else 0), 0)
    total_amount = money_value(payload.get("totalAmount", 0), 0)
    if not total_amount and unit_price:
        total_amount = unit_price * quantity
    keeper_id = str(payload.get("keeperId") or (existing["keeper_id"] if existing else actor["id"])).strip()
    return {
        "name": clean_docx_text(payload.get("name") or (existing["name"] if existing else "")),
        "category": clean_docx_text(payload.get("category") or (existing["category"] if existing else "未分类")),
        "spec": clean_docx_text(payload.get("spec") or ""),
        "quantity": quantity,
        "safe_stock": max(0, int(payload.get("safeStock", existing["safe_stock"] if existing else 0) or 0)),
        "brand": clean_docx_text(payload.get("brand") or ""),
        "unit": clean_docx_text(payload.get("unit") or "件") or "件",
        "unit_price": unit_price,
        "total_amount": total_amount,
        "purchase_date": clean_date_text(payload.get("purchaseDate") or ""),
        "inbound_date": clean_date_text(payload.get("inboundDate") or ""),
        "supplier": clean_docx_text(payload.get("supplier") or ""),
        "use_department": clean_docx_text(payload.get("useDepartment") or actor["department"]),
        "use_user_id": clean_docx_text(payload.get("useUserId") or keeper_id),
        "source": clean_docx_text(payload.get("source") or ""),
        "location": clean_docx_text(payload.get("location") or (existing["location"] if existing else "")),
        "keeper_id": keeper_id,
        "status": clean_docx_text(payload.get("status") or (existing["status"] if existing else "in_stock")),
        "remark": clean_docx_text(payload.get("remark") or ""),
        "image": payload.get("image", existing["image"] if existing and "image" in existing.keys() else "") or "",
    }


def record_business_order(conn, table, order_id, status="", approval_status="", approver_id=""):
    updates = []
    values = []
    if status:
        updates.append("status = ?")
        values.append(status)
    if approval_status:
        updates.append("approval_status = ?")
        values.append(approval_status)
    if approver_id:
        updates.append("approver_id = ?")
        values.append(approver_id)
        if table in ("borrow_orders", "scrap_orders"):
            updates.append("approval_time = ?")
            values.append(now_local())
    updates.append("updated_at = ?")
    values.append(now_local())
    values.append(order_id)
    conn.execute(f"update {table} set {', '.join(updates)} where id = ?", values)


def audit_change(conn, user_id, action, object_type="", object_id="", detail="", before=None, after=None, business_no=""):
    before_text = before if isinstance(before, str) else asset_snapshot(before)
    after_text = after if isinstance(after, str) else asset_snapshot(after)
    conn.execute(
        """
        insert into audits
        (id, time, user_id, action, detail, ip, object_type, object_id, before_value, after_value, business_no)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            new_id("log"),
            now_local(),
            user_id,
            action,
            detail,
            REQUEST_IP.get(),
            object_type,
            object_id,
            before_text,
            after_text,
            business_no,
        ),
    )


def status_transition_allowed(old_status, new_status, action=""):
    old_status = old_status or "in_stock"
    new_status = new_status or old_status
    if old_status == new_status:
        return True, ""
    if old_status == "retired":
        return False, "已报废资产不能再变更状态或参与业务流转"
    if action in ("borrow", "checkout", "claim", "transfer") and old_status in ("repair", "retired"):
        return False, f"{STATUS_LABELS.get(old_status, old_status)}资产不能执行该业务"
    allowed = {
        "in_stock": {"checked_out", "repair", "retired"},
        "checked_out": {"in_stock", "repair", "retired"},
        "repair": {"in_stock", "retired"},
    }
    if new_status in allowed.get(old_status, set()):
        return True, ""
    return False, f"不允许从“{STATUS_LABELS.get(old_status, old_status)}”直接流转到“{STATUS_LABELS.get(new_status, new_status)}”"


def ensure_column(conn, table, column, definition):
    columns = {item["name"] for item in rows_to_list(conn.execute(f"pragma table_info({table})"))}
    if column not in columns:
        conn.execute(f"alter table {table} add column {column} {definition}")


def ensure_default_admin_login(conn):
    admin = conn.execute(
        """
        select id from users
        where username = 'admin' or id = 'u-admin'
        order by case when username = 'admin' then 0 else 1 end
        limit 1
        """
    ).fetchone()
    if admin:
        conn.execute(
            """
            update users
            set username = 'admin',
                password = ?,
                role = 'admin',
                role_id = 'admin',
                active = 1
            where id = ?
            """,
            (DEFAULT_ADMIN_PASSWORD, admin["id"]),
        )
        return
    conn.execute(
        """
        insert into users
        (id, username, password, name, role, role_id, department, active)
        values (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        ("u-admin", "admin", DEFAULT_ADMIN_PASSWORD, "系统管理员", "admin", "admin", "仓储部", 1),
    )


def init_db():
    with db() as conn:
        conn.executescript(
            """
            create table if not exists users (
              id text primary key,
              username text unique not null,
              password text not null,
              name text not null,
              role text not null check(role in ('admin', 'asset_manager', 'department_head', 'teacher', 'user')),
              role_id text,
              department text not null,
              active integer not null default 1
            );

            create table if not exists user_sessions (
              token text primary key,
              user_id text not null references users(id),
              created_at text not null,
              last_seen_at text not null
            );

            create table if not exists roles (
              id text primary key,
              name text unique not null,
              description text,
              active integer not null default 1,
              created_at text not null default '',
              updated_at text not null default ''
            );

            create table if not exists permissions (
              code text primary key,
              name text not null,
              description text
            );

            create table if not exists role_permissions (
              role_id text not null references roles(id),
              permission_code text not null references permissions(code),
              primary key (role_id, permission_code)
            );

            create table if not exists menu_permissions (
              menu_key text primary key,
              label text not null,
              active integer not null default 1
            );

            create table if not exists role_menus (
              role_id text not null references roles(id),
              menu_key text not null references menu_permissions(menu_key),
              primary key (role_id, menu_key)
            );

            create table if not exists assets (
              id text primary key,
              code text unique not null,
              name text not null,
              category text not null,
              spec text,
              quantity integer not null,
              safe_stock integer not null default 0,
              brand text,
              unit text not null default '件',
              unit_price real not null default 0,
              total_amount real not null default 0,
              purchase_date text,
              inbound_date text,
              supplier text,
              use_department text,
              use_user_id text,
              source text,
              creator_id text,
              created_at text,
              updated_at text,
              location text not null,
              keeper_id text not null references users(id),
              status text not null,
              remark text,
              image text
            );

            create table if not exists records (
              id text primary key,
              asset_id text not null references assets(id),
              type text not null,
              quantity integer not null,
              user_id text not null references users(id),
              operator_id text not null references users(id),
              in_time text,
              out_time text,
              status text not null,
              paper_no text,
              note text,
              photo text
            );

            create table if not exists audits (
              id text primary key,
              time text not null,
              user_id text not null references users(id),
              action text not null,
              detail text not null,
              ip text,
              object_type text,
              object_id text,
              before_value text,
              after_value text,
              business_no text
            );

            create table if not exists paper_queue (
              id text primary key,
              paper_no text not null,
              source text not null,
              owner_id text not null references users(id),
              status text not null,
              text text not null
            );

            create table if not exists departments (
              id text primary key,
              name text unique not null,
              active integer not null default 1
            );

            create table if not exists asset_categories (
              id text primary key,
              name text unique not null,
              parent_id text,
              code text,
              category_type text not null default '固定资产',
              active integer not null default 1,
              created_at text not null default '',
              updated_at text not null default ''
            );

            create table if not exists locations (
              id text primary key,
              name text unique not null,
              parent_id text,
              type text not null default '仓库',
              code text,
              manager_id text,
              remark text,
              active integer not null default 1,
              created_at text not null,
              updated_at text not null
            );

            create table if not exists import_archives (
              id text primary key,
              file_name text not null,
              file_type text not null,
              category text not null,
              uploaded_by text not null references users(id),
              uploaded_at text not null,
              result_json text not null,
              content blob not null
            );

            create table if not exists import_row_fingerprints (
              id text primary key,
              file_hash text not null,
              row_hash text not null unique,
              file_name text not null,
              row_number integer not null,
              target_type text,
              target_id text,
              result text not null,
              archive_id text,
              imported_by text,
              created_at text not null
            );

            create table if not exists system_settings (
              key text primary key,
              value text not null
            );

            create table if not exists admin_requests (
              id text primary key,
              user_id text not null references users(id),
              status text not null,
              reason text,
              created_at text not null,
              handled_by text,
              handled_at text
            );

            create table if not exists asset_requests (
              id text primary key,
              user_id text not null references users(id),
              asset_name text not null,
              category text,
              spec text,
              quantity integer not null default 1,
              reason text,
              status text not null,
              created_at text not null,
              handled_by text,
              handled_at text,
              handle_note text
            );

            create table if not exists purchase_wishes (
              id text primary key,
              user_id text not null references users(id),
              item_name text not null,
              category text,
              spec text,
              unit text not null default '',
              quantity integer not null default 1,
              unit_price real not null default 0,
              total_amount real not null default 0,
              item_type text not null default '',
              priority text,
              expected_time text,
              reason text,
              status text not null,
              created_at text not null,
              handled_by text,
              handled_at text,
              handle_note text
            );

            create table if not exists inventory_check_tasks (
              id text primary key,
              check_no text unique not null,
              scope_type text not null,
              scope_value text,
              owner_id text not null references users(id),
              start_time text not null,
              end_time text,
              status text not null,
              remark text,
              created_at text not null
            );

            create table if not exists inventory_check_items (
              id text primary key,
              task_id text not null references inventory_check_tasks(id),
              asset_id text not null references assets(id),
              system_location text,
              actual_location text,
              system_status text,
              actual_status text,
              system_keeper_id text,
              actual_keeper_id text,
              checked integer not null default 0,
              diff_type text not null,
              remark text
            );

            create table if not exists stock_records (
              id text primary key,
              asset_id text not null references assets(id),
              flow_type text not null,
              quantity integer not null,
              before_quantity integer not null,
              after_quantity integer not null,
              related_type text,
              related_id text,
              operator_id text not null references users(id),
              note text,
              created_at text not null
            );

            create table if not exists borrow_orders (
              id text primary key,
              order_no text unique not null,
              asset_id text not null references assets(id),
              borrower_id text not null references users(id),
              quantity integer not null default 1,
              count_quantity integer not null default 1,
              operator_id text not null references users(id),
              expected_return_date text,
              actual_return_date text,
              status text not null,
              approval_status text not null,
              approver_id text,
              approval_time text,
              return_check text,
              note text,
              created_at text not null,
              updated_at text not null
            );

            create table if not exists transfer_orders (
              id text primary key,
              order_no text unique not null,
              asset_id text not null references assets(id),
              old_department text,
              new_department text,
              old_location text,
              new_location text,
              old_keeper_id text,
              new_keeper_id text,
              reason text,
              transfer_date text,
              status text not null,
              operator_id text not null references users(id),
              approver_id text,
              created_at text not null,
              updated_at text not null
            );

            create table if not exists repair_orders (
              id text primary key,
              order_no text unique not null,
              asset_id text not null references assets(id),
              reporter_id text not null references users(id),
              repairer text,
              status text not null,
              fault_desc text,
              cost real not null default 0,
              result text,
              start_time text,
              end_time text,
              operator_id text not null references users(id),
              created_at text not null,
              updated_at text not null
            );

            create table if not exists scrap_orders (
              id text primary key,
              order_no text unique not null,
              asset_id text not null references assets(id),
              applicant_id text not null references users(id),
              reason text,
              residual_value real not null default 0,
              scrap_date text,
              status text not null,
              approval_status text not null,
              approver_id text,
              approval_time text,
              operator_id text not null references users(id),
              created_at text not null,
              updated_at text not null
            );

            create table if not exists asset_flow_logs (
              id text primary key,
              asset_id text not null references assets(id),
              action text not null,
              operator_id text not null references users(id),
              business_no text,
              source_type text,
              source_id text,
              before_json text,
              after_json text,
              note text,
              created_at text not null
            );

            create table if not exists device_group_rules (
              id text primary key,
              source_key text unique not null,
              group_name text not null,
              family_id text,
              active integer not null default 1,
              created_by text,
              created_at text not null,
              updated_at text not null
            );
            """
        )
        conn.execute("insert or ignore into system_settings values ('multi_department_enabled', '0')")
        conn.execute("insert or ignore into system_settings values ('developer_mode_enabled', '0')")
        conn.execute("insert or ignore into system_settings values ('admin_prefill_enabled', '0')")
        conn.execute("insert or ignore into system_settings values ('asset_detail_label_enabled', '1')")
        conn.execute("insert or ignore into system_settings values ('paper_module_enabled', '1')")
        conn.execute("insert or ignore into system_settings values ('login_background_image', '')")
        conn.execute("insert or ignore into system_settings values ('service_port', ?)", (str(PUBLIC_PORT),))
        conn.execute("insert or ignore into system_settings values ('school_code', 'XXZX')")
        conn.execute("insert or ignore into system_settings values ('print_asset_template_name', '')")
        conn.execute("insert or ignore into system_settings values ('print_asset_template_content', '')")
        conn.execute("insert or ignore into system_settings values ('print_consumable_template_name', '')")
        conn.execute("insert or ignore into system_settings values ('print_consumable_template_content', '')")
        seed_rbac(conn)
        migrate_user_roles(conn)
        ensure_column(conn, "records", "photo", "text")
        ensure_column(conn, "assets", "image", "text")
        ensure_column(conn, "borrow_orders", "quantity", "integer not null default 1")
        ensure_column(conn, "borrow_orders", "count_quantity", "integer not null default 1")
        ensure_column(conn, "audits", "ip", "text")
        ensure_column(conn, "audits", "object_type", "text")
        ensure_column(conn, "audits", "object_id", "text")
        ensure_column(conn, "audits", "before_value", "text")
        ensure_column(conn, "audits", "after_value", "text")
        ensure_column(conn, "audits", "business_no", "text")
        ensure_column(conn, "assets", "safe_stock", "integer not null default 0")
        ensure_column(conn, "assets", "brand", "text")
        ensure_column(conn, "assets", "unit", "text not null default '件'")
        ensure_column(conn, "assets", "unit_price", "real not null default 0")
        ensure_column(conn, "assets", "total_amount", "real not null default 0")
        ensure_column(conn, "assets", "purchase_date", "text")
        ensure_column(conn, "assets", "inbound_date", "text")
        ensure_column(conn, "assets", "supplier", "text")
        ensure_column(conn, "assets", "use_department", "text")
        ensure_column(conn, "assets", "use_user_id", "text")
        ensure_column(conn, "assets", "source", "text")
        ensure_column(conn, "assets", "creator_id", "text")
        ensure_column(conn, "assets", "created_at", "text")
        ensure_column(conn, "assets", "updated_at", "text")
        conn.execute("update assets set unit = '件' where unit is null or unit = ''")
        conn.execute("update assets set total_amount = quantity * unit_price where (total_amount is null or total_amount = 0) and unit_price > 0")
        conn.execute("update assets set use_department = (select department from users where users.id = assets.keeper_id) where use_department is null or use_department = ''")
        conn.execute("update assets set use_user_id = keeper_id where use_user_id is null or use_user_id = ''")
        conn.execute("update assets set created_at = coalesce(nullif(inbound_date, ''), ?) where created_at is null or created_at = ''", (now_local(),))
        conn.execute("update assets set updated_at = created_at where updated_at is null or updated_at = ''")
        ensure_column(conn, "asset_categories", "parent_id", "text")
        ensure_column(conn, "asset_categories", "code", "text")
        ensure_column(conn, "asset_categories", "category_type", "text not null default '固定资产'")
        ensure_column(conn, "asset_categories", "created_at", "text not null default ''")
        ensure_column(conn, "asset_categories", "updated_at", "text not null default ''")
        ensure_column(conn, "locations", "parent_id", "text")
        ensure_column(conn, "locations", "type", "text not null default '仓库'")
        ensure_column(conn, "locations", "code", "text")
        ensure_column(conn, "locations", "manager_id", "text")
        ensure_column(conn, "locations", "remark", "text")
        ensure_column(conn, "locations", "active", "integer not null default 1")
        ensure_column(conn, "locations", "created_at", "text not null default ''")
        ensure_column(conn, "locations", "updated_at", "text not null default ''")
        ensure_column(conn, "purchase_wishes", "unit", "text not null default ''")
        ensure_column(conn, "purchase_wishes", "unit_price", "real not null default 0")
        ensure_column(conn, "purchase_wishes", "total_amount", "real not null default 0")
        ensure_column(conn, "purchase_wishes", "item_type", "text not null default ''")
        conn.execute("update purchase_wishes set unit = '件' where unit is null or unit = ''")
        conn.execute("update purchase_wishes set item_type = category where (item_type is null or item_type = '') and category <> ''")
        conn.execute("update purchase_wishes set total_amount = quantity * unit_price where (total_amount is null or total_amount = 0) and unit_price > 0")
        migrate_server_times_to_beijing(conn)
        migrate_multi_department_default_off(conn)
        migrate_factory_blank_config(conn)
        migrate_imported_asset_names(conn)
        migrate_word_import_order_and_users(conn)
        migrate_imported_asset_names_v2(conn)
        migrate_imported_asset_names_v3(conn)
        migrate_blank_placeholder_values(conn)
        migrate_remove_template_noise_assets(conn)
        migrate_remove_template_noise_assets_v2(conn)
        migrate_clean_word_record_notes(conn)
        migrate_link_word_asset_groups(conn)
        migrate_tag_word_import_groups(conn)
        migrate_tag_word_import_groups_v2(conn)
        migrate_tag_word_import_groups_v3(conn)
        migrate_tag_word_import_groups_v4(conn)
        migrate_import_usernames_to_initials(conn)
        migrate_usernames_to_initials_v2(conn)
        migrate_revoked_admin_requests(conn)
        migrate_asset_quantity_from_price(conn)
        migrate_numeric_record_times(conn)
        migrate_remove_word_import_time_fallback_records(conn)
        migrate_word_record_times_from_archives(conn)
        migrate_remove_word_records_using_import_time(conn)
        migrate_deduplicate_duplicate_records(conn)
        ensure_default_admin_login(conn)
        existing_departments = conn.execute("select count(*) from departments").fetchone()[0]
        if not existing_departments:
            user_departments = rows_to_list(conn.execute("select distinct department as name from users where department <> ''"))
            seed_departments = [item["name"] for item in user_departments] or ["仓储部"]
            conn.executemany(
                "insert or ignore into departments values (?, ?, ?)",
                [(new_id("dept"), name, 1) for name in seed_departments],
            )
        existing_categories = conn.execute("select count(*) from asset_categories").fetchone()[0]
        if not existing_categories:
            asset_categories = rows_to_list(conn.execute("select distinct category as name from assets where category <> ''"))
            seed_categories = [item["name"] for item in asset_categories] or ["固定资产", "低值易耗品", "耗材", "购进软件"]
            now = now_local()
            conn.executemany(
                """
                insert or ignore into asset_categories
                (id, name, parent_id, code, category_type, active, created_at, updated_at)
                values (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [(new_id("cat"), name, "", "", name if name in ("固定资产", "低值品", "低值易耗品", "易耗品", "耗材") else "固定资产", 1, now, now) for name in seed_categories],
            )
        existing_locations = conn.execute("select count(*) from locations").fetchone()[0]
        if not existing_locations:
            asset_locations = rows_to_list(conn.execute("select distinct location as name from assets where location <> ''"))
            seed_locations = [item["name"] for item in asset_locations] or ["总仓库"]
            now = now_local()
            conn.executemany(
                """
                insert or ignore into locations
                (id, name, parent_id, type, code, manager_id, remark, active, created_at, updated_at)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [(new_id("loc"), name, "", "仓库", "", "", "", 1, now, now) for name in seed_locations],
            )
        count = conn.execute("select count(*) from users").fetchone()[0]
        if count:
            return

        conn.executemany(
            """
            insert into users
            (id, username, password, name, role, role_id, department, active)
            values (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                ("u-admin", "admin", DEFAULT_ADMIN_PASSWORD, "系统管理员", "admin", "admin", "仓储部", 1),
            ],
        )
        conn.executemany(
            "insert or ignore into departments values (?, ?, ?)",
            [(new_id("dept"), name, 1) for name in ["仓储部"]],
        )


def role_id_for_user(user):
    role_id = str(user["role_id"] or "").strip() if "role_id" in user.keys() else ""
    if role_id:
        return role_id
    return "admin" if user["role"] == "admin" else "teacher"


def role_label(role_id):
    return next((name for item_id, name, _ in ROLE_DEFINITIONS if item_id == role_id), role_id or "普通教师")


def user_permissions(conn, user):
    role_id = role_id_for_user(user)
    rows = rows_to_list(
        conn.execute(
            "select permission_code from role_permissions where role_id = ?",
            (role_id,),
        )
    )
    return {item["permission_code"] for item in rows}


def user_menus(conn, user):
    role_id = role_id_for_user(user)
    rows = rows_to_list(
        conn.execute(
            """
            select rm.menu_key
            from role_menus rm
            join menu_permissions mp on mp.menu_key = rm.menu_key and mp.active = 1
            where rm.role_id = ?
            order by case rm.menu_key
              when 'dashboard' then 1 when 'assets' then 2 when 'inventory' then 3
              when 'records' then 4 when 'checks' then 5 when 'orders' then 6
              when 'reports' then 7 when 'assetRequests' then 8 when 'purchaseWishes' then 9
              when 'paper' then 10 when 'users' then 11 when 'baseData' then 12
              when 'settings' then 13 when 'audit' then 14 else 99 end
            """,
            (role_id,),
        )
    )
    return [item["menu_key"] for item in rows]


def has_permission(conn, user, permission_code):
    if role_id_for_user(user) == "admin":
        return True
    return permission_code in user_permissions(conn, user)


def require_permission(conn, user, permission_code):
    if not has_permission(conn, user, permission_code):
        raise PermissionError("没有执行该操作的权限")


def has_view_permission(conn, user, permission_code, view_role=""):
    if view_role == "user" and has_permission(conn, user, "assets.view.all"):
        return permission_code in ROLE_PERMISSION_MAP["teacher"]
    return has_permission(conn, user, permission_code)


def require_view_permission(conn, user, permission_code, view_role=""):
    if not has_view_permission(conn, user, permission_code, view_role):
        raise PermissionError("没有执行该操作的权限")


def department_scope_filter(user, field="department"):
    if role_id_for_user(user) == "department_head":
        return f" and {field} = ? ", [user["department"]]
    return "", []


def public_user(user, conn=None):
    data = dict(user)
    data.pop("password", None)
    data["active"] = bool(data["active"])
    role_id = role_id_for_user(user)
    data["roleId"] = role_id
    data["roleName"] = role_label(role_id)
    data["legacyRole"] = data.get("role", "")
    data["role"] = role_id
    if conn is not None:
        data["permissions"] = sorted(user_permissions(conn, user))
        data["menus"] = user_menus(conn, user)
    return data


def get_user(conn, user_id):
    return conn.execute("select * from users where id = ? and active = 1", (user_id,)).fetchone()


def cleanup_old_sessions(conn):
    cutoff = (datetime.now(BEIJING_TZ).replace(tzinfo=None, microsecond=0) - timedelta(days=30)).isoformat(timespec="minutes")
    conn.execute("delete from user_sessions where last_seen_at < ?", (cutoff,))


def create_session(conn, user_id):
    cleanup_old_sessions(conn)
    token = secrets.token_urlsafe(32)
    now = now_local()
    conn.execute(
        "insert into user_sessions (token, user_id, created_at, last_seen_at) values (?, ?, ?, ?)",
        (token, user_id, now, now),
    )
    return token


def request_session_token(payload=None, query=None):
    token = ""
    if payload:
        token = str(payload.get("sessionToken") or "").strip()
    if not token and query:
        token = str(query.get("sessionToken", [""])[0] or "").strip()
    return token


def require_user(conn, payload=None, query=None):
    user_id = ""
    if payload:
        user_id = str(payload.get("actorId") or payload.get("userId") or "").strip()
    if not user_id and query:
        user_id = str(query.get("userId", [""])[0] or "").strip()
    token = request_session_token(payload, query)
    if not token:
        raise AuthError("登录已过期，请重新登录。")
    session = conn.execute("select * from user_sessions where token = ?", (token,)).fetchone()
    if not session:
        raise AuthError("登录已过期，请重新登录。")
    if user_id and user_id != session["user_id"]:
        raise AuthError("登录身份不一致，请重新登录。")
    user = get_user(conn, session["user_id"])
    if not user:
        raise AuthError("请先登录。")
    conn.execute("update user_sessions set last_seen_at = ? where token = ?", (now_local(), token))
    return user


def require_admin(user):
    if role_id_for_user(user) != "admin":
        raise PermissionError("只有管理员可以执行此操作")


def add_audit(conn, user_id, action, detail, ip=""):
    audit_change(conn, user_id, action, detail=detail, before="", after="", business_no="")


def setting_value(conn, key, default=""):
    row = conn.execute("select value from system_settings where key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(conn, key, value):
    conn.execute(
        "insert into system_settings values (?, ?) on conflict(key) do update set value = excluded.value",
        (key, str(value)),
    )


def valid_port(value):
    try:
        port = int(str(value).strip())
    except ValueError:
        return 0
    return port if 1 <= port <= 65535 else 0


def next_asset_code(conn, category_name=""):
    year = datetime.now(BEIJING_TZ).year
    category = conn.execute("select code from asset_categories where name = ? and active = 1", (category_name,)).fetchone()
    category_code = str(category["code"] or "").strip().upper() if category else ""
    school_code = setting_value(conn, "school_code", "XXZX").strip().upper() or "XXZX"
    prefix = f"{school_code}-{category_code}-{year}-" if category_code else f"CK-{year}-"
    rows = rows_to_list(conn.execute("select code from assets where code like ?", (f"{prefix}%",)))
    max_number = 0
    for row in rows:
        match = re.fullmatch(rf"{re.escape(prefix)}(\d+)", row["code"] or "")
        if match:
            max_number = max(max_number, int(match.group(1)))
    return f"{prefix}{max_number + 1:04d}"


def next_check_no(conn):
    prefix = f"PD-{datetime.now(BEIJING_TZ).year}-"
    rows = rows_to_list(conn.execute("select check_no from inventory_check_tasks where check_no like ?", (f"{prefix}%",)))
    max_number = 0
    for row in rows:
        match = re.fullmatch(rf"{re.escape(prefix)}(\d+)", row["check_no"] or "")
        if match:
            max_number = max(max_number, int(match.group(1)))
    return f"{prefix}{max_number + 1:04d}"


def next_order_no(conn, table, column, prefix):
    year_prefix = f"{prefix}-{datetime.now(BEIJING_TZ).year}-"
    rows = rows_to_list(conn.execute(f"select {column} as order_no from {table} where {column} like ?", (f"{year_prefix}%",)))
    max_number = 0
    for row in rows:
        match = re.fullmatch(rf"{re.escape(year_prefix)}(\d+)", row["order_no"] or "")
        if match:
            max_number = max(max_number, int(match.group(1)))
    return f"{year_prefix}{max_number + 1:04d}"


def valid_login_background(value):
    text = str(value or "").strip()
    if not text:
        return ""
    if len(text) > 6 * 1024 * 1024:
        raise ValueError("图片太大，请选择 5MB 以内的图片")
    if re.match(r"^data:image/(png|jpe?g|webp|gif);base64,[a-zA-Z0-9+/=\s]+$", text):
        return re.sub(r"\s+", "", text)
    if re.match(r"^https?://", text):
        return text
    raise ValueError("只支持图片上传或 http/https 图片地址")


def valid_docx_template(file_name, content_base64):
    clean_name = safe_download_name(file_name or "print-template.docx")
    if not clean_name.lower().endswith(".docx"):
        raise ValueError("打印模板必须是 .docx 文件")
    try:
        content = base64.b64decode(content_base64 or "")
    except (ValueError, TypeError):
        raise ValueError("模板文件内容无效")
    if len(content) > 2 * 1024 * 1024:
        raise ValueError("模板文件不能超过 2MB")
    try:
        with zipfile.ZipFile(io.BytesIO(content), "r") as archive:
            if "word/document.xml" not in archive.namelist():
                raise ValueError("模板文件不是有效的 Word 文档")
    except zipfile.BadZipFile:
        raise ValueError("模板文件不是有效的 Word 文档")
    return clean_name, base64.b64encode(content).decode("ascii")


def template_source(conn, kind):
    if kind == "asset":
        return (
            setting_value(conn, "print_asset_template_name", ""),
            setting_value(conn, "print_asset_template_content", ""),
            ASSET_REQUEST_TEMPLATE,
        )
    return (
        setting_value(conn, "print_consumable_template_name", ""),
        setting_value(conn, "print_consumable_template_content", ""),
        CONSUMABLE_REQUEST_TEMPLATE,
    )


def write_port_config(port):
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(f"WAREHOUSE_HOST_PORT={port}\n", encoding="utf-8")


def ensure_department(conn, name):
    clean = str(name or "").strip()
    if not clean:
        return
    conn.execute(
        "insert into departments values (?, ?, 1) on conflict(name) do update set active = 1",
        (new_id("dept"), clean),
    )


def ensure_asset_category(conn, name):
    clean = str(name or "").strip()
    if not clean:
        return
    now = now_local()
    conn.execute(
        """
        insert into asset_categories
        (id, name, parent_id, code, category_type, active, created_at, updated_at)
        values (?, ?, '', '', ?, 1, ?, ?)
        on conflict(name) do update set active = 1, updated_at = excluded.updated_at
        """,
        (new_id("cat"), clean, "耗材" if is_consumable_text(clean) else "固定资产", now, now),
    )


def save_import_archive(conn, actor, file_name, file_type, category, content, result):
    archive_id = new_id("file")
    conn.execute(
        "insert into import_archives values (?, ?, ?, ?, ?, ?, ?, ?)",
        (
            archive_id,
            file_name,
            file_type,
            category,
            actor["id"],
            now_local(),
            json.dumps(result, ensure_ascii=False),
            sqlite3.Binary(content),
        ),
    )
    return archive_id


def sha256_hex(value):
    if isinstance(value, str):
        value = value.encode("utf-8")
    return hashlib.sha256(value or b"").hexdigest()


def normalized_row_payload(row, scope=""):
    items = {}
    for key, value in sorted((row or {}).items(), key=lambda item: str(item[0])):
        clean_key = clean_docx_text(key)
        clean_value = clean_docx_text(value)
        if clean_key or clean_value:
            items[clean_key] = clean_value
    return {"scope": scope, "row": items}


def import_row_hash(row, scope=""):
    return sha256_hex(json.dumps(normalized_row_payload(row, scope), ensure_ascii=False, sort_keys=True))


def imported_row(conn, row_hash):
    prune_orphan_import_fingerprints(conn)
    return conn.execute(
        """
        select *
        from import_row_fingerprints f
        where f.row_hash = ?
          and (
            (f.target_type = 'asset' and exists (select 1 from assets a where a.id = f.target_id))
            or (f.target_type = 'record' and exists (select 1 from records r where r.id = f.target_id))
            or (f.target_type = 'file' and (
              exists (select 1 from import_archives a where a.id = f.archive_id)
              or exists (select 1 from import_archives a where a.id = f.target_id)
            ))
          )
        """,
        (row_hash,),
    ).fetchone()


def register_import_row(conn, file_hash, row_hash, file_name, row_number, target_type, target_id, result, actor_id, archive_id=""):
    conn.execute(
        """
        insert or ignore into import_row_fingerprints
        (id, file_hash, row_hash, file_name, row_number, target_type, target_id, result, archive_id, imported_by, created_at)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            new_id("improw"),
            file_hash,
            row_hash,
            file_name,
            int(row_number or 0),
            target_type,
            target_id,
            result,
            archive_id,
            actor_id,
            now_local(),
        ),
    )


def import_file_seen(conn, file_hash):
    if not file_hash:
        return None
    prune_orphan_import_fingerprints(conn)
    return conn.execute(
        """
        select file_name, created_at
        from import_row_fingerprints f
        where f.file_hash = ?
          and (
            (f.target_type = 'asset' and exists (select 1 from assets a where a.id = f.target_id))
            or (f.target_type = 'record' and exists (select 1 from records r where r.id = f.target_id))
            or (f.target_type = 'file' and (
              exists (select 1 from import_archives a where a.id = f.archive_id)
              or exists (select 1 from import_archives a where a.id = f.target_id)
            ))
          )
        order by f.created_at limit 1
        """,
        (file_hash,),
    ).fetchone()


def prune_orphan_import_fingerprints(conn):
    conn.execute(
        """
        delete from import_row_fingerprints
        where not (
          (target_type = 'asset' and exists (select 1 from assets a where a.id = import_row_fingerprints.target_id))
          or (target_type = 'record' and exists (select 1 from records r where r.id = import_row_fingerprints.target_id))
          or (target_type = 'file' and (
            exists (select 1 from import_archives a where a.id = import_row_fingerprints.archive_id)
            or exists (select 1 from import_archives a where a.id = import_row_fingerprints.target_id)
          ))
        )
        """
    )


def import_file_marker(conn, file_hash):
    if not file_hash:
        return None
    prune_orphan_import_fingerprints(conn)
    return conn.execute(
        """
        select f.*, a.file_type, a.result_json
        from import_row_fingerprints f
        left join import_archives a on a.id = f.archive_id
        where f.file_hash = ? and f.target_type = 'file'
        order by f.created_at desc, f.id desc
        limit 1
        """,
        (file_hash,),
    ).fetchone()


def word_file_retry_allowed(conn, file_hash):
    marker = import_file_marker(conn, file_hash)
    if not marker or marker["file_type"] != "docx":
        return False
    try:
        result = json.loads(marker["result_json"] or "{}")
    except json.JSONDecodeError:
        return False
    skipped_count = len(result.get("skipped") or [])
    return bool(result.get("paperCreated")) or skipped_count > 0 or int(result.get("imported") or 0) == 0


def register_import_file(conn, file_hash, file_name, category, actor_id, archive_id=""):
    if not file_hash:
        return
    register_import_row(
        conn,
        file_hash,
        sha256_hex(f"file:{file_hash}"),
        file_name,
        0,
        "file",
        archive_id,
        f"archived:{category or 'import'}",
        actor_id,
        archive_id,
    )


def tag_import_rows_with_archive(conn, file_hash, archive_id):
    if not file_hash or not archive_id:
        return
    conn.execute(
        """
        update import_row_fingerprints
        set archive_id = ?
        where file_hash = ? and (archive_id is null or archive_id = '')
        """,
        (archive_id, file_hash),
    )


def ensure_import_result_stats(result):
    result.setdefault("imported", 0)
    result.setdefault("createdAssets", 0)
    result.setdefault("existingAssets", 0)
    result.setdefault("updatedAssets", 0)
    result.setdefault("processedRows", int(result.get("imported") or 0) + int(result.get("existingAssets") or 0))
    result.setdefault("duplicateRows", 0)
    result.setdefault("duplicateFiles", 0)
    result.setdefault("paperCreated", 0)
    result.setdefault("skipped", [])
    return result


def attach_import_archive(conn, actor, file_name, content, file_type, category, result, file_hash=""):
    ensure_import_result_stats(result)
    archive_id = save_import_archive(conn, actor, file_name, file_type, category, content, result)
    result["archiveId"] = archive_id
    register_import_file(conn, file_hash, file_name, category, actor["id"], archive_id)
    tag_import_rows_with_archive(conn, file_hash, archive_id)
    return archive_id


def cell_text(cell, shared_strings):
    cell_type = cell.attrib.get("t")
    value = cell.find("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}v")
    inline = cell.find("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}is/{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")
    if inline is not None and inline.text:
        return inline.text.strip()
    if value is None or value.text is None:
        return ""
    raw = value.text.strip()
    if cell_type == "s":
        try:
            return shared_strings[int(raw)]
        except (ValueError, IndexError):
            return raw
    return raw


def cell_index(cell):
    ref = cell.attrib.get("r", "")
    letters = "".join(ch for ch in ref if ch.isalpha())
    if not letters:
        return None
    index = 0
    for letter in letters:
        index = index * 26 + ord(letter.upper()) - ord("A") + 1
    return index - 1


def parse_xlsx(content):
    parsed_rows = []
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        shared_strings = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
            for item in root.findall("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}si"):
                texts = [node.text or "" for node in item.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")]
                shared_strings.append("".join(texts).strip())
        sheet_names = sorted(
            (name for name in archive.namelist() if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", name)),
            key=lambda name: int(re.search(r"sheet(\d+)\.xml", name).group(1)),
        )
        for sheet_name in sheet_names:
            parsed_rows.extend(table_to_dicts(xlsx_sheet_rows(archive, sheet_name, shared_strings)))
    return parsed_rows


def xlsx_sheet_rows(archive, sheet_name, shared_strings):
    rows = []
    root = ElementTree.fromstring(archive.read(sheet_name))
    for row in root.findall(".//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}row"):
        values = []
        for cell in row.findall("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}c"):
            index = cell_index(cell)
            if index is None:
                index = len(values)
            while len(values) <= index:
                values.append("")
            values[index] = cell_text(cell, shared_strings)
        if any(values):
            rows.append(values)
    return rows


def parse_csv(content):
    text = content.decode("utf-8-sig")
    rows = list(csv.reader(io.StringIO(text)))
    return table_to_dicts(rows)


def parse_docx(content):
    table_rows = []
    tables = []
    text_parts = []
    image_count = 0
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        names = archive.namelist()
        image_count = len([name for name in names if name.startswith("word/media/")])
        if "word/document.xml" not in names:
            return {"rows": [], "text": "", "imageCount": image_count}
        root = ElementTree.fromstring(archive.read("word/document.xml"))
        for paragraph in root.findall(".//w:p", ns):
            texts = [node.text or "" for node in paragraph.findall(".//w:t", ns)]
            line = "".join(texts).strip()
            if line:
                text_parts.append(line)
        for table in root.findall(".//w:tbl", ns):
            current_table = []
            for row in table.findall(".//w:tr", ns):
                values = []
                for cell in row.findall(".//w:tc", ns):
                    cell_lines = []
                    for paragraph in cell.findall(".//w:p", ns):
                        line = "".join(node.text or "" for node in paragraph.findall(".//w:t", ns)).strip()
                        if line:
                            cell_lines.append(line)
                    if not cell_lines:
                        cell_lines = ["".join(node.text or "" for node in cell.findall(".//w:t", ns))]
                    values.append(clean_docx_text(" ".join(cell_lines)))
                if any(values):
                    table_rows.append(values)
                    current_table.append(values)
            if current_table:
                tables.append(current_table)
    return {"rows": table_to_dicts(table_rows), "tables": tables, "text": "\n".join(text_parts), "imageCount": image_count}


def clean_docx_text(value):
    text = str(value or "")
    text = text.replace("\u21b5", "").replace("\r", " ").replace("\n", " ")
    text = text.replace("□", "").replace("☑", "").replace("√", "")
    return re.sub(r"\s+", " ", text).strip()


def field_key(value):
    return re.sub(r"\s+", "", clean_docx_text(value))


INVALID_FIELD_VALUES = {
    "序号",
    "申领人",
    "申请人",
    "借用人",
    "使用人",
    "归还人",
    "物品名称",
    "资产名称",
    "配置",
    "规格",
    "数量",
    "领用时间",
    "领用日期",
    "预计归还时间",
    "归还日期",
    "备注",
    "申请缘由",
    "审核",
    "负责人审核",
    "项目负责人审核",
    "资产管理负责人审核",
    "领用人确认领用签名",
    "领用人确认归还签名",
    "资产管理负责人确认归还签名",
    "确认归还签名",
}


def is_invalid_field_value(value):
    key = field_key(value).strip(":：")
    return not key or key in {field_key(item) for item in INVALID_FIELD_VALUES}


def is_template_noise_row(*values):
    keys = [field_key(value).strip(":：") for value in values if clean_docx_text(value)]
    if not keys:
        return True
    invalid_keys = {field_key(item) for item in INVALID_FIELD_VALUES}
    signature_keys = {"项目负责人审核", "资产管理负责人审核", "领用人确认领用签名", "领用人确认归还签名", "确认归还签名", "预期归还日期"}
    signature_keys = {field_key(item) for item in signature_keys}
    return any(key in invalid_keys or key in signature_keys for key in keys)


def clean_person_value(value):
    text = clean_docx_text(value).strip(":： ")
    if is_invalid_field_value(text):
        return ""
    if any(label in text for label in ("签名", "审核", "确认", "日期")):
        return ""
    if len(text) > 20:
        return ""
    return text


def value_after_label(text, label):
    for line in str(text or "").splitlines():
        clean = clean_docx_text(line)
        match = re.search(rf"{re.escape(label)}[:：]?[ \t]*([^，。；;:：]*)", clean)
        if match:
            value = clean_docx_text(match.group(1))
            if not is_invalid_field_value(value):
                return value
    return ""


def value_after_time_label(text, label):
    for line in str(text or "").splitlines():
        clean = clean_docx_text(line)
        match = re.search(rf"{re.escape(label)}[:：]?[ \t]*([^，。；;]*)", clean)
        if match:
            value = clean_docx_text(match.group(1))
            normalized = normalize_time(value)
            if normalized:
                return normalized
    return ""


def table_label_value(parsed, *labels):
    label_keys = {field_key(label) for label in labels}
    for table in parsed.get("tables", []):
        for row in table:
            for index, cell in enumerate(row):
                key = field_key(cell)
                if key in label_keys:
                    for next_cell in row[index + 1:]:
                        value = clean_docx_text(next_cell)
                        if not is_invalid_field_value(value):
                            return value
                for label in labels:
                    prefix = field_key(label)
                    if key.startswith(prefix) and len(key) > len(prefix):
                        value = clean_docx_text(cell[len(label):].lstrip(":： "))
                        if not is_invalid_field_value(value):
                            return value
    return ""


def document_time_value(parsed, *labels):
    full_text = parsed.get("text", "")
    table_value = table_label_value(parsed, *labels)
    normalized = normalize_time(table_value)
    if normalized:
        return normalized
    return next((value_after_time_label(full_text, label) for label in labels if value_after_time_label(full_text, label)), "")


def extract_asset_codes(value):
    text = clean_docx_text(value)
    codes = re.findall(r"[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+", text)
    if codes:
        return codes
    return [text] if text else []


def append_import_note(note, value):
    return append_unique_note(note, value) if value else note


def clean_doc_no(value):
    text = clean_docx_text(value)
    text = re.split(r"\s*(?:本单序号|负责人|申请人|申领人)\s*[:：]?", text, maxsplit=1)[0]
    return clean_docx_text(text)


def detect_category(value):
    text = field_key(value)
    for category in ("固定资产", "低值易耗品", "耗材", "购进软件"):
        if category in text:
            return category
    return ""


def detect_document_type(value):
    text = field_key(value)
    if "耗材领用申请" in text or "耗材领用" in text:
        return "耗材领用"
    if "物品领用申请" in text or "物品领用" in text:
        return "资产领用"
    return ""


def parse_requisition_docx(parsed):
    full_text = parsed["text"]
    document_type = detect_document_type(full_text) or "资产领用"
    doc_no = clean_doc_no(table_label_value(parsed, "编号", "本单序号") or value_after_label(full_text, "编号") or value_after_label(full_text, "本单序号"))
    applicant = clean_person_value(table_label_value(parsed, "申请人", "申领人") or value_after_label(full_text, "申请人") or value_after_label(full_text, "申领人"))
    owner = clean_person_value(table_label_value(parsed, "负责人") or value_after_label(full_text, "负责人"))
    default_receive_time = document_time_value(parsed, "领用时间", "领用日期", "出库时间", "出库日期", "借出时间", "借出日期", "申请日期")
    default_return_time = document_time_value(parsed, "预计归还时间", "预期归还日期", "预计归还日期", "归还日期")
    rows = []

    def add_requisition_row(sequence, name, code, config, quantity, receiver, receive_time, return_time, category, row_remark):
        note = "；".join(
            item
            for item in (
                f"单据类型：{document_type}",
                "Word领用单导入",
                f"负责人：{owner}" if owner else "",
                f"出借人：{receiver}" if receiver else "",
                f"申请人：{applicant}" if applicant and applicant != receiver else "",
                row_remark if row_remark and not is_invalid_field_value(row_remark) else "",
            )
            if item
        )
        if not receive_time:
            note = append_import_note(note, "原单未填写领用日期")
        rows.append(
            {
                "资产名称": name,
                "资产编号": code,
                "模板序号": sequence,
                "规格型号": config,
                "数量": quantity or "1",
                "借用人": receiver,
                "出库时间": receive_time,
                "归还时间": return_time,
                "类别": category or ("耗材" if document_type == "耗材领用" else "资产"),
                "纸质单号": doc_no,
                "备注": note,
                "类型": "出库",
            }
        )

    for table in parsed["tables"]:
        header_index = None
        headers = []
        for index, row in enumerate(table):
            joined = "".join(row)
            if "物品名称" in joined and "数量" in joined:
                header_index = index
                headers = row
                break
        if header_index is None:
            continue
        header_map = {field_key(header): pos for pos, header in enumerate(headers)}
        for row in table[header_index + 1:]:
            get = lambda *names: next((row[header_map[name]] for name in names if name in header_map and header_map[name] < len(row) and row[header_map[name]]), "")
            sequence = get("序号")
            name = get("物品名称")
            code = get("资产编号")
            config = get("配置")
            quantity = get("数量")
            receiver = clean_person_value(get("申领人", "申请人")) or applicant
            receive_time = get("领用时间", "领用日期", "出库时间", "出库日期", "借出时间", "借出日期") or default_receive_time
            return_time = get("预计归还时间", "预期归还日期", "预计归还日期", "归还日期") or default_return_time
            row_remark = get("备注")
            category = get("类别") or detect_category("".join(row))
            invalid_item_names = {"领用日期", "归还日期", "备注", "项目负责人审核", "负责人审核", "审核", "申请人", "申领人", "序号", "申请缘由"}
            invalid_item_keys = {field_key(item) for item in invalid_item_names}
            if field_key(name) in invalid_item_keys or field_key(sequence) in invalid_item_keys:
                continue
            if is_template_noise_row(sequence, name, code, config, quantity, receive_time, return_time):
                continue
            if not name and is_invalid_field_value(code):
                continue
            if not any([name, code, config, quantity, receive_time, return_time]):
                continue
            if not name:
                continue
            codes = extract_asset_codes(code)
            if len(codes) > 1:
                for code_index, item_code in enumerate(codes, start=1):
                    add_requisition_row(
                        f"{sequence}.{code_index}" if sequence else str(code_index),
                        name,
                        item_code,
                        config,
                        "1",
                        receiver,
                        receive_time,
                        return_time,
                        category,
                        row_remark,
                    )
            else:
                add_requisition_row(sequence, name, code, config, quantity, receiver, receive_time, return_time, category, row_remark)
    return rows


def row_record_time(row):
    out_time = normalize_time(first_value(row, ("出库时间", "借出时间", "领用时间", "领用日期", "out_time")))
    in_time = normalize_time(first_value(row, ("入库时间", "归还时间", "return_time", "in_time")))
    return out_time or in_time


def is_blank_requisition_template(parsed):
    if not detect_document_type(parsed.get("text", "")):
        return False
    invalid_labels = {"申请缘由", "领用日期", "归还日期", "项目负责人审核", "资产管理负责人审核", "备注", "领用人确认", "归还确认"}
    serial_values = {str(index) for index in range(1, 16)}
    for table in parsed.get("tables", []):
        header_index = None
        for index, row in enumerate(table):
            joined = "".join(row)
            if "物品名称" in joined and "数量" in joined:
                header_index = index
                break
        if header_index is None:
            continue
        for row in table[header_index + 1:]:
            cells = [clean_docx_text(cell) for cell in row]
            row_text = "".join(cells)
            if not row_text:
                continue
            if any(label in row_text for label in invalid_labels):
                continue
            meaningful = [
                cell for cell in cells
                if cell
                and cell not in serial_values
                and cell != "1"
                and not is_invalid_field_value(cell)
                and not all(label in cell for label in ("固定资产", "低值易耗品", "耗材", "购进软件"))
            ]
            if meaningful:
                return False
        return True
    return False


FIELD_ALIASES = {
    "资产编号": ("资产编码", "资产代码", "固定资产编号", "国资编号", "资产条码", "条码", "编号", "asset_code", "code", "__synthetic_asset_code"),
    "资产名称": ("名称", "物品名称", "设备名称", "耗材名称", "品名", "产品名称", "asset_name", "name"),
    "规格型号": ("规格", "型号", "配置", "规格/型号", "规格型号配置", "spec", "model"),
    "资产分类": ("分类", "类别", "资产类别", "物品类别", "category"),
    "数量": ("件数", "库存数量", "领用数量", "qty", "quantity"),
    "单位": ("计量单位", "unit"),
    "单价": ("价格", "资产原值", "资产原值（元）", "资产原值(元)", "原值", "金额", "unit_price"),
    "总金额": ("总价", "合计", "合计金额", "总计", "total_amount"),
    "取得日期": ("购置日期", "购买日期", "采购日期", "入账日期", "入库日期", "日期", "purchase_date"),
    "部门": ("使用部门", "所属部门", "当前部门", "领用部门", "department"),
    "具体存放地点": ("更新后的具体存放地点", "存放地点", "当前位置", "位置", "地点", "location"),
    "使用人": ("责任人", "保管人", "借用人", "领用人", "申领人", "姓名", "当前使用人", "user", "name"),
    "清查盘点情况": ("盘点情况", "盘点结果", "清查情况", "清查盘点"),
    "清查盘盈情况": ("盘盈情况", "盘盈结果", "清查盘盈"),
    "出入库取用情况": ("出入库取用情况（记录取用日期）", "取用情况", "领用情况", "借用情况"),
    "入库时间": ("入库日期", "取得日期", "in_time"),
    "出库时间": ("借出时间", "领用时间", "领用日期", "out_time"),
    "纸质单号": ("单号", "单据编号", "纸质编号", "paper_no"),
    "备注": ("说明", "用途", "note"),
}


def normalize_header_key(value):
    text = field_key(value).strip(":：")
    return re.sub(r"[（）()\[\]【】<>《》:：,，、/\\|_\-]", "", text).lower()


def aliases_for_field(name):
    aliases = [name]
    key = field_key(name).strip(":：")
    aliases.extend(FIELD_ALIASES.get(key, ()))
    normalized = normalize_header_key(name)
    for canonical, values in FIELD_ALIASES.items():
        if normalize_header_key(canonical) == normalized or normalized in {normalize_header_key(item) for item in values}:
            aliases.append(canonical)
            aliases.extend(values)
    result = []
    seen = set()
    for alias in aliases:
        alias_key = normalize_header_key(alias)
        if alias_key and alias_key not in seen:
            result.append(alias)
            seen.add(alias_key)
    return result


def header_matches_alias(header, alias):
    header_key = normalize_header_key(header)
    alias_key = normalize_header_key(alias)
    if not header_key or not alias_key:
        return False
    if header_key == alias_key:
        return True
    # Long aliases safely cover headers with prefixes/suffixes, such as "4月12日清查盘点情况".
    return len(alias_key) >= 4 and (alias_key in header_key or header_key in alias_key)


def header_matches_field(header, field_name):
    return any(header_matches_alias(header, alias) for alias in aliases_for_field(field_name))


def table_header_score(row):
    marker_fields = ("资产编号", "资产名称", "规格型号", "资产分类", "数量", "部门", "具体存放地点", "资产原值", "取得日期")
    score = 0
    for field_name in marker_fields:
        if any(header_matches_field(cell, field_name) for cell in row):
            score += 1
    return score


def table_to_dicts(rows):
    if not rows:
        return []
    header_index = 0
    for index, row in enumerate(rows[:30]):
        if table_header_score(row) >= 2:
            header_index = index
            break
    headers = [str(item).strip().replace("\n", "") for item in rows[header_index]]
    result = []
    for row in rows[header_index + 1:]:
        item = {}
        for index, header in enumerate(headers):
            if header:
                item[header] = str(row[index]).strip() if index < len(row) else ""
        if any(item.values()):
            result.append(item)
    return result


def first_value(row, names):
    if not isinstance(row, dict):
        return ""
    for name in names:
        for alias in aliases_for_field(name):
            direct = row.get(alias)
            if direct:
                return str(direct).strip()
            for header, value in row.items():
                if value and header_matches_alias(header, alias):
                    return str(value).strip()
    return ""


def normalize_record_type(value):
    text = (value or "").strip()
    if text in ("出库", "借出", "出借", "领用"):
        return "出库"
    if text in ("入库", "归还", "退回", "还回"):
        return "入库"
    return text


def normalize_time(value):
    text = (value or "").strip()
    if not text:
        return ""
    if re.fullmatch(r"\d+(?:\.\d+)?", text):
        return excel_serial_to_time(text)
    chinese = re.search(r"(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?(?:\s*(\d{1,2})[:：时]\s*(\d{1,2})?)?", text)
    if chinese:
        hour = int(chinese.group(4) or 0)
        minute = int(chinese.group(5) or 0)
        return f"{int(chinese.group(1)):04d}-{int(chinese.group(2)):02d}-{int(chinese.group(3)):02d}T{hour:02d}:{minute:02d}"
    text = text.replace("/", "-").replace(" ", "T")
    match = re.search(r"(\d{4}-\d{1,2}-\d{1,2})(?:T(\d{1,2}):(\d{1,2}))?", text)
    if match:
        year, month, day = [int(part) for part in match.group(1).split("-")]
        hour = int(match.group(2) or 0)
        minute = int(match.group(3) or 0)
        return f"{year:04d}-{month:02d}-{day:02d}T{hour:02d}:{minute:02d}"
    if len(text) == 10:
        return f"{text}T00:00"
    if not re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", text):
        return ""
    return text[:16]


def find_asset(conn, row, allow_name_match=True):
    code = first_value(row, ("资产编号", "资产编码", "编号", "资产代码", "asset_code", "code"))
    name = first_value(row, ("资产名称", "名称", "物品名称", "asset_name", "name"))
    if code:
        asset = conn.execute("select * from assets where code = ?", (code,)).fetchone()
        if asset:
            return asset
    if allow_name_match and name:
        return conn.execute("select * from assets where name = ?", (name,)).fetchone()
    return None


def number_value(value, default=1):
    text = str(value or "").strip()
    if not text:
        return default
    match = re.search(r"-?\d+(?:\.\d+)?", text.replace(",", ""))
    if not match:
        return default
    return int(float(match.group(0)))


def import_asset_values(conn, row, actor):
    code = first_value(row, ("资产编号", "资产编码", "编号", "资产代码", "asset_code", "code"))
    name = first_value(row, ("资产名称", "名称", "物品名称", "asset_name", "name"))
    category = first_value(row, ("资产分类", "分类", "类别", "category")) or "未分类"
    spec = first_value(row, ("规格型号", "规格", "型号", "spec"))
    quantity = safe_asset_quantity(row, default=1)
    unit_price = money_value(first_value(row, ("单价", "价格", "资产原值", "资产原值（元）", "资产原值(元)")), 0)
    total_amount = money_value(first_value(row, ("总金额", "金额", "合计金额")), 0) or unit_price * quantity
    location = first_value(row, ("更新后的具体存放地点", "具体存放地点", "存放地点", "位置", "location"))
    department = first_value(row, ("部门", "使用部门", "department")) or actor["department"]
    ensure_department(conn, department)
    use_user_name = first_value(row, ("使用人", "责任人", "保管人", "借用人", "姓名"))
    keeper = conn.execute("select * from users where name = ? and active = 1", (use_user_name,)).fetchone() if use_user_name else None
    if not keeper:
        keeper = conn.execute("select * from users where department = ? and active = 1 order by role desc, name limit 1", (department,)).fetchone()
    keeper_id = keeper["id"] if keeper else actor["id"]
    remark_parts = []
    sequence = first_value(row, ("模板序号", "序号"))
    if sequence:
        remark_parts.append(f"模板序号：{sequence}")
    paper_no = first_value(row, ("纸质单号", "单号", "paper_no"))
    if paper_no:
        remark_parts.append(f"单号：{paper_no}")
    inbound_date = clean_date_text(first_value(row, ("入库日期", "入库时间", "取得日期")))
    purchase_date = clean_date_text(first_value(row, ("购置日期", "购买日期", "采购日期", "取得日期")))
    return {
        "code": code,
        "name": name,
        "category": category,
        "spec": spec,
        "quantity": quantity,
        "brand": first_value(row, ("品牌", "brand")),
        "unit": first_value(row, ("单位", "unit")) or "件",
        "unit_price": unit_price,
        "total_amount": total_amount,
        "purchase_date": purchase_date,
        "inbound_date": inbound_date,
        "supplier": first_value(row, ("供应商", "供货商", "supplier")),
        "use_department": department,
        "use_user_id": keeper_id,
        "source": first_value(row, ("资产来源", "来源", "source")),
        "location": location,
        "keeper_id": keeper_id,
        "remark": "；".join(remark_parts),
    }


def incremental_update_asset_from_row(conn, asset, row, actor, source_type="", source_id="", file_name=""):
    values = import_asset_values(conn, row, actor)
    updates = {}
    for key in ("name", "category", "spec", "brand", "unit", "supplier", "use_department", "use_user_id", "source", "location", "keeper_id"):
        value = values.get(key)
        if value and str(asset[key] or "") != str(value):
            updates[key] = value
    for key in ("quantity", "unit_price", "total_amount"):
        value = values.get(key)
        if value not in ("", None) and float(asset[key] or 0) != float(value or 0):
            updates[key] = value
    for key in ("purchase_date", "inbound_date"):
        value = values.get(key)
        if value and str(asset[key] or "") != str(value):
            updates[key] = value
    remark = values.get("remark")
    if file_name:
        remark = append_unique_note(remark, f"导入文件：{file_name}")
    if remark:
        merged = append_unique_note(asset["remark"], remark)
        if merged != (asset["remark"] or ""):
            updates["remark"] = merged
    if not updates:
        return asset, False
    updated = update_asset_fields(
        conn,
        asset["id"],
        updates,
        actor["id"],
        "incremental_import",
        source_type=source_type,
        source_id=source_id,
        note=f"增量导入更新：{file_name}" if file_name else "增量导入更新",
    )
    return updated, True


def ensure_asset(conn, row, actor, allow_name_match=True):
    asset = find_asset(conn, row, allow_name_match=allow_name_match)
    if asset:
        return asset, False
    code = first_value(row, ("资产编号", "资产编码", "编号", "资产代码", "asset_code", "code"))
    name = first_value(row, ("资产名称", "名称", "物品名称", "asset_name", "name"))
    if not code and not name:
        return None, False
    if not code:
        code = f"IMPORT-{uuid.uuid4().hex[:8].upper()}"
    category = first_value(row, ("资产分类", "分类", "类别", "category")) or "未分类"
    spec = first_value(row, ("规格型号", "规格", "型号", "spec"))
    quantity = safe_asset_quantity(row, default=1)
    unit_price = money_value(first_value(row, ("单价", "价格", "资产原值", "资产原值（元）", "资产原值(元)")), 0)
    total_amount = money_value(first_value(row, ("总金额", "金额", "合计金额")), 0) or unit_price * quantity
    location = first_value(row, ("更新后的具体存放地点", "具体存放地点", "存放地点", "位置", "location"))
    department = first_value(row, ("部门", "使用部门", "department")) or actor["department"]
    ensure_department(conn, department)
    use_user_name = first_value(row, ("使用人", "责任人", "保管人", "借用人", "姓名"))
    keeper = conn.execute("select * from users where name = ? and active = 1", (use_user_name,)).fetchone() if use_user_name else None
    if not keeper:
        keeper = conn.execute("select * from users where department = ? and active = 1 order by role desc, name limit 1", (department,)).fetchone()
    keeper_id = keeper["id"] if keeper else actor["id"]
    remark_parts = []
    sequence = first_value(row, ("模板序号", "序号"))
    if sequence:
        remark_parts.append(f"模板序号：{sequence}")
    paper_no = first_value(row, ("纸质单号", "单号", "paper_no"))
    if paper_no:
        remark_parts.append(f"单号：{paper_no}")
    for label in ("资产原值（元）", "资产原值(元)", "取得日期", "搬迁时处置方式", "清查盘点情况", "4月12日清查盘点情况", "出入库取用情况（记录取用日期）", "出入库取用情况"):
      value = first_value(row, (label,))
      if value:
          remark_parts.append(f"{label}：{value}")
    asset_id = new_id("asset")
    inbound_date = clean_date_text(first_value(row, ("入库日期", "入库时间", "取得日期")))
    purchase_date = clean_date_text(first_value(row, ("购置日期", "购买日期", "采购日期", "取得日期")))
    now = now_local()
    conn.execute(
        """
        insert into assets
        (id, code, name, category, spec, quantity, safe_stock, brand, unit, unit_price, total_amount,
         purchase_date, inbound_date, supplier, use_department, use_user_id, source, creator_id,
         created_at, updated_at, location, keeper_id, status, remark)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            asset_id,
            code,
            name or code,
            category,
            spec,
            quantity,
            0,
            first_value(row, ("品牌", "brand")),
            first_value(row, ("单位", "unit")) or "件",
            unit_price,
            total_amount,
            purchase_date,
            inbound_date,
            first_value(row, ("供应商", "供货商", "supplier")),
            department,
            keeper_id,
            first_value(row, ("资产来源", "来源", "source")),
            actor["id"],
            now,
            now,
            location,
            keeper_id,
            "in_stock",
            "；".join(remark_parts),
        ),
    )
    add_stock_record(conn, asset_id, "导入建账", quantity, 0, quantity, actor["id"], "asset_import", "", "导入创建资产")
    return conn.execute("select * from assets where id = ?", (asset_id,)).fetchone(), True


def find_user(conn, row):
    username = first_value(row, ("账号", "用户名", "username"))
    name = first_value(row, ("借用人", "使用人", "归还人", "姓名", "经办人", "user", "name"))
    department = first_value(row, ("部门", "使用部门", "department"))
    if username:
        user = conn.execute("select * from users where username = ? and active = 1", (username,)).fetchone()
        if user:
            return user
    if name and department:
        user = conn.execute("select * from users where name = ? and department = ? and active = 1", (name, department)).fetchone()
        if user:
            return user
    if name:
        return conn.execute("select * from users where name = ? and active = 1", (name,)).fetchone()
    if department:
        return conn.execute("select * from users where department = ? and active = 1 order by role desc, name limit 1", (department,)).fetchone()
    return None


def ensure_import_user(conn, row, actor):
    user = find_user(conn, row)
    if user:
        return user
    name = first_value(row, ("借用人", "使用人", "归还人", "申领人", "申请人", "姓名", "经办人", "user", "name"))
    department = first_value(row, ("部门", "使用部门", "department")) or actor["department"]
    if not name:
        username = "import_unknown"
        existing = conn.execute("select * from users where username = ?", (username,)).fetchone()
        if existing:
            return existing
        conn.execute(
            """
            insert into users
            (id, username, password, name, role, role_id, department, active)
            values (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            ("u-import-unknown", username, DEFAULT_IMPORTED_USER_PASSWORD, "未填写", "user", "teacher", department, 0),
        )
        return conn.execute("select * from users where id = 'u-import-unknown'").fetchone()
    existing = conn.execute("select * from users where name = ?", (name,)).fetchone()
    if existing:
        return existing
    ensure_department(conn, department)
    username = unique_username(conn, username_base_from_name(name))
    user_id = new_id("user")
    conn.execute(
        """
        insert into users
        (id, username, password, name, role, role_id, department, active)
        values (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (user_id, username, DEFAULT_IMPORTED_USER_PASSWORD, name, "user", "teacher", department, 1),
    )
    return conn.execute("select * from users where id = ?", (user_id,)).fetchone()


def import_records_from_rows(conn, actor, rows, default_type="", allowed_type="", create_missing_assets=False, create_missing_users=False, file_hash="", file_name="", row_scope=""):
    imported = 0
    created_assets = 0
    existing_assets = 0
    updated_assets = 0
    duplicate_rows = 0
    record_ids = []
    skipped = []
    ledger_increment = create_missing_assets and (normalize_record_type(allowed_type) == "入库" or normalize_record_type(default_type) == "入库")
    for index, row in enumerate(rows, start=2):
        row_hash = import_row_hash(row, row_scope or allowed_type or default_type or "records")
        previous_row = imported_row(conn, row_hash)
        if previous_row:
            duplicate_rows += 1
            continue
        row = dict(row)
        source_row_code = first_value(row, ("资产编号", "资产编码", "编号", "资产代码", "asset_code", "code"))
        if ledger_increment and not source_row_code:
            seed = f"{file_hash or 'file'}:{index}:{row_hash}"
            row["__synthetic_asset_code"] = f"IMPORT-{sha256_hex(seed)[:12].upper()}"
        row_code = first_value(row, ("资产编号", "资产编码", "编号", "资产代码", "asset_code", "code"))
        row_name = first_value(row, ("资产名称", "名称", "物品名称", "asset_name", "name"))
        row_department = first_value(row, ("部门", "使用部门", "department"))
        record_type = allowed_type or normalize_record_type(first_value(row, ("类型", "出入库类型", "操作类型", "type"))) or default_type
        allow_name_match = not ledger_increment and not (create_missing_assets and normalize_record_type(record_type) == "出库")
        if create_missing_assets:
            existing_asset = find_asset(conn, row, allow_name_match=allow_name_match)
            if existing_asset and ledger_increment:
                existing_assets += 1
                asset, updated = incremental_update_asset_from_row(conn, existing_asset, row, actor, source_type="import_row", source_id=row_hash, file_name=file_name)
                if updated:
                    updated_assets += 1
                    register_import_row(conn, file_hash, row_hash, file_name, index, "asset", asset["id"], "updated", actor["id"])
                else:
                    register_import_row(conn, file_hash, row_hash, file_name, index, "asset", asset["id"], "existing", actor["id"])
                continue
            if existing_asset:
                asset = existing_asset
            else:
                asset, created = ensure_asset(conn, row, actor, allow_name_match=allow_name_match)
                if created:
                    created_assets += 1
        else:
            asset = find_asset(conn, row)
        ensure_department(conn, row_department)
        user = ensure_import_user(conn, row, actor) if create_missing_users else find_user(conn, row)
        if not asset:
            skipped.append({"row": index, "reason": f"找不到资产，请检查资产编号或资产名称；解析到编号：{row_code or '-'}，名称：{row_name or '-'}"})
            continue
        if not user and (record_type == "入库" or create_missing_assets):
            user = actor
        if not user:
            skipped.append({"row": index, "reason": f"找不到用户，请检查部门、借用人或账号；解析到部门：{row_department or '-'}"})
            continue
        if record_type not in ("入库", "出库"):
            skipped.append({"row": index, "reason": "类型必须是 出库/借出/入库/归还"})
            continue
        if allowed_type and record_type != allowed_type:
            skipped.append({"row": index, "reason": f"此导入入口只支持{allowed_type}记录"})
            continue
        try:
            quantity = safe_asset_quantity(row, default=1) if create_missing_assets else number_value(first_value(row, ("数量", "qty", "quantity")), default=1)
        except ValueError:
            skipped.append({"row": index, "reason": "数量格式不正确"})
            continue
        out_time = normalize_time(first_value(row, ("出库时间", "借出时间", "出入库取用情况（记录取用日期）", "出入库取用情况", "out_time")))
        in_time = normalize_time(first_value(row, ("入库时间", "归还时间", "取得日期", "return_time", "in_time")))
        if record_type == "出库" and not out_time:
            out_time = now_local()
        if record_type == "入库" and not in_time:
            in_time = now_local()
        status = "使用中" if record_type == "出库" else "已入库"
        note_parts = []
        sequence = first_value(row, ("模板序号", "序号"))
        if sequence:
            note_parts.append(f"模板序号：{sequence}")
        row_note = first_value(row, ("备注", "用途", "note"))
        if row_note:
            note_parts.append(row_note)
        paper_no = first_value(row, ("纸质单号", "单号", "paper_no"))
        record_note = "；".join(note_parts)
        duplicate_id = find_duplicate_record(
            conn,
            asset["id"],
            record_type,
            quantity,
            user["id"],
            in_time if record_type == "入库" else "",
            out_time if record_type == "出库" else "",
            paper_no,
            record_note,
        )
        if duplicate_id:
            duplicate_rows += 1
            register_import_row(conn, file_hash, row_hash, file_name, index, "record", duplicate_id, "duplicate", actor["id"])
            continue
        record_id = new_id("record")
        conn.execute(
            "insert into records (id, asset_id, type, quantity, user_id, operator_id, in_time, out_time, status, paper_no, note) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                record_id,
                asset["id"],
                record_type,
                quantity,
                user["id"],
                actor["id"],
                in_time if record_type == "入库" else "",
                out_time if record_type == "出库" else "",
                status,
                paper_no,
                record_note,
            ),
        )
        record_ids.append(record_id)
        try:
            update_asset_fields(
                conn,
                asset["id"],
                {
                    "status": "checked_out" if record_type == "出库" else "in_stock",
                    "keeper_id": user["id"],
                    "use_user_id": user["id"],
                    "use_department": user["department"],
                },
                actor["id"],
                "checkout" if record_type == "出库" else "checkin",
                business_no=first_value(row, ("纸质单号", "单号", "paper_no")),
                source_type="record",
                source_id=record_id,
                note="批量导入出入库",
            )
        except ValueError as exc:
            skipped.append({"row": index, "reason": str(exc)})
            conn.execute("delete from records where id = ?", (record_id,))
            continue
        imported += 1
        register_import_row(conn, file_hash, row_hash, file_name, index, "record", record_id, "imported", actor["id"])
    return {
        "imported": imported,
        "createdAssets": created_assets,
        "existingAssets": existing_assets,
        "updatedAssets": updated_assets,
        "processedRows": imported + existing_assets,
        "duplicateRows": duplicate_rows,
        "duplicateFiles": 0,
        "skipped": skipped,
        "_recordIds": record_ids,
    }


def tag_records_with_archive(conn, record_ids, file_name, archive_id):
    if not record_ids:
        return
    archive = conn.execute("select uploaded_at from import_archives where id = ?", (archive_id,)).fetchone()
    uploaded_at = archive["uploaded_at"] if archive else now_local()
    placeholders = ",".join("?" for _ in record_ids)
    records = rows_to_list(conn.execute(f"select * from records where id in ({placeholders})", record_ids))
    for record in records:
        note = append_unique_note(record["note"], f"导入文件：{file_name}")
        note = append_unique_note(note, f"导入时间：{uploaded_at}")
        conn.execute("update records set note = ? where id = ?", (note, record["id"]))


def import_records(conn, actor, file_name, content, default_type="", allowed_type=""):
    lower_name = file_name.lower()
    file_hash = sha256_hex(content)
    rows = parse_xlsx(content) if lower_name.endswith(".xlsx") else parse_csv(content)
    seen_file = import_file_seen(conn, file_hash)
    if seen_file:
        return ensure_import_result_stats({
            "imported": 0,
            "createdAssets": 0,
            "existingAssets": 0,
            "updatedAssets": 0,
            "processedRows": len(rows),
            "duplicateRows": len(rows),
            "duplicateFiles": 1,
            "skipped": [],
            "_recordIds": [],
            "message": f"已识别为重复文件：此前已导入 {seen_file['file_name']}。本次只做防重识别，未重复写入台账或流水。",
        })
    create_missing_assets = normalize_record_type(allowed_type) == "入库" or normalize_record_type(default_type) == "入库"
    result = import_records_from_rows(
        conn,
        actor,
        rows,
        default_type=default_type,
        allowed_type=allowed_type,
        create_missing_assets=create_missing_assets,
        file_hash=file_hash,
        file_name=file_name,
    )
    attach_import_archive(
        conn,
        actor,
        file_name,
        content,
        "xlsx" if lower_name.endswith(".xlsx") else "csv",
        allowed_type or "出入库",
        result,
        file_hash,
    )
    add_audit(
        conn,
        actor["id"],
        "批量导入出入库",
        f"{file_name} 导入 {result['imported']} 条，新建资产 {result.get('createdAssets', 0)} 个，更新 {result.get('updatedAssets', 0)} 个，重复 {result.get('duplicateRows', 0)} 条，跳过 {len(result['skipped'])} 条",
    )
    return result


def import_word_checkout(conn, actor, file_name, content):
    file_hash = sha256_hex(content)
    seen_file = import_file_seen(conn, file_hash)
    if seen_file and not word_file_retry_allowed(conn, file_hash):
        return ensure_import_result_stats({
            "processedRows": 0,
            "duplicateFiles": 1,
            "skipped": [],
            "_recordIds": [],
            "message": f"已识别为重复 Word 文件：此前已导入 {seen_file['file_name']}。本次未再次生成出借流水或待复核单。",
        })
    parsed = parse_docx(content)
    requisition_rows = parse_requisition_docx(parsed)
    if requisition_rows:
        fallback_time = now_local()
        missing_time_count = 0
        rows_to_import = []
        for row in requisition_rows:
            item = dict(row)
            if not row_record_time(item):
                missing_time_count += 1
                item["出库时间"] = fallback_time
                item["备注"] = append_import_note(item.get("备注", ""), f"原单未填写领用日期，按导入时间 {fallback_time} 生成流水")
            rows_to_import.append(item)
        result = import_records_from_rows(conn, actor, rows_to_import, default_type="出库", allowed_type="出库", create_missing_assets=True, create_missing_users=True, file_hash=file_hash, file_name=file_name, row_scope="word-checkout-v116")
        attach_import_archive(conn, actor, file_name, content, "docx", "领用申请Word", result, file_hash)
        tag_records_with_archive(conn, result.get("_recordIds", []), file_name, result["archiveId"])
        add_audit(conn, actor["id"], "识别Word领用申请", f"{file_name} 识别并导入 {result['imported']} 条，跳过 {len(result['skipped'])} 条")
        message = "已识别耗材/物品领用申请模板并导入出借记录"
        if missing_time_count:
            message += f"；{missing_time_count} 条原单未填写领用日期，已按导入时间生成流水"
        return {**result, "paperCreated": 0, "message": message}
    if is_blank_requisition_template(parsed):
        result = {"imported": 0, "createdAssets": 0, "skipped": [], "paperCreated": 0, "message": "识别为空白领用申请模板，已忽略，不计入跳过"}
        attach_import_archive(conn, actor, file_name, content, "docx", "空白领用模板", result, file_hash)
        add_audit(conn, actor["id"], "忽略空白Word模板", file_name)
        return result
    if parsed["rows"]:
        timed_rows = [row for row in parsed["rows"] if row_record_time(row)]
        if timed_rows:
            result = import_records_from_rows(conn, actor, timed_rows, default_type="出库", allowed_type="出库", file_hash=file_hash, file_name=file_name, row_scope="word-table-v116")
            attach_import_archive(conn, actor, file_name, content, "docx", "出库/出借Word", result, file_hash)
            tag_records_with_archive(conn, result.get("_recordIds", []), file_name, result["archiveId"])
            add_audit(conn, actor["id"], "导入Word出借记录", f"{file_name} 自动导入 {result['imported']} 条，跳过 {len(result['skipped'])} 条")
            return {**result, "paperCreated": 0, "message": "Word 表格文字已按出借记录导入"}

    summary = parsed["text"].strip()
    if not summary:
        summary = f"Word 文档包含 {parsed['imageCount']} 张图片，疑似手写或扫描件，请人工复核后登记出借记录。"
    else:
        summary = f"Word 文档未识别到标准表格，请人工复核：\n{summary[:800]}"
    conn.execute(
        "insert into paper_queue values (?, ?, ?, ?, ?, ?)",
        (new_id("paper"), file_name, "Word手写出借单", actor["id"], "待复核", summary),
    )
    result = {"imported": 0, "skipped": [], "paperCreated": 1, "message": "Word 文档已进入纸质单据待复核队列"}
    attach_import_archive(conn, actor, file_name, content, "docx", "出库/出借Word", result, file_hash)
    add_audit(conn, actor["id"], "导入Word手写出借单", f"{file_name} 已进入待复核队列")
    return result


def get_state(conn, user, view_role=""):
    user_id = user["id"]
    actual_role_id = role_id_for_user(user)
    forced_user_view = has_permission(conn, user, "assets.view.all") and view_role == "user"
    effective_role_id = "teacher" if forced_user_view else actual_role_id
    effective_permissions = set(ROLE_PERMISSION_MAP["teacher"]) if forced_user_view else set(user_permissions(conn, user))

    def effective_has(permission_code):
        if forced_user_view:
            return permission_code in effective_permissions
        return has_permission(conn, user, permission_code)

    admin = effective_has("assets.view.all")
    current_user = public_user(user, conn)
    current_user["actualRole"] = actual_role_id
    if forced_user_view:
        current_user["role"] = "teacher"
        current_user["roleId"] = "teacher"
        current_user["roleName"] = role_label("teacher")
        current_user["permissions"] = sorted(ROLE_PERMISSION_MAP["teacher"])
        current_user["menus"] = ROLE_MENU_MAP["teacher"]
        current_user["viewMode"] = "user"
    else:
        current_user["viewMode"] = "admin" if admin else "user"
    if forced_user_view:
        users = rows_to_list(conn.execute("select * from users where id = ?", (user_id,)))
    else:
        users = rows_to_list(conn.execute("select * from users order by active desc, role_id, username, name"))
    safe_users = [public_user(item, conn) for item in users]
    departments = rows_to_list(conn.execute("select name from departments where active = 1 order by name"))
    asset_categories = rows_to_list(conn.execute("select * from asset_categories where active = 1 order by category_type, parent_id, name"))
    locations = rows_to_list(conn.execute("select * from locations where active = 1 order by name"))
    device_group_rules = rows_to_list(conn.execute("select * from device_group_rules where active = 1 order by group_name, source_key"))
    multi_department = setting_value(conn, "multi_department_enabled", "0")
    developer_mode = setting_value(conn, "developer_mode_enabled", "0")
    admin_prefill = setting_value(conn, "admin_prefill_enabled", "0")
    asset_detail_label = setting_value(conn, "asset_detail_label_enabled", "1")
    paper_module_enabled = setting_value(conn, "paper_module_enabled", "1")
    login_background = setting_value(conn, "login_background_image", "")
    service_port = setting_value(conn, "service_port", str(PUBLIC_PORT))
    print_asset_template_name = setting_value(conn, "print_asset_template_name", "")
    print_asset_template_content = setting_value(conn, "print_asset_template_content", "")
    print_consumable_template_name = setting_value(conn, "print_consumable_template_name", "")
    print_consumable_template_content = setting_value(conn, "print_consumable_template_content", "")
    archives = rows_to_list(
        conn.execute(
            """
            select id, file_name, file_type, category, uploaded_by, uploaded_at, result_json,
                   length(content) as size
            from import_archives
            order by uploaded_at desc, id desc
            limit 50
            """
        )
    )
    if effective_has("users.view"):
        admin_requests = rows_to_list(
            conn.execute(
                """
                select ar.*, u.name as user_name, u.username as username, u.role as user_role
                from admin_requests ar
                join users u on u.id = ar.user_id
                order by case ar.status when '待处理' then 0 when '已批准' then 1 else 2 end, ar.created_at desc
                """
            )
        )
    else:
        admin_requests = rows_to_list(
            conn.execute(
                "select * from admin_requests where user_id = ? order by created_at desc limit 1",
                (user_id,),
            )
        )

    if effective_has("asset_requests.manage"):
        if effective_role_id == "department_head":
            asset_requests = rows_to_list(
                conn.execute(
                    """
                    select ar.*, u.name as user_name, u.username as username
                    from asset_requests ar
                    join users u on u.id = ar.user_id
                    where u.department = ?
                    order by case ar.status when '待处理' then 0 when '已批准' then 1 else 2 end, ar.created_at desc
                    """,
                    (user["department"],),
                )
            )
        else:
            asset_requests = rows_to_list(
                conn.execute(
                    """
                    select ar.*, u.name as user_name, u.username as username
                    from asset_requests ar
                    join users u on u.id = ar.user_id
                    order by case ar.status when '待处理' then 0 when '已批准' then 1 else 2 end, ar.created_at desc
                    """
                )
            )
    elif admin:
        asset_requests = rows_to_list(
            conn.execute(
                """
                select ar.*, u.name as user_name, u.username as username
                from asset_requests ar
                join users u on u.id = ar.user_id
                order by case ar.status when '待处理' then 0 when '已批准' then 1 else 2 end, ar.created_at desc
                """
            )
        )
    else:
        asset_requests = rows_to_list(
            conn.execute(
                "select * from asset_requests where user_id = ? order by created_at desc, id desc",
                (user_id,),
            )
        )

    if admin:
        purchase_wishes = rows_to_list(
            conn.execute(
                """
                select pw.*, u.name as user_name, u.username as username, u.department as user_department
                from purchase_wishes pw
                join users u on u.id = pw.user_id
                order by case pw.status when '待采购' then 0 when '已采纳' then 1 when '已采购' then 2 else 3 end,
                         case pw.priority when '紧急' then 0 when '高' then 1 when '普通' then 2 else 3 end,
                         pw.created_at desc
                """
            )
        )
    else:
        purchase_wishes = rows_to_list(
            conn.execute(
                "select * from purchase_wishes where user_id = ? order by created_at desc, id desc",
                (user_id,),
            )
        )

    if effective_has("purchase_wishes.manage") or admin:
        assets = sort_assets_for_display(rows_to_list(conn.execute("select * from assets order by code")))
        records = sort_records_for_display(rows_to_list(conn.execute("select * from records order by coalesce(in_time, out_time) desc, id desc")))
        audits = rows_to_list(conn.execute("select * from audits order by time desc, id desc"))
        paper = rows_to_list(conn.execute("select * from paper_queue order by id desc"))
        check_tasks = rows_to_list(conn.execute("select * from inventory_check_tasks order by created_at desc, id desc"))
        check_items = rows_to_list(conn.execute("select * from inventory_check_items order by id desc"))
        stock_records = rows_to_list(conn.execute("select * from stock_records order by created_at desc, id desc"))
        flow_logs = rows_to_list(conn.execute("select * from asset_flow_logs order by created_at desc, id desc"))
        borrow_orders = rows_to_list(conn.execute("select * from borrow_orders order by created_at desc, id desc"))
        transfer_orders = rows_to_list(conn.execute("select * from transfer_orders order by created_at desc, id desc"))
        repair_orders = rows_to_list(conn.execute("select * from repair_orders order by created_at desc, id desc"))
        scrap_orders = rows_to_list(conn.execute("select * from scrap_orders order by created_at desc, id desc"))
    elif effective_role_id == "department_head":
        assets = sort_assets_for_display(rows_to_list(
            conn.execute(
                """
                select distinct a.* from assets a
                left join users ku on ku.id = a.keeper_id
                left join users uu on uu.id = a.use_user_id
                left join records r on r.asset_id = a.id
                left join users ru on ru.id = r.user_id
                where a.use_department = ? or ku.department = ? or uu.department = ? or ru.department = ?
                order by a.code
                """,
                (user["department"], user["department"], user["department"], user["department"]),
            )
        ))
        asset_ids = [item["id"] for item in assets]
        if asset_ids:
            placeholders = ",".join("?" for _ in asset_ids)
            records = sort_records_for_display(rows_to_list(conn.execute(f"select * from records where asset_id in ({placeholders}) order by coalesce(in_time, out_time) desc, id desc", asset_ids)))
            check_items = rows_to_list(conn.execute(f"select * from inventory_check_items where asset_id in ({placeholders}) order by id desc", asset_ids))
            stock_records = rows_to_list(conn.execute(f"select * from stock_records where asset_id in ({placeholders}) order by created_at desc, id desc", asset_ids))
            flow_logs = rows_to_list(conn.execute(f"select * from asset_flow_logs where asset_id in ({placeholders}) order by created_at desc, id desc", asset_ids))
            borrow_orders = rows_to_list(conn.execute(f"select * from borrow_orders where asset_id in ({placeholders}) or borrower_id = ? order by created_at desc, id desc", asset_ids + [user_id]))
            transfer_orders = rows_to_list(conn.execute(f"select * from transfer_orders where asset_id in ({placeholders}) order by created_at desc, id desc", asset_ids))
            repair_orders = rows_to_list(conn.execute(f"select * from repair_orders where asset_id in ({placeholders}) or reporter_id = ? order by created_at desc, id desc", asset_ids + [user_id]))
            scrap_orders = rows_to_list(conn.execute(f"select * from scrap_orders where asset_id in ({placeholders}) or applicant_id = ? order by created_at desc, id desc", asset_ids + [user_id]))
        else:
            records, check_items, stock_records, flow_logs, borrow_orders, transfer_orders, repair_orders, scrap_orders = [], [], [], [], [], [], [], []
        audits = []
        paper = rows_to_list(conn.execute("select * from paper_queue where owner_id in (select id from users where department = ?) order by id desc", (user["department"],)))
        check_tasks = rows_to_list(conn.execute("select * from inventory_check_tasks where owner_id in (select id from users where department = ?) order by created_at desc, id desc", (user["department"],)))
    else:
        assets = sort_assets_for_display(rows_to_list(
            conn.execute(
                """
                select distinct a.* from assets a
                left join records r on r.asset_id = a.id
                where a.keeper_id = ? or r.user_id = ?
                order by a.code
                """,
                (user_id, user_id),
            )
        ))
        records = sort_records_for_display(rows_to_list(conn.execute("select * from records where user_id = ? order by coalesce(in_time, out_time) desc, id desc", (user_id,))))
        audits = []
        paper = rows_to_list(conn.execute("select * from paper_queue where owner_id = ? order by id desc", (user_id,)))
        check_tasks = []
        check_items = []
        stock_records = []
        flow_logs = rows_to_list(conn.execute("select * from asset_flow_logs where asset_id in (select id from assets where keeper_id = ? or use_user_id = ?) order by created_at desc, id desc", (user_id, user_id)))
        borrow_orders = rows_to_list(conn.execute("select * from borrow_orders where borrower_id = ? order by created_at desc, id desc", (user_id,)))
        transfer_orders = []
        repair_orders = rows_to_list(conn.execute("select * from repair_orders where reporter_id = ? order by created_at desc, id desc", (user_id,)))
        scrap_orders = rows_to_list(conn.execute("select * from scrap_orders where applicant_id = ? order by created_at desc, id desc", (user_id,)))

    return {
        "currentUser": current_user,
        "users": safe_users,
        "assets": [normalize_asset(item) for item in assets],
        "records": [normalize_record(item) for item in records],
        "audits": audits,
        "paperQueue": [normalize_paper(item) for item in paper],
        "importArchives": [normalize_archive(item) for item in archives] if admin else [],
        "adminRequests": [normalize_admin_request(item) for item in admin_requests],
        "assetRequests": [normalize_asset_request(item) for item in asset_requests],
        "purchaseWishes": [normalize_purchase_wish(item) for item in purchase_wishes],
        "inventoryCheckTasks": [normalize_check_task(item) for item in check_tasks],
        "inventoryCheckItems": [normalize_check_item(item) for item in check_items],
        "stockRecords": [normalize_stock_record(item) for item in stock_records],
        "assetFlowLogs": [normalize_flow_log(item) for item in flow_logs],
        "borrowOrders": [normalize_borrow_order(item) for item in borrow_orders],
        "transferOrders": [normalize_transfer_order(item) for item in transfer_orders],
        "repairOrders": [normalize_repair_order(item) for item in repair_orders],
        "scrapOrders": [normalize_scrap_order(item) for item in scrap_orders],
        "roles": [normalize_role(item) for item in rows_to_list(conn.execute("select * from roles where active = 1 order by id"))] if effective_has("users.view") else [],
        "permissions": rows_to_list(conn.execute("select * from permissions order by code")) if effective_has("users.view") else [],
        "menuPermissions": rows_to_list(conn.execute("select * from menu_permissions where active = 1 order by menu_key")) if effective_has("users.view") else [],
        "settings": {
            "departments": [item["name"] for item in departments],
            "assetCategories": [item["name"] for item in asset_categories],
            "assetCategoryItems": asset_categories,
            "locations": locations,
            "deviceGroupRules": [normalize_device_group_rule(item) for item in device_group_rules],
            "multiDepartmentEnabled": bool(int(multi_department)),
            "developerModeEnabled": bool(int(developer_mode)),
            "adminPrefillEnabled": bool(int(admin_prefill)),
            "adminPrefillPassword": DEFAULT_ADMIN_PASSWORD if bool(int(admin_prefill)) else "",
            "assetDetailLabelEnabled": bool(int(asset_detail_label)),
            "paperModuleEnabled": bool(int(paper_module_enabled)),
            "loginBackgroundImage": login_background,
            "servicePort": service_port,
            "printAssetTemplateName": print_asset_template_name,
            "printAssetTemplateCustom": bool(print_asset_template_content),
            "printConsumableTemplateName": print_consumable_template_name,
            "printConsumableTemplateCustom": bool(print_consumable_template_content),
            "appVersion": APP_VERSION,
        },
    }


def normalize_asset(item):
    data = dict(item)
    data["keeperId"] = data.pop("keeper_id")
    data["safeStock"] = data.pop("safe_stock", 0)
    data["unitPrice"] = data.pop("unit_price", 0)
    data["totalAmount"] = data.pop("total_amount", 0)
    data["purchaseDate"] = data.pop("purchase_date", "")
    data["inboundDate"] = data.pop("inbound_date", "")
    data["useDepartment"] = data.pop("use_department", "")
    data["useUserId"] = data.pop("use_user_id", "")
    data["creatorId"] = data.pop("creator_id", "")
    data["createdAt"] = data.pop("created_at", "")
    data["updatedAt"] = data.pop("updated_at", "")
    return data


def normalize_device_group_rule(item):
    data = dict(item)
    data["sourceKey"] = data.pop("source_key", "")
    data["groupName"] = data.pop("group_name", "")
    data["familyId"] = data.pop("family_id", "")
    data["createdBy"] = data.pop("created_by", "")
    data["createdAt"] = data.pop("created_at", "")
    data["updatedAt"] = data.pop("updated_at", "")
    return data


def record_document_type(note):
    text = str(note or "")
    for part in str(note or "").split("；"):
        clean = clean_docx_text(part)
        if clean.startswith("单据类型："):
            return clean.split("：", 1)[1].strip()
    if "耗材" in text:
        return "耗材领用"
    if "Word领用单导入" in text:
        return "资产领用"
    return ""


def record_display_note(note):
    hidden_prefixes = (
        "模板序号：",
        "Word领用单导入",
        "出借人：",
        "导入文件：",
        "导入时间：",
        "单号：",
        "单据类型：",
        "负责人：",
        "申请人：",
    )
    parts = []
    for part in str(note or "").split("；"):
        clean = clean_docx_text(part)
        if not clean:
            continue
        if any(clean.startswith(prefix) for prefix in hidden_prefixes):
            continue
        parts.append(clean)
    return "；".join(parts)


def normalize_record(item):
    data = dict(item)
    data["assetId"] = data.pop("asset_id")
    data["userId"] = data.pop("user_id")
    data["operatorId"] = data.pop("operator_id")
    data["inTime"] = data.pop("in_time")
    data["outTime"] = data.pop("out_time")
    data["paperNo"] = data.pop("paper_no")
    data["documentType"] = record_document_type(data.get("note"))
    data["displayNote"] = record_display_note(data.get("note"))
    return data


def normalize_paper(item):
    data = dict(item)
    data["paperNo"] = data.pop("paper_no")
    data["ownerId"] = data.pop("owner_id")
    return data


def normalize_admin_request(item):
    data = dict(item)
    data["userId"] = data.pop("user_id")
    data["createdAt"] = data.pop("created_at")
    data["handledBy"] = data.pop("handled_by", None)
    data["handledAt"] = data.pop("handled_at", None)
    data["userName"] = data.pop("user_name", "")
    data["userRole"] = data.pop("user_role", "")
    return data


def normalize_asset_request(item):
    data = dict(item)
    data["userId"] = data.pop("user_id")
    data["assetName"] = data.pop("asset_name")
    data["createdAt"] = data.pop("created_at")
    data["handledBy"] = data.pop("handled_by", None)
    data["handledAt"] = data.pop("handled_at", None)
    data["handleNote"] = data.pop("handle_note", "")
    data["userName"] = data.pop("user_name", "")
    return data


def normalize_purchase_wish(item):
    data = dict(item)
    data["userId"] = data.pop("user_id")
    data["itemName"] = data.pop("item_name")
    data["unitPrice"] = data.pop("unit_price", 0)
    data["totalAmount"] = data.pop("total_amount", 0)
    data["itemType"] = data.pop("item_type", "")
    data["expectedTime"] = data.pop("expected_time")
    data["createdAt"] = data.pop("created_at")
    data["handledBy"] = data.pop("handled_by", None)
    data["handledAt"] = data.pop("handled_at", None)
    data["handleNote"] = data.pop("handle_note", "")
    data["userName"] = data.pop("user_name", "")
    data["userDepartment"] = data.pop("user_department", "")
    return data


def normalize_archive(item):
    data = dict(item)
    data["fileName"] = data.pop("file_name")
    data["fileType"] = data.pop("file_type")
    data["uploadedBy"] = data.pop("uploaded_by")
    data["uploadedAt"] = data.pop("uploaded_at")
    try:
        data["result"] = json.loads(data.pop("result_json"))
    except json.JSONDecodeError:
        data["result"] = {}
    return data


def normalize_check_task(item):
    data = dict(item)
    data["checkNo"] = data.pop("check_no")
    data["scopeType"] = data.pop("scope_type")
    data["scopeValue"] = data.pop("scope_value", "")
    data["ownerId"] = data.pop("owner_id")
    data["startTime"] = data.pop("start_time")
    data["endTime"] = data.pop("end_time", "")
    data["createdAt"] = data.pop("created_at")
    return data


def normalize_check_item(item):
    data = dict(item)
    data["taskId"] = data.pop("task_id")
    data["assetId"] = data.pop("asset_id")
    data["systemLocation"] = data.pop("system_location", "")
    data["actualLocation"] = data.pop("actual_location", "")
    data["systemStatus"] = data.pop("system_status", "")
    data["actualStatus"] = data.pop("actual_status", "")
    data["systemKeeperId"] = data.pop("system_keeper_id", "")
    data["actualKeeperId"] = data.pop("actual_keeper_id", "")
    data["checked"] = bool(data.pop("checked", 0))
    data["diffType"] = data.pop("diff_type", "")
    return data


def normalize_stock_record(item):
    data = dict(item)
    data["assetId"] = data.pop("asset_id")
    data["flowType"] = data.pop("flow_type")
    data["beforeQuantity"] = data.pop("before_quantity")
    data["afterQuantity"] = data.pop("after_quantity")
    data["relatedType"] = data.pop("related_type", "")
    data["relatedId"] = data.pop("related_id", "")
    data["operatorId"] = data.pop("operator_id")
    data["createdAt"] = data.pop("created_at")
    return data


def normalize_flow_log(item):
    data = dict(item)
    data["assetId"] = data.pop("asset_id")
    data["operatorId"] = data.pop("operator_id")
    data["businessNo"] = data.pop("business_no", "")
    data["sourceType"] = data.pop("source_type", "")
    data["sourceId"] = data.pop("source_id", "")
    data["beforeJson"] = data.pop("before_json", "")
    data["afterJson"] = data.pop("after_json", "")
    data["createdAt"] = data.pop("created_at")
    return data


def normalize_borrow_order(item):
    data = dict(item)
    data["orderNo"] = data.pop("order_no")
    data["assetId"] = data.pop("asset_id")
    data["borrowerId"] = data.pop("borrower_id")
    data["countQuantity"] = bool(data.pop("count_quantity", 1))
    data["operatorId"] = data.pop("operator_id")
    data["expectedReturnDate"] = data.pop("expected_return_date", "")
    data["actualReturnDate"] = data.pop("actual_return_date", "")
    data["approvalStatus"] = data.pop("approval_status", "")
    data["approverId"] = data.pop("approver_id", "")
    data["approvalTime"] = data.pop("approval_time", "")
    data["returnCheck"] = data.pop("return_check", "")
    data["createdAt"] = data.pop("created_at")
    data["updatedAt"] = data.pop("updated_at")
    return data


def normalize_transfer_order(item):
    data = dict(item)
    data["orderNo"] = data.pop("order_no")
    data["assetId"] = data.pop("asset_id")
    data["oldDepartment"] = data.pop("old_department", "")
    data["newDepartment"] = data.pop("new_department", "")
    data["oldLocation"] = data.pop("old_location", "")
    data["newLocation"] = data.pop("new_location", "")
    data["oldKeeperId"] = data.pop("old_keeper_id", "")
    data["newKeeperId"] = data.pop("new_keeper_id", "")
    data["transferDate"] = data.pop("transfer_date", "")
    data["operatorId"] = data.pop("operator_id")
    data["approverId"] = data.pop("approver_id", "")
    data["createdAt"] = data.pop("created_at")
    data["updatedAt"] = data.pop("updated_at")
    return data


def normalize_repair_order(item):
    data = dict(item)
    data["orderNo"] = data.pop("order_no")
    data["assetId"] = data.pop("asset_id")
    data["reporterId"] = data.pop("reporter_id")
    data["faultDesc"] = data.pop("fault_desc", "")
    data["operatorId"] = data.pop("operator_id")
    data["startTime"] = data.pop("start_time", "")
    data["endTime"] = data.pop("end_time", "")
    data["createdAt"] = data.pop("created_at")
    data["updatedAt"] = data.pop("updated_at")
    return data


def normalize_scrap_order(item):
    data = dict(item)
    data["orderNo"] = data.pop("order_no")
    data["assetId"] = data.pop("asset_id")
    data["applicantId"] = data.pop("applicant_id")
    data["residualValue"] = data.pop("residual_value", 0)
    data["scrapDate"] = data.pop("scrap_date", "")
    data["approvalStatus"] = data.pop("approval_status", "")
    data["approverId"] = data.pop("approver_id", "")
    data["approvalTime"] = data.pop("approval_time", "")
    data["operatorId"] = data.pop("operator_id")
    data["createdAt"] = data.pop("created_at")
    data["updatedAt"] = data.pop("updated_at")
    return data


def normalize_role(item):
    data = dict(item)
    data["permissions"] = ROLE_PERMISSION_MAP.get(data["id"], [])
    data["menus"] = ROLE_MENU_MAP.get(data["id"], [])
    data["createdAt"] = data.pop("created_at", "")
    data["updatedAt"] = data.pop("updated_at", "")
    return data


def safe_download_name(file_name):
    clean = str(file_name or "import-archive").replace("\\", "_").replace("/", "_").strip()
    return clean or "import-archive"


def csv_bytes(headers, rows):
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(headers)
    for row in rows:
        writer.writerow(row)
    return ("\ufeff" + output.getvalue()).encode("utf-8")


def send_csv(handler, file_name, headers, rows):
    handler.send_binary(200, safe_download_name(file_name), "text/csv; charset=utf-8", csv_bytes(headers, rows))


def xml_escape(value):
    return (
        str(value if value is not None else "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def column_name(index):
    name = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        name = chr(65 + remainder) + name
    return name


def xlsx_bytes(headers, rows, sheet_name="Sheet1"):
    def cell_xml(row_index, col_index, value, header=False):
        ref = f"{column_name(col_index)}{row_index}"
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return f'<c r="{ref}" s="{1 if header else 0}"><v>{value}</v></c>'
        return f'<c r="{ref}" t="inlineStr" s="{1 if header else 0}"><is><t>{xml_escape(value)}</t></is></c>'

    sheet_rows = []
    sheet_rows.append(
        f'<row r="1">{"".join(cell_xml(1, index, header, True) for index, header in enumerate(headers, start=1))}</row>'
    )
    for row_index, row in enumerate(rows, start=2):
        sheet_rows.append(
            f'<row r="{row_index}">{"".join(cell_xml(row_index, index, value) for index, value in enumerate(row, start=1))}</row>'
        )
    widths = "".join(f'<col min="{index}" max="{index}" width="{width}" customWidth="1"/>' for index, width in enumerate((24, 36, 10, 10, 12, 12, 18, 42), start=1))
    sheet_xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <cols>{widths}</cols>
  <sheetData>{"".join(sheet_rows)}</sheetData>
</worksheet>'''
    workbook_xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="{xml_escape(sheet_name)[:31] or "Sheet1"}" sheetId="1" r:id="rId1"/></sheets>
</workbook>'''
    styles_xml = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><sz val="11"/><name val="Microsoft YaHei"/></font></fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/></cellXfs>
</styleSheet>'''
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>''')
        archive.writestr("_rels/.rels", '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>''')
        archive.writestr("xl/_rels/workbook.xml.rels", '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>''')
        archive.writestr("xl/workbook.xml", workbook_xml)
        archive.writestr("xl/styles.xml", styles_xml)
        archive.writestr("xl/worksheets/sheet1.xml", sheet_xml)
    return output.getvalue()


def send_xlsx(handler, file_name, headers, rows, sheet_name="Sheet1"):
    handler.send_binary(
        200,
        safe_download_name(file_name),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        xlsx_bytes(headers, rows, sheet_name),
    )


def purchase_wish_export_rows(conn, user):
    headers = ["名称", "技术参数", "单位", "数量", "单价", "总价", "品目", "备注"]
    if has_permission(conn, user, "purchase_wishes.manage"):
        wishes = rows_to_list(conn.execute("select * from purchase_wishes order by created_at desc, id desc"))
    else:
        wishes = rows_to_list(conn.execute("select * from purchase_wishes where user_id = ? order by created_at desc, id desc", (user["id"],)))
    rows = []
    for item in wishes:
        unit_price = float(item["unit_price"] or 0)
        quantity = int(item["quantity"] or 0)
        total_amount = float(item["total_amount"] or 0) or unit_price * quantity
        rows.append([
            item["item_name"],
            item["spec"],
            item["unit"] or "件",
            quantity,
            unit_price,
            total_amount,
            item["item_type"] or item["category"],
            item["reason"],
        ])
    return headers, rows


def asset_report_rows(conn, report_type, user):
    assets = rows_to_list(conn.execute("select * from assets order by code")) if has_permission(conn, user, "assets.view.all") else rows_to_list(
        conn.execute(
            """
            select distinct a.* from assets a
            left join records r on r.asset_id = a.id
            where a.keeper_id = ? or a.use_user_id = ? or r.user_id = ?
            order by a.code
            """,
            (user["id"], user["id"], user["id"]),
        )
    )
    asset_map = {item["id"]: item for item in assets}
    records = rows_to_list(conn.execute("select * from records order by coalesce(in_time, out_time) desc, id desc"))
    if report_type == "ledger":
        headers = ["资产编号", "名称", "品牌", "类别", "规格", "单位", "数量", "单价", "总金额", "购置日期", "入库日期", "供应商", "使用部门", "使用人", "位置", "状态", "资产来源", "创建人", "更新时间", "备注"]
        rows = [
            [
                item["code"], item["name"], item["brand"], item["category"], item["spec"], item["unit"], item["quantity"],
                item["unit_price"], item["total_amount"], item["purchase_date"], item["inbound_date"], item["supplier"],
                item["use_department"], user_name_by_id(conn, item["use_user_id"] or item["keeper_id"]), item["location"],
                STATUS_LABELS.get(item["status"], item["status"]), item["source"], user_name_by_id(conn, item["creator_id"]),
                item["updated_at"], item["remark"],
            ]
            for item in assets
        ]
        return "资产总账.csv", headers, rows
    if report_type in ("category", "department", "location", "keeper", "responsible"):
        group_field = {
            "category": "category",
            "department": "use_department",
            "location": "location",
            "keeper": "keeper_id",
            "responsible": "use_user_id",
        }[report_type]
        groups = {}
        for item in assets:
            key = item[group_field] or "未填写"
            if group_field in ("keeper_id", "use_user_id"):
                key = user_name_by_id(conn, key)
            entry = groups.setdefault(key, {"count": 0, "quantity": 0, "amount": 0})
            entry["count"] += 1
            entry["quantity"] += int(item["quantity"] or 0)
            entry["amount"] += float(item["total_amount"] or 0)
        headers = ["维度", "资产条目", "数量合计", "金额合计"]
        rows = [[key, value["count"], value["quantity"], round(value["amount"], 2)] for key, value in sorted(groups.items())]
        return f"{ {'category':'分类统计','department':'部门统计','location':'位置统计','keeper':'保管人统计','responsible':'责任人统计'}[report_type] }.csv", headers, rows
    if report_type in ("inbound", "outbound"):
        headers = ["时间", "资产编号", "资产名称", "类型", "数量", "人员", "部门", "单号", "备注"]
        if report_type == "inbound":
            filtered = [item for item in records if item["type"] == "入库"]
        else:
            filtered = [item for item in records if item["type"] == "出库"]
        rows = []
        for record in filtered:
            asset = asset_map.get(record["asset_id"])
            if not asset:
                continue
            rows.append([
                record["out_time"] or record["in_time"],
                asset["code"],
                asset["name"],
                record["type"],
                record["quantity"],
                user_name_by_id(conn, record["user_id"]),
                user_department_by_id(conn, record["user_id"]),
                record["paper_no"],
                record_display_note(record["note"]),
            ])
        title = {"inbound": "入库明细", "outbound": "出库明细"}[report_type]
        return f"{title}.csv", headers, rows
    if report_type == "claim":
        headers = ["时间", "资产编号", "资产名称", "业务类型", "数量", "是否扣减库存", "领用人", "部门", "单号", "审批状态", "备注"]
        rows = []
        for order in rows_to_list(conn.execute("select * from borrow_orders order by created_at desc, id desc")):
            asset = asset_map.get(order["asset_id"])
            if not asset or not (str(order["order_no"] or "").startswith("LY") or order["status"] == "已领用"):
                continue
            rows.append([
                order["created_at"],
                asset["code"],
                asset["name"],
                "领用单",
                order["quantity"],
                "是" if int(order["count_quantity"] or 0) else "否",
                user_name_by_id(conn, order["borrower_id"]),
                user_department_by_id(conn, order["borrower_id"]),
                order["order_no"],
                order["approval_status"],
                order["note"],
            ])
        for record in records:
            asset = asset_map.get(record["asset_id"])
            if not asset or record["type"] != "出库":
                continue
            rows.append([
                record["out_time"] or record["in_time"],
                asset["code"],
                asset["name"],
                "旧出库记录",
                record["quantity"],
                "按耗材规则",
                user_name_by_id(conn, record["user_id"]),
                user_department_by_id(conn, record["user_id"]),
                record["paper_no"],
                record["status"],
                record_display_note(record["note"]),
            ])
        return "领用明细.csv", headers, rows
    if report_type == "borrow":
        headers = ["借用时间", "资产编号", "资产名称", "数量", "是否扣减库存", "借用人", "部门", "预计归还", "实际归还", "状态", "单号", "验收", "备注"]
        rows = []
        for order in rows_to_list(conn.execute("select * from borrow_orders order by created_at desc, id desc")):
            asset = asset_map.get(order["asset_id"])
            if not asset or str(order["order_no"] or "").startswith("LY") or order["status"] == "已领用":
                continue
            rows.append([
                order["created_at"],
                asset["code"],
                asset["name"],
                order["quantity"],
                "是" if int(order["count_quantity"] or 0) else "否",
                user_name_by_id(conn, order["borrower_id"]),
                user_department_by_id(conn, order["borrower_id"]),
                order["expected_return_date"],
                order["actual_return_date"],
                order["status"],
                order["order_no"],
                order["return_check"],
                order["note"],
            ])
        for record in records:
            asset = asset_map.get(record["asset_id"])
            if not asset or record["type"] != "出库":
                continue
            rows.append([
                record["out_time"] or record["in_time"],
                asset["code"],
                asset["name"],
                record["quantity"],
                "按耗材规则",
                user_name_by_id(conn, record["user_id"]),
                user_department_by_id(conn, record["user_id"]),
                "",
                "",
                record["status"],
                record["paper_no"],
                "",
                record_display_note(record["note"]),
            ])
        return "借还明细.csv", headers, rows
    if report_type == "stock-flow":
        headers = ["时间", "资产编号", "资产名称", "流水类型", "变动数量", "变动前", "变动后", "关联业务", "经办人", "备注"]
        rows = []
        for item in rows_to_list(conn.execute("select * from stock_records order by created_at desc, id desc")):
            asset = asset_map.get(item["asset_id"])
            if not asset:
                continue
            related = " / ".join(part for part in (item["related_type"], item["related_id"]) if part)
            rows.append([item["created_at"], asset["code"], asset["name"], item["flow_type"], item["quantity"], item["before_quantity"], item["after_quantity"], related, user_name_by_id(conn, item["operator_id"]), item["note"]])
        return "库存流水.csv", headers, rows
    if report_type == "transfer":
        headers = ["调拨日期", "单号", "资产编号", "资产名称", "原部门", "新部门", "原位置", "新位置", "原责任人", "新责任人", "状态", "原因", "经办人"]
        rows = []
        for item in rows_to_list(conn.execute("select * from transfer_orders order by created_at desc, id desc")):
            asset = asset_map.get(item["asset_id"])
            if not asset:
                continue
            rows.append([item["transfer_date"], item["order_no"], asset["code"], asset["name"], item["old_department"], item["new_department"], item["old_location"], item["new_location"], user_name_by_id(conn, item["old_keeper_id"]), user_name_by_id(conn, item["new_keeper_id"]), item["status"], item["reason"], user_name_by_id(conn, item["operator_id"])])
        return "调拨明细.csv", headers, rows
    if report_type == "repair":
        headers = ["开始时间", "完成时间", "单号", "资产编号", "资产名称", "报修人", "维修人/单位", "状态", "费用", "故障描述", "维修结果", "经办人"]
        rows = []
        for item in rows_to_list(conn.execute("select * from repair_orders order by created_at desc, id desc")):
            asset = asset_map.get(item["asset_id"])
            if not asset:
                continue
            rows.append([item["start_time"], item["end_time"], item["order_no"], asset["code"], asset["name"], user_name_by_id(conn, item["reporter_id"]), item["repairer"], item["status"], item["cost"], item["fault_desc"], item["result"], user_name_by_id(conn, item["operator_id"])])
        return "维修明细.csv", headers, rows
    if report_type == "asset-flow":
        headers = ["时间", "资产编号", "资产名称", "动作", "业务单号", "来源", "经办人", "备注"]
        rows = []
        for item in rows_to_list(conn.execute("select * from asset_flow_logs order by created_at desc, id desc")):
            asset = asset_map.get(item["asset_id"])
            if not asset:
                continue
            source = " / ".join(part for part in (item["source_type"], item["source_id"]) if part)
            rows.append([item["created_at"], asset["code"], asset["name"], item["action"], item["business_no"], source, user_name_by_id(conn, item["operator_id"]), item["note"]])
        return "资产流转日志.csv", headers, rows
    if report_type == "scrap":
        headers = ["报废单号", "资产编号", "资产名称", "申请人", "报废日期", "残值", "审批状态", "原因"]
        rows = []
        for item in rows_to_list(conn.execute("select * from scrap_orders order by created_at desc")):
            asset = asset_map.get(item["asset_id"])
            if not asset:
                continue
            rows.append([item["order_no"], asset["code"] if asset else item["asset_id"], asset["name"] if asset else "", user_name_by_id(conn, item["applicant_id"]), item["scrap_date"], item["residual_value"], item["approval_status"], item["reason"]])
        return "报废资产清单.csv", headers, rows
    if report_type in ("consumable-warning", "consumable-status"):
        headers = ["资产编号", "耗材名称", "规格", "状态", "位置", "备注"]
        rows = [
            [item["code"], item["name"], item["spec"], STATUS_LABELS.get(item["status"], item["status"]), item["location"], item["remark"]]
            for item in assets
            if is_consumable_text(item["category"], item["name"], item["remark"]) and item["status"] in ("repair", "retired")
        ]
        return "耗材状态异常清单.csv", headers, rows
    return "资产报表.csv", ["提示"], [["未知报表类型"]]


def user_name_by_id(conn, user_id):
    if not user_id:
        return ""
    row = conn.execute("select name from users where id = ?", (user_id,)).fetchone()
    return row["name"] if row else user_id


def user_department_by_id(conn, user_id):
    if not user_id:
        return ""
    row = conn.execute("select department from users where id = ?", (user_id,)).fetchone()
    return row["department"] if row else ""


def inventory_check_report_rows(conn, task_id):
    task = conn.execute("select * from inventory_check_tasks where id = ?", (task_id,)).fetchone()
    if not task:
        raise ValueError("盘点任务不存在")
    items = rows_to_list(conn.execute("select * from inventory_check_items where task_id = ? order by diff_type, id", (task_id,)))
    headers = ["盘点单号", "资产编号", "资产名称", "系统位置", "实际位置", "系统状态", "实际状态", "系统责任人", "实际责任人", "是否已盘", "差异", "备注"]
    rows = []
    for item in items:
        asset = conn.execute("select * from assets where id = ?", (item["asset_id"],)).fetchone()
        rows.append([
            task["check_no"],
            asset["code"] if asset else item["asset_id"],
            asset["name"] if asset else "",
            item["system_location"],
            item["actual_location"],
            STATUS_LABELS.get(item["system_status"], item["system_status"]),
            STATUS_LABELS.get(item["actual_status"], item["actual_status"]),
            user_name_by_id(conn, item["system_keeper_id"]),
            user_name_by_id(conn, item["actual_keeper_id"]),
            "是" if item["checked"] else "否",
            item["diff_type"],
            item["remark"],
        ])
    return f"盘点差异报告-{task['check_no']}.csv", headers, rows


def w_tag(name):
    return f"{{{W_NS}}}{name}"


def set_paragraph_text(paragraph, text):
    ppr = paragraph.find(w_tag("pPr"))
    for child in list(paragraph):
        if child is not ppr:
            paragraph.remove(child)
    run = ElementTree.SubElement(paragraph, w_tag("r"))
    text_el = ElementTree.SubElement(run, w_tag("t"))
    text_el.set(f"{{{XML_NS}}}space", "preserve")
    text_el.text = str(text or "")


def set_cell_lines(cell, lines):
    tcpr = cell.find(w_tag("tcPr"))
    for child in list(cell):
        if child is not tcpr:
            cell.remove(child)
    for line in lines:
        para = ElementTree.SubElement(cell, w_tag("p"))
        set_paragraph_text(para, line)


def docx_text(element):
    return "".join(text.text or "" for text in element.findall(f".//{w_tag('t')}"))


def first_table(segment):
    for item in segment:
        if item.tag == w_tag("tbl"):
            return item
        table = item.find(f".//{w_tag('tbl')}")
        if table is not None:
            return table
    return None


def item_category_flags(item):
    category = str(item.get("category") or "")
    text = " ".join(str(item.get(field) or "") for field in ("category", "remark", "name"))
    template_noise = all(label in category for label in ("固定资产", "低值易耗品", "耗材", "购进软件"))
    is_consumable = is_consumable_asset(item)
    is_software = ("软件" in category or "购进软件" in category) and not template_noise
    is_low_value = ("低值易耗品" in category or "易耗品" in category) and not template_noise
    is_fixed = "固定资产" in text or (not is_consumable and not is_software and not is_low_value)
    return {
        "固定资产": is_fixed,
        "低值易耗品": is_low_value,
        "耗材": is_consumable,
        "购进软件": is_software,
    }


def category_checkbox_lines(item):
    flags = item_category_flags(item)
    box = lambda label: ("☑" if flags[label] else "□") + label
    return [f"{box('固定资产')} {box('低值易耗品')}", f"{box('耗材')}     {box('购进软件')}"]


def is_consumable_asset(item):
    category = str(item.get("category") or "").strip()
    name = str(item.get("name") or "").strip()
    remark = str(item.get("remark") or "")
    if "耗材" in name:
        return True
    if category in ("耗材", "耗材领用") or category.startswith("耗材/"):
        return True
    if "耗材" in category and not all(label in category for label in ("固定资产", "低值易耗品", "耗材", "购进软件")):
        return True
    source_parts = re.split(r"导入文件：|；|;", remark)
    return any("耗材" in part and (".doc" in part or ".xls" in part or ".xlsx" in part) for part in source_parts)


def page_break_paragraph():
    para = ElementTree.Element(w_tag("p"))
    run = ElementTree.SubElement(para, w_tag("r"))
    br = ElementTree.SubElement(run, w_tag("br"))
    br.set(w_tag("type"), "page")
    return para


def docx_body_template(root):
    body = root.find(w_tag("body"))
    children = list(body)
    sect_pr = children[-1] if children and children[-1].tag == w_tag("sectPr") else None
    content = children[:-1] if sect_pr is not None else children
    return body, content, sect_pr


def replace_body_content(body, content, sect_pr):
    for child in list(body):
        body.remove(child)
    for child in content:
        body.append(child)
    if sect_pr is not None:
        body.append(copy.deepcopy(sect_pr))


def fill_template_docx(template_path, chunks, fill_segment, template_content_base64=""):
    if not template_path.exists():
        raise FileNotFoundError(f"模板不存在：{template_path}")
    if template_content_base64:
        source_bytes = io.BytesIO(base64.b64decode(template_content_base64))
        source_zip = zipfile.ZipFile(source_bytes, "r")
    else:
        source_zip = zipfile.ZipFile(template_path, "r")
    with source_zip as source:
        original_files = {name: source.read(name) for name in source.namelist()}
    root = ElementTree.fromstring(original_files["word/document.xml"])
    body, template_content, sect_pr = docx_body_template(root)
    new_content = []
    for page_index, chunk in enumerate(chunks):
        if page_index:
            new_content.append(page_break_paragraph())
        segment = [copy.deepcopy(item) for item in template_content]
        fill_segment(segment, chunk, page_index)
        new_content.extend(segment)
    replace_body_content(body, new_content, sect_pr)
    original_files["word/document.xml"] = ElementTree.tostring(root, encoding="utf-8", xml_declaration=True)
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as target:
        for name, content in original_files.items():
            target.writestr(name, content)
    return output.getvalue()


def chunked(items, size):
    if not items:
        return [[]]
    return [items[index:index + size] for index in range(0, len(items), size)]


def fill_asset_template_segment(segment, items, page_index, applicant):
    today = datetime.now(BEIJING_TZ)
    serial = f"{today.strftime('%Y%m%d')}-{page_index + 1:02d}"
    for item in segment:
        if item.tag == w_tag("p"):
            text = docx_text(item)
            if "编号" in text and "本单序号" in text:
                set_paragraph_text(
                    item,
                    f"编号：GZITTC-WG-WPLY-{today.strftime('%y-%m')}         本单序号：{serial}                  申请人：{applicant}",
                )
    table = first_table(segment)
    rows = table.findall(w_tag("tr")) if table is not None else []
    for row_index in range(5):
        cells = rows[row_index + 1].findall(w_tag("tc"))
        asset = items[row_index] if row_index < len(items) else None
        values = [
            str(page_index * 5 + row_index + 1) if asset else "",
            asset["name"] if asset else "",
            asset["code"] if asset else "",
            asset["spec"] if asset else "",
            str(asset["quantity"]) if asset else "",
        ]
        for cell, value in zip(cells[:5], values):
            set_cell_lines(cell, [value])
        set_cell_lines(cells[5], category_checkbox_lines(asset or {}))


def fill_consumable_template_segment(segment, items, page_index, applicant):
    today = datetime.now(BEIJING_TZ)
    serial = f"{today.strftime('%Y%m%d')}-{page_index + 1:02d}"
    for item in segment:
        if item.tag == w_tag("p"):
            text = docx_text(item)
            if "编号" in text and "负责人" in text:
                set_paragraph_text(
                    item,
                    f"编号：GZITTC-WG-WPLY-{today.strftime('%y-%m')}         本单序号：{serial}                  负责人：",
                )
            elif text.startswith("申请人"):
                set_paragraph_text(item, f"申请人：{applicant}")
    table = first_table(segment)
    rows = table.findall(w_tag("tr")) if table is not None else []
    for row_index in range(1, min(len(rows), 16)):
        cells = rows[row_index].findall(w_tag("tc"))
        asset = items[row_index - 1] if row_index - 1 < len(items) else None
        values = [
            str(page_index * 15 + row_index) if asset else "",
            applicant if asset else "",
            asset["name"] if asset else "",
            asset["spec"] if asset else "",
            str(asset["quantity"]) if asset else "",
            today.strftime("%Y-%m-%d") if asset else "",
            "",
        ]
        for cell, value in zip(cells[:7], values):
            set_cell_lines(cell, [value])


def selected_assets_for_user(conn, user, asset_ids):
    if not asset_ids:
        return []
    placeholders = ",".join("?" for _ in asset_ids)
    if has_permission(conn, user, "assets.view.all"):
        rows = rows_to_list(conn.execute(f"select * from assets where id in ({placeholders})", asset_ids))
    elif role_id_for_user(user) == "department_head":
        rows = rows_to_list(
            conn.execute(
                f"""
                select distinct a.* from assets a
                left join users ku on ku.id = a.keeper_id
                left join users uu on uu.id = a.use_user_id
                where a.id in ({placeholders})
                  and (a.use_department = ? or ku.department = ? or uu.department = ?)
                """,
                [*asset_ids, user["department"], user["department"], user["department"]],
            )
        )
    else:
        rows = rows_to_list(
            conn.execute(
                f"""
                select distinct a.* from assets a
                left join records r on r.asset_id = a.id
                where a.id in ({placeholders}) and (a.keeper_id = ? or r.user_id = ?)
                """,
                [*asset_ids, user["id"], user["id"]],
            )
        )
    by_id = {item["id"]: item for item in rows}
    return [by_id[item_id] for item_id in asset_ids if item_id in by_id]


def group_assets_by_keeper(conn, assets):
    user_ids = []
    for asset in assets:
        keeper_id = asset.get("keeper_id") or ""
        if keeper_id and keeper_id not in user_ids:
            user_ids.append(keeper_id)
    if not user_ids:
        return [("", "", assets)]
    placeholders = ",".join("?" for _ in user_ids)
    users = rows_to_list(conn.execute(f"select id, name from users where id in ({placeholders})", user_ids))
    names = {item["id"]: item["name"] for item in users}
    groups = []
    for keeper_id in user_ids:
        group_items = [asset for asset in assets if asset.get("keeper_id") == keeper_id]
        name = names.get(keeper_id, "")
        if name in ("未填写", "未填", "无"):
            name = ""
        groups.append((keeper_id, name, group_items))
    return groups


def build_asset_template_download(conn, user, asset_ids):
    assets = selected_assets_for_user(conn, user, asset_ids)
    if not assets:
        raise ValueError("没有可打印的资产数据")
    files = []
    _, asset_template_content, asset_template_path = template_source(conn, "asset")
    _, consumable_template_content, consumable_template_path = template_source(conn, "consumable")
    for _, applicant, group_items in group_assets_by_keeper(conn, assets):
        applicant_name = applicant or user["name"]
        asset_items = [item for item in group_items if not is_consumable_asset(item)]
        consumable_items = [item for item in group_items if is_consumable_asset(item)]
        safe_name = safe_download_name(applicant_name or "未命名")
        if asset_items:
            content = fill_template_docx(
                asset_template_path,
                chunked(asset_items, 5),
                lambda segment, chunk, index: fill_asset_template_segment(segment, chunk, index, applicant_name),
                asset_template_content,
            )
            files.append((f"{safe_name}-资产申请及确认单.docx", content))
        if consumable_items:
            content = fill_template_docx(
                consumable_template_path,
                chunked(consumable_items, 15),
                lambda segment, chunk, index: fill_consumable_template_segment(segment, chunk, index, applicant_name),
                consumable_template_content,
            )
            files.append((f"{safe_name}-耗材申请及确认单.docx", content))
    if len(files) == 1:
        return files[0][0], "application/vnd.openxmlformats-officedocument.wordprocessingml.document", files[0][1]
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for file_name, content in files:
            archive.writestr(file_name, content)
    return "资产耗材申请确认单.zip", "application/zip", output.getvalue()


def reset_db():
    if DB_PATH.exists():
        DB_PATH.unlink()
    init_db()


def clear_data_preserving_login_accounts(conn):
    tables = [
        "inventory_check_items",
        "inventory_check_tasks",
        "stock_records",
        "asset_flow_logs",
        "borrow_orders",
        "transfer_orders",
        "repair_orders",
        "scrap_orders",
        "records",
        "import_row_fingerprints",
        "import_archives",
        "paper_queue",
        "asset_requests",
        "purchase_wishes",
        "admin_requests",
        "device_group_rules",
        "assets",
        "locations",
        "asset_categories",
        "departments",
        "system_settings",
        "audits",
    ]
    counts = {}
    existing = {
        row["name"]
        for row in rows_to_list(conn.execute("select name from sqlite_master where type = 'table'"))
    }
    for table in tables:
        if table not in existing:
            counts[table] = 0
            continue
        counts[table] = conn.execute(f"select count(*) from {table}").fetchone()[0]
        conn.execute(f"delete from {table}")
    return counts


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def log_message(self, fmt, *args):
        print(f"{self.address_string()} - {fmt % args}")

    def end_headers(self):
        static_path = urlparse(self.path).path
        if static_path in ("/", "/index.html", "/app.js", "/styles.css"):
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            self.send_header("Pragma", "no-cache")
        super().end_headers()

    def send_json(self, status, body):
        raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def send_auth_error(self, exc):
        self.send_json(401, {"error": str(exc) or "登录已过期，请重新登录。", "code": "SESSION_EXPIRED"})

    def send_binary(self, status, file_name, content_type, content):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Disposition", f"attachment; filename*=UTF-8''{quote(safe_download_name(file_name))}")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if not length:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def client_ip(self):
        for header in ("X-Forwarded-For", "X-Original-Forwarded-For", "X-Real-IP", "X-Client-IP", "True-Client-IP", "CF-Connecting-IP"):
            value = self.headers.get(header, "")
            if value:
                for item in value.split(","):
                    clean = item.strip().strip("[]")
                    if clean:
                        return clean
        forwarded = self.headers.get("Forwarded", "")
        if forwarded:
            match = re.search(r"for=\"?([^;,\"\s]+)", forwarded)
            if match:
                return match.group(1).strip("[]")
        return self.client_address[0] if self.client_address else ""

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            try:
                with db() as conn:
                    conn.execute("select 1").fetchone()
                    user_count = conn.execute("select count(*) from users").fetchone()[0]
                    asset_count = conn.execute("select count(*) from assets").fetchone()[0]
                self.send_json(
                    200,
                    {
                        "ok": True,
                        "appVersion": APP_VERSION,
                        "database": str(DB_PATH),
                        "publicPort": str(PUBLIC_PORT),
                        "users": user_count,
                        "assets": asset_count,
                        "time": now_local(),
                    },
                )
            except Exception as exc:
                self.send_json(
                    503,
                    {
                        "ok": False,
                        "appVersion": APP_VERSION,
                        "database": str(DB_PATH),
                        "error": str(exc),
                        "time": now_local(),
                    },
                )
            return
        if parsed.path == "/api/login-settings":
            with db() as conn:
                self.send_json(
                    200,
                    {
                        "adminPrefillEnabled": bool(int(setting_value(conn, "admin_prefill_enabled", "0"))),
                        "adminPrefillPassword": DEFAULT_ADMIN_PASSWORD if bool(int(setting_value(conn, "admin_prefill_enabled", "0"))) else "",
                        "loginBackgroundImage": setting_value(conn, "login_background_image", ""),
                        "appVersion": APP_VERSION,
                    },
                )
            return
        if parsed.path == "/api/import-archives/download":
            query = parse_qs(parsed.query)
            try:
                with db() as conn:
                    user = require_user(conn, query=query)
                    view_role = query.get("viewRole", [""])[0]
                    require_view_permission(conn, user, "records.manage", view_role)
                    archive_id = query.get("id", [""])[0]
                    archive = conn.execute("select * from import_archives where id = ?", (archive_id,)).fetchone()
                    if not archive:
                        self.send_response(404)
                        self.end_headers()
                        return
                    content = archive["content"]
                    file_name = safe_download_name(archive["file_name"])
                    self.send_response(200)
                    self.send_header("Content-Type", "application/octet-stream")
                    safe_name = quote(file_name)
                    self.send_header("Content-Disposition", f"attachment; filename*=UTF-8''{safe_name}")
                    self.send_header("Content-Length", str(len(content)))
                    self.end_headers()
                    self.wfile.write(content)
            except AuthError as exc:
                self.send_auth_error(exc)
            except PermissionError:
                self.send_response(403)
                self.end_headers()
            return
        if parsed.path == "/api/import-archives/content":
            query = parse_qs(parsed.query)
            try:
                with db() as conn:
                    user = require_user(conn, query=query)
                    view_role = query.get("viewRole", [""])[0]
                    require_view_permission(conn, user, "records.manage", view_role)
                    archive_id = query.get("id", [""])[0]
                    archive = conn.execute("select id, file_name, content from import_archives where id = ?", (archive_id,)).fetchone()
                    if not archive:
                        self.send_json(404, {"error": "导入留档不存在"})
                        return
                    self.send_json(
                        200,
                        {
                            "id": archive["id"],
                            "fileName": archive["file_name"],
                            "contentBase64": base64.b64encode(archive["content"]).decode("ascii"),
                        },
                    )
            except AuthError as exc:
                self.send_auth_error(exc)
            except PermissionError as exc:
                self.send_json(403, {"error": str(exc)})
            return
        if parsed.path == "/api/reports/export":
            query = parse_qs(parsed.query)
            try:
                with db() as conn:
                    user = require_user(conn, query=query)
                    view_role = query.get("viewRole", [""])[0]
                    require_view_permission(conn, user, "reports.export", view_role)
                    report_type = query.get("type", ["ledger"])[0]
                    file_name, headers, rows = asset_report_rows(conn, report_type, user)
                    send_csv(self, file_name, headers, rows)
            except AuthError as exc:
                self.send_auth_error(exc)
            except PermissionError:
                self.send_response(403)
                self.end_headers()
            return
        if parsed.path == "/api/purchase-wishes/export":
            query = parse_qs(parsed.query)
            try:
                with db() as conn:
                    user = require_user(conn, query=query)
                    require_view_permission(conn, user, "purchase_wishes.view", query.get("viewRole", [""])[0])
                    headers, rows = purchase_wish_export_rows(conn, user)
                    send_xlsx(self, "采购需求表.xlsx", headers, rows, "采购需求")
            except AuthError as exc:
                self.send_auth_error(exc)
            except PermissionError:
                self.send_response(403)
                self.end_headers()
            return
        if parsed.path == "/api/inventory-checks/export":
            query = parse_qs(parsed.query)
            try:
                with db() as conn:
                    user = require_user(conn, query=query)
                    view_role = query.get("viewRole", [""])[0]
                    require_view_permission(conn, user, "reports.export", view_role)
                    task_id = query.get("taskId", [""])[0]
                    file_name, headers, rows = inventory_check_report_rows(conn, task_id)
                    send_csv(self, file_name, headers, rows)
            except AuthError as exc:
                self.send_auth_error(exc)
            except PermissionError:
                self.send_response(403)
                self.end_headers()
            except ValueError as exc:
                self.send_json(404, {"error": str(exc)})
            return
        if parsed.path == "/api/state":
            try:
                with db() as conn:
                    query = parse_qs(parsed.query)
                    user = require_user(conn, query=query)
                    view_role = query.get("viewRole", [""])[0]
                    self.send_json(200, get_state(conn, user, view_role=view_role))
            except AuthError as exc:
                self.send_auth_error(exc)
            except PermissionError as exc:
                self.send_json(403, {"error": str(exc)})
            return
        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        payload = self.read_json()
        ip_token = REQUEST_IP.set(self.client_ip())
        try:
            with db() as conn:
                if parsed.path == "/api/login":
                    login_name = str(payload.get("username") or "").strip()
                    user = conn.execute(
                        """
                        select * from users
                        where (username = ? or name = ?) and password = ? and active = 1
                        order by case when username = ? then 0 else 1 end, username
                        limit 1
                        """,
                        (login_name, login_name, payload.get("password"), login_name),
                    ).fetchone()
                    if not user:
                        self.send_json(401, {"error": "账号或密码错误，或用户已停用。"})
                        return
                    session_token = create_session(conn, user["id"])
                    add_audit(conn, user["id"], "登录", f"{user['name']} 登录系统")
                    self.send_json(200, {"user": public_user(user), "sessionToken": session_token})
                    return

                if parsed.path == "/api/logout":
                    token = request_session_token(payload=payload)
                    if token:
                        session = conn.execute("select * from user_sessions where token = ?", (token,)).fetchone()
                        if session:
                            user = get_user(conn, session["user_id"])
                            if user:
                                add_audit(conn, user["id"], "退出登录", f"{user['name']} 退出系统")
                        conn.execute("delete from user_sessions where token = ?", (token,))
                    self.send_json(200, {"ok": True})
                    return

                user = require_user(conn, payload=payload)
                if parsed.path == "/api/assets/print-template":
                    asset_ids = [str(item) for item in payload.get("assetIds", []) if str(item).strip()]
                    try:
                        file_name, content_type, content = build_asset_template_download(conn, user, asset_ids)
                    except ValueError as exc:
                        self.send_json(400, {"error": str(exc)})
                        return
                    add_audit(conn, user["id"], "导出资产申请模板", f"{file_name}，{len(asset_ids)} 条")
                    self.send_binary(200, file_name, content_type, content)
                    return
                if parsed.path == "/api/reset":
                    require_permission(conn, user, "settings.manage")
                    reset_db()
                    with db() as fresh:
                        fresh_user = get_user(fresh, user["id"])
                        self.send_json(200, get_state(fresh, fresh_user))
                    return
                if parsed.path == "/api/assets":
                    require_permission(conn, user, "assets.manage")
                    asset_id = new_id("asset")
                    asset_code = str(payload.get("code") or "").strip() or next_asset_code(conn, payload.get("category", ""))
                    duplicate = conn.execute("select id from assets where code = ?", (asset_code,)).fetchone()
                    if duplicate:
                        self.send_json(400, {"error": "资产编号已存在"})
                        return
                    ensure_asset_category(conn, payload["category"])
                    values = asset_payload_values(payload, user)
                    now = now_local()
                    conn.execute(
                        """
                        insert into assets
                        (id, code, name, category, spec, quantity, safe_stock, brand, unit, unit_price, total_amount,
                         purchase_date, inbound_date, supplier, use_department, use_user_id, source, creator_id,
                         created_at, updated_at, location, keeper_id, status, remark, image)
                        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            asset_id,
                            asset_code,
                            values["name"],
                            values["category"],
                            values["spec"],
                            values["quantity"],
                            values["safe_stock"],
                            values["brand"],
                            values["unit"],
                            values["unit_price"],
                            values["total_amount"],
                            values["purchase_date"],
                            values["inbound_date"],
                            values["supplier"],
                            values["use_department"],
                            values["use_user_id"],
                            values["source"],
                            user["id"],
                            now,
                            now,
                            values["location"],
                            values["keeper_id"],
                            values["status"],
                            values["remark"],
                            values["image"],
                        ),
                    )
                    asset = conn.execute("select * from assets where id = ?", (asset_id,)).fetchone()
                    add_stock_record(conn, asset_id, "建账", values["quantity"], 0, values["quantity"], user["id"], "asset", asset_id, "新增资产台账")
                    add_flow_log(conn, asset_id, "create", user["id"], before="", after=asset, source_type="asset", source_id=asset_id, note="新增资产")
                    audit_change(conn, user["id"], "新增资产", "asset", asset_id, f"{values['name']}（{asset_code}）", before="", after=asset)
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/assets/update":
                    require_permission(conn, user, "assets.manage")
                    asset_id = payload["assetId"]
                    asset = conn.execute("select * from assets where id = ?", (asset_id,)).fetchone()
                    if not asset:
                        self.send_json(404, {"error": "资产不存在"})
                        return
                    asset_code = str(payload.get("code") or "").strip() or asset["code"] or next_asset_code(conn, payload.get("category", ""))
                    duplicate = conn.execute("select id from assets where code = ? and id <> ?", (asset_code, asset_id)).fetchone()
                    if duplicate:
                        self.send_json(400, {"error": "资产编号已存在"})
                        return
                    ensure_asset_category(conn, payload["category"])
                    values = asset_payload_values(payload, user, existing=asset)
                    values["code"] = asset_code
                    try:
                        updated = update_asset_fields(conn, asset_id, values, user["id"], "edit", source_type="asset", source_id=asset_id, note="编辑资产台账")
                    except ValueError as exc:
                        self.send_json(400, {"error": str(exc)})
                        return
                    audit_change(conn, user["id"], "编辑资产", "asset", asset_id, f"{values['name']}（{asset_code}）", before=asset, after=updated)
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/assets/delete":
                    require_permission(conn, user, "assets.manage")
                    asset_id = payload["assetId"]
                    asset = conn.execute("select * from assets where id = ?", (asset_id,)).fetchone()
                    if not asset:
                        self.send_json(404, {"error": "资产不存在"})
                        return
                    record_count = conn.execute("select count(*) from records where asset_id = ?", (asset_id,)).fetchone()[0]
                    if record_count:
                        self.send_json(400, {"error": f"该资产已有 {record_count} 条出入库记录，请先删除相关记录"})
                        return
                    conn.execute("delete from assets where id = ?", (asset_id,))
                    add_audit(conn, user["id"], "删除资产", f"{asset['name']}（{asset['code']}）")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/records":
                    require_permission(conn, user, "records.manage")
                    record_id = new_id("record")
                    record_type = payload["type"]
                    asset_row = conn.execute("select * from assets where id = ?", (payload["assetId"],)).fetchone()
                    if not asset_row:
                        self.send_json(404, {"error": "资产不存在"})
                        return
                    target_user = conn.execute("select * from users where id = ? and active = 1", (payload["userId"],)).fetchone()
                    if not target_user:
                        self.send_json(400, {"error": "使用人不存在或已停用"})
                        return
                    action = "checkout" if record_type == "出库" else "checkin"
                    ok, message = status_transition_allowed(asset_row["status"], "checked_out" if record_type == "出库" else "in_stock", action=action)
                    if not ok:
                        self.send_json(400, {"error": message})
                        return
                    in_time = payload.get("inTime") if record_type == "入库" else ""
                    out_time = payload.get("outTime") if record_type == "出库" else ""
                    if record_type == "出库" and not out_time:
                        out_time = now_local()
                    status = "已入库" if record_type == "入库" else "使用中"
                    quantity = max(1, int(payload.get("quantity", 1)))
                    conn.execute(
                        "insert into records (id, asset_id, type, quantity, user_id, operator_id, in_time, out_time, status, paper_no, note, photo) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (
                            record_id,
                            payload["assetId"],
                            record_type,
                            quantity,
                            payload["userId"],
                            user["id"],
                            in_time,
                            out_time,
                            status,
                            payload.get("paperNo", ""),
                            payload.get("note", ""),
                            payload.get("photo", ""),
                        ),
                    )
                    updates = {
                        "status": "in_stock" if record_type == "入库" else "checked_out",
                        "keeper_id": payload["userId"],
                        "use_user_id": payload["userId"],
                        "use_department": target_user["department"],
                    }
                    if asset_row and is_consumable_text(asset_row["category"], asset_row["name"], asset_row["remark"]):
                        change_quantity = quantity
                        if record_type == "出库":
                            change_quantity = -change_quantity
                        next_quantity = max(0, int(asset_row["quantity"] or 0) + change_quantity)
                        updates["quantity"] = next_quantity
                    try:
                        updated = update_asset_fields(
                            conn,
                            payload["assetId"],
                            updates,
                            user["id"],
                            action,
                            business_no=payload.get("paperNo", ""),
                            source_type="record",
                            source_id=record_id,
                            note=payload.get("note", ""),
                        )
                    except ValueError as exc:
                        conn.execute("delete from records where id = ?", (record_id,))
                        self.send_json(400, {"error": str(exc)})
                        return
                    asset_label = f"{asset_row['name']}（{asset_row['code']}）"
                    audit_change(conn, user["id"], f"登记{record_type}", "record", record_id, f"{asset_label} {record_type} {quantity}", before=asset_row, after=updated, business_no=payload.get("paperNo", ""))
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/records/delete":
                    require_permission(conn, user, "records.manage")
                    record_id = payload["recordId"]
                    record = conn.execute("select * from records where id = ?", (record_id,)).fetchone()
                    if not record:
                        self.send_json(404, {"error": "出入库记录不存在"})
                        return
                    asset = conn.execute("select * from assets where id = ?", (record["asset_id"],)).fetchone()
                    conn.execute("delete from records where id = ?", (record_id,))
                    if asset:
                        remaining = rows_to_list(
                            conn.execute(
                                "select * from records where asset_id = ? order by coalesce(in_time, out_time) desc, id desc",
                                (record["asset_id"],),
                            )
                        )
                        latest = remaining[0] if remaining else None
                        updates = {}
                        if latest:
                            latest_user = conn.execute("select * from users where id = ?", (latest["user_id"],)).fetchone()
                            updates = {
                                "status": "checked_out" if latest["type"] == "出库" else "in_stock",
                                "keeper_id": latest["user_id"],
                                "use_user_id": latest["user_id"],
                                "use_department": latest_user["department"] if latest_user else asset["use_department"],
                            }
                        else:
                            updates = {"status": "in_stock"}
                        try:
                            update_asset_fields(conn, record["asset_id"], updates, user["id"], "delete_record", source_type="record", source_id=record_id, note="删除出入库记录后重算状态")
                        except ValueError:
                            pass
                    label = f"{asset['name']}（{asset['code']}）" if asset else record["asset_id"]
                    audit_change(conn, user["id"], "删除出入库记录", "record", record_id, f"{record['type']}：{label}", before=record, after="")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/records/import":
                    require_permission(conn, user, "records.manage")
                    content = base64.b64decode(payload["contentBase64"])
                    result = import_records(conn, user, payload["fileName"], content)
                    self.send_json(200, {"importResult": result})
                    return
                if parsed.path == "/api/inventory/adjust":
                    require_permission(conn, user, "inventory.manage")
                    asset_id = payload["assetId"]
                    asset = conn.execute("select * from assets where id = ?", (asset_id,)).fetchone()
                    if not asset:
                        self.send_json(404, {"error": "耗材不存在"})
                        return
                    if not is_consumable_text(asset["category"], asset["name"], asset["remark"]):
                        self.send_json(400, {"error": "耗材流水登记只支持耗材"})
                        return
                    mode = str(payload.get("mode", "increase")).strip()
                    quantity = max(1, int(payload.get("quantity") or 1))
                    reason = str(payload.get("reason", "")).strip() or "耗材流水登记"
                    record_type = "入库" if mode == "increase" else "出库"
                    current_quantity = int(asset["quantity"] or 0)
                    next_quantity = max(0, current_quantity + (quantity if mode == "increase" else -quantity))
                    record_id = new_id("record")
                    current_time = now_local()
                    operator_target = payload.get("userId") or asset["keeper_id"]
                    conn.execute(
                        "insert into records (id, asset_id, type, quantity, user_id, operator_id, in_time, out_time, status, paper_no, note, photo) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (
                            record_id,
                            asset_id,
                            record_type,
                            quantity,
                            operator_target,
                            user["id"],
                            current_time if record_type == "入库" else "",
                            current_time if record_type == "出库" else "",
                            "已入库" if record_type == "入库" else "使用中",
                            payload.get("paperNo", ""),
                            f"耗材流水登记：{reason}",
                            "",
                        ),
                    )
                    target_user = conn.execute("select * from users where id = ?", (operator_target,)).fetchone()
                    try:
                        updated = update_asset_fields(
                            conn,
                            asset_id,
                            {
                                "quantity": next_quantity,
                                "status": "in_stock" if next_quantity > 0 else "checked_out",
                                "keeper_id": operator_target,
                                "use_user_id": operator_target,
                                "use_department": target_user["department"] if target_user else asset["use_department"],
                            },
                            user["id"],
                            "stock_adjust",
                            business_no=payload.get("paperNo", ""),
                            source_type="record",
                            source_id=record_id,
                            note=reason,
                        )
                    except ValueError as exc:
                        conn.execute("delete from records where id = ?", (record_id,))
                        self.send_json(400, {"error": str(exc)})
                        return
                    audit_change(conn, user["id"], "耗材流水登记", "record", record_id, f"{asset['name']} {record_type} {quantity}，仓库数量留痕 {current_quantity}->{next_quantity}", before=asset, after=updated, business_no=payload.get("paperNo", ""))
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/inventory/safe-stock":
                    require_permission(conn, user, "inventory.manage")
                    asset_id = payload["assetId"]
                    safe_stock = max(0, int(payload.get("safeStock") or 0))
                    asset = conn.execute("select * from assets where id = ?", (asset_id,)).fetchone()
                    if not asset:
                        self.send_json(404, {"error": "耗材不存在"})
                        return
                    conn.execute("update assets set safe_stock = ? where id = ?", (safe_stock, asset_id))
                    add_audit(conn, user["id"], "更新安全库存", f"{asset['name']}：{safe_stock}")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/records/import-inbound":
                    require_permission(conn, user, "records.manage")
                    content = base64.b64decode(payload["contentBase64"])
                    result = import_records(conn, user, payload["fileName"], content, default_type="入库", allowed_type="入库")
                    self.send_json(200, {"importResult": result})
                    return
                if parsed.path == "/api/records/import-word-checkout":
                    require_permission(conn, user, "records.manage")
                    content = base64.b64decode(payload["contentBase64"])
                    result = import_word_checkout(conn, user, payload["fileName"], content)
                    self.send_json(200, {"wordImportResult": result})
                    return
                if parsed.path == "/api/paper":
                    owner_id = payload.get("ownerId") if has_permission(conn, user, "paper.manage") else user["id"]
                    conn.execute(
                        "insert into paper_queue values (?, ?, ?, ?, ?, ?)",
                        (new_id("paper"), payload["paperNo"], payload["source"], owner_id, "待复核", payload["text"]),
                    )
                    add_audit(conn, user["id"], "新增纸质单据", f"{payload['paperNo']} 加入复核队列")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/paper/archive":
                    require_permission(conn, user, "paper.manage")
                    conn.execute("update paper_queue set status = '已归档' where id = ?", (payload["paperId"],))
                    add_audit(conn, user["id"], "归档纸质单据", payload["paperId"])
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/users":
                    require_permission(conn, user, "users.manage")
                    username = unique_username(conn, username_base_from_name(payload["name"]))
                    role_id = str(payload.get("roleId") or payload.get("role") or "teacher").strip()
                    if role_id not in ROLE_PERMISSION_MAP:
                        role_id = "teacher"
                    legacy_role = "admin" if role_id == "admin" else "user"
                    conn.execute(
                        """
                        insert into users
                        (id, username, password, name, role, role_id, department, active)
                        values (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            new_id("user"),
                            username,
                            payload["password"],
                            payload["name"],
                            legacy_role,
                            role_id,
                            payload["department"],
                            1 if payload.get("active", True) else 0,
                        ),
                    )
                    add_audit(conn, user["id"], "新增用户", f"{payload['name']}（{username}）")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/users/delete":
                    require_permission(conn, user, "users.manage")
                    target_id = payload["targetUserId"]
                    if target_id == user["id"]:
                        self.send_json(400, {"error": "不能删除当前登录用户"})
                        return
                    target = conn.execute("select * from users where id = ?", (target_id,)).fetchone()
                    if not target:
                        self.send_json(404, {"error": "用户不存在"})
                        return
                    if not target["active"]:
                        self.send_json(200, get_state(conn, user))
                        return
                    if role_id_for_user(target) == "admin":
                        admin_count = conn.execute(
                            "select count(*) from users where role_id = 'admin' and active = 1"
                        ).fetchone()[0]
                        if admin_count <= 1:
                            self.send_json(400, {"error": "至少需要保留一个启用的管理员"})
                            return
                    moved_assets = conn.execute("select count(*) from assets where keeper_id = ?", (target_id,)).fetchone()[0]
                    moved_papers = conn.execute(
                        "select count(*) from paper_queue where owner_id = ? and status <> '已归档'",
                        (target_id,),
                    ).fetchone()[0]
                    conn.execute("update assets set keeper_id = ? where keeper_id = ?", (user["id"], target_id))
                    conn.execute(
                        "update paper_queue set owner_id = ? where owner_id = ? and status <> '已归档'",
                        (user["id"], target_id),
                    )
                    conn.execute("update users set active = 0 where id = ?", (target_id,))
                    detail = f"{target['name']}（{target['username']}）"
                    if moved_assets or moved_papers:
                        detail += f"，已转移资产保管 {moved_assets} 项、待处理纸质单 {moved_papers} 条给 {user['name']}"
                    add_audit(conn, user["id"], "停用用户", detail)
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/users/promote":
                    require_permission(conn, user, "users.manage")
                    target_id = payload["targetUserId"]
                    role_id = str(payload.get("roleId") or "admin").strip()
                    if role_id not in ROLE_PERMISSION_MAP:
                        role_id = "admin"
                    target = conn.execute("select * from users where id = ?", (target_id,)).fetchone()
                    if not target:
                        self.send_json(404, {"error": "用户不存在"})
                        return
                    if not target["active"]:
                        self.send_json(400, {"error": "停用用户不能提权"})
                        return
                    if role_id_for_user(target) == role_id:
                        self.send_json(200, get_state(conn, user))
                        return
                    conn.execute("update users set role = ?, role_id = ? where id = ?", ("admin" if role_id == "admin" else "user", role_id, target_id))
                    add_audit(conn, user["id"], "调整用户角色", f"{target['name']}（{target['username']}）设为{role_label(role_id)}")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/users/revoke-admin":
                    require_permission(conn, user, "users.manage")
                    target_id = payload["targetUserId"]
                    if target_id == user["id"]:
                        self.send_json(400, {"error": "不能撤销当前登录管理员"})
                        return
                    target = conn.execute("select * from users where id = ?", (target_id,)).fetchone()
                    if not target:
                        self.send_json(404, {"error": "用户不存在"})
                        return
                    if not target["active"]:
                        self.send_json(400, {"error": "停用用户不能调整权限"})
                        return
                    if role_id_for_user(target) != "admin":
                        self.send_json(200, get_state(conn, user))
                        return
                    admin_count = conn.execute("select count(*) from users where role_id = 'admin' and active = 1").fetchone()[0]
                    if admin_count <= 1:
                        self.send_json(400, {"error": "至少需要保留一个启用的管理员"})
                        return
                    conn.execute("update users set role = 'user', role_id = 'teacher' where id = ?", (target_id,))
                    conn.execute(
                        "update admin_requests set status = '已撤销', handled_by = ?, handled_at = ? where user_id = ? and status = '已批准'",
                        (user["id"], now_local(), target_id),
                    )
                    add_audit(conn, user["id"], "撤销管理员权限", f"{target['name']}（{target['username']}）改为普通用户")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/users/password":
                    target_id = payload.get("targetUserId") or user["id"]
                    new_password = str(payload.get("newPassword") or "").strip()
                    if len(new_password) < 4:
                        self.send_json(400, {"error": "新密码至少需要 4 位"})
                        return
                    target = conn.execute("select * from users where id = ?", (target_id,)).fetchone()
                    if not target or not target["active"]:
                        self.send_json(404, {"error": "用户不存在或已停用"})
                        return
                    if target_id != user["id"]:
                        require_permission(conn, user, "users.manage")
                    else:
                        old_password = str(payload.get("oldPassword") or "")
                        if target["password"] != old_password:
                            self.send_json(400, {"error": "旧密码不正确"})
                            return
                    conn.execute("update users set password = ? where id = ?", (new_password, target_id))
                    action = "重置用户密码" if target_id != user["id"] else "修改密码"
                    add_audit(conn, user["id"], action, f"{target['name']}（{target['username']}）")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/admin-requests":
                    if role_id_for_user(user) == "admin":
                        self.send_json(400, {"error": "当前用户已经是管理员"})
                        return
                    existing = conn.execute(
                        "select * from admin_requests where user_id = ? and status = '待处理'",
                        (user["id"],),
                    ).fetchone()
                    if existing:
                        self.send_json(200, get_state(conn, user))
                        return
                    reason = clean_docx_text(payload.get("reason") or "申请管理员权限")
                    conn.execute(
                        "insert into admin_requests values (?, ?, ?, ?, ?, ?, ?)",
                        (new_id("req"), user["id"], "待处理", reason, now_local(), "", ""),
                    )
                    add_audit(conn, user["id"], "申请管理员权限", reason)
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/admin-requests/approve":
                    require_permission(conn, user, "users.manage")
                    request_id = payload["requestId"]
                    request = conn.execute("select * from admin_requests where id = ?", (request_id,)).fetchone()
                    if not request:
                        self.send_json(404, {"error": "申请不存在"})
                        return
                    if request["status"] != "待处理":
                        self.send_json(200, get_state(conn, user))
                        return
                    target = conn.execute("select * from users where id = ?", (request["user_id"],)).fetchone()
                    if not target or not target["active"]:
                        self.send_json(400, {"error": "申请用户不存在或已停用"})
                        return
                    conn.execute("update users set role = 'admin', role_id = 'admin' where id = ?", (target["id"],))
                    conn.execute(
                        "update admin_requests set status = '已批准', handled_by = ?, handled_at = ? where id = ?",
                        (user["id"], now_local(), request_id),
                    )
                    add_audit(conn, user["id"], "批准管理员申请", f"{target['name']}（{target['username']}）")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/admin-requests/ignore":
                    require_permission(conn, user, "users.manage")
                    request_id = payload["requestId"]
                    request = conn.execute("select * from admin_requests where id = ?", (request_id,)).fetchone()
                    if not request:
                        self.send_json(404, {"error": "申请不存在"})
                        return
                    if request["status"] == "待处理":
                        conn.execute(
                            "update admin_requests set status = '已忽略', handled_by = ?, handled_at = ? where id = ?",
                            (user["id"], now_local(), request_id),
                        )
                        target = conn.execute("select * from users where id = ?", (request["user_id"],)).fetchone()
                        label = f"{target['name']}（{target['username']}）" if target else request["user_id"]
                        add_audit(conn, user["id"], "忽略管理员申请", label)
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/admin-requests/mark-read":
                    require_permission(conn, user, "users.manage")
                    pending = rows_to_list(
                        conn.execute(
                            """
                            select ar.*, u.name as user_name, u.username as username
                            from admin_requests ar
                            left join users u on u.id = ar.user_id
                            where ar.status = '待处理'
                            """
                        )
                    )
                    conn.execute(
                        "update admin_requests set status = '已忽略', handled_by = ?, handled_at = ? where status = '待处理'",
                        (user["id"], now_local()),
                    )
                    if pending:
                        names = "、".join((item.get("user_name") or item.get("username") or item["user_id"]) for item in pending[:8])
                        suffix = f" 等 {len(pending)} 条" if len(pending) > 8 else ""
                        add_audit(conn, user["id"], "一键已读管理员申请", f"{names}{suffix}")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/asset-requests":
                    asset_name = clean_docx_text(payload.get("assetName") or "")
                    if not asset_name:
                        self.send_json(400, {"error": "请填写申请资产名称"})
                        return
                    try:
                        quantity = max(1, int(payload.get("quantity") or 1))
                    except (TypeError, ValueError):
                        self.send_json(400, {"error": "数量必须是大于 0 的数字"})
                        return
                    conn.execute(
                        "insert into asset_requests values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (
                            new_id("areq"),
                            user["id"],
                            asset_name,
                            clean_docx_text(payload.get("category") or ""),
                            clean_docx_text(payload.get("spec") or ""),
                            quantity,
                            clean_docx_text(payload.get("reason") or ""),
                            "待处理",
                            now_local(),
                            "",
                            "",
                            "",
                        ),
                    )
                    add_audit(conn, user["id"], "申请资产", f"{asset_name} × {quantity}")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/asset-requests/approve":
                    require_permission(conn, user, "asset_requests.manage")
                    request_id = payload["requestId"]
                    request = conn.execute("select * from asset_requests where id = ?", (request_id,)).fetchone()
                    if not request:
                        self.send_json(404, {"error": "资产申请不存在"})
                        return
                    if request["status"] == "待处理":
                        requester = conn.execute("select * from users where id = ?", (request["user_id"],)).fetchone()
                        if role_id_for_user(user) == "department_head" and requester and requester["department"] != user["department"]:
                            self.send_json(403, {"error": "部门负责人只能审批本部门申请"})
                            return
                        note = clean_docx_text(payload.get("note") or "")
                        conn.execute(
                            "update asset_requests set status = '已批准', handled_by = ?, handled_at = ?, handle_note = ? where id = ?",
                            (user["id"], now_local(), note, request_id),
                        )
                        add_audit(conn, user["id"], "批准资产申请", f"{request['asset_name']} × {request['quantity']}")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/asset-requests/reject":
                    require_permission(conn, user, "asset_requests.manage")
                    request_id = payload["requestId"]
                    request = conn.execute("select * from asset_requests where id = ?", (request_id,)).fetchone()
                    if not request:
                        self.send_json(404, {"error": "资产申请不存在"})
                        return
                    if request["status"] == "待处理":
                        requester = conn.execute("select * from users where id = ?", (request["user_id"],)).fetchone()
                        if role_id_for_user(user) == "department_head" and requester and requester["department"] != user["department"]:
                            self.send_json(403, {"error": "部门负责人只能审批本部门申请"})
                            return
                        note = clean_docx_text(payload.get("note") or "")
                        conn.execute(
                            "update asset_requests set status = '已驳回', handled_by = ?, handled_at = ?, handle_note = ? where id = ?",
                            (user["id"], now_local(), note, request_id),
                        )
                        add_audit(conn, user["id"], "驳回资产申请", f"{request['asset_name']} × {request['quantity']}")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/purchase-wishes":
                    item_name = clean_docx_text(payload.get("itemName") or "")
                    if not item_name:
                        self.send_json(400, {"error": "请填写需要的设备名称"})
                        return
                    try:
                        quantity = max(1, int(payload.get("quantity") or 1))
                    except (TypeError, ValueError):
                        self.send_json(400, {"error": "数量必须是大于 0 的数字"})
                        return
                    unit = clean_docx_text(payload.get("unit") or "件") or "件"
                    unit_price = money_value(payload.get("unitPrice"), 0)
                    uplift_rate = max(0, money_value(payload.get("upliftRate"), 30))
                    total_amount = money_value(payload.get("totalAmount"), 0) or unit_price * quantity * (1 + uplift_rate / 100)
                    item_type = clean_docx_text(payload.get("itemType") or payload.get("category") or "")
                    priority = clean_docx_text(payload.get("priority") or "普通") or "普通"
                    if priority not in ("普通", "高", "紧急"):
                        priority = "普通"
                    conn.execute(
                        """
                        insert into purchase_wishes
                        (id, user_id, item_name, category, spec, unit, quantity, unit_price, total_amount, item_type,
                         priority, expected_time, reason, status, created_at, handled_by, handled_at, handle_note)
                        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            new_id("wish"),
                            user["id"],
                            item_name,
                            item_type,
                            clean_docx_text(payload.get("spec") or ""),
                            unit,
                            quantity,
                            unit_price,
                            total_amount,
                            item_type,
                            priority,
                            clean_docx_text(payload.get("expectedTime") or ""),
                            clean_docx_text(payload.get("reason") or ""),
                            "待采购",
                            now_local(),
                            "",
                            "",
                            "",
                        ),
                    )
                    add_audit(conn, user["id"], "提交采购需求", f"{item_name} × {quantity}，优先级：{priority}")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/purchase-wishes/update":
                    require_permission(conn, user, "purchase_wishes.manage")
                    wish_id = payload["wishId"]
                    wish = conn.execute("select * from purchase_wishes where id = ?", (wish_id,)).fetchone()
                    if not wish:
                        self.send_json(404, {"error": "采购需求不存在"})
                        return
                    status = clean_docx_text(payload.get("status") or "")
                    if status not in ("待采购", "已采纳", "暂缓", "已采购", "已关闭"):
                        self.send_json(400, {"error": "采购需求状态不正确"})
                        return
                    note = clean_docx_text(payload.get("note") or "")
                    conn.execute(
                        "update purchase_wishes set status = ?, handled_by = ?, handled_at = ?, handle_note = ? where id = ?",
                        (status, user["id"], now_local(), note, wish_id),
                    )
                    add_audit(conn, user["id"], "更新采购需求", f"{wish['item_name']}：{status}")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/claim-orders":
                    require_permission(conn, user, "orders.manage")
                    asset_id = str(payload.get("assetId", "")).strip()
                    target_user_id = str(payload.get("userId") or user["id"]).strip()
                    quantity = max(1, int(payload.get("quantity") or 1))
                    count_quantity = 0 if payload.get("countQuantity") is False or payload.get("countQuantity") == "0" or payload.get("skipQuantity") else 1
                    asset = conn.execute("select * from assets where id = ?", (asset_id,)).fetchone()
                    target_user = conn.execute("select * from users where id = ? and active = 1", (target_user_id,)).fetchone()
                    if not asset or not target_user:
                        self.send_json(404, {"error": "资产或领用人不存在"})
                        return
                    if count_quantity and quantity > int(asset["quantity"] or 0):
                        self.send_json(400, {"error": "领用数量不能大于当前台账数量；如不需要扣减数量，请勾选“不统计数量”"})
                        return
                    if asset["status"] in ("repair", "retired"):
                        self.send_json(400, {"error": "维修中或已报废资产不能办理领用"})
                        return
                    order_no = next_order_no(conn, "borrow_orders", "order_no", "LY")
                    now = now_local()
                    order_id = new_id("claim")
                    conn.execute(
                        """
                        insert into borrow_orders
                        (id, order_no, asset_id, borrower_id, quantity, count_quantity, operator_id, expected_return_date, actual_return_date,
                         status, approval_status, approver_id, approval_time, return_check, note, created_at, updated_at)
                        values (?, ?, ?, ?, ?, ?, ?, '', '', '已领用', '已批准', ?, ?, '', ?, ?, ?)
                        """,
                        (order_id, order_no, asset_id, target_user_id, quantity, count_quantity, user["id"], user["id"], now, clean_docx_text(payload.get("note") or ""), now, now),
                    )
                    next_quantity = max(0, int(asset["quantity"] or 0) - quantity) if count_quantity else int(asset["quantity"] or 0)
                    next_status = "checked_out" if next_quantity <= 0 or not count_quantity else asset["status"]
                    try:
                        updated = update_asset_fields(
                            conn,
                            asset_id,
                            {
                                "status": next_status,
                                "quantity": next_quantity,
                                "keeper_id": target_user_id,
                                "use_user_id": target_user_id,
                                "use_department": target_user["department"],
                                "location": clean_docx_text(payload.get("location") or asset["location"]),
                            },
                            user["id"],
                            "claim",
                            business_no=order_no,
                            source_type="claim_order",
                            source_id=order_id,
                            note=clean_docx_text(payload.get("note") or ("不统计数量" if not count_quantity else "")),
                        )
                    except ValueError as exc:
                        conn.execute("delete from borrow_orders where id = ?", (order_id,))
                        self.send_json(400, {"error": str(exc)})
                        return
                    audit_change(conn, user["id"], "办理领用单", "claim_order", order_id, f"{order_no}：{asset['name']} × {quantity} -> {target_user['name']}", before=asset, after=updated, business_no=order_no)
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/borrow-orders":
                    require_permission(conn, user, "orders.manage")
                    asset_id = str(payload.get("assetId", "")).strip()
                    borrower_id = str(payload.get("borrowerId") or payload.get("userId") or user["id"]).strip()
                    quantity = max(1, int(payload.get("quantity") or 1))
                    count_quantity = 0 if payload.get("countQuantity") is False or payload.get("countQuantity") == "0" or payload.get("skipQuantity") else 1
                    asset = conn.execute("select * from assets where id = ?", (asset_id,)).fetchone()
                    borrower = conn.execute("select * from users where id = ? and active = 1", (borrower_id,)).fetchone()
                    if not asset or not borrower:
                        self.send_json(404, {"error": "资产或借用人不存在"})
                        return
                    if count_quantity and quantity > int(asset["quantity"] or 0):
                        self.send_json(400, {"error": "借用数量不能大于当前台账数量；如不需要扣减数量，请勾选“不统计数量”"})
                        return
                    if asset["status"] in ("repair", "retired"):
                        self.send_json(400, {"error": "维修中或已报废资产不能办理借用"})
                        return
                    order_no = next_order_no(conn, "borrow_orders", "order_no", "JY")
                    now = now_local()
                    order_id = new_id("borrow")
                    conn.execute(
                        """
                        insert into borrow_orders
                        (id, order_no, asset_id, borrower_id, quantity, count_quantity, operator_id, expected_return_date, actual_return_date,
                         status, approval_status, approver_id, approval_time, return_check, note, created_at, updated_at)
                        values (?, ?, ?, ?, ?, ?, ?, ?, '', '借用中', '已批准', ?, ?, '', ?, ?, ?)
                        """,
                        (
                            order_id,
                            order_no,
                            asset_id,
                            borrower_id,
                            quantity,
                            count_quantity,
                            user["id"],
                            clean_date_text(payload.get("expectedReturnDate") or ""),
                            user["id"],
                            now,
                            clean_docx_text(payload.get("note") or ""),
                            now,
                            now,
                        ),
                    )
                    next_quantity = max(0, int(asset["quantity"] or 0) - quantity) if count_quantity else int(asset["quantity"] or 0)
                    next_status = "checked_out" if next_quantity <= 0 or not count_quantity else asset["status"]
                    try:
                        updated = update_asset_fields(
                            conn,
                            asset_id,
                            {
                                "status": next_status,
                                "quantity": next_quantity,
                                "keeper_id": borrower_id,
                                "use_user_id": borrower_id,
                                "use_department": borrower["department"],
                                "location": clean_docx_text(payload.get("location") or asset["location"]),
                            },
                            user["id"],
                            "borrow",
                            business_no=order_no,
                            source_type="borrow_order",
                            source_id=order_id,
                            note=clean_docx_text(payload.get("note") or ("不统计数量" if not count_quantity else "")),
                        )
                    except ValueError as exc:
                        conn.execute("delete from borrow_orders where id = ?", (order_id,))
                        self.send_json(400, {"error": str(exc)})
                        return
                    audit_change(conn, user["id"], "办理借用单", "borrow_order", order_id, f"{order_no}：{asset['name']} × {quantity} -> {borrower['name']}", before=asset, after=updated, business_no=order_no)
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/borrow-orders/return":
                    require_permission(conn, user, "orders.manage")
                    order_id = str(payload.get("orderId", "")).strip()
                    order = conn.execute("select * from borrow_orders where id = ?", (order_id,)).fetchone()
                    if not order:
                        self.send_json(404, {"error": "借用单不存在"})
                        return
                    if order["status"] != "借用中":
                        self.send_json(400, {"error": "只有借用中的单据可以办理归还"})
                        return
                    asset = conn.execute("select * from assets where id = ?", (order["asset_id"],)).fetchone()
                    if not asset:
                        self.send_json(404, {"error": "资产不存在"})
                        return
                    now = now_local()
                    conn.execute(
                        """
                        update borrow_orders
                        set actual_return_date = ?, status = '已归还', return_check = ?, updated_at = ?
                        where id = ?
                        """,
                        (clean_date_text(payload.get("actualReturnDate") or now), clean_docx_text(payload.get("returnCheck") or "已验收"), now, order_id),
                    )
                    return_quantity = int(order["quantity"] or 1) if int(order["count_quantity"] or 0) else 0
                    try:
                        updated = update_asset_fields(
                            conn,
                            order["asset_id"],
                            {
                                "status": "in_stock",
                                "quantity": int(asset["quantity"] or 0) + return_quantity,
                                "location": clean_docx_text(payload.get("location") or asset["location"]),
                            },
                            user["id"],
                            "return",
                            business_no=order["order_no"],
                            source_type="borrow_order",
                            source_id=order_id,
                            note=clean_docx_text(payload.get("returnCheck") or "归还验收"),
                        )
                    except ValueError as exc:
                        self.send_json(400, {"error": str(exc)})
                        return
                    audit_change(conn, user["id"], "办理归还", "borrow_order", order_id, f"{order['order_no']}：{asset['name']}", before=asset, after=updated, business_no=order["order_no"])
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/transfer-orders":
                    require_permission(conn, user, "orders.manage")
                    asset_id = str(payload.get("assetId", "")).strip()
                    asset = conn.execute("select * from assets where id = ?", (asset_id,)).fetchone()
                    if not asset:
                        self.send_json(404, {"error": "资产不存在"})
                        return
                    new_keeper_id = str(payload.get("newKeeperId") or asset["keeper_id"]).strip()
                    new_keeper = conn.execute("select * from users where id = ? and active = 1", (new_keeper_id,)).fetchone()
                    if not new_keeper:
                        self.send_json(400, {"error": "新责任人不存在或已停用"})
                        return
                    new_department = clean_docx_text(payload.get("newDepartment") or new_keeper["department"])
                    new_location = clean_docx_text(payload.get("newLocation") or asset["location"])
                    order_no = next_order_no(conn, "transfer_orders", "order_no", "DB")
                    now = now_local()
                    order_id = new_id("transfer")
                    conn.execute(
                        """
                        insert into transfer_orders
                        (id, order_no, asset_id, old_department, new_department, old_location, new_location,
                         old_keeper_id, new_keeper_id, reason, transfer_date, status, operator_id, approver_id, created_at, updated_at)
                        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '已完成', ?, ?, ?, ?)
                        """,
                        (
                            order_id,
                            order_no,
                            asset_id,
                            asset["use_department"],
                            new_department,
                            asset["location"],
                            new_location,
                            asset["keeper_id"],
                            new_keeper_id,
                            clean_docx_text(payload.get("reason") or ""),
                            clean_date_text(payload.get("transferDate") or now),
                            user["id"],
                            user["id"],
                            now,
                            now,
                        ),
                    )
                    try:
                        updated = update_asset_fields(
                            conn,
                            asset_id,
                            {
                                "keeper_id": new_keeper_id,
                                "use_user_id": new_keeper_id,
                                "use_department": new_department,
                                "location": new_location,
                            },
                            user["id"],
                            "transfer",
                            business_no=order_no,
                            source_type="transfer_order",
                            source_id=order_id,
                            note=clean_docx_text(payload.get("reason") or ""),
                        )
                    except ValueError as exc:
                        conn.execute("delete from transfer_orders where id = ?", (order_id,))
                        self.send_json(400, {"error": str(exc)})
                        return
                    audit_change(conn, user["id"], "办理调拨", "transfer_order", order_id, f"{order_no}：{asset['name']} -> {new_location}", before=asset, after=updated, business_no=order_no)
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/repair-orders":
                    require_permission(conn, user, "orders.manage")
                    asset_id = str(payload.get("assetId", "")).strip()
                    asset = conn.execute("select * from assets where id = ?", (asset_id,)).fetchone()
                    if not asset:
                        self.send_json(404, {"error": "资产不存在"})
                        return
                    ok, message = status_transition_allowed(asset["status"], "repair", action="repair")
                    if not ok:
                        self.send_json(400, {"error": message})
                        return
                    order_no = next_order_no(conn, "repair_orders", "order_no", "WX")
                    now = now_local()
                    order_id = new_id("repair")
                    conn.execute(
                        """
                        insert into repair_orders
                        (id, order_no, asset_id, reporter_id, repairer, status, fault_desc, cost, result,
                         start_time, end_time, operator_id, created_at, updated_at)
                        values (?, ?, ?, ?, ?, '维修中', ?, ?, '', ?, '', ?, ?, ?)
                        """,
                        (
                            order_id,
                            order_no,
                            asset_id,
                            str(payload.get("reporterId") or user["id"]),
                            clean_docx_text(payload.get("repairer") or ""),
                            clean_docx_text(payload.get("faultDesc") or ""),
                            money_value(payload.get("cost"), 0),
                            now,
                            user["id"],
                            now,
                            now,
                        ),
                    )
                    try:
                        updated = update_asset_fields(conn, asset_id, {"status": "repair"}, user["id"], "repair", business_no=order_no, source_type="repair_order", source_id=order_id, note=clean_docx_text(payload.get("faultDesc") or ""))
                    except ValueError as exc:
                        conn.execute("delete from repair_orders where id = ?", (order_id,))
                        self.send_json(400, {"error": str(exc)})
                        return
                    audit_change(conn, user["id"], "创建维修单", "repair_order", order_id, f"{order_no}：{asset['name']}", before=asset, after=updated, business_no=order_no)
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/repair-orders/finish":
                    require_permission(conn, user, "orders.manage")
                    order_id = str(payload.get("orderId", "")).strip()
                    order = conn.execute("select * from repair_orders where id = ?", (order_id,)).fetchone()
                    if not order:
                        self.send_json(404, {"error": "维修单不存在"})
                        return
                    asset = conn.execute("select * from assets where id = ?", (order["asset_id"],)).fetchone()
                    now = now_local()
                    conn.execute(
                        "update repair_orders set status = '已完成', result = ?, cost = ?, end_time = ?, updated_at = ? where id = ?",
                        (clean_docx_text(payload.get("result") or "维修完成"), money_value(payload.get("cost"), order["cost"]), now, now, order_id),
                    )
                    try:
                        updated = update_asset_fields(conn, order["asset_id"], {"status": "in_stock"}, user["id"], "repair_finish", business_no=order["order_no"], source_type="repair_order", source_id=order_id, note=clean_docx_text(payload.get("result") or "维修完成"))
                    except ValueError as exc:
                        self.send_json(400, {"error": str(exc)})
                        return
                    audit_change(conn, user["id"], "完成维修", "repair_order", order_id, f"{order['order_no']}：{asset['name'] if asset else order['asset_id']}", before=asset, after=updated, business_no=order["order_no"])
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/scrap-orders":
                    require_permission(conn, user, "orders.manage")
                    asset_id = str(payload.get("assetId", "")).strip()
                    asset = conn.execute("select * from assets where id = ?", (asset_id,)).fetchone()
                    if not asset:
                        self.send_json(404, {"error": "资产不存在"})
                        return
                    ok, message = status_transition_allowed(asset["status"], "retired", action="scrap")
                    if not ok:
                        self.send_json(400, {"error": message})
                        return
                    order_no = next_order_no(conn, "scrap_orders", "order_no", "BF")
                    now = now_local()
                    order_id = new_id("scrap")
                    conn.execute(
                        """
                        insert into scrap_orders
                        (id, order_no, asset_id, applicant_id, reason, residual_value, scrap_date, status,
                         approval_status, approver_id, approval_time, operator_id, created_at, updated_at)
                        values (?, ?, ?, ?, ?, ?, ?, '已报废', '已批准', ?, ?, ?, ?, ?)
                        """,
                        (
                            order_id,
                            order_no,
                            asset_id,
                            str(payload.get("applicantId") or user["id"]),
                            clean_docx_text(payload.get("reason") or ""),
                            money_value(payload.get("residualValue"), 0),
                            clean_date_text(payload.get("scrapDate") or now),
                            user["id"],
                            now,
                            user["id"],
                            now,
                            now,
                        ),
                    )
                    try:
                        updated = update_asset_fields(conn, asset_id, {"status": "retired"}, user["id"], "scrap", business_no=order_no, source_type="scrap_order", source_id=order_id, note=clean_docx_text(payload.get("reason") or ""))
                    except ValueError as exc:
                        conn.execute("delete from scrap_orders where id = ?", (order_id,))
                        self.send_json(400, {"error": str(exc)})
                        return
                    audit_change(conn, user["id"], "办理报废", "scrap_order", order_id, f"{order_no}：{asset['name']}", before=asset, after=updated, business_no=order_no)
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/inventory-checks":
                    require_permission(conn, user, "checks.manage")
                    scope_type = str(payload.get("scopeType", "all")).strip() or "all"
                    scope_value = str(payload.get("scopeValue", "")).strip()
                    assets_query = "select * from assets"
                    params = []
                    if scope_type == "location" and scope_value:
                        assets_query += " where location = ?"
                        params.append(scope_value)
                    elif scope_type == "category" and scope_value:
                        assets_query += " where category = ?"
                        params.append(scope_value)
                    elif scope_type == "keeper" and scope_value:
                        assets_query += " where keeper_id = ?"
                        params.append(scope_value)
                    elif scope_type == "status" and scope_value:
                        assets_query += " where status = ?"
                        params.append(scope_value)
                    assets_query += " order by code"
                    check_assets = rows_to_list(conn.execute(assets_query, params))
                    if not check_assets:
                        self.send_json(400, {"error": "当前盘点范围内没有资产"})
                        return
                    task_id = new_id("check")
                    check_no = next_check_no(conn)
                    now = now_local()
                    conn.execute(
                        """
                        insert into inventory_check_tasks
                        (id, check_no, scope_type, scope_value, owner_id, start_time, end_time, status, remark, created_at)
                        values (?, ?, ?, ?, ?, ?, '', '进行中', ?, ?)
                        """,
                        (task_id, check_no, scope_type, scope_value, payload.get("ownerId") or user["id"], now, str(payload.get("remark", "")).strip(), now),
                    )
                    for asset in check_assets:
                        conn.execute(
                            """
                            insert into inventory_check_items
                            (id, task_id, asset_id, system_location, actual_location, system_status, actual_status,
                             system_keeper_id, actual_keeper_id, checked, diff_type, remark)
                            values (?, ?, ?, ?, '', ?, '', ?, '', 0, '未盘点', '')
                            """,
                            (new_id("checkitem"), task_id, asset["id"], asset["location"], asset["status"], asset["keeper_id"]),
                        )
                    add_audit(conn, user["id"], "创建盘点任务", f"{check_no}，范围 {scope_type}:{scope_value or '全部'}，{len(check_assets)} 项")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/inventory-checks/item":
                    require_permission(conn, user, "checks.manage")
                    item_id = payload["itemId"]
                    item = conn.execute("select * from inventory_check_items where id = ?", (item_id,)).fetchone()
                    if not item:
                        self.send_json(404, {"error": "盘点明细不存在"})
                        return
                    task = conn.execute("select * from inventory_check_tasks where id = ?", (item["task_id"],)).fetchone()
                    if not task or task["status"] == "已完成":
                        self.send_json(400, {"error": "盘点任务已完成，不能继续修改"})
                        return
                    actual_location = str(payload.get("actualLocation", "")).strip()
                    actual_status = str(payload.get("actualStatus", "")).strip()
                    actual_keeper_id = str(payload.get("actualKeeperId", "")).strip()
                    diffs = []
                    if actual_location and actual_location != item["system_location"]:
                        diffs.append("位置不符")
                    if actual_status and actual_status != item["system_status"]:
                        diffs.append("状态不符")
                    if actual_keeper_id and actual_keeper_id != item["system_keeper_id"]:
                        diffs.append("责任人不符")
                    diff_type = "正常" if not diffs else "、".join(diffs)
                    conn.execute(
                        """
                        update inventory_check_items
                        set actual_location = ?, actual_status = ?, actual_keeper_id = ?, checked = 1, diff_type = ?, remark = ?
                        where id = ?
                        """,
                        (actual_location, actual_status, actual_keeper_id, diff_type, str(payload.get("remark", "")).strip(), item_id),
                    )
                    add_audit(conn, user["id"], "录入盘点结果", f"{task['check_no']}：{diff_type}")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/inventory-checks/scan":
                    require_permission(conn, user, "checks.manage")
                    task_id = str(payload.get("taskId", "")).strip()
                    scan_text = str(payload.get("scanText", "")).strip()
                    task = conn.execute("select * from inventory_check_tasks where id = ?", (task_id,)).fetchone()
                    if not task or task["status"] == "已完成":
                        self.send_json(400, {"error": "盘点任务不存在或已完成"})
                        return
                    candidates = [scan_text]
                    try:
                        parsed_url = urlparse(scan_text)
                        params = parse_qs(parsed_url.query)
                        candidates.extend(params.get("asset", []))
                    except Exception:
                        pass
                    asset = None
                    for candidate in [item for item in candidates if item]:
                        asset = conn.execute("select * from assets where id = ? or code = ?", (candidate, candidate)).fetchone()
                        if asset:
                            break
                    if not asset:
                        self.send_json(404, {"error": "没有找到扫码对应的资产"})
                        return
                    item = conn.execute("select * from inventory_check_items where task_id = ? and asset_id = ?", (task_id, asset["id"])).fetchone()
                    if not item:
                        self.send_json(400, {"error": "该资产不在当前盘点任务范围内，可使用盘盈录入"})
                        return
                    actual_location = str(payload.get("actualLocation", "")).strip()
                    actual_status = str(payload.get("actualStatus", "")).strip()
                    actual_keeper_id = str(payload.get("actualKeeperId", "")).strip()
                    diffs = []
                    if actual_location and actual_location != item["system_location"]:
                        diffs.append("位置不符")
                    if actual_status and actual_status != item["system_status"]:
                        diffs.append("状态不符")
                    if actual_keeper_id and actual_keeper_id != item["system_keeper_id"]:
                        diffs.append("责任人不符")
                    diff_type = "正常" if not diffs else "、".join(diffs)
                    conn.execute(
                        """
                        update inventory_check_items
                        set actual_location = ?, actual_status = ?, actual_keeper_id = ?, checked = 1, diff_type = ?, remark = ?
                        where id = ?
                        """,
                        (actual_location, actual_status, actual_keeper_id, diff_type, clean_docx_text(payload.get("remark") or "扫码盘点"), item["id"]),
                    )
                    add_audit(conn, user["id"], "扫码盘点", f"{task['check_no']}：{asset['code']} {diff_type}")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/inventory-checks/surplus":
                    require_permission(conn, user, "checks.manage")
                    task_id = str(payload.get("taskId", "")).strip()
                    task = conn.execute("select * from inventory_check_tasks where id = ?", (task_id,)).fetchone()
                    if not task or task["status"] == "已完成":
                        self.send_json(400, {"error": "盘点任务不存在或已完成"})
                        return
                    asset_code = str(payload.get("code") or "").strip() or next_asset_code(conn, payload.get("category", ""))
                    duplicate = conn.execute("select id from assets where code = ?", (asset_code,)).fetchone()
                    if duplicate:
                        self.send_json(400, {"error": "盘盈资产编号已存在"})
                        return
                    ensure_asset_category(conn, payload.get("category") or "盘盈资产")
                    values = asset_payload_values({**payload, "code": asset_code, "status": "in_stock"}, user)
                    now = now_local()
                    asset_id = new_id("asset")
                    conn.execute(
                        """
                        insert into assets
                        (id, code, name, category, spec, quantity, safe_stock, brand, unit, unit_price, total_amount,
                         purchase_date, inbound_date, supplier, use_department, use_user_id, source, creator_id,
                         created_at, updated_at, location, keeper_id, status, remark)
                        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            asset_id, asset_code, values["name"], values["category"], values["spec"], values["quantity"],
                            values["safe_stock"], values["brand"], values["unit"], values["unit_price"], values["total_amount"],
                            values["purchase_date"], values["inbound_date"], values["supplier"], values["use_department"],
                            values["use_user_id"], values["source"] or "盘盈入账", user["id"], now, now, values["location"],
                            values["keeper_id"], "in_stock", values["remark"],
                        ),
                    )
                    conn.execute(
                        """
                        insert into inventory_check_items
                        (id, task_id, asset_id, system_location, actual_location, system_status, actual_status,
                         system_keeper_id, actual_keeper_id, checked, diff_type, remark)
                        values (?, ?, ?, '', ?, '', 'in_stock', '', ?, 1, '盘盈', ?)
                        """,
                        (new_id("checkitem"), task_id, asset_id, values["location"], values["keeper_id"], clean_docx_text(payload.get("remark") or "盘盈录入")),
                    )
                    add_stock_record(conn, asset_id, "盘盈入账", values["quantity"], 0, values["quantity"], user["id"], "inventory_check", task_id, "盘盈录入")
                    add_flow_log(conn, asset_id, "inventory_surplus", user["id"], before="", after=conn.execute("select * from assets where id = ?", (asset_id,)).fetchone(), business_no=task["check_no"], source_type="inventory_check", source_id=task_id, note="盘盈录入")
                    add_audit(conn, user["id"], "盘盈录入", f"{task['check_no']}：{values['name']}（{asset_code}）")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/inventory-checks/complete":
                    require_permission(conn, user, "checks.manage")
                    task_id = payload["taskId"]
                    task = conn.execute("select * from inventory_check_tasks where id = ?", (task_id,)).fetchone()
                    if not task:
                        self.send_json(404, {"error": "盘点任务不存在"})
                        return
                    total = conn.execute("select count(*) from inventory_check_items where task_id = ?", (task_id,)).fetchone()[0]
                    checked = conn.execute("select count(*) from inventory_check_items where task_id = ? and checked = 1", (task_id,)).fetchone()[0]
                    unchecked = total - checked
                    if unchecked:
                        conn.execute("update inventory_check_items set diff_type = '盘亏' where task_id = ? and checked = 0", (task_id,))
                    conn.execute("update inventory_check_tasks set status = '已完成', end_time = ? where id = ?", (now_local(), task_id))
                    add_audit(conn, user["id"], "完成盘点任务", f"{task['check_no']}，已盘 {checked} 项，盘亏 {unchecked} 项")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/device-groups/assign":
                    require_permission(conn, user, "base_data.manage")
                    group_name = str(payload.get("groupName", "")).strip()
                    family_id = str(payload.get("familyId", "")).strip()
                    source_keys = []
                    for source_key in payload.get("sourceKeys", []):
                        clean = str(source_key).strip()
                        if clean and clean not in source_keys:
                            source_keys.append(clean)
                    if not group_name:
                        self.send_json(400, {"error": "请填写标准归类名称"})
                        return
                    if not source_keys:
                        self.send_json(400, {"error": "请先选择要归到一起的设备组"})
                        return
                    now = now_local()
                    for source_key in source_keys:
                        conn.execute(
                            """
                            insert into device_group_rules
                            (id, source_key, group_name, family_id, active, created_by, created_at, updated_at)
                            values (?, ?, ?, ?, 1, ?, ?, ?)
                            on conflict(source_key) do update set
                              group_name = excluded.group_name,
                              family_id = excluded.family_id,
                              active = 1,
                              updated_at = excluded.updated_at
                            """,
                            (new_id("dgrp"), source_key, group_name, family_id, user["id"], now, now),
                        )
                    add_audit(conn, user["id"], "更新设备手动归类", f"{group_name}：{len(source_keys)} 个设备组")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/device-groups/unassign":
                    require_permission(conn, user, "base_data.manage")
                    source_keys = []
                    for source_key in payload.get("sourceKeys", []):
                        clean = str(source_key).strip()
                        if clean and clean not in source_keys:
                            source_keys.append(clean)
                    group_name = str(payload.get("groupName", "")).strip()
                    if not source_keys and not group_name:
                        self.send_json(400, {"error": "请指定要取消的设备归类"})
                        return
                    now = now_local()
                    if source_keys:
                        placeholders = ",".join("?" for _ in source_keys)
                        conn.execute(
                            f"update device_group_rules set active = 0, updated_at = ? where source_key in ({placeholders})",
                            [now] + source_keys,
                        )
                        detail = f"{len(source_keys)} 个设备组"
                    else:
                        conn.execute(
                            "update device_group_rules set active = 0, updated_at = ? where group_name = ?",
                            (now, group_name),
                        )
                        detail = group_name
                    add_audit(conn, user["id"], "取消设备手动归类", detail)
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/settings/departments":
                    require_permission(conn, user, "settings.manage")
                    names = []
                    for name in payload.get("departments", []):
                        clean = str(name).strip()
                        if clean and clean not in names:
                            names.append(clean)
                    if not names:
                        self.send_json(400, {"error": "至少保留一个部门"})
                        return
                    conn.execute("update departments set active = 0")
                    for name in names:
                        conn.execute(
                            "insert into departments values (?, ?, 1) on conflict(name) do update set active = 1",
                            (new_id("dept"), name),
                        )
                    add_audit(conn, user["id"], "更新系统设置", f"部门设置：{'、'.join(names)}")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/assets/categories":
                    require_permission(conn, user, "base_data.manage")
                    names = []
                    for name in payload.get("categories", []):
                        clean = str(name).strip()
                        if clean and clean not in names:
                            names.append(clean)
                    if not names:
                        self.send_json(400, {"error": "至少保留一个类别"})
                        return
                    conn.execute("update asset_categories set active = 0")
                    now = now_local()
                    for name in names:
                        conn.execute(
                            """
                            insert into asset_categories
                            (id, name, parent_id, code, category_type, active, created_at, updated_at)
                            values (?, ?, '', '', ?, 1, ?, ?)
                            on conflict(name) do update set active = 1, updated_at = excluded.updated_at
                            """,
                            (new_id("cat"), name, "耗材" if is_consumable_text(name) else "固定资产", now, now),
                        )
                    add_audit(conn, user["id"], "更新资产类别", f"类别设置：{'、'.join(names)}")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/assets/categories/add":
                    require_permission(conn, user, "base_data.manage")
                    name = str(payload.get("category") or payload.get("name") or "").strip()
                    if not name:
                        self.send_json(400, {"error": "类别名称不能为空"})
                        return
                    now = now_local()
                    conn.execute(
                        """
                        insert into asset_categories
                        (id, name, parent_id, code, category_type, active, created_at, updated_at)
                        values (?, ?, ?, ?, ?, 1, ?, ?)
                        on conflict(name) do update set
                          parent_id = excluded.parent_id,
                          code = excluded.code,
                          category_type = excluded.category_type,
                          active = 1,
                          updated_at = excluded.updated_at
                        """,
                        (
                            new_id("cat"),
                            name,
                            str(payload.get("parentId", "")).strip(),
                            str(payload.get("code", "")).strip().upper(),
                            str(payload.get("categoryType", "")).strip() or ("耗材" if is_consumable_text(name) else "固定资产"),
                            now,
                            now,
                        ),
                    )
                    add_audit(conn, user["id"], "新增资产类别", name)
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/assets/categories/update":
                    require_permission(conn, user, "base_data.manage")
                    category_id = str(payload.get("categoryId", "")).strip()
                    name = str(payload.get("name", "")).strip()
                    if not category_id or not name:
                        self.send_json(400, {"error": "类别名称不能为空"})
                        return
                    category = conn.execute("select * from asset_categories where id = ?", (category_id,)).fetchone()
                    if not category:
                        self.send_json(404, {"error": "类别不存在"})
                        return
                    duplicate = conn.execute("select id from asset_categories where name = ? and id <> ? and active = 1", (name, category_id)).fetchone()
                    if duplicate:
                        self.send_json(400, {"error": f"类别“{name}”已存在"})
                        return
                    parent_id = str(payload.get("parentId", "")).strip()
                    if parent_id == category_id:
                        self.send_json(400, {"error": "父级类别不能选择自己"})
                        return
                    conn.execute(
                        """
                        update asset_categories
                        set name = ?, parent_id = ?, code = ?, category_type = ?, updated_at = ?
                        where id = ?
                        """,
                        (
                            name,
                            parent_id,
                            str(payload.get("code", "")).strip().upper(),
                            str(payload.get("categoryType", "")).strip() or "固定资产",
                            now_local(),
                            category_id,
                        ),
                    )
                    if category["name"] != name:
                        conn.execute("update assets set category = ? where category = ?", (name, category["name"]))
                        conn.execute("update asset_requests set category = ? where category = ?", (name, category["name"]))
                        conn.execute("update purchase_wishes set category = ? where category = ?", (name, category["name"]))
                    add_audit(conn, user["id"], "编辑资产类别", f"{category['name']} -> {name}")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/assets/categories/rename":
                    require_permission(conn, user, "base_data.manage")
                    old_name = str(payload.get("oldName", "")).strip()
                    new_name = str(payload.get("newName", "")).strip()
                    if not old_name or not new_name:
                        self.send_json(400, {"error": "类别名称不能为空"})
                        return
                    if old_name == new_name:
                        self.send_json(200, get_state(conn, user))
                        return
                    duplicate = conn.execute(
                        "select id from asset_categories where name = ? and active = 1",
                        (new_name,),
                    ).fetchone()
                    if duplicate:
                        self.send_json(400, {"error": f"类别“{new_name}”已存在"})
                        return
                    existing = conn.execute("select id from asset_categories where name = ?", (old_name,)).fetchone()
                    if existing:
                        conn.execute("update asset_categories set name = ?, active = 1 where name = ?", (new_name, old_name))
                    else:
                        ensure_asset_category(conn, new_name)
                    conn.execute("update assets set category = ? where category = ?", (new_name, old_name))
                    conn.execute("update asset_requests set category = ? where category = ?", (new_name, old_name))
                    conn.execute("update purchase_wishes set category = ? where category = ?", (new_name, old_name))
                    add_audit(conn, user["id"], "编辑资产类别", f"{old_name} -> {new_name}")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/locations/add":
                    require_permission(conn, user, "base_data.manage")
                    name = str(payload.get("name", "")).strip()
                    if not name:
                        self.send_json(400, {"error": "位置名称不能为空"})
                        return
                    now = now_local()
                    conn.execute(
                        """
                        insert into locations
                        (id, name, parent_id, type, code, manager_id, remark, active, created_at, updated_at)
                        values (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                        on conflict(name) do update set
                          parent_id = excluded.parent_id,
                          type = excluded.type,
                          code = excluded.code,
                          manager_id = excluded.manager_id,
                          remark = excluded.remark,
                          active = 1,
                          updated_at = excluded.updated_at
                        """,
                        (
                            new_id("loc"),
                            name,
                            str(payload.get("parentId", "")).strip(),
                            str(payload.get("type", "仓库")).strip() or "仓库",
                            str(payload.get("code", "")).strip(),
                            str(payload.get("managerId", "")).strip(),
                            str(payload.get("remark", "")).strip(),
                            now,
                            now,
                        ),
                    )
                    add_audit(conn, user["id"], "新增位置", name)
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/locations/update":
                    require_permission(conn, user, "base_data.manage")
                    location_id = str(payload.get("locationId", "")).strip()
                    name = str(payload.get("name", "")).strip()
                    if not location_id or not name:
                        self.send_json(400, {"error": "位置名称不能为空"})
                        return
                    location = conn.execute("select * from locations where id = ?", (location_id,)).fetchone()
                    if not location:
                        self.send_json(404, {"error": "位置不存在"})
                        return
                    parent_id = str(payload.get("parentId", "")).strip()
                    if parent_id == location_id:
                        self.send_json(400, {"error": "父级位置不能选择自己"})
                        return
                    duplicate = conn.execute("select id from locations where name = ? and id <> ? and active = 1", (name, location_id)).fetchone()
                    if duplicate:
                        self.send_json(400, {"error": f"位置“{name}”已存在"})
                        return
                    conn.execute(
                        """
                        update locations
                        set name = ?, parent_id = ?, type = ?, code = ?, manager_id = ?, remark = ?, updated_at = ?
                        where id = ?
                        """,
                        (
                            name,
                            parent_id,
                            str(payload.get("type", "仓库")).strip() or "仓库",
                            str(payload.get("code", "")).strip(),
                            str(payload.get("managerId", "")).strip(),
                            str(payload.get("remark", "")).strip(),
                            now_local(),
                            location_id,
                        ),
                    )
                    if location["name"] != name:
                        conn.execute("update assets set location = ? where location = ?", (name, location["name"]))
                    add_audit(conn, user["id"], "编辑位置", f"{location['name']} -> {name}")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/settings/multi-department":
                    require_permission(conn, user, "settings.manage")
                    enabled = "1" if payload.get("enabled") else "0"
                    conn.execute(
                        "insert into system_settings values ('multi_department_enabled', ?) on conflict(key) do update set value = excluded.value",
                        (enabled,),
                    )
                    add_audit(conn, user["id"], "更新系统设置", f"多部门功能：{'开启' if enabled == '1' else '关闭'}")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/settings/developer-mode":
                    require_permission(conn, user, "settings.manage")
                    enabled = "1" if payload.get("enabled") else "0"
                    conn.execute(
                        "insert into system_settings values ('developer_mode_enabled', ?) on conflict(key) do update set value = excluded.value",
                        (enabled,),
                    )
                    if enabled != "1":
                        conn.execute(
                            "insert into system_settings values ('admin_prefill_enabled', '0') on conflict(key) do update set value = '0'"
                        )
                    add_audit(conn, user["id"], "更新系统设置", f"开发者模式：{'开启' if enabled == '1' else '关闭'}")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/settings/admin-prefill":
                    require_permission(conn, user, "settings.manage")
                    developer_mode = conn.execute("select value from system_settings where key = 'developer_mode_enabled'").fetchone()
                    if not developer_mode or developer_mode["value"] != "1":
                        self.send_json(400, {"error": "请先在设置中开启开发者模式"})
                        return
                    enabled = "1" if payload.get("enabled") else "0"
                    conn.execute(
                        "insert into system_settings values ('admin_prefill_enabled', ?) on conflict(key) do update set value = excluded.value",
                        (enabled,),
                    )
                    add_audit(conn, user["id"], "更新系统设置", f"默认填写管理员密码：{'开启' if enabled == '1' else '关闭'}")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/settings/asset-detail-label":
                    require_permission(conn, user, "settings.manage")
                    enabled = "1" if payload.get("enabled") else "0"
                    set_setting(conn, "asset_detail_label_enabled", enabled)
                    add_audit(conn, user["id"], "Update settings", f"asset_detail_label_enabled: {'on' if enabled == '1' else 'off'}")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/settings/paper-module":
                    require_permission(conn, user, "settings.manage")
                    enabled = "1" if payload.get("enabled") else "0"
                    set_setting(conn, "paper_module_enabled", enabled)
                    add_audit(conn, user["id"], "Update settings", f"paper_module_enabled: {'on' if enabled == '1' else 'off'}")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/settings/login-background":
                    require_permission(conn, user, "settings.manage")
                    try:
                        image = valid_login_background(payload.get("image", ""))
                    except ValueError as exc:
                        self.send_json(400, {"error": str(exc)})
                        return
                    set_setting(conn, "login_background_image", image)
                    add_audit(conn, user["id"], "更新系统设置", "登录展示图已更新" if image else "登录展示图已恢复默认")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/settings/print-template":
                    require_permission(conn, user, "settings.manage")
                    kind = str(payload.get("kind") or "").strip()
                    if kind not in ("asset", "consumable"):
                        self.send_json(400, {"error": "模板类型不正确"})
                        return
                    try:
                        file_name, content_base64 = valid_docx_template(payload.get("fileName"), payload.get("contentBase64"))
                    except ValueError as exc:
                        self.send_json(400, {"error": str(exc)})
                        return
                    if kind == "asset":
                        set_setting(conn, "print_asset_template_name", file_name)
                        set_setting(conn, "print_asset_template_content", content_base64)
                        label = "资产领用打印模板"
                    else:
                        set_setting(conn, "print_consumable_template_name", file_name)
                        set_setting(conn, "print_consumable_template_content", content_base64)
                        label = "耗材领用打印模板"
                    add_audit(conn, user["id"], "更新打印设置", f"{label}：{file_name}")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/settings/print-template/reset":
                    require_permission(conn, user, "settings.manage")
                    kind = str(payload.get("kind") or "").strip()
                    if kind not in ("asset", "consumable"):
                        self.send_json(400, {"error": "模板类型不正确"})
                        return
                    if kind == "asset":
                        set_setting(conn, "print_asset_template_name", "")
                        set_setting(conn, "print_asset_template_content", "")
                        label = "资产领用打印模板"
                    else:
                        set_setting(conn, "print_consumable_template_name", "")
                        set_setting(conn, "print_consumable_template_content", "")
                        label = "耗材领用打印模板"
                    add_audit(conn, user["id"], "更新打印设置", f"{label}已恢复内置无隐私模板")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/settings/service-port":
                    require_permission(conn, user, "settings.manage")
                    port = valid_port(payload.get("port"))
                    if not port:
                        self.send_json(400, {"error": "端口必须是 1 到 65535 之间的数字"})
                        return
                    set_setting(conn, "service_port", port)
                    try:
                        write_port_config(port)
                    except OSError as exc:
                        self.send_json(500, {"error": f"端口配置写入失败：{exc}"})
                        return
                    command = f"$env:WAREHOUSE_HOST_PORT='{port}'; docker compose -p warehouse up --build -d"
                    add_audit(conn, user["id"], "更新系统设置", f"服务端口改为 {port}，重启 Docker 后生效")
                    data = get_state(conn, user)
                    data["portNotice"] = f"端口已保存为 {port}。请在项目目录的 PowerShell 执行端口重启命令，然后打开 http://127.0.0.1:{port}/"
                    data["portCommand"] = command
                    self.send_json(200, data)
                    return
                if parsed.path == "/api/debug/clear-files":
                    require_permission(conn, user, "settings.manage")
                    developer_mode = conn.execute("select value from system_settings where key = 'developer_mode_enabled'").fetchone()
                    if not developer_mode or developer_mode["value"] != "1":
                        self.send_json(400, {"error": "请先在设置中开启开发者模式"})
                        return
                    counts = clear_data_preserving_login_accounts(conn)
                    data = get_state(conn, user)
                    data["clearSummary"] = {
                        "assets": counts.get("assets", 0),
                        "records": counts.get("records", 0),
                        "importArchives": counts.get("import_archives", 0),
                        "audits": counts.get("audits", 0),
                    }
                    self.send_json(200, data)
                    return
                if parsed.path == "/api/settings/departments/delete":
                    require_permission(conn, user, "settings.manage")
                    name = str(payload.get("department", "")).strip()
                    if not name:
                        self.send_json(400, {"error": "缺少部门名称"})
                        return
                    count = conn.execute("select count(*) from users where department = ? and active = 1", (name,)).fetchone()[0]
                    if count:
                        self.send_json(400, {"error": f"部门“{name}”下还有 {count} 个启用用户，请先调整用户部门"})
                        return
                    conn.execute("update departments set active = 0 where name = ?", (name,))
                    add_audit(conn, user["id"], "删除部门", name)
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/locations/delete":
                    require_permission(conn, user, "base_data.manage")
                    location_id = str(payload.get("locationId", "")).strip()
                    location = conn.execute("select * from locations where id = ?", (location_id,)).fetchone()
                    if not location:
                        self.send_json(404, {"error": "位置不存在"})
                        return
                    count = conn.execute("select count(*) from assets where location = ?", (location["name"],)).fetchone()[0]
                    if count:
                        self.send_json(400, {"error": f"位置“{location['name']}”下还有 {count} 个资产，请先调整资产位置"})
                        return
                    conn.execute("update locations set active = 0, updated_at = ? where id = ?", (now_local(), location_id))
                    add_audit(conn, user["id"], "删除位置", location["name"])
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/assets/categories/delete":
                    require_permission(conn, user, "base_data.manage")
                    category_id = str(payload.get("categoryId", "")).strip()
                    name = str(payload.get("category", "")).strip()
                    category = conn.execute("select * from asset_categories where id = ?", (category_id,)).fetchone() if category_id else None
                    if category:
                        name = category["name"]
                    if not name:
                        self.send_json(400, {"error": "缺少类别名称"})
                        return
                    count = conn.execute("select count(*) from assets where category = ?", (name,)).fetchone()[0]
                    if count:
                        self.send_json(400, {"error": f"类别“{name}”下还有 {count} 个资产，请先调整资产类别"})
                        return
                    child_count = conn.execute("select count(*) from asset_categories where parent_id = ? and active = 1", (category_id,)).fetchone()[0] if category_id else 0
                    if child_count:
                        self.send_json(400, {"error": f"类别“{name}”下还有 {child_count} 个子类别，请先调整子类别"})
                        return
                    if category_id:
                        conn.execute("update asset_categories set active = 0, updated_at = ? where id = ?", (now_local(), category_id))
                    else:
                        conn.execute("update asset_categories set active = 0, updated_at = ? where name = ?", (now_local(), name))
                    add_audit(conn, user["id"], "删除资产类别", name)
                    self.send_json(200, get_state(conn, user))
                    return
        except sqlite3.IntegrityError as exc:
            self.send_json(400, {"error": f"数据重复或关联不存在：{exc}"})
            return
        except AuthError as exc:
            self.send_auth_error(exc)
            return
        except PermissionError as exc:
            self.send_json(403, {"error": str(exc)})
            return
        except KeyError as exc:
            self.send_json(400, {"error": f"缺少字段：{exc}"})
            return

        self.send_json(404, {"error": "接口不存在"})


if __name__ == "__main__":
    init_db()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"Warehouse system running on http://0.0.0.0:{PORT}")
    print(f"SQLite database: {DB_PATH}")
    server.serve_forever()
