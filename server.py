import json
import os
import sqlite3
import uuid
import base64
import csv
import io
import zipfile
import contextvars
import copy
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
DEFAULT_ADMIN_PASSWORD = os.environ.get("WAREHOUSE_ADMIN_PASSWORD", "change-me-before-use")
DEFAULT_IMPORTED_USER_PASSWORD = os.environ.get("WAREHOUSE_IMPORTED_USER_PASSWORD", "change-me-before-use")
BEIJING_TZ = timezone(timedelta(hours=8))
APP_VERSION = "20260606-asset-status-groups-v71"
REQUEST_IP = contextvars.ContextVar("request_ip", default="")
W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
XML_NS = "http://www.w3.org/XML/1998/namespace"
ElementTree.register_namespace("w", W_NS)


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


def ensure_column(conn, table, column, definition):
    columns = {item["name"] for item in rows_to_list(conn.execute(f"pragma table_info({table})"))}
    if column not in columns:
        conn.execute(f"alter table {table} add column {column} {definition}")


def init_db():
    with db() as conn:
        conn.executescript(
            """
            create table if not exists users (
              id text primary key,
              username text unique not null,
              password text not null,
              name text not null,
              role text not null check(role in ('admin', 'user')),
              department text not null,
              active integer not null default 1
            );

            create table if not exists assets (
              id text primary key,
              code text unique not null,
              name text not null,
              category text not null,
              spec text,
              quantity integer not null,
              location text not null,
              keeper_id text not null references users(id),
              status text not null,
              remark text
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
              ip text
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
              quantity integer not null default 1,
              priority text,
              expected_time text,
              reason text,
              status text not null,
              created_at text not null,
              handled_by text,
              handled_at text,
              handle_note text
            );
            """
        )
        conn.execute("insert or ignore into system_settings values ('multi_department_enabled', '0')")
        conn.execute("insert or ignore into system_settings values ('developer_mode_enabled', '0')")
        conn.execute("insert or ignore into system_settings values ('admin_prefill_enabled', '0')")
        conn.execute("insert or ignore into system_settings values ('login_background_image', '')")
        conn.execute("insert or ignore into system_settings values ('service_port', ?)", (str(PUBLIC_PORT),))
        conn.execute("insert or ignore into system_settings values ('print_asset_template_name', '')")
        conn.execute("insert or ignore into system_settings values ('print_asset_template_content', '')")
        conn.execute("insert or ignore into system_settings values ('print_consumable_template_name', '')")
        conn.execute("insert or ignore into system_settings values ('print_consumable_template_content', '')")
        ensure_column(conn, "records", "photo", "text")
        ensure_column(conn, "audits", "ip", "text")
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
        existing_departments = conn.execute("select count(*) from departments").fetchone()[0]
        if not existing_departments:
            user_departments = rows_to_list(conn.execute("select distinct department as name from users where department <> ''"))
            seed_departments = [item["name"] for item in user_departments] or ["仓储部"]
            conn.executemany(
                "insert or ignore into departments values (?, ?, ?)",
                [(new_id("dept"), name, 1) for name in seed_departments],
            )
        count = conn.execute("select count(*) from users").fetchone()[0]
        if count:
            return

        conn.executemany(
            "insert into users values (?, ?, ?, ?, ?, ?, ?)",
            [
                ("u-admin", "admin", DEFAULT_ADMIN_PASSWORD, "系统管理员", "admin", "仓储部", 1),
            ],
        )
        conn.executemany(
            "insert or ignore into departments values (?, ?, ?)",
            [(new_id("dept"), name, 1) for name in ["仓储部"]],
        )


def public_user(user):
    data = dict(user)
    data.pop("password", None)
    data["active"] = bool(data["active"])
    return data


def get_user(conn, user_id):
    return conn.execute("select * from users where id = ? and active = 1", (user_id,)).fetchone()


def require_user(conn, payload=None, query=None):
    user_id = None
    if payload:
        user_id = payload.get("actorId") or payload.get("userId")
    if not user_id and query:
        user_id = query.get("userId", [""])[0]
    user = get_user(conn, user_id)
    if not user:
        raise PermissionError("请先登录")
    return user


def require_admin(user):
    if user["role"] != "admin":
        raise PermissionError("只有管理员可以执行此操作")


def add_audit(conn, user_id, action, detail, ip=""):
    conn.execute(
        "insert into audits (id, time, user_id, action, detail, ip) values (?, ?, ?, ?, ?, ?)",
        (new_id("log"), now_local(), user_id, action, detail, ip or REQUEST_IP.get("")),
    )


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


def next_asset_code(conn):
    prefix = f"CK-{datetime.now(BEIJING_TZ).year}-"
    rows = rows_to_list(conn.execute("select code from assets where code like ?", (f"{prefix}%",)))
    max_number = 0
    for row in rows:
        match = re.fullmatch(rf"{re.escape(prefix)}(\d+)", row["code"] or "")
        if match:
            max_number = max(max_number, int(match.group(1)))
    return f"{prefix}{max_number + 1:03d}"


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
    rows = []
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        shared_strings = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
            for item in root.findall("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}si"):
                texts = [node.text or "" for node in item.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")]
                shared_strings.append("".join(texts).strip())
        sheet_name = "xl/worksheets/sheet1.xml"
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
    return table_to_dicts(rows)


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
                    texts = [node.text or "" for node in cell.findall(".//w:t", ns)]
                    values.append(clean_docx_text("".join(texts)))
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
    "审核",
    "负责人审核",
    "项目负责人审核",
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
    rows = []
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
            receive_time = get("领用时间")
            return_time = get("预计归还时间")
            row_remark = get("备注")
            category = get("类别") or detect_category("".join(row))
            invalid_item_names = {"领用日期", "归还日期", "备注", "项目负责人审核", "负责人审核", "审核", "申请人", "申领人", "序号"}
            if field_key(name) in {field_key(item) for item in invalid_item_names}:
                continue
            if is_template_noise_row(sequence, name, code, config, quantity, receive_time, return_time):
                continue
            if not name and is_invalid_field_value(code):
                continue
            if not any([name, code, config, receive_time, return_time]):
                continue
            if not name:
                continue
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
                    "备注": "；".join(
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
                    ),
                    "类型": "出库",
                }
            )
    return rows


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


def table_to_dicts(rows):
    if not rows:
        return []
    header_index = 0
    header_markers = {"资产编号", "资产名称", "规格型号", "资产分类", "数量", "部门"}
    for index, row in enumerate(rows[:20]):
        normalized = {str(item).strip() for item in row}
        if len(header_markers.intersection(normalized)) >= 2:
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
    for name in names:
        if row.get(name):
            return row[name].strip()
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
    text = text.replace("/", "-").replace(" ", "T")
    if len(text) == 10:
        return f"{text}T00:00"
    if not re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", text):
        return ""
    return text[:16]


def find_asset(conn, row):
    code = first_value(row, ("资产编号", "资产编码", "编号", "资产代码", "asset_code", "code"))
    name = first_value(row, ("资产名称", "名称", "物品名称", "asset_name", "name"))
    if code:
        asset = conn.execute("select * from assets where code = ?", (code,)).fetchone()
        if asset:
            return asset
    if name:
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


def ensure_asset(conn, row, actor):
    asset = find_asset(conn, row)
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
    location = first_value(row, ("更新后的具体存放地点", "具体存放地点", "存放地点", "位置", "location"))
    department = first_value(row, ("部门", "使用部门", "department")) or actor["department"]
    ensure_department(conn, department)
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
    conn.execute(
        "insert into assets values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (asset_id, code, name or code, category, spec, quantity, location, keeper_id, "in_stock", "；".join(remark_parts)),
    )
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
            "insert into users values (?, ?, ?, ?, ?, ?, ?)",
            ("u-import-unknown", username, DEFAULT_IMPORTED_USER_PASSWORD, "未填写", "user", department, 0),
        )
        return conn.execute("select * from users where id = 'u-import-unknown'").fetchone()
    existing = conn.execute("select * from users where name = ?", (name,)).fetchone()
    if existing:
        return existing
    ensure_department(conn, department)
    username = unique_username(conn, username_base_from_name(name))
    user_id = new_id("user")
    conn.execute(
        "insert into users values (?, ?, ?, ?, ?, ?, ?)",
        (user_id, username, DEFAULT_IMPORTED_USER_PASSWORD, name, "user", department, 1),
    )
    return conn.execute("select * from users where id = ?", (user_id,)).fetchone()


def import_records_from_rows(conn, actor, rows, default_type="", allowed_type="", create_missing_assets=False, create_missing_users=False):
    imported = 0
    created_assets = 0
    record_ids = []
    skipped = []
    for index, row in enumerate(rows, start=2):
        row_code = first_value(row, ("资产编号", "资产编码", "编号", "资产代码", "asset_code", "code"))
        row_name = first_value(row, ("资产名称", "名称", "物品名称", "asset_name", "name"))
        row_department = first_value(row, ("部门", "使用部门", "department"))
        if create_missing_assets:
            asset, created = ensure_asset(conn, row, actor)
            if created:
                created_assets += 1
        else:
            asset = find_asset(conn, row)
        ensure_department(conn, row_department)
        user = ensure_import_user(conn, row, actor) if create_missing_users else find_user(conn, row)
        record_type = allowed_type or normalize_record_type(first_value(row, ("类型", "出入库类型", "操作类型", "type"))) or default_type
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
                first_value(row, ("纸质单号", "单号", "paper_no")),
                "；".join(note_parts),
            ),
        )
        record_ids.append(record_id)
        conn.execute(
            "update assets set status = ?, keeper_id = ? where id = ?",
            ("checked_out" if record_type == "出库" else "in_stock", user["id"], asset["id"]),
        )
        imported += 1
    return {"imported": imported, "createdAssets": created_assets, "skipped": skipped, "_recordIds": record_ids}


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
    rows = parse_xlsx(content) if lower_name.endswith(".xlsx") else parse_csv(content)
    result = import_records_from_rows(conn, actor, rows, default_type=default_type, allowed_type=allowed_type, create_missing_assets=allowed_type == "入库")
    result["archiveId"] = save_import_archive(conn, actor, file_name, "xlsx" if lower_name.endswith(".xlsx") else "csv", allowed_type or "出入库", content, result)
    add_audit(conn, actor["id"], "批量导入出入库", f"{file_name} 导入 {result['imported']} 条，新建资产 {result.get('createdAssets', 0)} 个，跳过 {len(result['skipped'])} 条")
    return result


def import_word_checkout(conn, actor, file_name, content):
    parsed = parse_docx(content)
    requisition_rows = parse_requisition_docx(parsed)
    if requisition_rows:
        result = import_records_from_rows(conn, actor, requisition_rows, default_type="出库", allowed_type="出库", create_missing_assets=True, create_missing_users=True)
        result["archiveId"] = save_import_archive(conn, actor, file_name, "docx", "领用申请Word", content, result)
        tag_records_with_archive(conn, result.get("_recordIds", []), file_name, result["archiveId"])
        add_audit(conn, actor["id"], "识别Word领用申请", f"{file_name} 识别并导入 {result['imported']} 条，跳过 {len(result['skipped'])} 条")
        return {**result, "paperCreated": 0, "message": "已识别耗材/物品领用申请模板并导入出借记录"}
    if is_blank_requisition_template(parsed):
        result = {"imported": 0, "createdAssets": 0, "skipped": [], "paperCreated": 0, "message": "识别为空白领用申请模板，已忽略，不计入跳过"}
        result["archiveId"] = save_import_archive(conn, actor, file_name, "docx", "空白领用模板", content, result)
        add_audit(conn, actor["id"], "忽略空白Word模板", file_name)
        return result
    if parsed["rows"]:
        result = import_records_from_rows(conn, actor, parsed["rows"], default_type="出库", allowed_type="出库")
        result["archiveId"] = save_import_archive(conn, actor, file_name, "docx", "出库/出借Word", content, result)
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
    result["archiveId"] = save_import_archive(conn, actor, file_name, "docx", "出库/出借Word", content, result)
    add_audit(conn, actor["id"], "导入Word手写出借单", f"{file_name} 已进入待复核队列")
    return result


def get_state(conn, user, view_role=""):
    user_id = user["id"]
    admin = user["role"] == "admin" and view_role != "user"
    current_user = public_user(user)
    current_user["actualRole"] = user["role"]
    if user["role"] == "admin" and view_role == "user":
        current_user["role"] = "user"
        current_user["viewMode"] = "user"
    else:
        current_user["viewMode"] = "admin" if user["role"] == "admin" else "user"
    users = rows_to_list(conn.execute("select * from users order by active desc, role, username, name"))
    safe_users = [public_user(item) for item in users]
    departments = rows_to_list(conn.execute("select name from departments where active = 1 order by name"))
    multi_department = setting_value(conn, "multi_department_enabled", "0")
    developer_mode = setting_value(conn, "developer_mode_enabled", "0")
    admin_prefill = setting_value(conn, "admin_prefill_enabled", "0")
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
    if admin:
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

    if admin:
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

    if admin:
        assets = sort_assets_for_display(rows_to_list(conn.execute("select * from assets order by code")))
        records = sort_records_for_display(rows_to_list(conn.execute("select * from records order by coalesce(in_time, out_time) desc, id desc")))
        audits = rows_to_list(conn.execute("select * from audits order by time desc, id desc"))
        paper = rows_to_list(conn.execute("select * from paper_queue order by id desc"))
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
        "settings": {
            "departments": [item["name"] for item in departments],
            "multiDepartmentEnabled": bool(int(multi_department)),
            "developerModeEnabled": bool(int(developer_mode)),
            "adminPrefillEnabled": bool(int(admin_prefill)),
            "adminPrefillPassword": DEFAULT_ADMIN_PASSWORD if bool(int(admin_prefill)) else "",
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


def safe_download_name(file_name):
    clean = str(file_name or "import-archive").replace("\\", "_").replace("/", "_").strip()
    return clean or "import-archive"


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
    if user["role"] == "admin":
        rows = rows_to_list(conn.execute(f"select * from assets where id in ({placeholders})", asset_ids))
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
            self.send_json(200, {"ok": True, "database": str(DB_PATH)})
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
                    require_admin(user)
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
            except PermissionError:
                self.send_response(403)
                self.end_headers()
            return
        if parsed.path == "/api/import-archives/content":
            query = parse_qs(parsed.query)
            try:
                with db() as conn:
                    user = require_user(conn, query=query)
                    require_admin(user)
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
            except PermissionError as exc:
                self.send_json(403, {"error": str(exc)})
            return
        if parsed.path == "/api/state":
            try:
                with db() as conn:
                    query = parse_qs(parsed.query)
                    user = require_user(conn, query=query)
                    view_role = query.get("viewRole", [""])[0]
                    self.send_json(200, get_state(conn, user, view_role=view_role))
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
                    add_audit(conn, user["id"], "登录", f"{user['name']} 登录系统")
                    self.send_json(200, {"user": public_user(user)})
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
                    require_admin(user)
                    reset_db()
                    with db() as fresh:
                        fresh_user = get_user(fresh, user["id"])
                        self.send_json(200, get_state(fresh, fresh_user))
                    return
                if parsed.path == "/api/assets":
                    require_admin(user)
                    asset_id = new_id("asset")
                    asset_code = str(payload.get("code") or "").strip() or next_asset_code(conn)
                    conn.execute(
                        "insert into assets values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (
                            asset_id,
                            asset_code,
                            payload["name"],
                            payload["category"],
                            payload.get("spec", ""),
                            int(payload.get("quantity", 1)),
                            payload["location"],
                            payload["keeperId"],
                            payload.get("status", "in_stock"),
                            payload.get("remark", ""),
                        ),
                    )
                    add_audit(conn, user["id"], "新增资产", f"{payload['name']}（{asset_code}）")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/assets/update":
                    require_admin(user)
                    asset_id = payload["assetId"]
                    asset = conn.execute("select * from assets where id = ?", (asset_id,)).fetchone()
                    if not asset:
                        self.send_json(404, {"error": "资产不存在"})
                        return
                    asset_code = str(payload.get("code") or "").strip() or asset["code"] or next_asset_code(conn)
                    duplicate = conn.execute("select id from assets where code = ? and id <> ?", (asset_code, asset_id)).fetchone()
                    if duplicate:
                        self.send_json(400, {"error": "资产编号已存在"})
                        return
                    conn.execute(
                        """
                        update assets
                        set code = ?, name = ?, category = ?, spec = ?, quantity = ?, location = ?,
                            keeper_id = ?, status = ?, remark = ?
                        where id = ?
                        """,
                        (
                            asset_code,
                            payload["name"],
                            payload["category"],
                            payload.get("spec", ""),
                            int(payload.get("quantity", 1)),
                            payload["location"],
                            payload["keeperId"],
                            payload.get("status", "in_stock"),
                            payload.get("remark", ""),
                            asset_id,
                        ),
                    )
                    add_audit(conn, user["id"], "编辑资产", f"{payload['name']}（{asset_code}）")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/assets/delete":
                    require_admin(user)
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
                    require_admin(user)
                    record_id = new_id("record")
                    record_type = payload["type"]
                    in_time = payload.get("inTime") if record_type == "入库" else ""
                    out_time = payload.get("outTime") if record_type == "出库" else ""
                    if record_type == "出库" and not out_time:
                        out_time = now_local()
                    status = "已入库" if record_type == "入库" else "使用中"
                    conn.execute(
                        "insert into records (id, asset_id, type, quantity, user_id, operator_id, in_time, out_time, status, paper_no, note, photo) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (
                            record_id,
                            payload["assetId"],
                            record_type,
                            int(payload.get("quantity", 1)),
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
                    conn.execute(
                        "update assets set status = ?, keeper_id = ? where id = ?",
                        ("in_stock" if record_type == "入库" else "checked_out", payload["userId"], payload["assetId"]),
                    )
                    asset = conn.execute("select name, code from assets where id = ?", (payload["assetId"],)).fetchone()
                    asset_label = f"{asset['name']}（{asset['code']}）" if asset else payload["assetId"]
                    add_audit(conn, user["id"], f"登记{record_type}", f"{asset_label} {record_type} {payload.get('quantity', 1)}")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/records/delete":
                    require_admin(user)
                    record_id = payload["recordId"]
                    record = conn.execute("select * from records where id = ?", (record_id,)).fetchone()
                    if not record:
                        self.send_json(404, {"error": "出入库记录不存在"})
                        return
                    asset = conn.execute("select name, code from assets where id = ?", (record["asset_id"],)).fetchone()
                    conn.execute("delete from records where id = ?", (record_id,))
                    if asset:
                        remaining = rows_to_list(
                            conn.execute(
                                "select * from records where asset_id = ? order by coalesce(in_time, out_time) desc, id desc",
                                (record["asset_id"],),
                            )
                        )
                        latest = remaining[0] if remaining else None
                        if latest:
                            conn.execute(
                                "update assets set status = ?, keeper_id = ? where id = ?",
                                ("checked_out" if latest["type"] == "出库" else "in_stock", latest["user_id"], record["asset_id"]),
                            )
                    label = f"{asset['name']}（{asset['code']}）" if asset else record["asset_id"]
                    add_audit(conn, user["id"], "删除出入库记录", f"{record['type']}：{label}")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/records/import":
                    require_admin(user)
                    content = base64.b64decode(payload["contentBase64"])
                    result = import_records(conn, user, payload["fileName"], content)
                    data = get_state(conn, user)
                    data["importResult"] = result
                    self.send_json(200, data)
                    return
                if parsed.path == "/api/records/import-inbound":
                    require_admin(user)
                    content = base64.b64decode(payload["contentBase64"])
                    result = import_records(conn, user, payload["fileName"], content, default_type="入库", allowed_type="入库")
                    data = get_state(conn, user)
                    data["importResult"] = result
                    self.send_json(200, data)
                    return
                if parsed.path == "/api/records/import-word-checkout":
                    require_admin(user)
                    content = base64.b64decode(payload["contentBase64"])
                    result = import_word_checkout(conn, user, payload["fileName"], content)
                    data = get_state(conn, user)
                    data["wordImportResult"] = result
                    self.send_json(200, data)
                    return
                if parsed.path == "/api/paper":
                    owner_id = payload.get("ownerId") if user["role"] == "admin" else user["id"]
                    conn.execute(
                        "insert into paper_queue values (?, ?, ?, ?, ?, ?)",
                        (new_id("paper"), payload["paperNo"], payload["source"], owner_id, "待复核", payload["text"]),
                    )
                    add_audit(conn, user["id"], "新增纸质单据", f"{payload['paperNo']} 加入复核队列")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/paper/archive":
                    require_admin(user)
                    conn.execute("update paper_queue set status = '已归档' where id = ?", (payload["paperId"],))
                    add_audit(conn, user["id"], "归档纸质单据", payload["paperId"])
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/users":
                    require_admin(user)
                    username = unique_username(conn, username_base_from_name(payload["name"]))
                    conn.execute(
                        "insert into users values (?, ?, ?, ?, ?, ?, ?)",
                        (
                            new_id("user"),
                            username,
                            payload["password"],
                            payload["name"],
                            payload.get("role", "user"),
                            payload["department"],
                            1 if payload.get("active", True) else 0,
                        ),
                    )
                    add_audit(conn, user["id"], "新增用户", f"{payload['name']}（{username}）")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/users/delete":
                    require_admin(user)
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
                    if target["role"] == "admin":
                        admin_count = conn.execute(
                            "select count(*) from users where role = 'admin' and active = 1"
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
                    require_admin(user)
                    target_id = payload["targetUserId"]
                    target = conn.execute("select * from users where id = ?", (target_id,)).fetchone()
                    if not target:
                        self.send_json(404, {"error": "用户不存在"})
                        return
                    if not target["active"]:
                        self.send_json(400, {"error": "停用用户不能提权"})
                        return
                    if target["role"] == "admin":
                        self.send_json(200, get_state(conn, user))
                        return
                    conn.execute("update users set role = 'admin' where id = ?", (target_id,))
                    add_audit(conn, user["id"], "用户提权", f"{target['name']}（{target['username']}）设为管理员")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/users/revoke-admin":
                    require_admin(user)
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
                    if target["role"] != "admin":
                        self.send_json(200, get_state(conn, user))
                        return
                    admin_count = conn.execute("select count(*) from users where role = 'admin' and active = 1").fetchone()[0]
                    if admin_count <= 1:
                        self.send_json(400, {"error": "至少需要保留一个启用的管理员"})
                        return
                    conn.execute("update users set role = 'user' where id = ?", (target_id,))
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
                        require_admin(user)
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
                    if user["role"] == "admin":
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
                    require_admin(user)
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
                    conn.execute("update users set role = 'admin' where id = ?", (target["id"],))
                    conn.execute(
                        "update admin_requests set status = '已批准', handled_by = ?, handled_at = ? where id = ?",
                        (user["id"], now_local(), request_id),
                    )
                    add_audit(conn, user["id"], "批准管理员申请", f"{target['name']}（{target['username']}）")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/admin-requests/ignore":
                    require_admin(user)
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
                    require_admin(user)
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
                    require_admin(user)
                    request_id = payload["requestId"]
                    request = conn.execute("select * from asset_requests where id = ?", (request_id,)).fetchone()
                    if not request:
                        self.send_json(404, {"error": "资产申请不存在"})
                        return
                    if request["status"] == "待处理":
                        note = clean_docx_text(payload.get("note") or "")
                        conn.execute(
                            "update asset_requests set status = '已批准', handled_by = ?, handled_at = ?, handle_note = ? where id = ?",
                            (user["id"], now_local(), note, request_id),
                        )
                        add_audit(conn, user["id"], "批准资产申请", f"{request['asset_name']} × {request['quantity']}")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/asset-requests/reject":
                    require_admin(user)
                    request_id = payload["requestId"]
                    request = conn.execute("select * from asset_requests where id = ?", (request_id,)).fetchone()
                    if not request:
                        self.send_json(404, {"error": "资产申请不存在"})
                        return
                    if request["status"] == "待处理":
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
                    priority = clean_docx_text(payload.get("priority") or "普通") or "普通"
                    if priority not in ("普通", "高", "紧急"):
                        priority = "普通"
                    conn.execute(
                        "insert into purchase_wishes values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (
                            new_id("wish"),
                            user["id"],
                            item_name,
                            clean_docx_text(payload.get("category") or ""),
                            clean_docx_text(payload.get("spec") or ""),
                            quantity,
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
                    require_admin(user)
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
                if parsed.path == "/api/settings/departments":
                    require_admin(user)
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
                if parsed.path == "/api/settings/multi-department":
                    require_admin(user)
                    enabled = "1" if payload.get("enabled") else "0"
                    conn.execute(
                        "insert into system_settings values ('multi_department_enabled', ?) on conflict(key) do update set value = excluded.value",
                        (enabled,),
                    )
                    add_audit(conn, user["id"], "更新系统设置", f"多部门功能：{'开启' if enabled == '1' else '关闭'}")
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/settings/developer-mode":
                    require_admin(user)
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
                    require_admin(user)
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
                if parsed.path == "/api/settings/login-background":
                    require_admin(user)
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
                    require_admin(user)
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
                    require_admin(user)
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
                    require_admin(user)
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
                    command = f"$env:WAREHOUSE_HOST_PORT='{port}'; docker compose -p warehouse up -d"
                    add_audit(conn, user["id"], "更新系统设置", f"服务端口改为 {port}，重启 Docker 后生效")
                    data = get_state(conn, user)
                    data["portNotice"] = f"端口已保存为 {port}。请在 PowerShell 执行：\n{command}\n然后打开 http://127.0.0.1:{port}/"
                    self.send_json(200, data)
                    return
                if parsed.path == "/api/debug/clear-files":
                    require_admin(user)
                    developer_mode = conn.execute("select value from system_settings where key = 'developer_mode_enabled'").fetchone()
                    if not developer_mode or developer_mode["value"] != "1":
                        self.send_json(400, {"error": "请先在设置中开启开发者模式"})
                        return
                    archive_count = conn.execute("select count(*) from import_archives").fetchone()[0]
                    asset_count = conn.execute("select count(*) from assets").fetchone()[0]
                    record_count = conn.execute("select count(*) from records").fetchone()[0]
                    paper_count = conn.execute("select count(*) from paper_queue").fetchone()[0]
                    audit_count = conn.execute("select count(*) from audits").fetchone()[0]
                    asset_request_count = conn.execute("select count(*) from asset_requests").fetchone()[0]
                    wish_count = conn.execute("select count(*) from purchase_wishes").fetchone()[0]
                    conn.execute("delete from import_archives")
                    conn.execute("delete from paper_queue")
                    conn.execute("delete from asset_requests")
                    conn.execute("delete from purchase_wishes")
                    conn.execute("delete from records")
                    conn.execute("delete from assets")
                    conn.execute("delete from audits")
                    add_audit(
                        conn,
                        user["id"],
                        "调试清空业务数据",
                        f"已清空资产 {asset_count} 个、出入库记录 {record_count} 条、导入留档 {archive_count} 个、纸质待复核 {paper_count} 条、资产申请 {asset_request_count} 条、采购需求 {wish_count} 条、旧操作记录 {audit_count} 条；用户保留",
                    )
                    self.send_json(200, get_state(conn, user))
                    return
                if parsed.path == "/api/settings/departments/delete":
                    require_admin(user)
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
        except sqlite3.IntegrityError as exc:
            self.send_json(400, {"error": f"数据重复或关联不存在：{exc}"})
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
