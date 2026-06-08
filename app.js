const USER_KEY = "warehouse-current-user";
const SESSION_USER_KEY = "warehouse-session-user";
const VIEW_MODE_KEY = "warehouse-view-mode";
const SUSPECT_DUPLICATE_MODE_KEY = "warehouse-suspect-duplicate-mode";
const APP_VERSION = "20260608-school-rbac-flow-v92";

let state = {
  currentUser: null,
  users: [],
  assets: [],
  records: [],
  audits: [],
  paperQueue: [],
  importArchives: [],
  adminRequests: [],
  assetRequests: [],
  purchaseWishes: [],
  inventoryCheckTasks: [],
  inventoryCheckItems: [],
  stockRecords: [],
  assetFlowLogs: [],
  borrowOrders: [],
  transferOrders: [],
  repairOrders: [],
  scrapOrders: [],
  roles: [],
  permissions: [],
  menuPermissions: [],
  settings: { departments: [], assetCategories: [], assetCategoryItems: [], locations: [], multiDepartmentEnabled: false, developerModeEnabled: false, adminPrefillEnabled: false, assetDetailLabelEnabled: true, paperModuleEnabled: true, loginBackgroundImage: "", servicePort: "", printAssetTemplateName: "", printAssetTemplateCustom: false, printConsumableTemplateName: "", printConsumableTemplateCustom: false }
};
let loginSettings = { adminPrefillEnabled: false, adminPrefillPassword: "", loginBackgroundImage: "", appVersion: APP_VERSION };
let view = "dashboard";
let assetFilter = "";
let selectedAssetId = "";
let assetStatusFilter = "all";
let assetKeeperFilter = "all";
let assetBorrowerFilter = "all";
let assetSortField = "model";
let assetSortDir = "asc";
let inventoryFilter = "";
let assetDrawerOpen = false;
let editingAssetId = "";
let selectedAssetDetailId = "";
let dashboardSearch = "";
let recordFilter = "all";
let recordKindFilter = "all";
let selectedDepartment = "all";
let recordMode = "manual";
let importKind = "inbound";
let importResult = null;
let wordImportResult = null;
let auditFilterField = "all";
let auditFilterQuery = "";
let auditStartTime = "";
let auditEndTime = "";
let orderType = "claim";
let reportType = "ledger";
let searchRenderTimer = null;
let messagePanelOpen = false;
let suspectDuplicateMode = localStorage.getItem(SUSPECT_DUPLICATE_MODE_KEY) || "expanded";
let composingInputs = new Set();

function viewRoleParam() {
  return localStorage.getItem(VIEW_MODE_KEY) === "user" ? "&viewRole=user" : "";
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...options
    });
  } catch (exc) {
    throw new Error(exc?.message === "Failed to fetch" ? "网络请求中断：文件可能较大、服务正在重启，或浏览器连接被断开，请稍后重试。" : exc.message || "网络请求失败");
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

async function loadState() {
  await loadLoginSettings();
  const saved = localStorage.getItem(USER_KEY) || sessionStorage.getItem(SESSION_USER_KEY);
  if (!saved) {
    render();
    return;
  }
  try {
    const data = await api(`/api/state?userId=${encodeURIComponent(saved)}${viewRoleParam()}`);
    ensureFreshVersion(data);
    state = data;
    applyAssetUrlSelection();
  } catch {
    localStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(SESSION_USER_KEY);
    state.currentUser = null;
  }
  render();
}

async function loadLoginSettings() {
  try {
    loginSettings = await api("/api/login-settings");
    ensureFreshVersion({ settings: loginSettings });
  } catch {
    loginSettings = { adminPrefillEnabled: false, adminPrefillPassword: "", loginBackgroundImage: "", appVersion: APP_VERSION };
  }
}

async function refresh() {
  if (!state.currentUser) return render();
  state = await api(`/api/state?userId=${encodeURIComponent(state.currentUser.id)}${viewRoleParam()}`);
  ensureFreshVersion(state);
  applyAssetUrlSelection();
  render();
}

function applyAssetUrlSelection() {
  const assetId = new URLSearchParams(window.location.search).get("asset");
  if (!assetId || selectedAssetDetailId) return;
  const asset = state.assets.find((item) => item.id === assetId || item.code === assetId);
  if (asset) {
    view = "assets";
    selectedAssetDetailId = asset.id;
  }
}

function ensureFreshVersion(data) {
  const serverVersion = data?.settings?.appVersion;
  if (serverVersion && serverVersion !== APP_VERSION) {
    window.location.reload();
  }
}

function nowLocal() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function fmt(value) {
  if (!value) return "-";
  return value.replace("T", " ");
}

function blank(value) {
  const text = String(value ?? "").trim();
  return text && !["未填写", "未填", "无"].includes(text) ? text : "-";
}

function isAdmin() {
  return can("assets.view.all") || state.currentUser?.role === "admin";
}

function isRealAdmin() {
  return state.currentUser?.actualRole === "admin" || state.currentUser?.role === "admin" || state.currentUser?.roleId === "admin";
}

function isUserViewMode() {
  return isRealAdmin() && state.currentUser?.viewMode === "user";
}

function permissions() {
  return new Set(state.currentUser?.permissions || []);
}

function can(permission) {
  return permissions().has(permission) || state.currentUser?.role === "admin" || state.currentUser?.roleId === "admin";
}

function canMenu(menuKey) {
  if (menuKey === "paper" && !isPaperModuleEnabled()) return false;
  const menus = state.currentUser?.menus || [];
  return menus.includes(menuKey) || can("system.admin");
}

function roleLabel(roleId) {
  return {
    admin: "系统管理员",
    asset_manager: "资产管理员",
    department_head: "部门负责人",
    teacher: "普通教师",
    user: "普通用户"
  }[roleId] || roleId || "普通教师";
}

function isMultiDepartment() {
  return Boolean(state.settings?.multiDepartmentEnabled);
}

function isDeveloperMode() {
  return Boolean(state.settings?.developerModeEnabled);
}

function isAdminPrefillEnabled() {
  return Boolean(state.settings?.adminPrefillEnabled);
}

function isAssetDetailLabelEnabled() {
  return state.settings?.assetDetailLabelEnabled !== false;
}

function isPaperModuleEnabled() {
  return state.settings?.paperModuleEnabled !== false;
}

function loginBackgroundStyle() {
  const image = loginSettings.loginBackgroundImage || state.settings?.loginBackgroundImage || "";
  if (!image) return "";
  return `style="--login-bg-image: url('${String(image).replaceAll("'", "%27")}')"`;
}

function userName(userId) {
  return state.users.find((user) => user.id === userId)?.name || "未知用户";
}

function userDepartment(userId) {
  return state.users.find((user) => user.id === userId)?.department || "-";
}

function departments() {
  const configured = state.settings?.departments || [];
  if (configured.length) return configured;
  return [...new Set(selectableUsers().map((user) => user.department))].sort();
}

function assetCategories() {
  const items = assetCategoryItems();
  if (items.length) return items.map((item) => item.name);
  const configured = state.settings?.assetCategories || [];
  if (configured.length) return configured;
  const fromAssets = [...new Set(state.assets.map((asset) => String(asset.category || "").trim()).filter(Boolean))].sort();
  return fromAssets.length ? fromAssets : ["固定资产", "低值易耗品", "耗材", "购进软件"];
}

function assetCategoryItems() {
  const configured = state.settings?.assetCategoryItems || [];
  if (configured.length) return configured;
  const names = (state.settings?.assetCategories || []).length
    ? state.settings.assetCategories
    : [...new Set(state.assets.map((asset) => String(asset.category || "").trim()).filter(Boolean))].sort();
  return (names.length ? names : ["固定资产", "低值易耗品", "耗材", "购进软件"])
    .map((name) => ({ id: name, name, parent_id: "", code: "", category_type: isConsumableCategoryName(name) ? "耗材" : "固定资产" }));
}

function isConsumableCategoryName(name) {
  return String(name || "").includes("耗材") || String(name || "").includes("易耗");
}

function categoryName(categoryId) {
  return assetCategoryItems().find((item) => item.id === categoryId)?.name || "-";
}

function locations() {
  const configured = state.settings?.locations || [];
  if (configured.length) return configured;
  const fromAssets = [...new Set(state.assets.map((asset) => String(asset.location || "").trim()).filter(Boolean))]
    .sort()
    .map((name) => ({ id: name, name, type: "仓库", code: "", manager_id: "", remark: "" }));
  return fromAssets.length ? fromAssets : [{ id: "default-location", name: "总仓库", type: "仓库", code: "", manager_id: "", remark: "" }];
}

function treeDepth(items, item, parentKey = "parent_id", depth = 0, seen = new Set()) {
  const parentId = item?.[parentKey];
  if (!parentId || seen.has(parentId)) return depth;
  const parent = items.find((entry) => entry.id === parentId);
  if (!parent) return depth;
  seen.add(parentId);
  return treeDepth(items, parent, parentKey, depth + 1, seen);
}

function treeLabel(items, item, parentKey = "parent_id") {
  return `${"　".repeat(treeDepth(items, item, parentKey))}${item.name}`;
}

function selectableUsers() {
  return state.users.filter((user) => user.active === true);
}

function activeUsersByDepartment() {
  if (!isMultiDepartment()) return selectableUsers();
  return selectableUsers().filter((user) => selectedDepartment === "all" || user.department === selectedDepartment);
}

function assetName(assetId) {
  const asset = state.assets.find((item) => item.id === assetId);
  return asset ? `${asset.name}（${asset.code}）` : "未知资产";
}

function assetModelText(asset) {
  const name = String(asset?.name || "").trim();
  const spec = String(asset?.spec || "").trim();
  return [name, spec].filter(Boolean).join(" · ") || "未命名资产";
}

function assetGroupKey(asset) {
  return assetModelText(asset).toLowerCase();
}

function assetGroups() {
  const groups = new Map();
  for (const asset of state.assets) {
    const key = assetGroupKey(asset);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        id: asset.id,
        name: asset.name || "未命名资产",
        spec: asset.spec || "",
        model: assetModelText(asset),
        category: asset.category || "-",
        quantity: 0,
        count: 0,
        assets: []
      });
    }
    const group = groups.get(key);
    group.quantity += Number(asset.quantity || 0);
    group.count += 1;
    group.assets.push(asset);
    if ((!group.category || group.category === "-") && asset.category) group.category = asset.category;
  }
  return [...groups.values()].sort((a, b) => a.model.localeCompare(b.model, "zh-Hans-CN"));
}

function assetGroupById(assetId) {
  const asset = state.assets.find((item) => item.id === assetId);
  if (!asset) return null;
  return assetGroups().find((group) => group.key === assetGroupKey(asset)) || null;
}

function assetRecords(assetIds) {
  const ids = new Set(Array.isArray(assetIds) ? assetIds : [assetIds]);
  return state.records
    .filter((record) => ids.has(record.assetId))
    .sort((a, b) => recordMillis(b) - recordMillis(a));
}

function assetDetailUrl(asset) {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}?asset=${encodeURIComponent(asset.id)}`;
}

function clearAssetUrlParam() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("asset")) return;
  url.searchParams.delete("asset");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function qrSeed(text) {
  let seed = 0;
  for (const char of String(text || "")) {
    seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
  }
  return seed || 1;
}

function qrLikeSvg(text) {
  try {
    return standardQrSvg(text);
  } catch {
    // Fallback keeps labels printable if an unexpected input exceeds the compact QR profile.
  }
  const size = 21;
  let seed = qrSeed(text);
  const hasFinder = (x, y, ox, oy) => x >= ox && x < ox + 7 && y >= oy && y < oy + 7;
  const finderCell = (x, y, ox, oy) => {
    const dx = x - ox;
    const dy = y - oy;
    return dx === 0 || dy === 0 || dx === 6 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4);
  };
  const cells = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let dark = false;
      if (hasFinder(x, y, 0, 0)) dark = finderCell(x, y, 0, 0);
      else if (hasFinder(x, y, 14, 0)) dark = finderCell(x, y, 14, 0);
      else if (hasFinder(x, y, 0, 14)) dark = finderCell(x, y, 0, 14);
      else {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        dark = ((seed >>> ((x + y) % 13)) & 1) === 1;
      }
      if (dark) cells.push(`<rect x="${x}" y="${y}" width="1" height="1" />`);
    }
  }
  return `<svg class="qr-code" viewBox="0 0 ${size} ${size}" role="img" aria-label="资产二维码">${cells.join("")}</svg>`;
}

function qrGfTables() {
  const exp = new Array(512).fill(0);
  const log = new Array(256).fill(0);
  let value = 1;
  for (let index = 0; index < 255; index += 1) {
    exp[index] = value;
    log[value] = index;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let index = 255; index < 512; index += 1) exp[index] = exp[index - 255];
  return { exp, log };
}

function qrGfMul(left, right, tables) {
  if (!left || !right) return 0;
  return tables.exp[tables.log[left] + tables.log[right]];
}

function qrRsDivisor(degree, tables) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let index = 0; index < degree; index += 1) {
    for (let pos = 0; pos < degree; pos += 1) {
      result[pos] = qrGfMul(result[pos], root, tables);
      if (pos + 1 < degree) result[pos] ^= result[pos + 1];
    }
    root = qrGfMul(root, 2, tables);
  }
  return result;
}

function qrRsRemainder(data, degree, tables) {
  const divisor = qrRsDivisor(degree, tables);
  const result = new Array(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift();
    result.push(0);
    for (let index = 0; index < degree; index += 1) {
      result[index] ^= qrGfMul(divisor[index], factor, tables);
    }
  }
  return result;
}

function qrAppendBits(bits, value, length) {
  for (let index = length - 1; index >= 0; index -= 1) {
    bits.push((value >>> index) & 1);
  }
}

function qrEncodeCodewords(text) {
  const bytes = [...new TextEncoder().encode(String(text || ""))];
  const version = 5;
  const dataCodewords = 108;
  const ecCodewords = 26;
  if (bytes.length > 106) {
    throw new Error("二维码内容过长");
  }
  const bits = [];
  qrAppendBits(bits, 0b0100, 4);
  qrAppendBits(bits, bytes.length, 8);
  bytes.forEach((byte) => qrAppendBits(bits, byte, 8));
  const capacityBits = dataCodewords * 8;
  qrAppendBits(bits, 0, Math.min(4, capacityBits - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let index = 0; index < bits.length; index += 8) {
    data.push(bits.slice(index, index + 8).reduce((sum, bit) => (sum << 1) | bit, 0));
  }
  for (let pad = 0xec; data.length < dataCodewords; pad ^= 0xfd) data.push(pad);
  const ecc = qrRsRemainder(data, ecCodewords, qrGfTables());
  return { version, codewords: [...data, ...ecc] };
}

function qrFormatBits(mask = 0) {
  let data = (0b01 << 3) | mask;
  let bits = data << 10;
  const generator = 0x537;
  for (let index = 14; index >= 10; index -= 1) {
    if ((bits >>> index) & 1) bits ^= generator << (index - 10);
  }
  return ((data << 10) | bits) ^ 0x5412;
}

function standardQrSvg(text) {
  const { version, codewords } = qrEncodeCodewords(text);
  const size = 17 + version * 4;
  const matrix = Array.from({ length: size }, () => new Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark, reserve = true) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    matrix[y][x] = Boolean(dark);
    if (reserve) reserved[y][x] = true;
  };
  const finder = (left, top) => {
    for (let y = -1; y <= 7; y += 1) {
      for (let x = -1; x <= 7; x += 1) {
        const xx = left + x;
        const yy = top + y;
        const inCore = x >= 0 && x <= 6 && y >= 0 && y <= 6;
        const dark = inCore && (x === 0 || y === 0 || x === 6 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4));
        set(xx, yy, dark);
      }
    }
  };
  finder(0, 0);
  finder(size - 7, 0);
  finder(0, size - 7);
  for (let index = 8; index < size - 8; index += 1) {
    set(index, 6, index % 2 === 0);
    set(6, index, index % 2 === 0);
  }
  const centers = version === 5 ? [6, 30] : [6, 24, 42];
  for (const cx of centers) {
    for (const cy of centers) {
      const overlapsFinder = (cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6);
      if (overlapsFinder) continue;
      for (let y = -2; y <= 2; y += 1) {
        for (let x = -2; x <= 2; x += 1) {
          set(cx + x, cy + y, Math.max(Math.abs(x), Math.abs(y)) !== 1);
        }
      }
    }
  }
  set(8, size - 8, true);
  const reserveFormat = () => {
    for (let index = 0; index < 9; index += 1) {
      if (index !== 6) {
        reserved[8][index] = true;
        reserved[index][8] = true;
      }
    }
    for (let index = 0; index < 8; index += 1) {
      reserved[8][size - 1 - index] = true;
      reserved[size - 1 - index][8] = true;
    }
  };
  reserveFormat();
  const dataBits = codewords.flatMap((byte) => Array.from({ length: 8 }, (_, index) => (byte >>> (7 - index)) & 1));
  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    for (let vert = 0; vert < size; vert += 1) {
      const y = upward ? size - 1 - vert : vert;
      for (let dx = 0; dx < 2; dx += 1) {
        const x = right - dx;
        if (reserved[y][x]) continue;
        const mask = (x + y) % 2 === 0;
        set(x, y, Boolean((dataBits[bitIndex] || 0) ^ (mask ? 1 : 0)), false);
        bitIndex += 1;
      }
    }
    upward = !upward;
  }
  const format = qrFormatBits(0);
  for (let index = 0; index <= 5; index += 1) set(8, index, (format >>> index) & 1);
  set(8, 7, (format >>> 6) & 1);
  set(8, 8, (format >>> 7) & 1);
  set(7, 8, (format >>> 8) & 1);
  for (let index = 9; index < 15; index += 1) set(14 - index, 8, (format >>> index) & 1);
  for (let index = 0; index < 8; index += 1) set(size - 1 - index, 8, (format >>> index) & 1);
  for (let index = 8; index < 15; index += 1) set(8, size - 15 + index, (format >>> index) & 1);
  const cells = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (matrix[y][x]) cells.push(`<rect x="${x}" y="${y}" width="1" height="1" />`);
    }
  }
  return `<svg class="qr-code" viewBox="0 0 ${size} ${size}" role="img" aria-label="资产二维码">${cells.join("")}</svg>`;
}

function assetGroupStatus(group) {
  const statuses = [...new Set(group.assets.map((asset) => asset.status || "in_stock"))];
  if (statuses.length === 1) return statusBadge(statuses[0]);
  const checkedOut = group.assets.filter((asset) => asset.status === "checked_out").length;
  const inStock = group.assets.filter((asset) => asset.status === "in_stock").length;
  return `<span class="badge warn">混合</span><span class="mini-meta">在库 ${inStock} / 出库 ${checkedOut}</span>`;
}

function assetGroupLocations(group) {
  return blank([...new Set(group.assets.map((asset) => blank(asset.location)).filter((item) => item !== "-"))].join("；"));
}

function assetGroupPeople(group) {
  const people = group.assets
    .map((asset) => {
      const flow = assetFlow(asset);
      return flow.borrowerName !== "-" ? flow.borrowerName : userName(asset.keeperId);
    })
    .filter((name) => name && name !== "未知用户");
  return blank([...new Set(people)].join("；"));
}

function latestGroupRecord(group, type) {
  return group.assets
    .flatMap((asset) => state.records.filter((record) => record.assetId === asset.id && record.type === type))
    .sort((a, b) => recordMillis(b) - recordMillis(a))[0];
}

function assetGroupRecordDetail(group, type, mode = "html") {
  const record = latestGroupRecord(group, type);
  if (!record) return "-";
  const time = type === "入库" ? fmt(record.inTime) : fmt(record.outTime);
  const actorLabel = type === "入库" ? "经办" : "使用";
  const parts = [
    `${type}：${time}`,
    `${actorLabel}人：${userName(record.userId)}`,
    `数量：${record.quantity || "-"}`,
    `单号：${record.paperNo || "-"}`
  ];
  if (mode === "text") return parts.join("；");
  return `<div class="flow-detail">${parts.map((item) => `<span>${item}</span>`).join("")}</div>`;
}

function borrowerRecordsForUser(userId) {
  if (!userId || userId === "all") return [];
  return state.records
    .filter((record) => record.type === "出库" && record.userId === userId)
    .sort((a, b) => recordMillis(b) - recordMillis(a));
}

function borrowerAssetsForUser(userId) {
  if (!userId || userId === "all") return [];
  const recordAssetIds = new Set(borrowerRecordsForUser(userId).map((record) => record.assetId));
  return state.assets
    .filter((asset) => asset.keeperId === userId || asset.useUserId === userId || assetFlow(asset).borrowerId === userId || recordAssetIds.has(asset.id))
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "zh-Hans-CN", { numeric: true, sensitivity: "base" }));
}

function borrowerDetailRows(userId, kind) {
  const assets = borrowerAssetsForUser(userId).filter((asset) => assetKind(asset) === kind);
  return assets.map((asset) => {
    const records = state.records
      .filter((record) => record.assetId === asset.id && record.userId === userId && record.type === "出库")
      .sort((a, b) => recordMillis(b) - recordMillis(a));
    const latest = records[0] || {};
    return { asset, latest, records };
  });
}

function renderBorrowerDetailTable(rows, emptyText) {
  if (!rows.length) return `<div class="empty compact-empty">${emptyText}</div>`;
  return `
    <div class="table-wrap compact-table">
      <table>
        <thead><tr><th>名称</th><th>规格/类别</th><th>数量</th><th>领取/出借时间</th><th>单号</th><th>来源</th><th>状态</th></tr></thead>
        <tbody>
          ${rows.map(({ asset, latest }) => `
            <tr>
              <td><strong>${asset.name}</strong><div class="mini-meta">${asset.code}</div></td>
              <td>${blank(asset.spec || asset.category)}</td>
              <td>${latest.quantity || asset.quantity || 1}</td>
              <td>${fmt(latest.outTime)}</td>
              <td>${blank(latest.paperNo)}</td>
              <td>${blank(sourceFilesFromText(`${asset.remark || ""}；${latest.note || ""}`).join("；"))}</td>
              <td>${statusBadge(asset.status)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderBorrowerDetailPanel() {
  if (!assetBorrowerFilter || assetBorrowerFilter === "all") return "";
  const person = state.users.find((user) => user.id === assetBorrowerFilter);
  const assetRows = borrowerDetailRows(assetBorrowerFilter, "资产");
  const consumableRows = borrowerDetailRows(assetBorrowerFilter, "耗材");
  const records = borrowerRecordsForUser(assetBorrowerFilter);
  return `
    <section class="borrower-detail-panel no-print">
      <div class="asset-list-title">
        <div>
          <h3>${userName(assetBorrowerFilter)}的出借详情</h3>
          <span>${person?.department ? `${person.department} · ` : ""}资产 ${assetRows.length} 项 / 耗材 ${consumableRows.length} 项 / 出库记录 ${records.length} 条</span>
        </div>
        <button class="ghost small" id="clearBorrowerDetail" type="button">关闭详情</button>
      </div>
      <div class="borrower-detail-grid">
        <section>
          <div class="section-title compact-title"><h2>领取 / 借用资产</h2><span class="hint">${assetRows.length} 项</span></div>
          ${renderBorrowerDetailTable(assetRows, "这个人暂无资产领取或借用记录")}
        </section>
        <section>
          <div class="section-title compact-title"><h2>耗材领用</h2><span class="hint">${consumableRows.length} 项</span></div>
          ${renderBorrowerDetailTable(consumableRows, "这个人暂无耗材领用记录")}
        </section>
      </div>
    </section>
  `;
}

function assetGroupSourceFiles(group) {
  const files = group.assets.flatMap((asset) => {
    const fromAsset = sourceFilesFromText(asset.remark);
    const fromRecords = state.records
      .filter((record) => record.assetId === asset.id)
      .flatMap((record) => sourceFilesFromText(record.note));
    return [...fromAsset, ...fromRecords];
  });
  return blank([...new Set(files)].join("；"));
}

function assetGroupMatches(group, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return includesQuery([
    group.model,
    group.name,
    group.spec,
    group.category,
    group.quantity,
    assetGroupLocations(group),
    assetGroupPeople(group),
    assetGroupRecordDetail(group, "入库", "text"),
    assetGroupRecordDetail(group, "出库", "text"),
    assetGroupSourceFiles(group)
  ], q);
}

function filteredAssetGroups() {
  return assetGroups().filter((group) => {
    if (selectedAssetId && !group.assets.some((asset) => asset.id === selectedAssetId)) return false;
    if (assetStatusFilter !== "all" && !group.assets.some((asset) => asset.status === assetStatusFilter)) return false;
    if (assetKeeperFilter !== "all" && !group.assets.some((asset) => asset.keeperId === assetKeeperFilter || assetFlow(asset).borrowerId === assetKeeperFilter)) return false;
    if (assetBorrowerFilter !== "all" && !group.assets.some((asset) => {
      const flow = assetFlow(asset);
      return asset.keeperId === assetBorrowerFilter
        || asset.useUserId === assetBorrowerFilter
        || flow.borrowerId === assetBorrowerFilter
        || state.records.some((record) => record.assetId === asset.id && record.userId === assetBorrowerFilter && record.type === "出库");
    })) return false;
    return assetGroupMatches(group, assetFilter);
  }).sort(compareAssetGroups);
}

function assetGroupSortValue(group, field) {
  const latestIn = latestGroupRecord(group, "入库");
  const latestOut = latestGroupRecord(group, "出库");
  const values = {
    model: group.model,
    category: group.category,
    quantity: Number(group.quantity || 0),
    location: assetGroupLocations(group),
    status: [...new Set(group.assets.map((asset) => asset.status || "in_stock"))].join("；"),
    people: assetGroupPeople(group),
    inTime: latestIn?.inTime || "",
    outTime: latestOut?.outTime || "",
    source: assetGroupSourceFiles(group)
  };
  return values[field] ?? values.model;
}

function compareAssetGroups(left, right) {
  const leftValue = assetGroupSortValue(left, assetSortField);
  const rightValue = assetGroupSortValue(right, assetSortField);
  const direction = assetSortDir === "desc" ? -1 : 1;
  if (typeof leftValue === "number" || typeof rightValue === "number") {
    return (Number(leftValue || 0) - Number(rightValue || 0)) * direction || left.model.localeCompare(right.model, "zh-Hans-CN", { numeric: true });
  }
  return String(leftValue || "").localeCompare(String(rightValue || ""), "zh-Hans-CN", { numeric: true, sensitivity: "base" }) * direction
    || left.model.localeCompare(right.model, "zh-Hans-CN", { numeric: true, sensitivity: "base" });
}

function recordDocumentType(record) {
  const asset = state.assets.find((item) => item.id === record.assetId);
  if (record.documentType) return record.documentType;
  if (record.note?.includes("耗材")) return "耗材领用";
  if (asset?.category?.includes("耗材")) return "耗材领用";
  if (record.note?.includes("Word领用单导入")) return "资产领用";
  return "-";
}

function assetKind(asset) {
  const category = String(asset?.category || "").trim();
  const name = String(asset?.name || "").trim();
  const remark = String(asset?.remark || "");
  const templateNoise = ["固定资产", "低值易耗品", "耗材", "购进软件"].every((label) => category.includes(label));
  const sourceConsumable = remark
    .split(/导入文件：|；|;/)
    .some((part) => part.includes("耗材") && /\.(docx?|xlsx?)\b/i.test(part));
  if (name.includes("耗材") || category === "耗材" || category === "耗材领用" || sourceConsumable) return "耗材";
  if (category.includes("耗材") && !templateNoise) return "耗材";
  return "资产";
}

function recordKind(record) {
  const asset = state.assets.find((item) => item.id === record.assetId);
  const type = recordDocumentType(record);
  if (type.includes("耗材")) return "耗材";
  return assetKind(asset);
}

function recordDisplayNote(record) {
  return record.displayNote || "-";
}

function suspectText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/import-[a-z0-9]+/gi, "")
    .replace(/[0-9a-z]+(?:-[0-9a-z]+){2,}/gi, "")
    .replace(/[^\u4e00-\u9fa5a-z0-9]/gi, "");
}

function suspectDate(record) {
  return String(record.outTime || record.inTime || "").slice(0, 10);
}

function suspectRecordText(record) {
  return suspectText([
    assetName(record.assetId),
    recordDocumentType(record),
    recordDisplayNote(record)
  ].join(" "));
}

function suspectSimilarity(left, right) {
  const a = suspectText(left);
  const b = suspectText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  const grams = (text) => {
    const set = new Set();
    for (let index = 0; index < text.length - 1; index += 1) set.add(text.slice(index, index + 2));
    return set.size ? set : new Set([text]);
  };
  const leftGrams = grams(a);
  const rightGrams = grams(b);
  let overlap = 0;
  leftGrams.forEach((item) => {
    if (rightGrams.has(item)) overlap += 1;
  });
  return overlap / Math.max(leftGrams.size, rightGrams.size);
}

function suspectedDuplicateRecordGroups(records) {
  const candidates = records.filter((record) => record.paperNo || record.note?.includes("导入文件：") || record.note?.includes("Word领用单导入"));
  const groups = [];
  candidates.forEach((record) => {
    const keyDate = suspectDate(record);
    const keyPaper = String(record.paperNo || "").trim();
    const keyText = suspectRecordText(record);
    if (!keyText) return;
    const group = groups.find((item) => {
      const sample = item.records[0];
      const samePaper = keyPaper && sample.paperNo && keyPaper === sample.paperNo;
      const sameDate = keyDate && suspectDate(sample) && keyDate === suspectDate(sample);
      const closeText = suspectSimilarity(keyText, item.text) >= 0.72;
      const sameDocumentContext = samePaper || sameDate || recordDocumentType(record) === recordDocumentType(sample);
      return record.type === sample.type && sameDocumentContext && closeText;
    });
    if (group) {
      group.records.push(record);
      group.text = group.records.map(suspectRecordText).sort((a, b) => b.length - a.length)[0] || group.text;
    } else {
      groups.push({ text: keyText, records: [record] });
    }
  });
  return groups.filter((group) => group.records.length > 1);
}

function renderSuspectedDuplicateRecords(records) {
  const groups = suspectedDuplicateRecordGroups(records);
  if (!groups.length) return "";
  const total = groups.reduce((sum, group) => sum + group.records.length, 0);
  const modeButtons = `
    <div class="suspect-duplicate-actions" role="group" aria-label="疑似重复档显示挡位">
      ${["expanded", "compact", "hidden"].map((mode) => {
        const label = { expanded: "展开", compact: "收起", hidden: "隐藏" }[mode];
        return `<button class="${suspectDuplicateMode === mode ? "active" : ""}" data-suspect-duplicate-mode="${mode}" type="button">${label}</button>`;
      }).join("")}
    </div>
  `;
  if (suspectDuplicateMode === "hidden") {
    return `
      <div class="suspect-duplicate-box is-hidden">
        <div class="section-title"><h2>疑似重复档</h2><span class="hint">已隐藏 ${groups.length} 组 / ${total} 条</span>${modeButtons}</div>
      </div>
    `;
  }
  if (suspectDuplicateMode === "compact") {
    return `
      <div class="suspect-duplicate-box is-compact">
        <div class="section-title"><h2>疑似重复档</h2><span class="hint">${groups.length} 组 / ${total} 条，当前收起</span>${modeButtons}</div>
      </div>
    `;
  }
  return `
    <div class="suspect-duplicate-box">
      <div class="section-title"><h2>疑似重复档</h2><span class="hint">${groups.length} 组 / ${total} 条，先归档待确认，不自动删除</span>${modeButtons}</div>
      <div class="suspect-duplicate-grid">
        ${groups.map((group) => {
          const sample = group.records[0];
          const names = [...new Set(group.records.map((record) => assetName(record.assetId)))].slice(0, 5);
          const dates = [...new Set(group.records.map(suspectDate).filter(Boolean))].slice(0, 4);
          return `
            <article class="suspect-duplicate-card">
              <div class="card-head"><strong>${recordDocumentType(sample)} · ${sample.type === "出库" ? "出库/出借" : sample.type}</strong><span class="badge warn">疑似重复 ${group.records.length} 条</span></div>
              <p>单号：${blank(sample.paperNo)}，时间：${dates.join(" / ") || "-"}</p>
              <p>内容：${names.join("；")}</p>
            </article>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function recordPhoto(record) {
  if (!record.photo) return "-";
  return `<a class="photo-thumb" href="${record.photo}" target="_blank" rel="noopener"><img src="${record.photo}" alt="现场照片" /></a>`;
}

function displayRemark(value) {
  const hiddenPrefixes = ["模板序号：", "单号：", "导入文件：", "导入时间：", "Word领用单导入", "出借人：", "单据类型：", "负责人：", "申请人："];
  const parts = String(value || "")
    .split("；")
    .map((item) => item.trim())
    .filter((item) => item && !hiddenPrefixes.some((prefix) => item.startsWith(prefix)));
  return blank(parts.join("；"));
}

function fileBaseName(value) {
  return String(value || "").split(/[\\/]/).pop().trim();
}

function sourceFilesFromText(value) {
  const files = String(value || "")
    .split("；")
    .map((item) => item.trim())
    .filter((item) => item.startsWith("导入文件："))
    .map((item) => item.replace("导入文件：", "").trim())
    .map(fileBaseName)
    .filter(Boolean);
  return [...new Set(files)];
}

function sourceFiles(value) {
  return blank(sourceFilesFromText(value).join("；"));
}

function assetSourceFiles(asset) {
  const flow = assetFlow(asset);
  const userId = flow.borrowerId || asset.keeperId;
  const relatedRecords = state.records
    .filter((record) => record.assetId === asset.id && (!userId || record.userId === userId))
    .sort((a, b) => recordMillis(b) - recordMillis(a));
  for (const record of relatedRecords) {
    const files = sourceFilesFromText(record.note);
    if (files.length) return files[files.length - 1];
  }

  const ownerName = userName(userId);
  const compactOwner = ownerName.replace(/\s+/g, "");
  const fromAsset = sourceFilesFromText(asset.remark);
  const matched = compactOwner && ownerName !== "未知用户"
    ? fromAsset.filter((file) => file.replace(/\s+/g, "").includes(compactOwner))
    : [];
  return matched.length ? matched[matched.length - 1] : "-";
}

function statusBadge(status) {
  const cls = status === "in_stock" || status === "已入库" || status === "已归档" ? "ok" : status === "checked_out" || status === "使用中" || status === "待复核" ? "warn" : "bad";
  const text = statusText(status);
  return `<span class="badge ${cls}">${text}</span>`;
}

function statusText(status) {
  return { in_stock: "在库", checked_out: "出库/出借", repair: "维修中", retired: "报废" }[status] || status || "-";
}

function kindBadge(kind) {
  return `<span class="kind-badge ${kind === "耗材" ? "consumable" : "asset"}">${kind}</span>`;
}

function recordTime(record) {
  return record.outTime || record.inTime || "";
}

function recordMillis(record) {
  const value = recordTime(record);
  return value ? new Date(value).getTime() : 0;
}

function assetFlow(asset) {
  const records = state.records
    .filter((record) => record.assetId === asset.id)
    .sort((a, b) => recordMillis(b) - recordMillis(a));
  const latestOut = records.find((record) => record.type === "出库");
  const latestIn = records.find((record) => record.type === "入库");
  const isBorrowed = asset.status === "checked_out" || (latestOut && (!latestIn || recordMillis(latestOut) > recordMillis(latestIn)));
  return {
    borrowerId: isBorrowed ? latestOut?.userId : "",
    borrowerName: isBorrowed ? userName(latestOut?.userId) : "-",
    borrowDepartment: isBorrowed ? userDepartment(latestOut?.userId) : "-",
    borrowTime: isBorrowed ? fmt(latestOut?.outTime) : "-",
    returnTime: latestIn ? fmt(latestIn.inTime) : "-"
  };
}

function latestAssetRecord(asset, type) {
  return state.records
    .filter((record) => record.assetId === asset.id && record.type === type)
    .sort((a, b) => recordMillis(b) - recordMillis(a))[0];
}

function assetRecordDetail(asset, type, mode = "html") {
  const record = latestAssetRecord(asset, type);
  if (!record) return "-";
  const time = type === "入库" ? fmt(record.inTime) : fmt(record.outTime);
  const actorLabel = type === "入库" ? "经办" : "使用";
  const parts = [
    `${type}：${time}`,
    `${actorLabel}人：${userName(record.userId)}`,
    `数量：${record.quantity || "-"}`,
    `单号：${record.paperNo || "-"}`
  ];
  if (mode === "text") return parts.join("；");
  return `<div class="flow-detail">${parts.map((item) => `<span>${item}</span>`).join("")}</div>`;
}

function includesQuery(values, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return values.some((value) => String(value || "").toLowerCase().includes(q));
}

function assetMatches(asset, query) {
  const flow = assetFlow(asset);
  return includesQuery([
    asset.code,
    asset.name,
    asset.category,
    asset.spec,
    asset.location,
    asset.remark,
    userName(asset.keeperId),
    userDepartment(asset.keeperId),
    flow.borrowerName,
    flow.borrowDepartment,
    flow.borrowTime,
    flow.returnTime
  ], query);
}

function recordMatches(record, query) {
  const asset = state.assets.find((item) => item.id === record.assetId);
  return includesQuery([
    record.type,
    record.status,
    record.paperNo,
    record.documentType,
    record.displayNote,
    record.note,
    record.inTime,
    record.outTime,
    record.quantity,
    userName(record.userId),
    userDepartment(record.userId),
    asset?.code,
    asset?.name,
    asset?.category,
    asset?.location,
    asset?.remark
  ], query);
}

function auditMatches(audit) {
  const time = audit.time || "";
  const startTime = auditStartTime || defaultAuditStartTime();
  if (startTime && time < startTime) return false;
  if (auditEndTime && time > auditEndTime) return false;

  const values = {
    time: fmt(time),
    operator: userName(audit.user_id || audit.userId),
    ip: auditIpDisplay(audit.ip),
    action: audit.action,
    detail: audit.detail
  };
  if (auditFilterField === "all") {
    return includesQuery(Object.values(values), auditFilterQuery);
  }
  if (auditFilterField === "time" && auditFilterQuery) {
    return time.slice(0, 10) === auditFilterQuery;
  }
  if (!auditFilterQuery) return true;
  return values[auditFilterField] === auditFilterQuery;
}

function defaultAuditStartTime() {
  const first = state.audits
    .map((audit) => audit.time)
    .filter(Boolean)
    .sort()[0];
  return first ? `${first.slice(0, 10)}T00:00` : "";
}

function auditValue(audit, field) {
  const values = {
    time: audit.time ? audit.time.slice(0, 10) : "",
    operator: userName(audit.user_id || audit.userId),
    ip: auditIpDisplay(audit.ip),
    action: audit.action,
    detail: audit.detail
  };
  return values[field] || "";
}

function auditIpDisplay(value) {
  const ip = String(value || "").trim();
  if (!ip) return "-";
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return `${ip}（Docker转发地址）`;
  if (ip === "127.0.0.1" || ip === "::1") return `${ip}（本机）`;
  return ip;
}

function auditFilterOptions(field) {
  if (field === "all") return [];
  return [...new Set(state.audits.map((audit) => auditValue(audit, field)).filter(Boolean))].sort();
}

function render() {
  if (view === "paper" && !isPaperModuleEnabled()) view = "dashboard";
  const app = document.querySelector("#app");
  app.innerHTML = state.currentUser ? renderShell() : renderLogin();
  bindEvents();
}

function scheduleSearchRender(inputId) {
  if (composingInputs.has(inputId)) return;
  clearTimeout(searchRenderTimer);
  searchRenderTimer = setTimeout(() => {
    const active = document.activeElement;
    const selection = active?.id === inputId
      ? { start: active.selectionStart, end: active.selectionEnd }
      : null;
    render();
    if (selection) {
      const input = document.querySelector(`#${inputId}`);
      input?.focus();
      input?.setSelectionRange(selection.start, selection.end);
    }
  }, 300);
}

function bindSearchInput(selector, updateValue) {
  const input = document.querySelector(selector);
  if (!input) return;
  input.addEventListener("compositionstart", () => {
    composingInputs.add(input.id);
    clearTimeout(searchRenderTimer);
  });
  input.addEventListener("compositionend", (event) => {
    composingInputs.delete(input.id);
    updateValue(event.target.value);
    scheduleSearchRender(input.id);
  });
  input.addEventListener("input", (event) => {
    updateValue(event.target.value);
    if (event.isComposing || composingInputs.has(input.id)) return;
    scheduleSearchRender(input.id);
  });
}

function renderLogin() {
  const defaultUser = loginSettings.adminPrefillEnabled ? "admin" : "";
  const defaultPassword = loginSettings.adminPrefillEnabled ? loginSettings.adminPrefillPassword || "" : "";
  return `
    <section class="login-shell" ${loginBackgroundStyle()}>
      <div class="login-copy">
        <h1>厂库出入库管理系统</h1>
        <p>系统运行在 Docker 服务中，登录、资产、出入库、纸质单据和后台操作记录全部写入容器数据库。</p>
      </div>
      <form class="login-panel" id="loginForm">
        <h2>用户登录</h2>
        <p class="hint">管理员查看全部资产和操作记录，普通用户查看自己的出入库状态。</p>
        <div class="field">
          <label for="username">姓名</label>
          <input id="username" name="username" autocomplete="username" required value="${defaultUser}" />
        </div>
        <div class="field">
          <label for="password">密码</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required value="${defaultPassword}" />
        </div>
        <label class="check-line">
          <input name="rememberLogin" type="checkbox" checked />
          <span>保持一直登录</span>
        </label>
        <p class="hint">使用姓名+密码登录。</p>
        <p class="error" id="loginError"></p>
        <button class="primary" type="submit">登录</button>
      </form>
    </section>
  `;
}

function renderShell() {
  const user = state.currentUser;
  const pendingAdminRequests = (state.adminRequests || []).filter((item) => item.status === "待处理").length;
  const navItems = [
    ["dashboard", "总览", "⌂"],
    ["assets", "资产状态", "▦"],
    ["inventory", "库存管理", "▥"],
    ["records", can("records.manage") ? "出入库登记" : "我的出入库", "⇄"],
    ["checks", "盘点管理", "☑"],
    ["orders", "业务单据", "▧"],
    ["reports", "报表统计", "▨"],
    ["assetRequests", can("asset_requests.manage") ? "资产申请" : "申请资产", "□"],
    ["purchaseWishes", "需求清单", "☆"],
    ["paper", "纸质单据方案", "▤"],
    ["users", pendingAdminRequests ? `用户管理(${pendingAdminRequests})` : "用户管理", "◉"],
    ["baseData", "基础数据", "▣"],
    ["settings", "设置", "⚙"],
    ["audit", "操作记录", "◎"]
  ].filter(([key]) => canMenu(key));
  return `
    <section class="layout">
      <aside class="sidebar">
        <div class="brand">
          <strong>厂库管理</strong>
          <span>Docker + SQLite</span>
        </div>
        <nav class="nav">
          ${navItems.map(([key, label, icon]) => `
            <button data-view="${key}" class="${view === key ? "active" : ""}">
              <span class="nav-icon">${icon}</span>
              <span>${label}</span>
            </button>
          `).join("")}
        </nav>
        <div class="user-chip">
          <div class="user-profile">
            <span class="avatar">${user.name.slice(0, 1).toUpperCase()}</span>
            <div>
              <strong>${user.name}</strong>
              <span>${isUserViewMode() ? "普通用户视角" : user.roleName || roleLabel(user.roleId || user.role)}${isMultiDepartment() ? ` · ${user.department}` : ""}</span>
            </div>
          </div>
          ${!isAdmin() ? renderAdminRequestControl() : ""}
          <button class="secondary" id="changeMyPasswordBtn" type="button">修改密码</button>
          ${isRealAdmin() ? `<button class="secondary" id="toggleViewModeBtn" type="button">${isUserViewMode() ? "恢复管理员权限" : "切换普通用户权限"}</button>` : ""}
          <button class="ghost" id="logoutBtn" type="button">退出登录</button>
        </div>
      </aside>
      <section class="content">
        <header class="topbar">
          <div>
            <h1>${pageTitle()}</h1>
            <p>${pageSubtitle()}</p>
          </div>
          <div class="topbar-actions">
            ${view === "assets" ? renderAssetTopbarActions() : ""}
            ${can("asset_requests.manage") || can("users.manage") ? renderMessageCenter() : ""}
          </div>
        </header>
        ${renderView()}
        ${renderContextMenu()}
      </section>
    </section>
  `;
}

function renderAssetTopbarActions() {
  return `
    <div class="asset-page-actions no-print">
      <button class="secondary" id="downloadAssets" type="button">下载资产表</button>
      <button class="secondary" id="printAssets" type="button">打印资产表</button>
      <button class="secondary" id="exportPrintTemplates" type="button">导出模板单</button>
      ${can("assets.manage") ? `<button class="primary" id="openAssetDrawer" type="button">+ 新增资产</button>` : ""}
    </div>
  `;
}

function renderAdminRequestControl() {
  if (isRealAdmin()) return "";
  const latest = state.adminRequests?.[0];
  if (latest?.status === "待处理") {
    return `<span class="hint">管理员申请：待处理</span>`;
  }
  if (latest?.status === "已批准" && state.currentUser?.actualRole === "admin") {
    return `<span class="hint">管理员申请：已批准，请重新登录</span>`;
  }
  return `<button class="secondary" id="requestAdminBtn" type="button">申请管理员权限</button>`;
}

function renderMessageCenter() {
  const requests = state.adminRequests || [];
  const pending = requests.filter((item) => item.status === "待处理");
  const assetPending = (state.assetRequests || []).filter((item) => item.status === "待处理");
  const wishPending = (state.purchaseWishes || []).filter((item) => item.status === "待采购" || item.status === "已采纳");
  const pendingTotal = pending.length + assetPending.length + wishPending.length;
  return `
    <div class="message-center">
      <button class="message-button" id="messageCenterBtn" type="button" title="消息">
        <span class="message-icon">✉</span>
        ${pendingTotal ? `<span class="message-badge">${pendingTotal}</span>` : ""}
      </button>
      ${messagePanelOpen ? `
        <div class="message-panel">
          <div class="message-head">
            <strong>消息</strong>
            <div class="message-actions">
              <span class="hint">待处理 ${pendingTotal} 条</span>
              ${pending.length ? `<button class="secondary small" id="markAllMessagesRead" type="button">一键已读</button>` : ""}
            </div>
          </div>
          ${renderAdminRequestsPanel("compact")}
          ${renderAssetRequestMessages()}
          ${renderPurchaseWishMessages()}
        </div>
      ` : ""}
    </div>
  `;
}

function pageTitle() {
  return {
    dashboard: "业务总览",
    assets: "资产状态",
    inventory: "库存管理",
    checks: "盘点管理",
    orders: "业务单据",
    reports: "报表统计",
    assetRequests: isAdmin() ? "资产申请管理" : "申请资产",
    purchaseWishes: isAdmin() ? "采购需求清单" : "我的需求清单",
    records: isAdmin() ? "出入库登记" : "我的出入库状态",
    paper: "纸质单据电子化方案",
    users: "用户管理",
    baseData: "基础数据",
    settings: "系统设置",
    audit: "后台操作记录"
  }[view];
}

function pageSubtitle() {
  return {
    dashboard: "从数据库读取库存、出库、纸质单据和近期操作。",
    assets: "管理员可打印资产表，普通用户仅看与自己相关资产。",
    inventory: "针对易耗品查看当前库存、安全库存、流水、预警和库存调整。",
    checks: "按位置、分类、责任人或状态生成盘点任务，录入实际结果并生成差异。",
    orders: "办理正式领用、借用归还、调拨、维修和报废流程。",
    reports: "按资产总账、分类、部门、位置、责任人、流水和盘点差异导出报表。",
    assetRequests: isAdmin() ? "处理普通用户提交的资产领用申请。" : "填写需要领用的资产、数量和用途，等待管理员处理。",
    purchaseWishes: isAdmin() ? "汇总每个人下一年度想要或需要的设备，为预算和采购提供参考。" : "写下自己希望采购或补充的设备，管理员会用于预算和采购参考。",
    records: "登记入库时间、出库时间、经办人和纸质单据编号。",
    paper: "把手写材料通过拍照、编号、复核和电子台账串起来。",
    users: "维护多用户架构和角色权限。",
    baseData: "维护资产类别等基础数据。",
    settings: "维护系统基础配置。",
    audit: "追踪登录、登记、修改、纸质单据处理等动作。"
  }[view];
}

function renderView() {
  return {
    dashboard: renderDashboard,
    assets: renderAssets,
    inventory: renderInventory,
    checks: renderInventoryChecks,
    orders: renderOrders,
    reports: renderReports,
    assetRequests: renderAssetRequests,
    purchaseWishes: renderPurchaseWishes,
    records: renderRecords,
    paper: renderPaper,
    users: renderUsers,
    baseData: renderBaseData,
    settings: renderSettings,
    audit: renderAudit
  }[view]();
}

function renderDashboard() {
  const matchedAssets = state.assets.filter((asset) => assetMatches(asset, dashboardSearch));
  const matchedRecords = state.records.filter((record) => recordMatches(record, dashboardSearch));
  const assetItems = matchedAssets.filter((asset) => assetKind(asset) === "资产");
  const consumableItems = matchedAssets.filter((asset) => assetKind(asset) === "耗材");
  const assetRecords = matchedRecords.filter((record) => recordKind(record) === "资产");
  const consumableRecords = matchedRecords.filter((record) => recordKind(record) === "耗材");
  const checkedOutAssets = assetItems.filter((asset) => asset.status === "checked_out").length;
  const checkedOutConsumables = consumableItems.filter((asset) => asset.status === "checked_out").length;
  const paperPending = state.paperQueue.filter((item) => item.status !== "已归档").length;
  const assetLimit = dashboardSearch ? 30 : 6;
  const consumableLimit = dashboardSearch ? 30 : 6;
  return `
    <section class="dashboard-search">
      <div class="dashboard-search-inner">
        <span class="search-mark">⌕</span>
        <input id="dashboardSearch" placeholder="搜索资产编号、名称、位置、借用人、纸质单号、备注" value="${dashboardSearch}" />
        <button class="primary" type="button" data-view="dashboard">搜索</button>
      </div>
    </section>
    <div class="dashboard-stats">
      ${dashboardStatCard(dashboardSearch ? "匹配资产类" : "资产类", assetItems.length, `出库中 ${checkedOutAssets}`, "▦")}
      ${dashboardStatCard(dashboardSearch ? "匹配耗材类" : "耗材类", consumableItems.length, `领用中 ${checkedOutConsumables}`, "◍")}
      ${dashboardStatCard(dashboardSearch ? "匹配出入库" : "出入库记录", matchedRecords.length, `资产 ${assetRecords.length} / 耗材 ${consumableRecords.length}`, "⇄")}
      ${dashboardStatCard("待处理纸质单", paperPending, "需复核或归档", "▤")}
    </div>
    <div class="dashboard-grid">
      ${renderDashboardRecordPanel("资产近期出入库", assetRecords.slice(0, assetLimit), "暂无资产出入库记录")}
      ${renderDashboardRecordPanel("耗材近期领用", consumableRecords.slice(0, consumableLimit), "暂无耗材领用记录")}
      ${renderReminderPanel("资产状态提醒", assetItems, "资产", checkedOutAssets, paperPending)}
      ${renderReminderPanel("耗材状态提醒", consumableItems, "耗材", checkedOutConsumables, paperPending)}
    </div>
  `;
}

function dashboardStatCard(label, value, sub, icon) {
  return `
    <article class="dashboard-stat">
      <span class="stat-icon">${icon}</span>
      <div>
        <span>${label}</span>
        <strong>${value}</strong>
        <em>${sub}</em>
      </div>
    </article>
  `;
}

function renderDashboardRecordPanel(title, records, emptyText) {
  return `
    <section class="dashboard-panel">
      <div class="section-title"><h2>${title}</h2></div>
      ${renderDashboardRecordRows(records, emptyText)}
    </section>
  `;
}

function renderDashboardRecordRows(records, emptyText) {
  if (!records.length) return `<div class="empty compact-empty">${emptyText}</div>`;
  return `<div class="dashboard-record-list">${records.map((record) => {
    const asset = state.assets.find((item) => item.id === record.assetId) || {};
    return `
      <article class="dashboard-record-row">
        <div class="record-main">
          <strong>${asset.name || assetName(record.assetId)}</strong>
          <span>${record.type} · ${recordDocumentType(record)} · ${userName(record.userId)}</span>
          <em>${fmt(recordTime(record))} / 数量 ${record.quantity || "-"}</em>
        </div>
        <div class="record-side">
          ${statusBadge(record.status)}
          ${isAdmin() ? `<button class="danger small" data-delete-record="${record.id}" type="button">删除</button>` : ""}
        </div>
      </article>
    `;
  }).join("")}</div>`;
}

function renderReminderPanel(title, items, kind, activeCount, paperPending) {
  const lowStock = items.filter((asset) => Number(asset.quantity || 0) <= 1).length;
  const inStock = items.filter((asset) => asset.status === "in_stock").length;
  return `
    <section class="dashboard-panel">
      <div class="section-title"><h2>${title}</h2></div>
      <div class="reminder-list">
        ${reminderRow("库存不足", `${lowStock} 项`, lowStock ? "warn" : "ok", "需补充数量小于等于 1 的${kind}")}
        ${reminderRow(kind === "资产" ? "待归还" : "领用中", `${activeCount} 项`, activeCount ? "warn" : "ok", kind === "资产" ? "当前处于出库中的资产" : "当前处于领用中的耗材")}
        ${reminderRow("可用库存", `${inStock} 项`, "ok", `仍在库的${kind}`)}
        ${reminderRow("纸质单待处理", `${paperPending} 张`, paperPending ? "bad" : "ok", "等待复核、归档或电子化留档")}
      </div>
    </section>
  `;
}

function reminderRow(label, value, tone, note) {
  return `
    <div class="reminder-row ${tone}">
      <span class="reminder-dot"></span>
      <div>
        <strong>${label}</strong>
        <em>${note}</em>
      </div>
      <b>${value}</b>
    </div>
  `;
}

function renderAssetCards(items, emptyText) {
  const visible = items.slice(0, dashboardSearch ? 50 : 8);
  return `
    <div class="record-list">
      ${visible.map((asset) => `
        <article class="record-card">
          <div class="card-head">
            <strong>${asset.name} · ${asset.code}</strong>
            ${isAdmin() ? `<button class="danger small" data-delete-asset="${asset.id}" type="button">删除</button>` : ""}
          </div>
          <p>${statusBadge(asset.status)} 数量：${asset.quantity}，位置：${blank(asset.location)}</p>
          <p>借用人：${assetFlow(asset).borrowerName}，借出：${assetFlow(asset).borrowTime}，最近归还：${assetFlow(asset).returnTime}</p>
          <p>保管人：${userName(asset.keeperId)}，备注：${displayRemark(asset.remark)}</p>
        </article>
      `).join("") || `<div class="empty">${emptyText}</div>`}
    </div>
  `;
}

function renderAssets() {
  const groups = filteredAssetGroups();
  const printableAssets = filteredAssets();
  const keeperOptions = selectableUsers().map((user) => `<option value="${user.id}" ${assetKeeperFilter === user.id ? "selected" : ""}>${user.name}</option>`).join("");
  const borrowerOptions = selectableUsers().map((user) => `<option value="${user.id}" ${assetBorrowerFilter === user.id ? "selected" : ""}>${user.name}${isMultiDepartment() ? ` · ${user.department}` : ""}</option>`).join("");
  return `
    <section class="asset-workspace">
      <div class="asset-filter-bar no-print">
        <input id="assetSearch" placeholder="搜索型号 / 规格 / 类别 / 使用人 / 出入库详情" value="${assetFilter}" />
        <select id="assetStatusFilter">
          <option value="all" ${assetStatusFilter === "all" ? "selected" : ""}>状态：全部</option>
          <option value="in_stock" ${assetStatusFilter === "in_stock" ? "selected" : ""}>状态：在库</option>
          <option value="checked_out" ${assetStatusFilter === "checked_out" ? "selected" : ""}>状态：出库/出借</option>
          <option value="repair" ${assetStatusFilter === "repair" ? "selected" : ""}>状态：维修中</option>
          <option value="retired" ${assetStatusFilter === "retired" ? "selected" : ""}>状态：报废</option>
        </select>
        <select id="assetKeeperFilter">
          <option value="all" ${assetKeeperFilter === "all" ? "selected" : ""}>保管人：全部</option>
          ${keeperOptions}
        </select>
        <select id="assetBorrowerFilter">
          <option value="all" ${assetBorrowerFilter === "all" ? "selected" : ""}>查看出借详情：全部人员</option>
          ${borrowerOptions}
        </select>
        <select id="assetSortField">
          <option value="model" ${assetSortField === "model" ? "selected" : ""}>排序：型号/规格</option>
          <option value="category" ${assetSortField === "category" ? "selected" : ""}>排序：类别</option>
          <option value="quantity" ${assetSortField === "quantity" ? "selected" : ""}>排序：数量</option>
          <option value="location" ${assetSortField === "location" ? "selected" : ""}>排序：位置</option>
          <option value="status" ${assetSortField === "status" ? "selected" : ""}>排序：状态</option>
          <option value="people" ${assetSortField === "people" ? "selected" : ""}>排序：使用/保管人</option>
          <option value="inTime" ${assetSortField === "inTime" ? "selected" : ""}>排序：最近入库</option>
          <option value="outTime" ${assetSortField === "outTime" ? "selected" : ""}>排序：最近出库</option>
          <option value="source" ${assetSortField === "source" ? "selected" : ""}>排序：文件来源</option>
        </select>
        <select id="assetSortDir">
          <option value="asc" ${assetSortDir === "asc" ? "selected" : ""}>升序</option>
          <option value="desc" ${assetSortDir === "desc" ? "selected" : ""}>降序</option>
        </select>
        <button class="secondary" id="clearAssetSelection" type="button">重置</button>
      </div>
      ${renderBorrowerDetailPanel()}
      <div class="asset-list-panel">
        <div class="asset-list-title">
          <h3>资产列表</h3>
          <span>共 ${groups.length} 类 / ${printableAssets.length} 条明细</span>
        </div>
      <div class="table-wrap asset-table-wrap">
        <table>
          <thead>
            <tr>
              <th>型号/规格</th><th>类别</th><th>数量</th><th>位置</th><th>状态</th><th>当前使用/保管</th><th>入库详情</th><th>出库详情</th><th>文件来源</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${groups.map((group) => `
              <tr>
                <td><strong>${group.model}</strong><div class="mini-meta">合并 ${group.count} 条资产明细</div></td>
                <td>${group.category}</td>
                <td>${group.quantity}</td>
                <td>${assetGroupLocations(group)}</td>
                <td>${assetGroupStatus(group)}</td>
                <td>${assetGroupPeople(group)}</td>
                <td>${assetGroupRecordDetail(group, "入库")}</td>
                <td>${assetGroupRecordDetail(group, "出库")}</td>
                <td>${assetGroupSourceFiles(group)}</td>
                ${can("assets.manage") ? `<td><div class="row-actions"><button class="ghost small" data-view-asset="${group.id}" type="button">详情</button>${group.count === 1 ? `<button class="ghost small" data-edit-asset="${group.id}" type="button">编辑</button><button class="danger small" data-delete-asset="${group.id}" type="button">删除</button>` : `<span class="mini-meta">已按型号归类</span>`}</div></td>` : `<td><button class="ghost small" data-view-asset="${group.id}" type="button">详情</button></td>`}
              </tr>
            `).join("") || `<tr><td colspan="10" class="empty">暂无资产</td></tr>`}
          </tbody>
        </table>
      </div>
      </div>
    </section>
    ${renderPrintableAssetSheets(printableAssets)}
    ${can("assets.manage") && assetDrawerOpen ? renderAssetDrawer() : ""}
    ${selectedAssetDetailId ? renderAssetDetailDrawer() : ""}
  `;
}

function inventoryItems() {
  return state.assets
    .filter((asset) => assetKind(asset) === "耗材")
    .filter((asset) => assetMatches(asset, inventoryFilter))
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "zh-Hans-CN", { numeric: true, sensitivity: "base" }));
}

function inventoryRecords(type = "") {
  const consumableIds = new Set(state.assets.filter((asset) => assetKind(asset) === "耗材").map((asset) => asset.id));
  return state.records
    .filter((record) => consumableIds.has(record.assetId))
    .filter((record) => !type || record.type === type)
    .filter((record) => recordMatches(record, inventoryFilter))
    .sort((a, b) => recordMillis(b) - recordMillis(a));
}

function stockLevel(asset) {
  const quantity = Number(asset.quantity || 0);
  const safeStock = Number(asset.safeStock || 0);
  if (safeStock > 0 && quantity <= safeStock) return "warn";
  if (quantity <= 0) return "bad";
  return "ok";
}

function stockLevelText(asset) {
  const level = stockLevel(asset);
  if (level === "bad") return `<span class="badge bad">无库存</span>`;
  if (level === "warn") return `<span class="badge warn">低于安全库存</span>`;
  return `<span class="badge ok">正常</span>`;
}

function lendableStatusBadge(asset) {
  if (asset.status === "retired") return `<span class="badge bad">不可出借</span>`;
  if (asset.status === "repair") return `<span class="badge warn">维修中</span>`;
  return `<span class="badge ok">可出借</span>`;
}

function renderInventoryFlow(records, emptyText) {
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>时间</th><th>耗材</th><th>数量</th><th>经办/领用人</th><th>单号</th><th>备注</th></tr></thead>
        <tbody>
          ${records.map((record) => `
            <tr>
              <td>${fmt(record.type === "入库" ? record.inTime : record.outTime)}</td>
              <td>${assetName(record.assetId)}</td>
              <td>${record.quantity}</td>
              <td>${userName(record.userId)}</td>
              <td>${blank(record.paperNo)}</td>
              <td>${recordDisplayNote(record)}</td>
            </tr>
          `).join("") || `<tr><td colspan="6" class="empty">${emptyText}</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function renderInventory() {
  const items = inventoryItems();
  const blockedItems = items.filter((asset) => asset.status === "retired" || asset.status === "repair");
  const inboundRecords = inventoryRecords("入库");
  const outboundRecords = inventoryRecords("出库");
  const lendableCount = items.length - blockedItems.length;
  const itemOptions = items.map((asset) => `<option value="${asset.id}">${asset.name}${asset.spec ? ` · ${asset.spec}` : ""}（可出借）</option>`).join("");
  return `
    <section class="asset-workspace">
      <div class="asset-filter-bar no-print">
        <input id="inventorySearch" placeholder="搜索耗材名称 / 类别 / 规格 / 流水备注" value="${inventoryFilter}" />
        <button class="secondary" id="clearInventorySearch" type="button">重置</button>
      </div>
      <div class="stats">
        <div class="stat"><span>物品种类</span><strong>${items.length}</strong><em>当前纳入出借管理</em></div>
        <div class="stat"><span>当前库存</span><strong>-</strong><em>不按仓库数量汇总</em></div>
        <div class="stat"><span>可出借</span><strong>${lendableCount}</strong><em>维修/报废除外</em></div>
        <div class="stat"><span>流水记录</span><strong>${inboundRecords.length + outboundRecords.length}</strong><em>入库 + 出库</em></div>
      </div>
      ${can("inventory.manage") ? `
        <section class="panel">
          <div class="section-title"><h2>库存调整</h2><span class="hint">用于盘点修正、损耗、补录等场景，会同步生成流水。</span></div>
          <form id="inventoryAdjustForm" class="form-grid">
            <div class="field"><label>耗材</label><select name="assetId" required>${itemOptions}</select></div>
            <div class="field"><label>调整类型</label><select name="mode"><option value="increase">增加库存</option><option value="decrease">减少库存</option></select></div>
            <div class="field"><label>数量</label><input name="quantity" type="number" min="1" value="1" required /></div>
            <div class="field"><label>经办/领用人</label><select name="userId">${selectableUsers().map((user) => `<option value="${user.id}">${user.name}${isMultiDepartment() ? ` · ${user.department}` : ""}</option>`).join("")}</select></div>
            <div class="field"><label>单号</label><input name="paperNo" placeholder="可选" /></div>
            <div class="field"><label>原因</label><input name="reason" placeholder="盘点调整 / 损耗 / 补录" /></div>
            <div class="actions form-grid wide"><button class="primary" type="submit">保存调整</button></div>
          </form>
        </section>
      ` : ""}
      <section class="panel">
        <div class="section-title"><h2>当前库存</h2><span class="hint">此处不统计仓库数量，只判断是否可出借。</span></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>耗材</th><th>类别</th><th>规格</th><th>当前库存</th><th>安全库存</th><th>位置</th><th>状态</th>${can("inventory.manage") ? "<th>操作</th>" : ""}</tr></thead>
            <tbody>
              ${items.map((asset) => `
                <tr>
                  <td><strong>${asset.name}</strong><div class="mini-meta">${asset.code}</div></td>
                  <td>${blank(asset.category)}</td>
                  <td>${blank(asset.spec)}</td>
                  <td>-</td>
                  <td>-</td>
                  <td>-</td>
                  <td>${lendableStatusBadge(asset)}</td>
                  ${can("inventory.manage") ? `<td><span class="mini-meta">按出借管理</span></td>` : ""}
                </tr>
              `).join("") || `<tr><td colspan="${can("inventory.manage") ? 8 : 7}" class="empty">暂无耗材库存</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
      <section class="panel">
        <div class="section-title"><h2>不可出借清单</h2><span class="hint">只显示维修中或已报废的物品。</span></div>
        <div class="record-list">
          ${blockedItems.map((asset) => `
            <article class="record-card">
              <div class="card-head"><strong>${asset.name}</strong>${lendableStatusBadge(asset)}</div>
              <p>当前库存：-，安全库存：-，位置：-</p>
            </article>
          `).join("") || `<div class="empty">暂无不可出借物品</div>`}
        </div>
      </section>
      <section class="grid">
        <div class="panel">
          <div class="section-title"><h2>入库流水</h2><span class="hint">${inboundRecords.length} 条</span></div>
          ${renderInventoryFlow(inboundRecords, "暂无入库流水")}
        </div>
        <div class="panel">
          <div class="section-title"><h2>出库流水</h2><span class="hint">${outboundRecords.length} 条</span></div>
          ${renderInventoryFlow(outboundRecords, "暂无出库流水")}
        </div>
      </section>
    </section>
  `;
}

function checkTaskItems(taskId) {
  return (state.inventoryCheckItems || []).filter((item) => item.taskId === taskId);
}

function checkDiffBadge(diffType) {
  const text = diffType || "未盘点";
  const cls = text === "正常" ? "ok" : text === "未盘点" ? "warn" : "bad";
  return `<span class="badge ${cls}">${text}</span>`;
}

function statusSelectOptions(selected) {
  return [
    ["in_stock", "在库"],
    ["checked_out", "借出/出库"],
    ["repair", "维修中"],
    ["retired", "报废"]
  ].map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join("");
}

function renderInventoryChecks() {
  if (!can("checks.view")) return "";
  const tasks = state.inventoryCheckTasks || [];
  const activeTask = tasks[0];
  const locationOptions = locations().map((location) => `<option value="${location.name}">${location.name}</option>`).join("");
  const categoryOptions = assetCategories().map((category) => `<option value="${category}">${category}</option>`).join("");
  const keeperOptions = selectableUsers().map((user) => `<option value="${user.id}">${user.name}${isMultiDepartment() ? ` · ${user.department}` : ""}</option>`).join("");
  const statusOptions = statusSelectOptions("");
  const items = activeTask ? checkTaskItems(activeTask.id) : [];
  const checked = items.filter((item) => item.checked).length;
  const abnormal = items.filter((item) => item.diffType && item.diffType !== "正常" && item.diffType !== "未盘点").length;
  return `
    <section class="panel">
      <div class="section-title"><h2>创建盘点任务</h2><span class="hint">一期先支持按范围生成资产清单，再人工录入实际结果。</span></div>
      <form id="inventoryCheckForm" class="form-grid">
        <div class="field"><label>盘点范围</label><select name="scopeType" id="checkScopeType"><option value="all">全部资产</option><option value="location">按位置</option><option value="category">按分类</option><option value="keeper">按责任人</option><option value="status">按状态</option></select></div>
        <div class="field"><label>范围值</label><select name="scopeValue" id="checkScopeValue"><option value="">全部</option>${locationOptions}</select></div>
        <div class="field"><label>负责人</label><select name="ownerId">${keeperOptions}</select></div>
        <div class="field wide"><label>备注</label><input name="remark" placeholder="例如：2026 春季实验室资产盘点" /></div>
        <button class="primary" type="submit">生成盘点任务</button>
      </form>
      <template id="checkScopeOptions">
        <select data-scope="location"><option value="">全部位置</option>${locationOptions}</select>
        <select data-scope="category"><option value="">全部分类</option>${categoryOptions}</select>
        <select data-scope="keeper"><option value="">全部责任人</option>${keeperOptions}</select>
        <select data-scope="status"><option value="">全部状态</option>${statusOptions}</select>
        <select data-scope="all"><option value="">全部</option></select>
      </template>
    </section>
    <section class="panel">
      <div class="section-title">
        <h2>盘点任务</h2>
        <span class="hint">共 ${tasks.length} 个任务</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>盘点单号</th><th>范围</th><th>负责人</th><th>开始</th><th>结束</th><th>状态</th><th>进度</th><th>异常</th><th>操作</th></tr></thead>
          <tbody>
            ${tasks.map((task) => {
              const taskItems = checkTaskItems(task.id);
              const taskChecked = taskItems.filter((item) => item.checked).length;
              const taskAbnormal = taskItems.filter((item) => item.diffType && item.diffType !== "正常" && item.diffType !== "未盘点").length;
              return `
                <tr>
                  <td>${task.checkNo}</td>
                  <td>${task.scopeType} ${task.scopeValue || "全部"}</td>
                  <td>${userName(task.ownerId)}</td>
                  <td>${fmt(task.startTime)}</td>
                  <td>${fmt(task.endTime)}</td>
                  <td>${requestStatusBadge(task.status)}</td>
                  <td>${taskChecked}/${taskItems.length}</td>
                  <td>${taskAbnormal}</td>
                  <td><div class="row-actions">${task.status !== "已完成" && can("checks.manage") ? `<button class="secondary small" data-complete-check="${task.id}" type="button">完成</button>` : ""}${can("reports.export") ? `<button class="ghost small" data-export-check="${task.id}" type="button">导出</button>` : ""}</div></td>
                </tr>
              `;
            }).join("") || `<tr><td colspan="9" class="empty">暂无盘点任务</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
    ${activeTask ? `
      ${can("checks.manage") ? `
      <section class="panel">
        <div class="section-title"><h2>扫码盘点 / 盘盈录入</h2><span class="hint">扫码内容可以是资产二维码链接或资产编号。</span></div>
        <form id="checkScanForm" class="form-grid">
          <div class="field wide"><label>扫码内容</label><input name="scanText" required placeholder="粘贴资产二维码内容或资产编号" /></div>
          <input type="hidden" name="taskId" value="${activeTask.id}" />
          <div class="field"><label>实际位置</label><select name="actualLocation">${locationOptions()}</select></div>
          <div class="field"><label>实际状态</label><select name="actualStatus">${statusSelectOptions("")}</select></div>
          <div class="field"><label>实际责任人</label><select name="actualKeeperId">${userOptions()}</select></div>
          <div class="field"><label>备注</label><input name="remark" placeholder="扫码盘点" /></div>
          <div class="setting-actions"><button class="primary" type="submit">提交扫码结果</button><button class="secondary" id="startCheckQrScanner" type="button">摄像头扫码</button></div>
        </form>
        <form id="checkSurplusForm" class="form-grid">
          <input type="hidden" name="taskId" value="${activeTask.id}" />
          <div class="field"><label>盘盈资产名称</label><input name="name" required placeholder="现场发现但系统无记录的资产" /></div>
          <div class="field"><label>编号</label><input name="code" placeholder="留空自动生成" /></div>
          <div class="field"><label>分类</label><select name="category">${assetCategories().map((category) => `<option value="${category}">${category}</option>`).join("")}</select></div>
          <div class="field"><label>位置</label><select name="location">${locationOptions()}</select></div>
          <div class="field"><label>责任人</label><select name="keeperId">${userOptions()}</select></div>
          <div class="field"><label>数量</label><input name="quantity" type="number" min="1" value="1" /></div>
          <div class="field wide"><label>备注</label><input name="remark" placeholder="盘盈说明" /></div>
          <button class="secondary" type="submit">录入盘盈</button>
        </form>
      </section>` : ""}
      <section class="panel">
        <div class="section-title"><h2>最新任务明细：${activeTask.checkNo}</h2><span class="hint">已盘 ${checked}/${items.length}，异常 ${abnormal}</span></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>资产</th><th>系统位置</th><th>实际位置</th><th>系统状态</th><th>实际状态</th><th>系统责任人</th><th>实际责任人</th><th>差异</th><th>备注</th><th>操作</th></tr></thead>
            <tbody>
              ${items.map((item) => {
                const asset = state.assets.find((entry) => entry.id === item.assetId) || {};
                return `
                  <tr>
                    <td><strong>${asset.name || "未知资产"}</strong><div class="mini-meta">${asset.code || item.assetId}</div></td>
                    <td>${blank(item.systemLocation)}</td>
                    <td><select data-check-location="${item.id}">${locations().map((location) => `<option value="${location.name}" ${(item.actualLocation || item.systemLocation) === location.name ? "selected" : ""}>${location.name}</option>`).join("")}</select></td>
                    <td>${statusBadge(item.systemStatus)}</td>
                    <td><select data-check-status="${item.id}">${statusSelectOptions(item.actualStatus || item.systemStatus)}</select></td>
                    <td>${userName(item.systemKeeperId)}</td>
                    <td><select data-check-keeper="${item.id}">${selectableUsers().map((user) => `<option value="${user.id}" ${(item.actualKeeperId || item.systemKeeperId) === user.id ? "selected" : ""}>${user.name}</option>`).join("")}</select></td>
                    <td>${checkDiffBadge(item.diffType)}</td>
                    <td><input data-check-remark="${item.id}" value="${item.remark || ""}" placeholder="备注" /></td>
                    <td><button class="secondary small" data-save-check-item="${item.id}" type="button">保存</button></td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
      </section>
    ` : ""}
  `;
}

function availableOrderAssets() {
  return state.assets.filter((asset) => asset.status !== "retired");
}

function assetOptions(selected = "") {
  return availableOrderAssets().map((asset) => `<option value="${asset.id}" ${selected === asset.id ? "selected" : ""}>${asset.name} · ${asset.code} · ${statusText(asset.status)}</option>`).join("");
}

function userOptions(selected = "") {
  return selectableUsers().map((user) => `<option value="${user.id}" ${selected === user.id ? "selected" : ""}>${user.name}${isMultiDepartment() ? ` · ${user.department}` : ""}</option>`).join("");
}

function locationOptions(selected = "") {
  return locations().map((location) => `<option value="${location.name}" ${selected === location.name ? "selected" : ""}>${location.name}</option>`).join("");
}

function departmentOptions(selected = "") {
  return departments().map((department) => `<option value="${department}" ${selected === department ? "selected" : ""}>${department}</option>`).join("");
}

function renderOrders() {
  const canManage = can("orders.manage");
  return `
    ${canManage ? `
      <section class="panel">
        <div class="mode-tabs" role="tablist" aria-label="业务单据类型">
          ${[
            ["claim", "领用单"],
            ["borrow", "借用单"],
            ["transfer", "调拨单"],
            ["repair", "维修单"],
            ["scrap", "报废单"]
          ].map(([key, label]) => `<button class="${orderType === key ? "active" : ""}" data-order-type="${key}" type="button">${label}</button>`).join("")}
        </div>
        ${renderOrderForm()}
      </section>
    ` : ""}
    <section class="grid">
      ${renderBorrowOrderList()}
      ${renderTransferOrderList()}
      ${renderRepairOrderList()}
      ${renderScrapOrderList()}
    </section>
  `;
}

function renderReports() {
  if (!can("reports.view")) return "";
  const reportItems = [
    ["ledger", "资产总账", "完整台账字段"],
    ["category", "分类统计", "按分类汇总数量和金额"],
    ["department", "部门统计", "按使用部门汇总"],
    ["location", "位置统计", "按存放位置汇总"],
    ["responsible", "责任人统计", "按使用人汇总"],
    ["claim", "领用明细", "领用/出库明细"],
    ["borrow", "借还明细", "借出与归还记录"],
    ["inbound", "入库明细", "入库记录"],
    ["outbound", "出库明细", "出库记录"],
    ["scrap", "报废资产清单", "已报废资产"],
    ["consumable-warning", "耗材库存预警", "低于安全库存的耗材"]
  ];
  const latestTask = (state.inventoryCheckTasks || [])[0];
  return `
    <section class="panel">
      <div class="section-title"><h2>报表导出</h2><span class="hint">导出 CSV，可直接用 Excel 打开。</span></div>
      <div class="report-grid">
        ${reportItems.map(([key, title, desc]) => `
          <article class="report-card">
            <div><strong>${title}</strong><p class="hint">${desc}</p></div>
            <button class="secondary small" data-export-report="${key}" type="button">导出</button>
          </article>
        `).join("")}
        <article class="report-card">
          <div><strong>盘点差异报告</strong><p class="hint">${latestTask ? `最新任务 ${latestTask.checkNo}` : "暂无盘点任务"}</p></div>
          ${latestTask ? `<button class="secondary small" data-export-check="${latestTask.id}" type="button">导出</button>` : `<span class="hint">无任务</span>`}
        </article>
      </div>
    </section>
    <section class="panel">
      <div class="section-title"><h2>当前统计预览</h2></div>
      <div class="stats compact">
        ${dashboardStatCard("资产总数", state.assets.length, "台账条目", "▦")}
        ${dashboardStatCard("总金额", state.assets.reduce((sum, item) => sum + Number(item.totalAmount || 0), 0).toFixed(2), "按台账总金额", "￥")}
        ${dashboardStatCard("报废资产", state.assets.filter((item) => item.status === "retired").length, "禁止领用/借用/调拨", "×")}
        ${dashboardStatCard("耗材预警", inventoryItems().filter((asset) => stockLevel(asset) !== "ok").length, "低于安全库存", "!")}
      </div>
    </section>
  `;
}

function renderOrderForm() {
  const assets = assetOptions();
  if (!assets) return `<div class="empty">暂无可办理业务的资产</div>`;
  if (orderType === "claim") {
    return `
      <form id="claimOrderForm" class="form-grid">
        <div class="field"><label>资产</label><select name="assetId" required>${assets}</select></div>
        <div class="field"><label>领用人</label><select name="userId" required>${userOptions()}</select></div>
        <div class="field"><label>数量</label><input name="quantity" type="number" min="1" value="1" required /></div>
        <div class="field"><label>领用后位置</label><select name="location">${locationOptions()}</select></div>
        <label class="check-line field-check"><input name="skipQuantity" type="checkbox" /><span>不统计数量</span></label>
        <div class="field wide"><label>用途 / 备注</label><input name="note" placeholder="领用用途、审批意见或验收说明" /></div>
        <button class="primary" type="submit">办理领用</button>
      </form>
    `;
  }
  if (orderType === "borrow") {
    return `
      <form id="borrowOrderForm" class="form-grid">
        <div class="field"><label>资产</label><select name="assetId" required>${assets}</select></div>
        <div class="field"><label>借用人</label><select name="borrowerId" required>${userOptions()}</select></div>
        <div class="field"><label>数量</label><input name="quantity" type="number" min="1" value="1" required /></div>
        <div class="field"><label>预计归还日期</label><input name="expectedReturnDate" type="date" /></div>
        <div class="field"><label>借用位置</label><select name="location">${locationOptions()}</select></div>
        <label class="check-line field-check"><input name="skipQuantity" type="checkbox" /><span>不统计数量</span></label>
        <div class="field wide"><label>借用说明</label><input name="note" placeholder="用途、审批意见或注意事项" /></div>
        <button class="primary" type="submit">办理借用</button>
      </form>
    `;
  }
  if (orderType === "transfer") {
    return `
      <form id="transferOrderForm" class="form-grid">
        <div class="field"><label>资产</label><select name="assetId" required>${assets}</select></div>
        <div class="field"><label>新部门</label><select name="newDepartment" required>${departmentOptions()}</select></div>
        <div class="field"><label>新位置</label><select name="newLocation" required>${locationOptions()}</select></div>
        <div class="field"><label>新责任人</label><select name="newKeeperId" required>${userOptions()}</select></div>
        <div class="field"><label>调拨日期</label><input name="transferDate" type="date" value="${new Date().toISOString().slice(0, 10)}" /></div>
        <div class="field wide"><label>调拨原因</label><input name="reason" placeholder="部门调整、位置调整、项目需要等" /></div>
        <button class="primary" type="submit">办理调拨</button>
      </form>
    `;
  }
  if (orderType === "repair") {
    return `
      <form id="repairOrderForm" class="form-grid">
        <div class="field"><label>资产</label><select name="assetId" required>${assets}</select></div>
        <div class="field"><label>报修人</label><select name="reporterId" required>${userOptions(state.currentUser.id)}</select></div>
        <div class="field"><label>维修人 / 单位</label><input name="repairer" placeholder="内部维修人或外部维修单位" /></div>
        <div class="field"><label>预计费用</label><input name="cost" type="number" min="0" step="0.01" value="0" /></div>
        <div class="field wide"><label>故障描述</label><input name="faultDesc" required placeholder="故障现象、报修原因" /></div>
        <button class="primary" type="submit">创建维修单</button>
      </form>
    `;
  }
  return `
    <form id="scrapOrderForm" class="form-grid">
      <div class="field"><label>资产</label><select name="assetId" required>${assets}</select></div>
      <div class="field"><label>申请人</label><select name="applicantId" required>${userOptions(state.currentUser.id)}</select></div>
      <div class="field"><label>残值</label><input name="residualValue" type="number" min="0" step="0.01" value="0" /></div>
      <div class="field"><label>报废日期</label><input name="scrapDate" type="date" value="${new Date().toISOString().slice(0, 10)}" /></div>
      <div class="field wide"><label>报废原因</label><input name="reason" required placeholder="损坏无法维修、超过使用年限等" /></div>
      <button class="danger" type="submit">办理报废</button>
    </form>
  `;
}

function overdueBadge(order) {
  if (order.status === "已归还") return requestStatusBadge("已归还");
  if (order.expectedReturnDate && new Date(order.expectedReturnDate).getTime() < Date.now()) {
    return `<span class="badge bad">逾期</span>`;
  }
  return requestStatusBadge(order.status);
}

function renderBorrowOrderList() {
  const orders = state.borrowOrders || [];
  return `
    <section class="panel">
      <div class="section-title"><h2>领用 / 借用单</h2><span class="hint">${orders.length} 条</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>单号</th><th>资产</th><th>人员</th><th>数量</th><th>预计归还</th><th>实际归还</th><th>状态</th><th>验收</th><th>操作</th></tr></thead>
          <tbody>
            ${orders.map((item) => `
              <tr>
                <td>${item.orderNo}</td><td>${assetName(item.assetId)}</td><td>${userName(item.borrowerId)}</td><td>${item.quantity || 1}${item.countQuantity === false ? `<div class="mini-meta">不计数</div>` : ""}</td><td>${blank(item.expectedReturnDate)}</td><td>${blank(item.actualReturnDate)}</td><td>${overdueBadge(item)}</td><td>${blank(item.returnCheck)}</td>
                <td>${can("orders.manage") && item.status !== "已归还" ? `<button class="secondary small" data-return-borrow="${item.id}" type="button">归还验收</button>` : "-"}</td>
              </tr>
            `).join("") || `<tr><td colspan="9" class="empty">暂无领用或借用单</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderTransferOrderList() {
  const orders = state.transferOrders || [];
  return `
    <section class="panel">
      <div class="section-title"><h2>调拨单</h2><span class="hint">${orders.length} 条</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>单号</th><th>资产</th><th>原部门/位置</th><th>新部门/位置</th><th>新责任人</th><th>原因</th><th>状态</th></tr></thead>
          <tbody>
            ${orders.map((item) => `<tr><td>${item.orderNo}</td><td>${assetName(item.assetId)}</td><td>${blank(item.oldDepartment)} / ${blank(item.oldLocation)}</td><td>${blank(item.newDepartment)} / ${blank(item.newLocation)}</td><td>${userName(item.newKeeperId)}</td><td>${blank(item.reason)}</td><td>${requestStatusBadge(item.status)}</td></tr>`).join("") || `<tr><td colspan="7" class="empty">暂无调拨单</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderRepairOrderList() {
  const orders = state.repairOrders || [];
  return `
    <section class="panel">
      <div class="section-title"><h2>维修单</h2><span class="hint">${orders.length} 条</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>单号</th><th>资产</th><th>状态</th><th>维修人</th><th>费用</th><th>故障/结果</th><th>操作</th></tr></thead>
          <tbody>
            ${orders.map((item) => `<tr><td>${item.orderNo}</td><td>${assetName(item.assetId)}</td><td>${requestStatusBadge(item.status)}</td><td>${blank(item.repairer)}</td><td>${Number(item.cost || 0).toFixed(2)}</td><td>${blank(item.result || item.faultDesc)}</td><td>${can("orders.manage") && item.status !== "已完成" ? `<button class="secondary small" data-finish-repair="${item.id}" type="button">完成</button>` : "-"}</td></tr>`).join("") || `<tr><td colspan="7" class="empty">暂无维修单</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderScrapOrderList() {
  const orders = state.scrapOrders || [];
  return `
    <section class="panel">
      <div class="section-title"><h2>报废单</h2><span class="hint">${orders.length} 条</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>单号</th><th>资产</th><th>申请人</th><th>报废日期</th><th>残值</th><th>状态</th><th>原因</th></tr></thead>
          <tbody>
            ${orders.map((item) => `<tr><td>${item.orderNo}</td><td>${assetName(item.assetId)}</td><td>${userName(item.applicantId)}</td><td>${blank(item.scrapDate)}</td><td>${Number(item.residualValue || 0).toFixed(2)}</td><td>${requestStatusBadge(item.status)}</td><td>${blank(item.reason)}</td></tr>`).join("") || `<tr><td colspan="7" class="empty">暂无报废单</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderBaseData() {
  if (!can("base_data.view")) return "";
  return `
    <section class="panel">
      <div class="section-title">
        <h2>资产类别管理</h2>
        <span class="hint">新增、编辑、删除资产类别；新增资产时会从这里选择类别。</span>
      </div>
      ${renderAssetCategoryManager()}
    </section>
    <section class="panel">
      <div class="section-title">
        <h2>位置管理</h2>
        <span class="hint">维护校区、楼栋、教室、办公室、实验室、仓库等资产存放位置。</span>
      </div>
      ${renderLocationManager()}
    </section>
  `;
}

function renderAssetCategoryManager() {
  const categories = assetCategoryItems();
  const parentOptions = [`<option value="">无父级（一级分类）</option>`]
    .concat(categories.map((category) => `<option value="${category.id}">${treeLabel(categories, category)}</option>`))
    .join("");
  return `
    <div class="asset-category-manager no-print">
      <form id="assetCategoryForm" class="form-grid">
        <input type="hidden" name="categoryId" />
        <div class="field"><label>分类名称</label><input name="name" required placeholder="例如：电脑设备 / 打印耗材" /></div>
        <div class="field"><label>分类编码</label><input name="code" placeholder="例如：DN / HC" /></div>
        <div class="field"><label>分类类型</label><select name="categoryType"><option value="固定资产">固定资产</option><option value="低值品">低值品</option><option value="耗材">耗材</option></select></div>
        <div class="field"><label>父级分类</label><select name="parentId">${parentOptions}</select></div>
        <div class="setting-actions"><button class="primary" type="submit">保存分类</button><button class="ghost" id="resetCategoryForm" type="button">清空</button></div>
      </form>
      <div class="table-wrap">
        <table>
          <thead><tr><th>分类名称</th><th>父级</th><th>编码</th><th>类型</th><th>资产数量</th><th>操作</th></tr></thead>
          <tbody>
        ${categories.map((category) => {
          const count = state.assets.filter((asset) => asset.category === category.name).length;
          return `
            <tr>
              <td><strong>${treeLabel(categories, category)}</strong></td>
              <td>${category.parent_id ? categoryName(category.parent_id) : "-"}</td>
              <td>${blank(category.code)}</td>
              <td>${blank(category.category_type)}</td>
              <td>${count}</td>
              <td><div class="row-actions"><button class="ghost small" data-category-edit="${category.id}" type="button">编辑</button><button class="danger small" data-category-delete="${category.id}" type="button">删除</button></div></td>
            </tr>
          `;
        }).join("") || `<tr><td colspan="6" class="empty">暂无分类</td></tr>`}
          </tbody>
        </table>
      </div>
      <p class="hint">分类编码用于自动生成资产编号，例如：XXZX-DN-2026-0001。删除分类前需要确保没有资产或子分类使用。</p>
    </div>
  `;
}

function renderLocationManager() {
  const items = locations();
  const parentOptions = [`<option value="">无父级（校区/独立位置）</option>`]
    .concat(items.map((location) => `<option value="${location.id}">${treeLabel(items, location)}</option>`))
    .join("");
  const managerOptions = [`<option value="">未指定</option>`]
    .concat(selectableUsers().map((user) => `<option value="${user.id}">${user.name}${isMultiDepartment() ? ` · ${user.department}` : ""}</option>`))
    .join("");
  const typeOptions = ["校区", "楼栋", "楼层", "教室", "办公室", "实验室", "仓库", "图书室", "体育器材室"];
  return `
    <div class="asset-category-manager no-print">
      <form id="locationForm" class="form-grid">
        <input type="hidden" name="locationId" />
        <div class="field"><label>位置名称</label><input name="name" required placeholder="例如：总仓库 / 实验楼 301" /></div>
        <div class="field"><label>父级位置</label><select name="parentId">${parentOptions}</select></div>
        <div class="field"><label>位置类型</label><select name="type">${typeOptions.map((type) => `<option value="${type}">${type}</option>`).join("")}</select></div>
        <div class="field"><label>位置编码</label><input name="code" placeholder="例如：LAB-301" /></div>
        <div class="field"><label>负责人</label><select name="managerId">${managerOptions}</select></div>
        <div class="field"><label>备注</label><input name="remark" placeholder="可选" /></div>
        <div class="setting-actions"><button class="primary" type="submit">保存位置</button><button class="ghost" id="resetLocationForm" type="button">清空</button></div>
      </form>
      <div class="table-wrap">
        <table>
          <thead><tr><th>位置名称</th><th>父级</th><th>类型</th><th>编码</th><th>负责人</th><th>资产数量</th><th>备注</th><th>操作</th></tr></thead>
          <tbody>
            ${items.map((location) => {
              const count = state.assets.filter((asset) => asset.location === location.name).length;
              return `
                <tr>
                  <td><strong>${treeLabel(items, location)}</strong></td>
                  <td>${location.parent_id ? locations().find((item) => item.id === location.parent_id)?.name || "-" : "-"}</td>
                  <td>${blank(location.type)}</td>
                  <td>${blank(location.code)}</td>
                  <td>${location.manager_id ? userName(location.manager_id) : "-"}</td>
                  <td>${count}</td>
                  <td>${blank(location.remark)}</td>
                  <td><div class="row-actions"><button class="ghost small" data-location-edit="${location.id}" type="button">编辑</button><button class="danger small" data-location-delete="${location.id}" type="button">删除</button></div></td>
                </tr>
              `;
            }).join("") || `<tr><td colspan="8" class="empty">暂无位置</td></tr>`}
          </tbody>
        </table>
      </div>
      <p class="hint">删除位置前需要确保没有资产正在使用该位置；编辑位置名称会同步更新资产台账。</p>
    </div>
  `;
}

function renderAssetDrawer() {
  const asset = state.assets.find((item) => item.id === editingAssetId) || {};
  const isEdit = Boolean(asset.id);
  const categories = assetCategories();
  const categoryOptions = [
    ...(asset.category && !categories.includes(asset.category) ? [asset.category] : []),
    ...categories
  ].map((category) => `<option value="${category}" ${asset.category === category ? "selected" : ""}>${category}</option>`).join("");
  const locationNames = locations().map((location) => location.name);
  const locationOptions = [
    ...(asset.location && !locationNames.includes(asset.location) ? [asset.location] : []),
    ...locationNames
  ].map((location) => `<option value="${location}" ${asset.location === location ? "selected" : ""}>${location}</option>`).join("");
  const userOptions = selectableUsers().map((u) => `<option value="${u.id}" ${(asset.useUserId || asset.keeperId) === u.id ? "selected" : ""}>${u.name}${isMultiDepartment() ? ` · ${u.department}` : ""}</option>`).join("");
  const keeperOptions = selectableUsers().map((u) => `<option value="${u.id}" ${asset.keeperId === u.id ? "selected" : ""}>${u.name}${isMultiDepartment() ? ` · ${u.department}` : ""}</option>`).join("");
  const departmentOptions = departments().map((department) => `<option value="${department}" ${(asset.useDepartment || state.currentUser.department) === department ? "selected" : ""}>${department}</option>`).join("");
  return `
    <div class="drawer-backdrop no-print" id="assetDrawerBackdrop"></div>
    <aside class="asset-drawer no-print" aria-label="${isEdit ? "编辑资产" : "新增资产"}">
      <form id="assetForm">
        <input type="hidden" name="assetId" value="${asset.id || ""}" />
        <div class="drawer-head">
          <h2>${isEdit ? "编辑资产" : "新增资产"}</h2>
          <button class="ghost icon-button" id="closeAssetDrawer" type="button">×</button>
        </div>
        <div class="drawer-body">
          <div class="field"><label>资产编号</label><input name="code" value="${asset.code || ""}" placeholder="自动生成" /></div>
          <div class="field"><label><b>*</b> 资产名称</label><input name="name" required value="${asset.name || ""}" placeholder="请输入资产名称" /></div>
          <div class="field"><label>品牌</label><input name="brand" value="${asset.brand || ""}" placeholder="品牌 / 厂商" /></div>
          <div class="field"><label><b>*</b> 类别</label><select name="category" required>${categoryOptions}</select></div>
          <div class="field"><label>规格</label><input name="spec" value="${asset.spec || ""}" placeholder="请输入规格型号" /></div>
          <div class="field"><label>单位</label><input name="unit" value="${asset.unit || "件"}" placeholder="件 / 台 / 套 / 个" /></div>
          <div class="field"><label><b>*</b> 数量</label><input name="quantity" type="number" min="1" value="${asset.quantity || 1}" required placeholder="请输入数量" /></div>
          <div class="field"><label>单价</label><input name="unitPrice" type="number" min="0" step="0.01" value="${asset.unitPrice || 0}" /></div>
          <div class="field"><label>总金额</label><input name="totalAmount" type="number" min="0" step="0.01" value="${asset.totalAmount || 0}" placeholder="留空按数量×单价" /></div>
          <div class="field"><label>安全库存</label><input name="safeStock" type="number" min="0" value="${asset.safeStock || 0}" placeholder="耗材低于此数量时预警" /></div>
          <div class="field"><label>购置日期</label><input name="purchaseDate" type="date" value="${asset.purchaseDate || ""}" /></div>
          <div class="field"><label>入库日期</label><input name="inboundDate" type="date" value="${asset.inboundDate || ""}" /></div>
          <div class="field"><label>供应商</label><input name="supplier" value="${asset.supplier || ""}" placeholder="供应商 / 供货商" /></div>
          <div class="field"><label>使用部门</label><select name="useDepartment">${departmentOptions}</select></div>
          <div class="field"><label>使用人</label><select name="useUserId">${userOptions}</select></div>
          <div class="field"><label>资产来源</label><select name="source"><option value="" ${!asset.source ? "selected" : ""}>未填写</option><option value="购置" ${asset.source === "购置" ? "selected" : ""}>购置</option><option value="调拨" ${asset.source === "调拨" ? "selected" : ""}>调拨</option><option value="捐赠" ${asset.source === "捐赠" ? "selected" : ""}>捐赠</option><option value="自建" ${asset.source === "自建" ? "selected" : ""}>自建</option><option value="盘盈入账" ${asset.source === "盘盈入账" ? "selected" : ""}>盘盈入账</option></select></div>
          <div class="field"><label><b>*</b> 位置</label><select name="location" required>${locationOptions}</select></div>
          <div class="field"><label><b>*</b> 保管人</label><select name="keeperId">${keeperOptions}</select></div>
          <div class="field"><label><b>*</b> 状态</label><select name="status"><option value="in_stock" ${asset.status === "in_stock" || !asset.status ? "selected" : ""}>在库</option><option value="checked_out" ${asset.status === "checked_out" ? "selected" : ""}>出库/出借</option><option value="repair" ${asset.status === "repair" ? "selected" : ""}>维修中</option><option value="retired" ${asset.status === "retired" ? "selected" : ""}>报废</option></select></div>
          <div class="field"><label>备注</label><textarea name="remark" maxlength="200" placeholder="请输入备注（选填）">${asset.remark || ""}</textarea></div>
        </div>
        <div class="drawer-actions">
          <button class="ghost" id="cancelAssetDrawer" type="button">取消</button>
          <button class="primary" type="submit">保存资产</button>
        </div>
      </form>
    </aside>
  `;
}

function renderAssetLabel(asset) {
  const url = assetDetailUrl(asset);
  return `
    <section class="asset-label-card">
      <div class="asset-label-info">
        <strong>学校资产标签</strong>
        <span>资产编号：${asset.code}</span>
        <span>资产名称：${asset.name}</span>
        <span>分类：${asset.category}</span>
        <span>责任人：${userName(asset.keeperId)}</span>
        <span>位置：${blank(asset.location)}</span>
      </div>
      <div class="asset-label-qr">
        ${qrLikeSvg(url)}
        <small>${url}</small>
      </div>
    </section>
  `;
}

function renderAssetDetailDrawer() {
  const asset = state.assets.find((item) => item.id === selectedAssetDetailId);
  if (!asset) return "";
  const group = assetGroupById(asset.id);
  const groupAssets = group?.assets || [asset];
  const records = assetRecords(groupAssets.map((item) => item.id));
  const assetIds = new Set(groupAssets.map((item) => item.id));
  const repairRows = (state.repairOrders || []).filter((item) => assetIds.has(item.assetId));
  const checkRows = (state.inventoryCheckItems || []).filter((item) => assetIds.has(item.assetId));
  const scrapRows = (state.scrapOrders || []).filter((item) => assetIds.has(item.assetId));
  const transferRows = (state.transferOrders || []).filter((item) => assetIds.has(item.assetId));
  const borrowRows = (state.borrowOrders || []).filter((item) => assetIds.has(item.assetId));
  const flowRows = (state.assetFlowLogs || []).filter((item) => assetIds.has(item.assetId));
  const flow = assetFlow(asset);
  const showAssetDetailLabel = isAssetDetailLabelEnabled();
  return `
    <div class="drawer-backdrop no-print" id="assetDetailBackdrop"></div>
    <aside class="asset-drawer asset-detail-drawer no-print" aria-label="资产详情">
      <div class="drawer-head">
        <h2>资产详情</h2>
        <button class="ghost icon-button" id="closeAssetDetail" type="button">×</button>
      </div>
      <div class="drawer-body">
        <section class="detail-hero">
          <div>
            <span class="hint">${asset.code}</span>
            <h3>${asset.name}</h3>
            <p>${asset.spec || "未填写规格"} · ${asset.category}</p>
          </div>
          ${statusBadge(asset.status)}
        </section>
        <section class="detail-grid">
          <div><span>资产/耗材</span><strong>${assetKind(asset)}</strong></div>
          <div><span>品牌</span><strong>${blank(asset.brand)}</strong></div>
          <div><span>数量</span><strong>${group?.quantity ?? asset.quantity ?? 0}</strong></div>
          <div><span>单位</span><strong>${blank(asset.unit || "件")}</strong></div>
          <div><span>单价</span><strong>${Number(asset.unitPrice || 0).toFixed(2)}</strong></div>
          <div><span>总金额</span><strong>${Number(asset.totalAmount || 0).toFixed(2)}</strong></div>
          <div><span>购置日期</span><strong>${blank(asset.purchaseDate)}</strong></div>
          <div><span>入库日期</span><strong>${blank(asset.inboundDate)}</strong></div>
          <div><span>供应商</span><strong>${blank(asset.supplier)}</strong></div>
          <div><span>使用部门</span><strong>${blank(asset.useDepartment)}</strong></div>
          <div><span>位置</span><strong>${blank(asset.location)}</strong></div>
          <div><span>保管人</span><strong>${userName(asset.keeperId)}</strong></div>
          <div><span>使用人</span><strong>${asset.useUserId ? userName(asset.useUserId) : userName(asset.keeperId)}</strong></div>
          <div><span>当前使用人</span><strong>${flow.borrowerName}</strong></div>
          <div><span>最近借出</span><strong>${flow.borrowTime}</strong></div>
          <div><span>最近归还</span><strong>${flow.returnTime}</strong></div>
          <div><span>安全库存</span><strong>${asset.safeStock || 0}</strong></div>
          <div><span>资产来源</span><strong>${blank(asset.source)}</strong></div>
          <div><span>创建人</span><strong>${asset.creatorId ? userName(asset.creatorId) : "-"}</strong></div>
          <div><span>更新时间</span><strong>${fmt(asset.updatedAt)}</strong></div>
          <div><span>详情链接</span><strong><button class="download-link" data-copy-asset-url="${asset.id}" type="button">复制</button></strong></div>
        </section>
        ${showAssetDetailLabel ? `<section class="detail-section">
          <div class="section-title"><h2>二维码标签</h2><button class="secondary small" id="printAssetLabel" type="button">打印标签</button></div>
          ${renderAssetLabel(asset)}
        </section>` : ""}
        <section class="detail-section">
          <div class="section-title"><h2>流转记录</h2><span class="hint">${records.length} 条</span></div>
          <div class="record-list">
            ${records.map((record) => `
              <article class="record-card">
                <div class="card-head"><strong>${record.type === "出库" ? "出库/出借" : "入库/归还"} · ${record.quantity}</strong>${statusBadge(record.status)}</div>
                <p>时间：${fmt(record.outTime || record.inTime)}，经办/使用人：${userName(record.userId)}</p>
                <p>单号：${blank(record.paperNo)}，备注：${recordDisplayNote(record)}</p>
              </article>
            `).join("") || `<div class="empty">暂无流转记录</div>`}
          </div>
        </section>
        ${renderDetailOrderList("借用/领用记录", borrowRows, (item) => `${item.orderNo} · ${assetName(item.assetId)} · ${userName(item.borrowerId)} · ${item.status} · 预计归还 ${blank(item.expectedReturnDate)} · 实际归还 ${blank(item.actualReturnDate)}`)}
        ${renderDetailOrderList("调拨记录", transferRows, (item) => `${item.orderNo} · ${blank(item.oldDepartment)} / ${blank(item.oldLocation)} -> ${blank(item.newDepartment)} / ${blank(item.newLocation)} · ${item.status}`)}
        ${renderDetailOrderList("维修记录", repairRows, (item) => `${item.orderNo} · ${item.status} · ${blank(item.repairer)} · 费用 ${Number(item.cost || 0).toFixed(2)} · ${blank(item.result || item.faultDesc)}`)}
        ${renderDetailOrderList("盘点记录", checkRows, (item) => `${blank(item.systemLocation)} -> ${blank(item.actualLocation)} · ${checkDiffBadge(item.diffType)} · ${blank(item.remark)}`)}
        ${renderDetailOrderList("报废记录", scrapRows, (item) => `${item.orderNo} · ${item.status} · 残值 ${Number(item.residualValue || 0).toFixed(2)} · ${blank(item.reason)}`)}
        ${renderDetailOrderList("资产流转日志", flowRows, (item) => `${fmt(item.createdAt)} · ${blank(item.action)} · ${userName(item.operatorId)} · ${blank(item.businessNo)} · ${blank(item.note)}`)}
        <section class="detail-section">
          <div class="section-title"><h2>备注</h2></div>
          <p class="hint">${displayRemark(asset.remark)}</p>
        </section>
      </div>
    </aside>
    ${showAssetDetailLabel ? `<div class="print-label-template">${renderAssetLabel(asset)}</div>` : ""}
  `;
}

function renderDetailOrderList(title, items, formatRow) {
  return `
    <section class="detail-section">
      <div class="section-title"><h2>${title}</h2><span class="hint">${items.length} 条</span></div>
      <div class="record-list">
        ${items.map((item) => `<article class="record-card"><p>${formatRow(item)}</p></article>`).join("") || `<div class="empty">暂无${title}</div>`}
      </div>
    </section>
  `;
}

function renderRecords() {
  const records = state.records.filter((record) => {
    const typeMatched = recordFilter === "all" || record.type === recordFilter;
    const kindMatched = recordKindFilter === "all" || recordKind(record) === recordKindFilter;
    return typeMatched && kindMatched;
  });
  const assetRecordCount = state.records.filter((record) => recordKind(record) === "资产").length;
  const consumableRecordCount = state.records.filter((record) => recordKind(record) === "耗材").length;
  return `
    ${can("records.manage") ? renderRecordModePanel() : ""}
    <section class="panel">
      <div class="section-title"><h2>${can("records.manage") ? "全部出入库记录" : "我的出入库记录"}</h2></div>
      <div class="toolbar">
        <div class="filters">
          <select id="recordKindFilter">
            <option value="all" ${recordKindFilter === "all" ? "selected" : ""}>全部资产/耗材</option>
            <option value="资产" ${recordKindFilter === "资产" ? "selected" : ""}>资产记录（${assetRecordCount}）</option>
            <option value="耗材" ${recordKindFilter === "耗材" ? "selected" : ""}>耗材记录（${consumableRecordCount}）</option>
          </select>
          <select id="recordFilter">
            <option value="all" ${recordFilter === "all" ? "selected" : ""}>全部类型</option>
            <option value="入库" ${recordFilter === "入库" ? "selected" : ""}>入库</option>
            <option value="出库" ${recordFilter === "出库" ? "selected" : ""}>出库/出借</option>
          </select>
        </div>
        <span class="hint">当前 ${records.length} 条，资产 ${assetRecordCount} 条 / 耗材 ${consumableRecordCount} 条</span>
      </div>
      ${renderSuspectedDuplicateRecords(records)}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>资产</th><th>资产/耗材</th><th>类型</th><th>单据类型</th><th>数量</th>${isMultiDepartment() ? "<th>部门</th>" : ""}<th>借用/归还人</th><th>入库/归还时间</th><th>出库/借出时间</th><th>现场照片</th><th>状态</th><th>纸质单号</th><th>备注</th>
            </tr>
          </thead>
          <tbody>
            ${records.map((record) => `
              <tr>
                <td>${assetName(record.assetId)}</td><td>${kindBadge(recordKind(record))}</td><td>${record.type === "出库" ? "出库/出借" : record.type}</td><td>${recordDocumentType(record)}</td><td>${record.quantity}</td>${isMultiDepartment() ? `<td>${userDepartment(record.userId)}</td>` : ""}<td>${userName(record.userId)}</td>
                <td>${fmt(record.inTime)}</td><td>${fmt(record.outTime)}</td><td>${recordPhoto(record)}</td><td>${statusBadge(record.status)}</td><td>${record.paperNo || "-"}</td><td>${recordDisplayNote(record)}</td>
              </tr>
            `).join("") || `<tr><td colspan="${isMultiDepartment() ? 13 : 12}" class="empty">暂无记录</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderRecordModePanel() {
  return `
    <section class="panel">
      <div class="mode-tabs" role="tablist" aria-label="出入库管理方式">
        <button class="${recordMode === "manual" ? "active" : ""}" data-record-mode="manual" type="button">手动管理</button>
        <button class="${recordMode === "import" ? "active" : ""}" data-record-mode="import" type="button">批量导入</button>
      </div>
      ${recordMode === "manual" ? renderRecordFormInner() : renderImportPanelInner()}
    </section>
  `;
}

function renderImportPanel() {
  return `<section class="panel">${renderImportPanelInner()}</section>`;
}

function renderImportPanelInner() {
  const config = importConfig();
  return `
      <div class="section-title import-title">
        <h2>批量导入</h2>
        <button class="secondary" id="downloadInboundTemplate" type="button">下载入库模板</button>
      </div>
      <form id="bulkImportForm" class="import-flow">
        <section class="import-step">
          <div class="step-head"><span class="step-index">1</span><h3>选择导入类型</h3></div>
          <div class="import-kind-grid">
            <button class="kind-card ${importKind === "inbound" ? "active" : ""}" data-import-kind="inbound" type="button">
              <span><strong>入库记录</strong><em>支持资产/耗材入库，导入后自动归类</em></span>
              ${importKind === "inbound" ? "<b>✓</b>" : ""}
            </button>
            <button class="kind-card ${importKind === "word" ? "active" : ""}" data-import-kind="word" type="button">
              <span><strong>出库/出借单</strong><em>识别资产领用和耗材领用模板</em></span>
              ${importKind === "word" ? "<b>✓</b>" : ""}
            </button>
          </div>
        </section>
        <section class="import-step">
          <div class="step-head"><span class="step-index">2</span><h3>上传文件</h3></div>
          <input id="bulkFileInput" name="file" class="visually-hidden" type="file" accept="${config.accept}" multiple />
          <input id="bulkFolderInput" name="folder" class="visually-hidden" type="file" accept="${config.accept}" multiple webkitdirectory directory />
          <div class="upload-zone" data-upload-zone>
            <div class="upload-icon">☁</div>
            <strong>点击上传或拖拽文件到这里</strong>
            <p>${config.uploadHint}</p>
            <div class="upload-actions">
              <label class="secondary" for="bulkFileInput">选择文件</label>
              <label class="secondary" for="bulkFolderInput">选择文件夹</label>
            </div>
          </div>
          <div class="selected-files" id="selectedImportFiles">
            <span class="hint">尚未选择文件</span>
          </div>
        </section>
        <section class="import-step import-submit-step">
          <div>
            <div class="step-head"><span class="step-index">3</span><h3>开始导入</h3></div>
            <p class="hint">${config.description}</p>
          </div>
          <button class="primary" type="submit">${config.button}</button>
        </section>
      </form>
      ${importResult ? renderImportResult("入库导入结果", importResult) : ""}
      ${wordImportResult ? renderImportResult("Word 出借导入结果", wordImportResult) : ""}
      ${renderImportArchives()}
  `;
}

function renderImportResult(title, result) {
  return `
    <div class="import-result">
      <strong>${title}：成功 ${result.imported} 条${result.createdAssets ? `，新建资产 ${result.createdAssets} 个` : ""}，跳过 ${result.skipped.length} 条${result.paperCreated ? `，待复核 ${result.paperCreated} 条` : ""}</strong>
      ${result.message ? `<p class="hint">${result.message}</p>` : ""}
      ${result.files?.length ? `
        <div class="table-wrap">
          <table>
            <thead><tr><th>文件</th><th>成功</th><th>新建资产</th><th>待复核</th><th>跳过</th></tr></thead>
            <tbody>${result.files.map((item) => `<tr><td>${item.fileName}</td><td>${item.imported}</td><td>${item.createdAssets || 0}</td><td>${item.paperCreated || 0}</td><td>${item.error || item.skipped || 0}</td></tr>`).join("")}</tbody>
          </table>
        </div>
      ` : ""}
      ${result.skipped.length ? `
        <div class="table-wrap">
          <table>
            <thead><tr><th>文件/行号</th><th>原因</th></tr></thead>
            <tbody>${result.skipped.map((item) => `<tr><td>${item.file ? `${item.file} / ` : ""}${item.row}</td><td>${item.reason}</td></tr>`).join("")}</tbody>
          </table>
        </div>
      ` : ""}
    </div>
  `;
}

function renderImportArchives() {
  if (!state.importArchives?.length) {
    return `<div class="empty">暂无导入电子档留档</div>`;
  }
  return `
    <div class="archive-list">
      <div class="section-title"><h2>导入电子档留档</h2></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>文件名</th><th>类型</th><th>上传人</th><th>上传时间</th><th>导入结果</th><th>操作</th></tr></thead>
          <tbody>
            ${state.importArchives.map((item) => `
              <tr>
                <td>${item.fileName}</td>
                <td>${item.category}</td>
                <td>${userName(item.uploadedBy)}</td>
                <td>${fmt(item.uploadedAt)}</td>
                <td>成功 ${item.result?.imported || 0} 条，新建资产 ${item.result?.createdAssets || 0} 个，跳过 ${item.result?.skipped?.length || 0} 条${item.result?.paperCreated ? `，待复核 ${item.result.paperCreated} 条` : ""}</td>
                <td><button class="download-link" data-download-archive="${item.id}" type="button">下载</button></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderLegacyImportPanel() {
  return `
    <section class="panel">
      <div class="section-title">
        <h2>批量导入出入库记录</h2>
      </div>
      <form id="importForm" class="import-row">
        <input name="file" type="file" accept=".xlsx,.csv" required />
        <button class="primary" type="submit">导入记录</button>
      </form>
    </section>
  `;
}

function renderRecordForm() {
  return `<section class="panel">${renderRecordFormInner()}</section>`;
}

function renderRecordFormInner() {
  const deptOptions = [`<option value="all" ${selectedDepartment === "all" ? "selected" : ""}>全部部门</option>`]
    .concat(departments().map((department) => `<option value="${department}" ${selectedDepartment === department ? "selected" : ""}>${department}</option>`))
    .join("");
  const userOptions = activeUsersByDepartment().map((u) => `<option value="${u.id}">${u.name}${isMultiDepartment() ? ` · ${u.department}` : ""}</option>`).join("");
  const groups = assetGroups();
  const defaultGroup = groups[0] || {};
  return `
    <form id="recordForm" class="manual-flow">
      <div class="manual-main">
        <div class="section-title manual-title"><h2>登记出入库</h2><button class="ghost small" type="reset">清空选择</button></div>
        <section class="manual-step">
          <div class="step-head"><span class="step-index">1</span><h3>资产信息</h3></div>
          <div class="field"><label>资产</label><select name="assetId">${groups.map((group) => `<option value="${group.id}">${group.model} · 共 ${group.quantity || 0} 台</option>`).join("")}</select></div>
          <div class="asset-info-grid">
            <div><span>型号/规格</span><strong id="assetCodePreview">${defaultGroup.model || "-"}</strong></div>
            <div><span>分类</span><strong id="assetCategoryPreview">${defaultGroup.category || "-"}</strong></div>
            <div><span>当前库存</span><strong id="assetQuantityPreview">${defaultGroup.quantity || 0} 台</strong></div>
          </div>
        </section>
        <section class="manual-step">
          <div class="step-head"><span class="step-index">2</span><h3>登记信息</h3></div>
          <input type="hidden" name="type" value="入库" />
          <div class="manual-grid">
            <div class="field wide"><label>类型</label><div class="type-segments">
              <button class="active" data-record-type="入库" type="button">入库</button>
              <button data-record-type="出库" type="button">出库/出借</button>
              <button data-record-type="入库" type="button">归还</button>
            </div></div>
            <div class="field"><label>数量</label><div class="quantity-stepper"><button data-quantity-step="-1" type="button">−</button><input name="quantity" type="number" min="1" value="1" required /><button data-quantity-step="1" type="button">+</button></div></div>
            <div class="field"><label>借用人 / 归还人</label><select name="userId" required>${userOptions}</select></div>
            ${isMultiDepartment() ? `<div class="field"><label>部门</label><select id="departmentFilter">${deptOptions}</select></div>` : ""}
            <div class="field"><label>入库时间</label><input name="inTime" type="datetime-local" value="${nowLocal()}" /></div>
            <div class="field"><label>出库时间（可选）</label><input name="outTime" type="datetime-local" /></div>
            <div class="field"><label>纸质单号</label><input name="paperNo" placeholder="如 SZ-003" /></div>
          </div>
        </section>
        <section class="manual-step">
          <div class="step-head"><span class="step-index">3</span><h3>附件与备注</h3></div>
          <div class="manual-grid">
            <div class="field"><label>现场照片（可选）</label><label class="photo-upload"><input name="photoFile" type="file" accept="image/*" capture="environment" /><span>☁</span><strong>点击上传现场照片</strong><em id="photoFileName">支持 JPG、PNG</em></label></div>
            <div class="field"><label>备注（可选）</label><textarea name="note" maxlength="200" placeholder="来源、用途、验收情况等"></textarea></div>
          </div>
          <div class="manual-actions">
            <button class="ghost" type="reset">取消</button>
            <button class="secondary" type="button" id="saveDraftBtn">保存草稿</button>
            <button class="primary" type="submit">提交登记</button>
          </div>
        </section>
      </div>
      <aside class="manual-aside">
        <div class="assist-card">
          <h3>辅助信息</h3>
          <div class="assist-block"><strong>登记提示</strong><ul><li>选择类型后填写对应时间</li><li>可上传现场照片作为凭证</li><li>提交后可在记录列表中查看</li></ul></div>
          <div class="assist-block">
            <strong>当前登记摘要</strong>
            <dl>
              <dt>类型</dt><dd id="summaryType">入库</dd>
              <dt>数量</dt><dd id="summaryQuantity">1</dd>
              <dt>经办人</dt><dd id="summaryUser">${selectableUsers()[0]?.name || "-"}</dd>
              <dt>入库时间</dt><dd id="summaryInTime">${fmt(nowLocal())}</dd>
              <dt>出库时间</dt><dd id="summaryOutTime">-</dd>
              <dt>纸质单号</dt><dd id="summaryPaper">-</dd>
              <dt>备注</dt><dd id="summaryNote">-</dd>
            </dl>
          </div>
          <button class="primary" type="submit">提交登记</button>
        </div>
      </aside>
    </form>
  `;
}

function renderPaper() {
  const canManagePaper = can("paper.manage");
  return `
    <div class="solution">
      <section class="panel">
        <div class="section-title"><h2>手写材料解决方案</h2></div>
        <div class="steps">
          <div class="step"><strong>1. 单据编号</strong><span>所有纸质入库单、出库单先写唯一编号，例如 SZ-2026-001。</span></div>
          <div class="step"><strong>2. 拍照或扫描</strong><span>手机拍照、扫描仪或高拍仪采集图片，上传后进入待复核队列。</span></div>
          <div class="step"><strong>3. OCR 初识别</strong><span>后续可接入 OCR，把手写内容识别为资产名称、数量、时间、领用人。</span></div>
          <div class="step"><strong>4. 人工复核</strong><span>仓管员核对识别结果，确认后生成电子出入库记录和后台操作记录。</span></div>
          <div class="step"><strong>5. 纸电对应</strong><span>电子记录保留纸质单号、扫描图和复核人，方便追溯和打印。</span></div>
        </div>
      </section>
      <section class="panel">
        <div class="section-title"><h2>新增纸质单据</h2></div>
        <form id="paperForm">
          <div class="field"><label>纸质单号</label><input name="paperNo" required placeholder="SZ-2026-001" /></div>
          <div class="field"><label>单据来源</label><input name="source" required placeholder="手写入库单 / 出库单" /></div>
          ${canManagePaper ? `<div class="field"><label>关联用户</label><select name="ownerId">${selectableUsers().map((u) => `<option value="${u.id}">${u.name}</option>`).join("")}</select></div>` : ""}
          <div class="field"><label>识别文本 / 人工摘录</label><textarea name="text" required placeholder="资产、数量、时间、经手人、用途"></textarea></div>
          <button class="primary" type="submit">加入复核队列</button>
        </form>
      </section>
    </div>
    <section class="panel">
      <div class="section-title"><h2>纸质单据队列</h2></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>单号</th><th>来源</th><th>关联用户</th><th>状态</th><th>识别内容</th>${canManagePaper ? "<th>操作</th>" : ""}</tr></thead>
          <tbody>
            ${state.paperQueue.map((item) => `
              <tr>
                <td>${item.paperNo}</td><td>${item.source}</td><td>${userName(item.ownerId)}</td><td>${statusBadge(item.status)}</td><td>${item.text}</td>
                ${canManagePaper ? `<td><button class="secondary" data-archive-paper="${item.id}" type="button">归档</button></td>` : ""}
              </tr>
            `).join("") || `<tr><td colspan="${canManagePaper ? 6 : 5}" class="empty">暂无纸质单据</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function requestStatusBadge(status) {
  const cls = status === "已批准" ? "ok" : status === "待处理" ? "warn" : "bad";
  return `<span class="badge ${cls}">${status || "-"}</span>`;
}

function renderAssetRequests() {
  const requests = state.assetRequests || [];
  const canManageRequests = can("asset_requests.manage");
  return `
    ${!canManageRequests ? `
    <section class="panel">
      <div class="section-title"><h2>提交资产申请</h2></div>
      <form id="assetRequestForm" class="form-grid">
        <div class="field"><label>资产名称</label><input name="assetName" required placeholder="例如 投影仪、键盘、网线" /></div>
        <div class="field"><label>类别</label><input name="category" placeholder="设备 / 工具 / 耗材 / 软件" /></div>
        <div class="field"><label>规格</label><input name="spec" placeholder="型号、规格或配置" /></div>
        <div class="field"><label>数量</label><input name="quantity" type="number" min="1" value="1" required /></div>
        <div class="field wide"><label>申请原因 / 用途</label><textarea name="reason" required placeholder="说明用途、项目、期望使用时间等"></textarea></div>
        <button class="primary" type="submit">提交申请</button>
      </form>
    </section>` : ""}
    <section class="panel">
      <div class="section-title">
        <h2>${canManageRequests ? "资产申请列表" : "我的资产申请"}</h2>
        <span class="hint">待处理 ${requests.filter((item) => item.status === "待处理").length} 条</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              ${canManageRequests ? "<th>申请人</th>" : ""}<th>资产名称</th><th>类别</th><th>规格</th><th>数量</th><th>用途</th><th>时间</th><th>状态</th><th>处理备注</th>${canManageRequests ? "<th>操作</th>" : ""}
            </tr>
          </thead>
          <tbody>
            ${requests.map((item) => `
              <tr>
                ${canManageRequests ? `<td>${item.userName || userName(item.userId)}</td>` : ""}<td>${item.assetName}</td><td>${blank(item.category)}</td><td>${blank(item.spec)}</td><td>${item.quantity}</td><td>${blank(item.reason)}</td><td>${fmt(item.createdAt)}</td><td>${requestStatusBadge(item.status)}</td><td>${blank(item.handleNote)}</td>
                ${canManageRequests ? `<td>${item.status === "待处理" ? `<div class="row-actions"><button class="secondary small" data-approve-asset-request="${item.id}" type="button">批准</button><button class="ghost small" data-reject-asset-request="${item.id}" type="button">驳回</button></div>` : "-"}</td>` : ""}
              </tr>
            `).join("") || `<tr><td colspan="${canManageRequests ? 10 : 8}" class="empty">暂无资产申请</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function priorityBadge(priority) {
  const cls = priority === "紧急" ? "bad" : priority === "高" ? "warn" : "ok";
  return `<span class="badge ${cls}">${priority || "普通"}</span>`;
}

function renderPurchaseWishes() {
  const wishes = state.purchaseWishes || [];
  const canManageWishes = can("purchase_wishes.manage");
  const pending = wishes.filter((item) => item.status === "待采购" || item.status === "已采纳").length;
  const totalQuantity = wishes.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  return `
    <section class="panel">
      <div class="section-title">
        <h2>${canManageWishes ? "下一年度采购需求汇总" : "提交想要的设备"}</h2>
        <span class="hint">当前 ${wishes.length} 项，数量合计 ${totalQuantity}，待跟进 ${pending} 项</span>
      </div>
      ${!canManageWishes ? `
        <form id="purchaseWishForm" class="form-grid">
          <div class="field"><label>设备名称</label><input name="itemName" required placeholder="例如 笔记本、显示器、网线、硬盘" /></div>
          <div class="field"><label>类别</label><input name="category" placeholder="设备 / 耗材 / 软件 / 工具" /></div>
          <div class="field"><label>规格配置</label><input name="spec" placeholder="型号、容量、配置或数量规格" /></div>
          <div class="field"><label>数量</label><input name="quantity" type="number" min="1" value="1" required /></div>
          <div class="field"><label>优先级</label><select name="priority"><option>普通</option><option>高</option><option>紧急</option></select></div>
          <div class="field"><label>期望时间</label><input name="expectedTime" placeholder="例如 2027 年预算 / 下学期 / 尽快" /></div>
          <div class="field wide"><label>用途说明</label><textarea name="reason" required placeholder="说明使用场景、项目、课程、竞赛或现有设备不足的问题"></textarea></div>
          <button class="primary" type="submit">加入需求清单</button>
        </form>
      ` : `
        <div class="stats compact">
          ${["待采购", "已采纳", "暂缓", "已采购", "已关闭"].map((status) => dashboardStatCard(status, wishes.filter((item) => item.status === status).length, "采购需求", "☆")).join("")}
        </div>
      `}
    </section>
    <section class="panel">
      <div class="section-title"><h2>${canManageWishes ? "全部需求" : "我的需求"}</h2></div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              ${canManageWishes ? `<th>提交人</th>${isMultiDepartment() ? "<th>部门</th>" : ""}` : ""}<th>设备名称</th><th>类别</th><th>规格</th><th>数量</th><th>优先级</th><th>期望时间</th><th>用途说明</th><th>状态</th><th>处理备注</th>${canManageWishes ? "<th>操作</th>" : ""}
            </tr>
          </thead>
          <tbody>
            ${wishes.map((item) => `
              <tr>
                ${canManageWishes ? `<td>${item.userName || userName(item.userId)}</td>${isMultiDepartment() ? `<td>${item.userDepartment || userDepartment(item.userId)}</td>` : ""}` : ""}
                <td>${item.itemName}</td><td>${blank(item.category)}</td><td>${blank(item.spec)}</td><td>${item.quantity}</td><td>${priorityBadge(item.priority)}</td><td>${blank(item.expectedTime)}</td><td>${blank(item.reason)}</td><td>${requestStatusBadge(item.status)}</td><td>${blank(item.handleNote)}</td>
                ${canManageWishes ? `<td><div class="row-actions"><button class="secondary small" data-update-wish="${item.id}" data-wish-status="已采纳" type="button">采纳</button><button class="secondary small" data-update-wish="${item.id}" data-wish-status="暂缓" type="button">暂缓</button><button class="secondary small" data-update-wish="${item.id}" data-wish-status="已采购" type="button">已采购</button><button class="ghost small" data-update-wish="${item.id}" data-wish-status="已关闭" type="button">关闭</button></div></td>` : ""}
              </tr>
            `).join("") || `<tr><td colspan="${canManageWishes ? (isMultiDepartment() ? 12 : 11) : 9}" class="empty">暂无采购需求</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderUsers() {
  if (!can("users.view")) return "";
  const departmentOptions = departments().map((department) => `<option value="${department}">${department}</option>`).join("");
  const roleOptions = [
    ["teacher", "普通教师"],
    ["department_head", "部门负责人"],
    ["asset_manager", "资产管理员"],
    ["admin", "系统管理员"]
  ].map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
  return `
    ${can("users.manage") ? `<section class="panel">
      <div class="section-title"><h2>新增用户</h2></div>
      <form id="userForm" class="form-grid">
        <div class="field"><label>账号自动生成</label><input disabled placeholder="保存后按姓名缩写生成，如 张三 -> zs" /></div>
        <div class="field"><label>姓名</label><input name="name" required /></div>
        <div class="field"><label>初始密码</label><input name="password" required placeholder="请填写临时密码" /></div>
        ${isMultiDepartment() ? `<div class="field"><label>部门选项</label><select name="department" required>${departmentOptions}</select></div>` : `<input type="hidden" name="department" value="${state.currentUser.department}" />`}
        <div class="field"><label>角色</label><select name="roleId">${roleOptions}</select></div>
        <div class="field"><label>状态</label><select name="active"><option value="true">启用</option><option value="false">停用</option></select></div>
        <button class="primary" type="submit">保存用户</button>
      </form>
    </section>` : ""}
    <section class="panel">
      <div class="section-title"><h2>角色权限表</h2><span class="hint">菜单和权限由后端 RBAC 表控制。</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>角色</th><th>说明</th><th>菜单</th><th>权限数</th></tr></thead>
          <tbody>
            ${(state.roles || []).map((role) => `<tr><td>${role.name}</td><td>${blank(role.description)}</td><td>${(role.menus || []).join(" / ")}</td><td>${(role.permissions || []).length}</td></tr>`).join("") || `<tr><td colspan="4" class="empty">暂无角色数据</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
    <section class="panel">
      <div class="section-title"><h2>用户列表</h2></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>账号</th><th>姓名</th><th>操作</th><th>角色</th>${isMultiDepartment() ? "<th>部门</th>" : ""}<th>状态</th></tr></thead>
          <tbody>
            ${state.users.map((user) => `
              <tr data-user-row="${user.id}">
                <td>${user.username}</td>
                <td>${user.name}</td>
                <td>
                  ${user.id === state.currentUser.id ? `<span class="hint">当前用户</span>` : user.active ? `
                    ${can("users.manage") ? `<button class="secondary small" data-promote-user="${user.id}" data-role-id="asset_manager" type="button">资产管理员</button><button class="secondary small" data-promote-user="${user.id}" data-role-id="department_head" type="button">部门负责人</button><button class="secondary small" data-promote-user="${user.id}" data-role-id="admin" type="button">系统管理员</button>` : ""}
                    ${can("users.manage") && (user.roleId === "admin" || user.role === "admin") ? `<button class="secondary small" data-revoke-admin="${user.id}" type="button">改为教师</button>` : ""}
                    <button class="secondary small" data-reset-password="${user.id}" type="button">改密码</button>
                    <button class="danger small" data-delete-user="${user.id}" type="button">删除</button>
                  ` : `<span class="hint">已停用</span>`}
                </td>
                <td>${user.roleName || roleLabel(user.roleId || user.role)}</td>
                ${isMultiDepartment() ? `<td>${user.department}</td>` : ""}
                <td>${user.active ? "启用" : "停用"}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderAdminRequestsPanel(mode = "panel") {
  const requests = state.adminRequests || [];
  const pending = requests.filter((item) => item.status === "待处理");
  const wrapper = mode === "compact" ? "div" : "section";
  const className = mode === "compact" ? "message-table" : "panel";
  return `
    <${wrapper} class="${className}">
      ${mode === "compact" ? "" : `<div class="section-title"><h2>管理员权限申请</h2><span class="hint">待处理 ${pending.length} 条</span></div>`}
      <div class="table-wrap">
        <table>
          <thead><tr><th>申请人</th><th>账号</th><th>理由</th><th>时间</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            ${requests.map((item) => `
              <tr>
                <td>${item.userName || userName(item.userId)}</td>
                <td>${item.username || "-"}</td>
                <td>${item.reason || "-"}</td>
                <td>${fmt(item.createdAt)}</td>
                <td>${item.status}</td>
                <td>${item.status === "待处理" ? `<div class="row-actions"><button class="secondary small" data-approve-admin-request="${item.id}" type="button">批准</button><button class="ghost small" data-ignore-admin-request="${item.id}" type="button">忽略</button></div>` : "-"}</td>
              </tr>
            `).join("") || `<tr><td colspan="6" class="empty">暂无管理员权限申请</td></tr>`}
          </tbody>
        </table>
      </div>
    </${wrapper}>
  `;
}

function renderAssetRequestMessages() {
  const requests = (state.assetRequests || []).filter((item) => item.status === "待处理");
  if (!requests.length) return "";
  return `
    <div class="message-table">
      <div class="section-title"><h2>资产申请</h2><span class="hint">待处理 ${requests.length} 条</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>申请人</th><th>资产</th><th>数量</th><th>用途</th><th>操作</th></tr></thead>
          <tbody>
            ${requests.slice(0, 8).map((item) => `
              <tr>
                <td>${item.userName || userName(item.userId)}</td><td>${item.assetName}</td><td>${item.quantity}</td><td>${blank(item.reason)}</td>
                <td><div class="row-actions"><button class="secondary small" data-approve-asset-request="${item.id}" type="button">批准</button><button class="ghost small" data-reject-asset-request="${item.id}" type="button">驳回</button></div></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderPurchaseWishMessages() {
  const wishes = (state.purchaseWishes || []).filter((item) => item.status === "待采购" || item.status === "已采纳");
  if (!wishes.length) return "";
  return `
    <div class="message-table">
      <div class="section-title"><h2>采购需求</h2><span class="hint">待跟进 ${wishes.length} 项</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>提交人</th><th>设备</th><th>数量</th><th>优先级</th><th>状态</th></tr></thead>
          <tbody>
            ${wishes.slice(0, 8).map((item) => `
              <tr>
                <td>${item.userName || userName(item.userId)}</td><td>${item.itemName}</td><td>${item.quantity}</td><td>${priorityBadge(item.priority)}</td><td>${requestStatusBadge(item.status)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function printTemplateLabel(kind) {
  if (kind === "asset") {
    return state.settings?.printAssetTemplateCustom
      ? state.settings?.printAssetTemplateName || "自定义资产领用模板"
      : "内置无隐私资产领用模板";
  }
  return state.settings?.printConsumableTemplateCustom
    ? state.settings?.printConsumableTemplateName || "自定义耗材领用模板"
    : "内置无隐私耗材领用模板";
}

function renderPrintTemplateSetting(kind, title, description) {
  return `
    <div class="print-template-card">
      <div>
        <strong>${title}</strong>
        <p class="hint">${description}</p>
        <p class="hint">当前：${printTemplateLabel(kind)}</p>
      </div>
      <div class="setting-actions">
        <input id="${kind}PrintTemplateFile" class="visually-hidden" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" />
        <label class="secondary" for="${kind}PrintTemplateFile">选择模板</label>
        <button class="primary" data-save-print-template="${kind}" type="button">保存模板</button>
        <button class="ghost" data-reset-print-template="${kind}" type="button">恢复内置</button>
      </div>
    </div>
  `;
}

function portApplyCommand(port = state.settings?.servicePort || "38280") {
  return `if (Test-Path .\\docker-compose.yml) { } elseif (Test-Path .\\Warehouse-Management-System\\docker-compose.yml) { Set-Location .\\Warehouse-Management-System } else { Write-Host '请先进入 Warehouse-Management-System 项目目录'; exit 1 }; $env:WAREHOUSE_HOST_PORT='${port}'; docker compose -p warehouse up --build -d`;
}

function renderSettings() {
  if (!can("settings.view")) return "";
  return `
    <section class="panel">
      <div class="section-title"><h2>基础设置</h2></div>
      <form id="multiDepartmentForm" class="setting-row">
        <div>
          <strong>多部门功能</strong>
          <p class="hint">关闭后，系统会隐藏部门选择、部门列和部门右键操作。</p>
        </div>
        <label class="switch">
          <input name="enabled" type="checkbox" ${isMultiDepartment() ? "checked" : ""} />
          <span></span>
        </label>
      </form>
      <form id="developerModeForm" class="setting-row">
        <div>
          <strong>开发者调试功能</strong>
          <p class="hint">开启后显示调试工具。调试工具只建议测试时使用。</p>
        </div>
        <label class="switch">
          <input name="enabled" type="checkbox" ${isDeveloperMode() ? "checked" : ""} />
          <span></span>
        </label>
      </form>
      <form id="loginBackgroundForm" class="setting-row setting-row-stack">
        <div>
          <strong>登录展示图</strong>
          <p class="hint">自定义登录页左侧大背景图，建议使用横版仓库、设备或办公现场照片。</p>
        </div>
        <div class="setting-actions">
          <input id="loginBackgroundFile" class="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp,image/gif" />
          <label class="secondary" for="loginBackgroundFile">选择图片</label>
          <button class="primary" type="submit">保存展示图</button>
          <button class="ghost" id="resetLoginBackground" type="button">恢复默认</button>
        </div>
        <div class="login-bg-preview" ${state.settings?.loginBackgroundImage ? `style="background-image:url('${String(state.settings.loginBackgroundImage).replaceAll("'", "%27")}')"` : ""}></div>
      </form>
      <form id="servicePortForm" class="setting-row">
        <div>
          <strong>后台端口设置</strong>
          <p class="hint">当前访问端口：${state.settings?.servicePort || "38280"}。修改后需要在宿主机重新执行 Docker 命令，网页不能直接热切换端口。</p>
          <code class="inline-command">${portApplyCommand()}</code>
        </div>
        <div class="port-setting">
          <input name="port" type="number" min="1" max="65535" required value="${state.settings?.servicePort || "38280"}" />
          <button class="primary" type="submit">保存端口</button>
          <button class="secondary" id="copyPortCommand" type="button">复制命令</button>
        </div>
      </form>
      ${isDeveloperMode() ? `
      <form id="adminPrefillForm" class="setting-row">
        <div>
          <strong>默认填写管理员密码</strong>
          <p class="hint">开启后登录页会自动填入 admin 和管理员初始密码；关闭后登录页保持空白，但缩写账号登录仍然保留。</p>
        </div>
        <label class="switch">
          <input name="enabled" type="checkbox" ${isAdminPrefillEnabled() ? "checked" : ""} />
          <span></span>
        </label>
      </form>
      <div class="debug-tools">
        <div>
          <strong>清空业务数据</strong>
          <p class="hint">清空资产、出入库记录、导入留档、纸质待复核和操作记录，保留用户、部门和系统设置。当前资产 ${state.assets.length} 个，记录 ${state.records.length} 条，留档 ${state.importArchives.length} 个。</p>
        </div>
        <button class="danger" id="clearDebugFiles" type="button">清空业务数据</button>
      </div>` : ""}
    </section>
    <section class="panel">
      <div class="section-title"><h2>实验室功能</h2><span class="hint">放置扫码、预览类等仍在逐步完善的功能。</span></div>
      ${renderExperimentalFeatures()}
    </section>
    <section class="panel">
      <div class="section-title"><h2>打印设置</h2></div>
      <p class="hint">默认使用系统内置的空白无隐私 Word 模板。上传自定义 .docx 后，“导出模板单”会优先使用这里保存的模板；浏览器“打印资产表”使用网页打印样式。</p>
      <div class="print-template-grid">
        ${renderPrintTemplateSetting("asset", "资产领用模板", "用于“物品领用申请及确认单”，建议使用空白模板，不填写真实姓名、资产编号或业务内容。")}
        ${renderPrintTemplateSetting("consumable", "耗材领用模板", "用于“耗材领用申请及确认单”，建议使用空白模板，不填写真实姓名、资产编号或业务内容。")}
      </div>
    </section>
    ${isMultiDepartment() ? `
    <section class="panel">
      <div class="section-title"><h2>部门设置</h2></div>
      <form id="departmentSettingsForm">
        <div class="field">
          <label>部门列表</label>
          <textarea name="departments" required>${departments().join("\n")}</textarea>
        </div>
        <p class="hint">每行一个部门。这里保存后，新增用户、登记出入库、批量导入校验都会使用这些部门。</p>
        <button class="primary" type="submit">保存设置</button>
      </form>
      <div class="department-tags">
        ${departments().map((department) => `<button class="department-tag" data-department-name="${department}" title="右键删除部门" type="button">${department}</button>`).join("")}
      </div>
    </section>` : ""}
  `;
}

function renderExperimentalFeatures() {
  return `
    <form id="assetDetailLabelForm" class="setting-row">
      <div>
        <strong>资产详情二维码标签</strong>
        <p class="hint">控制资产状况详情抽屉里“二维码标签”和“打印标签”区域是否显示。</p>
      </div>
      <label class="switch">
        <input name="enabled" type="checkbox" ${isAssetDetailLabelEnabled() ? "checked" : ""} />
        <span></span>
      </label>
    </form>
    <form id="paperModuleForm" class="setting-row">
      <div>
        <strong>纸质单据方案</strong>
        <p class="hint">控制左侧“纸质单据方案”菜单和纸质单据队列页面是否显示；关闭不会删除已有纸质单据数据。</p>
      </div>
      <label class="switch">
        <input name="enabled" type="checkbox" ${isPaperModuleEnabled() ? "checked" : ""} />
        <span></span>
      </label>
    </form>
    <div class="setting-row setting-row-stack">
      <div>
        <strong>扫码查看资产</strong>
        <p class="hint">用于测试二维码标签入口。支持粘贴二维码内容、资产详情链接或资产编号；摄像头扫码取决于浏览器是否支持。</p>
      </div>
      <div class="form-grid">
        <div class="field wide">
          <label>二维码内容 / 资产编号</label>
          <input id="qrAssetLookup" placeholder="例如 XXZX-DN-2026-0001，或粘贴二维码链接" />
        </div>
        <div class="setting-actions">
          <button class="primary" id="openQrAsset" type="button">打开资产详情</button>
          <button class="secondary" id="startQrScanner" type="button">使用摄像头扫描</button>
        </div>
      </div>
    </div>
  `;
}

function renderAudit() {
  if (!can("audit.view")) return "";
  const defaultStart = defaultAuditStartTime();
  const visibleStart = auditStartTime || defaultStart;
  const fieldLabels = { all: "全部字段", time: "日期", operator: "操作人", ip: "来源IP", action: "动作", detail: "详情" };
  const filterOptions = auditFilterOptions(auditFilterField);
  const queryControl = auditFilterField === "all"
    ? `<input id="auditFilterQuery" class="audit-query" placeholder="搜索时间、操作人、来源IP、动作、详情" value="${auditFilterQuery}" />`
    : `<select id="auditFilterQuery" class="audit-query">
        <option value="">全部${fieldLabels[auditFilterField]}</option>
        ${filterOptions.map((item) => `<option value="${item}" ${auditFilterQuery === item ? "selected" : ""}>${item}</option>`).join("")}
      </select>`;
  const audits = state.audits.filter(auditMatches);
  return `
    <section class="panel">
      <div class="section-title"><h2>操作记录</h2></div>
      <div class="toolbar audit-toolbar">
        <div class="filters">
          <input id="auditStartTime" type="datetime-local" value="${visibleStart}" title="开始时间" />
          <input id="auditEndTime" type="datetime-local" value="${auditEndTime}" title="结束时间" />
          <select id="auditFilterField" title="筛选字段">
            <option value="all" ${auditFilterField === "all" ? "selected" : ""}>全部字段</option>
            <option value="time" ${auditFilterField === "time" ? "selected" : ""}>时间</option>
            <option value="operator" ${auditFilterField === "operator" ? "selected" : ""}>操作人</option>
            <option value="ip" ${auditFilterField === "ip" ? "selected" : ""}>来源IP</option>
            <option value="action" ${auditFilterField === "action" ? "selected" : ""}>动作</option>
            <option value="detail" ${auditFilterField === "detail" ? "selected" : ""}>详情</option>
          </select>
          ${queryControl}
          <button class="secondary" id="clearAuditFilter" type="button">清空筛选</button>
        </div>
        <span class="hint">当前 ${audits.length} 条 / 共 ${state.audits.length} 条。Docker 直连只能看到转发地址；接入内网代理并传 X-Forwarded-For 后会显示真实局域网 IP。</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>时间</th><th>操作人</th><th>来源IP</th><th>动作</th><th>详情</th></tr></thead>
          <tbody>
            ${audits.map((audit) => `<tr><td>${fmt(audit.time)}</td><td>${userName(audit.user_id || audit.userId)}</td><td>${auditIpDisplay(audit.ip)}</td><td>${audit.action}</td><td>${audit.detail}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">暂无符合筛选条件的操作记录</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderContextMenu() {
  if (!state.currentUser) return "";
  const adminItems = can("assets.manage") || can("records.manage") || can("users.manage") || can("settings.manage")
    ? `
      ${can("assets.manage") ? `<button data-context-action="assets" type="button">新建资产</button>` : ""}
      ${can("records.manage") ? `<button data-context-action="records" type="button">新增出入库</button><button data-context-action="records-import" type="button">批量导入记录</button>` : ""}
      ${can("users.manage") ? `<button data-context-action="users" type="button">新增用户</button>` : ""}
      ${can("settings.manage") ? `<button data-context-action="settings" type="button">系统设置</button>` : ""}
    `
    : `
      <button data-context-action="records" type="button">查看我的出入库</button>
      <button data-context-action="assets" type="button">查看相关资产</button>
    `;
  return `
    <div class="context-menu" id="contextMenu" aria-hidden="true">
      ${adminItems}
      <button data-context-action="refresh" type="button">刷新数据</button>
    </div>
    ${isMultiDepartment() ? `
    <div class="context-menu compact" id="departmentContextMenu" aria-hidden="true">
      <button data-department-delete type="button">删除部门</button>
    </div>` : ""}
    <div class="context-menu compact" id="userContextMenu" aria-hidden="true">
      <button data-user-promote type="button">设为管理员</button>
      <button data-user-revoke-admin type="button">撤销管理员</button>
      <button data-user-password type="button">改密码</button>
      <button data-user-delete type="button">删除用户</button>
    </div>
  `;
}

function assetFromQrText(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  let candidates = [text];
  try {
    const url = new URL(text, window.location.origin);
    const assetParam = url.searchParams.get("asset");
    if (assetParam) candidates.push(assetParam);
    const pathAsset = url.pathname.match(/\/assets\/([^/]+)/);
    if (pathAsset) candidates.push(decodeURIComponent(pathAsset[1]));
  } catch {
    const assetParam = text.match(/[?&]asset=([^&]+)/);
    if (assetParam) candidates.push(decodeURIComponent(assetParam[1]));
  }
  candidates = candidates.map((item) => String(item || "").trim()).filter(Boolean);
  return state.assets.find((asset) => candidates.includes(asset.id) || candidates.includes(asset.code))
    || state.assets.find((asset) => candidates.some((item) => asset.name === item));
}

function openAssetFromQrText(value) {
  const asset = assetFromQrText(value);
  if (!asset) {
    alert("没有找到对应资产。请确认二维码内容、资产编号或链接是否正确。");
    return;
  }
  view = "assets";
  selectedAssetDetailId = asset.id;
  render();
}

async function startQrScanner(onResult) {
  if (!("BarcodeDetector" in window)) {
    alert("当前浏览器不支持摄像头二维码识别。可以把二维码内容或资产编号粘贴到输入框后打开资产详情。");
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    alert("当前浏览器无法调用摄像头。");
    return;
  }
  const overlay = document.createElement("div");
  overlay.className = "scanner-overlay";
  overlay.innerHTML = `
    <div class="scanner-panel">
      <div class="section-title"><h2>扫描资产二维码</h2><button class="ghost small" type="button" data-close-scanner>关闭</button></div>
      <video autoplay playsinline></video>
      <p class="hint">请将资产标签二维码放入画面中。</p>
    </div>
  `;
  document.body.appendChild(overlay);
  const video = overlay.querySelector("video");
  const close = () => {
    video.srcObject?.getTracks?.().forEach((track) => track.stop());
    overlay.remove();
  };
  overlay.querySelector("[data-close-scanner]")?.addEventListener("click", close);
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    video.srcObject = stream;
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    let active = true;
    const tick = async () => {
      if (!active || !document.body.contains(overlay)) return;
      try {
        const codes = await detector.detect(video);
        if (codes.length) {
          active = false;
          const raw = codes[0].rawValue || "";
          close();
          if (typeof onResult === "function") {
            onResult(raw);
          } else {
            openAssetFromQrText(raw);
          }
          return;
        }
      } catch {
        // Some browsers throw while the video stream is warming up.
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  } catch (exc) {
    close();
    alert(`摄像头无法启动：${exc.message || "请检查浏览器权限"}`);
  }
}

function renderRecordCards(records) {
  if (!records.length) return `<div class="empty">暂无出入库记录</div>`;
  return `<div class="record-list">${records.map((record) => `
    <article class="record-card">
      <div class="card-head">
        <strong>${record.type} · ${assetName(record.assetId)}</strong>
        ${isAdmin() ? `<button class="danger small" data-delete-record="${record.id}" type="button">删除</button>` : ""}
      </div>
      <p>${statusBadge(record.status)} 单据：${recordDocumentType(record)}，数量：${record.quantity}，使用人：${userName(record.userId)}</p>
      <p>入库：${fmt(record.inTime)}，出库：${fmt(record.outTime)}</p>
      <p>纸质单号：${record.paperNo || "-"}</p>
      ${record.displayNote ? `<p>备注：${recordDisplayNote(record)}</p>` : ""}
    </article>
  `).join("")}</div>`;
}

function updateManualRecordPreview() {
  const form = document.querySelector("#recordForm");
  if (!form) return;
  const asset = state.assets.find((item) => item.id === form.assetId?.value) || {};
  const group = assetGroupById(form.assetId?.value);
  const user = state.users.find((item) => item.id === form.userId?.value) || {};
  const activeType = form.querySelector("[data-record-type].active");
  const typeText = activeType?.textContent?.trim() || form.type?.value || "-";
  document.querySelector("#assetCodePreview").textContent = group?.model || assetModelText(asset) || "-";
  document.querySelector("#assetCategoryPreview").textContent = group?.category || asset.category || "-";
  document.querySelector("#assetQuantityPreview").textContent = `${group?.quantity ?? asset.quantity ?? 0} 台`;
  document.querySelector("#summaryType").textContent = typeText;
  document.querySelector("#summaryQuantity").textContent = form.quantity?.value || "1";
  document.querySelector("#summaryUser").textContent = user.name ? `${user.name}${isMultiDepartment() ? ` · ${user.department}` : ""}` : "-";
  document.querySelector("#summaryInTime").textContent = fmt(form.inTime?.value);
  document.querySelector("#summaryOutTime").textContent = fmt(form.outTime?.value);
  document.querySelector("#summaryPaper").textContent = form.paperNo?.value || "-";
  document.querySelector("#summaryNote").textContent = form.note?.value || "-";
  const file = form.photoFile?.files?.[0];
  const fileName = document.querySelector("#photoFileName");
  if (fileName) fileName.textContent = file ? file.name : "支持 JPG、PNG";
}

function withActor(payload = {}) {
  return { ...payload, actorId: state.currentUser.id };
}

function formData(form) {
  return Object.fromEntries(new FormData(form));
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function selectedImportFiles(form, extensions) {
  const files = [
    ...Array.from(form.file?.files || []),
    ...Array.from(form.folder?.files || [])
  ];
  const seen = new Set();
  return files.filter((file) => {
    const name = (file.webkitRelativePath || file.name || "").toLowerCase();
    const key = `${name}:${file.size}:${file.lastModified}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return extensions.some((extension) => name.endsWith(extension));
  });
}

function importConfig() {
  if (importKind === "word") {
    return {
      accept: ".docx",
      extensions: [".docx"],
      endpoint: "/api/records/import-word-checkout",
      resultKey: "wordImportResult",
      button: "导入 Word 出借单",
      uploadHint: "支持 .docx，单次可上传多个文件，也可选择包含 Word 单据的文件夹",
      description: "标准表格会自动导入出借记录；手写图片或扫描件会进入待复核队列。"
    };
  }
  return {
    accept: ".xlsx,.csv",
    extensions: [".xlsx", ".csv"],
    endpoint: "/api/records/import-inbound",
    resultKey: "importResult",
    button: "导入入库记录",
    uploadHint: "支持 .xlsx、.csv，单次可上传多个文件，也可选择包含入库表的文件夹",
    description: `表头：资产编号、类型、数量${isMultiDepartment() ? "、部门" : ""}、借用人、入库时间、纸质单号、备注。`
  };
}

function renderSelectedFiles(files) {
  const box = document.querySelector("#selectedImportFiles");
  if (!box) return;
  if (!files.length) {
    box.innerHTML = `<span class="hint">尚未选择文件</span>`;
    return;
  }
  box.innerHTML = `
    ${files.slice(0, 8).map((file) => `
      <div class="selected-file">
        <span class="file-icon">${file.name.toLowerCase().endsWith(".docx") ? "W" : "X"}</span>
        <div><strong>${file.webkitRelativePath || file.name}</strong><em>${formatFileSize(file.size)}</em></div>
        <span class="file-ok">✓</span>
      </div>
    `).join("")}
    <div class="selected-count">已选择 ${files.length} 个文件${files.length > 8 ? "，仅预览前 8 个" : ""}</div>
  `;
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes)) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function importFilesBatch(files, endpoint, resultKey) {
  const summary = { imported: 0, createdAssets: 0, paperCreated: 0, skipped: [], files: [] };
  for (const file of files) {
    const fileName = file.webkitRelativePath || file.name;
    try {
      const response = await api(endpoint, {
        method: "POST",
        body: JSON.stringify(withActor({
          fileName,
          contentBase64: await fileToBase64(file)
        }))
      });
      const result = response[resultKey] || { imported: 0, skipped: [] };
      summary.imported += Number(result.imported || 0);
      summary.createdAssets += Number(result.createdAssets || 0);
      summary.paperCreated += Number(result.paperCreated || 0);
      summary.skipped.push(...(result.skipped || []).map((item) => ({ ...item, file: fileName })));
      summary.files.push({
        fileName,
        imported: Number(result.imported || 0),
        createdAssets: Number(result.createdAssets || 0),
        paperCreated: Number(result.paperCreated || 0),
        skipped: (result.skipped || []).length
      });
    } catch (exc) {
      summary.skipped.push({ row: fileName, reason: exc.message });
      summary.files.push({ fileName, imported: 0, createdAssets: 0, paperCreated: 0, skipped: 1, error: exc.message });
    }
  }
  state = await api(`/api/state?userId=${encodeURIComponent(state.currentUser.id)}${viewRoleParam()}`);
  ensureFreshVersion(state);
  applyAssetUrlSelection();
  summary.message = `已处理 ${files.length} 个文件`;
  return summary;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function imageToDataUrl(file) {
  if (!file || !file.size) return "";
  const source = await readFileAsDataUrl(file);
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = source;
  });
  const maxSide = 1280;
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.78);
}

function csvCell(value) {
  const text = String(value ?? "").replace(/\r?\n/g, " ");
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadTextFile(fileName, text, type = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type });
  downloadBlob(fileName, blob);
}

function base64ToBlob(base64, type = "application/octet-stream") {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type });
}

function downloadBlob(fileName, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = safeDownloadName(fileName);
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    link.remove();
  }, 1000);
}

function safeDownloadName(fileName) {
  return String(fileName || "导入留档文件").replace(/[\\/:*?"<>|]/g, "_");
}

async function downloadImportArchive(archiveId) {
  const data = await api(`/api/import-archives/content?id=${encodeURIComponent(archiveId)}&userId=${encodeURIComponent(state.currentUser.id)}`);
  downloadBlob(data.fileName || "导入留档文件", base64ToBlob(data.contentBase64));
}

function fileNameFromDisposition(disposition, fallback) {
  const text = String(disposition || "");
  const utfMatch = text.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch) return decodeURIComponent(utfMatch[1]);
  const plainMatch = text.match(/filename="?([^";]+)"?/i);
  return plainMatch ? plainMatch[1] : fallback;
}

async function downloadAssetPrintTemplates() {
  const assetIds = filteredAssets().map((asset) => asset.id);
  if (!assetIds.length) {
    alert("没有可打印的资产数据。");
    return;
  }
  const response = await fetch("/api/assets/print-template", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor({ assetIds }))
  });
  if (!response.ok) {
    let message = "生成模板失败";
    try {
      const data = await response.json();
      message = data.error || message;
    } catch {}
    throw new Error(message);
  }
  const blob = await response.blob();
  const fileName = fileNameFromDisposition(response.headers.get("Content-Disposition"), "资产申请确认单.docx");
  downloadBlob(fileName, blob);
}

function filteredAssets() {
  return filteredAssetGroups().flatMap((group) => group.assets);
}

function downloadAssetsTable() {
  const headers = ["序号", "资产编号", "物品名称", "品牌", "类别", "规格", "单位", "数量", "单价", "总金额", "购置日期", "入库日期", "供应商", "使用部门", "使用人", "位置", "状态", "资产来源", "创建人", "更新时间", "备注"];
  const rows = filteredAssets().map((asset, index) => [
    index + 1,
    asset.code,
    asset.name,
    blank(asset.brand),
    asset.category,
    blank(asset.spec),
    blank(asset.unit || "件"),
    asset.quantity,
    Number(asset.unitPrice || 0),
    Number(asset.totalAmount || 0),
    blank(asset.purchaseDate),
    blank(asset.inboundDate),
    blank(asset.supplier),
    blank(asset.useDepartment),
    asset.useUserId ? userName(asset.useUserId) : userName(asset.keeperId),
    blank(asset.location),
    statusText(asset.status),
    blank(asset.source),
    asset.creatorId ? userName(asset.creatorId) : "-",
    fmt(asset.updatedAt),
    displayRemark(asset.remark)
  ]);
  const csv = `\ufeff${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
  downloadTextFile(`资产表-${new Date().toISOString().slice(0, 10)}.csv`, csv);
}

function assetCategoryChecks(asset) {
  const category = String(asset?.category || "").trim();
  const text = [category, asset?.remark, asset?.name].join(" ");
  const templateNoise = ["固定资产", "低值易耗品", "耗材", "购进软件"].every((label) => category.includes(label));
  const isAsset = assetKind(asset) === "资产";
  const checks = {
    固定资产: (category.includes("固定资产") && !templateNoise) || isAsset,
    低值易耗品: category.includes("低值易耗品") && !templateNoise,
    耗材: false,
    购进软件: ((category.includes("购进软件") || category.includes("软件")) && !templateNoise) || (text.includes("软件") && !templateNoise)
  };
  return `
    <div class="asset-print-category-line"><span>${checks.固定资产 ? "☑" : "☐"}固定资产</span><span>${checks.低值易耗品 ? "☑" : "☐"}低值易耗品</span></div>
    <div class="asset-print-category-line"><span>${checks.耗材 ? "☑" : "☐"}耗材</span><span>${checks.购进软件 ? "☑" : "☐"}购进软件</span></div>
  `;
}

function assetPrintChunks(items, size = 5) {
  const chunks = [];
  for (let index = 0; index < Math.max(items.length, 1); index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function printApplicantId(asset) {
  const flow = assetFlow(asset);
  if (flow.borrowerId) return flow.borrowerId;
  if (asset?.keeperId && asset.keeperId !== "u-import-unknown") return asset.keeperId;
  if (assetKeeperFilter !== "all") return assetKeeperFilter;
  return state.currentUser?.id || "";
}

function printApplicantNameById(userId) {
  const name = userName(userId);
  return name === "未知用户" || name === "未填写" ? "" : name;
}

function groupPrintItemsByApplicant(items) {
  const groups = new Map();
  items.forEach((asset) => {
    const applicantId = printApplicantId(asset);
    if (!groups.has(applicantId)) {
      groups.set(applicantId, {
        applicantId,
        applicantName: printApplicantNameById(applicantId),
        items: []
      });
    }
    groups.get(applicantId).items.push(asset);
  });
  return [...groups.values()];
}

function renderAssetPrintPage(chunk, pageIndex, today, applicantName) {
  const rows = Array.from({ length: 5 }, (_, rowIndex) => chunk[rowIndex] || null);
  return `
    <section class="asset-print-page asset-print-page-request">
      <h1>物品领用申请及确认单</h1>
      <div class="asset-print-meta">
        <span>编号：ZITTC-WG-WPLY-${String(new Date().getFullYear()).slice(2)}-${String(pageIndex + 1).padStart(2, "0")}</span>
        <span>本单序号：${today}-${String(pageIndex + 1).padStart(2, "0")}</span>
        <span>申请人：${applicantName || ""}</span>
      </div>
      <table class="asset-print-table">
        <thead>
          <tr><th>序号</th><th>物品名称</th><th>资产编号</th><th>配置</th><th>数量</th><th>类别</th></tr>
        </thead>
        <tbody>
          ${rows.map((asset, rowIndex) => `
            <tr>
              <td>${asset ? pageIndex * 5 + rowIndex + 1 : ""}</td>
              <td>${asset?.name || ""}</td>
              <td>${asset?.code || ""}</td>
              <td>${asset?.spec || ""}</td>
              <td>${asset?.quantity || ""}</td>
              <td class="asset-print-category">${asset ? assetCategoryChecks(asset) : ""}</td>
            </tr>
          `).join("")}
          <tr class="asset-print-reason"><td colspan="2">申请缘由</td><td colspan="4"></td></tr>
          <tr class="asset-print-sign"><td colspan="2">领用人确认<br>领用签名</td><td>领用日期</td><td></td><td>预期归还日期</td><td></td></tr>
          <tr class="asset-print-sign"><td colspan="2">资产管理负责人审核</td><td></td><td colspan="2">项目负责人审核</td><td></td></tr>
          <tr class="asset-print-sign"><td colspan="2">领用人确认归还签名</td><td></td><td colspan="2">归还日期</td><td></td></tr>
          <tr class="asset-print-sign"><td colspan="2">资产管理负责人确认归还签名</td><td></td><td colspan="2">备注</td><td></td></tr>
        </tbody>
      </table>
    </section>
  `;
}

function renderConsumablePrintPage(chunk, pageIndex, today, startIndex, applicantName) {
  const rows = Array.from({ length: 15 }, (_, rowIndex) => chunk[rowIndex] || null);
  return `
    <section class="asset-print-page consumable-print-page">
      <h1>耗材领用申请及确认单</h1>
      <div class="asset-print-meta consumable-print-meta">
        <span>编号：ZITTC-WG-WPLY-${String(new Date().getFullYear()).slice(2)}-${String(pageIndex + 1).padStart(2, "0")}</span>
        <span>本单序号：${today}-${String(pageIndex + 1).padStart(2, "0")}</span>
        <span>申请人：${applicantName || ""}</span>
      </div>
      <table class="asset-print-table consumable-print-table">
        <thead>
          <tr><th>序号</th><th>申领人</th><th>物品名称</th><th>配置</th><th>数量</th><th>领用时间</th><th>预计归还时间</th></tr>
        </thead>
        <tbody>
          ${rows.map((asset, rowIndex) => `
            <tr>
              <td>${asset ? startIndex + rowIndex + 1 : ""}</td>
              <td>${asset ? applicantName || "" : ""}</td>
              <td>${asset?.name || ""}</td>
              <td>${asset?.spec || ""}</td>
              <td>${asset?.quantity || ""}</td>
              <td>${asset ? new Date().toISOString().slice(0, 10) : ""}</td>
              <td></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </section>
  `;
}

function renderPrintableAssetSheets(items) {
  const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const pages = [];
  groupPrintItemsByApplicant(items).forEach((group) => {
    const assetItems = group.items.filter((asset) => assetKind(asset) === "资产");
    const consumableItems = group.items.filter((asset) => assetKind(asset) === "耗材");
    if (assetItems.length) {
      assetPrintChunks(assetItems, 5).forEach((chunk, pageIndex) => {
        pages.push(renderAssetPrintPage(chunk, pageIndex, today, group.applicantName));
      });
    }
    if (consumableItems.length) {
      assetPrintChunks(consumableItems, 15).forEach((chunk, pageIndex) => {
        pages.push(renderConsumablePrintPage(chunk, pageIndex, today, pageIndex * 15, group.applicantName));
      });
    }
  });
  if (!pages.length) {
    pages.push(renderAssetPrintPage([], 0, today, ""));
  }
  return `<div class="print-assets-template">${pages.join("")}</div>`;
}

function downloadInboundTemplate() {
  const header = isMultiDepartment()
    ? "资产编号,类型,数量,部门,借用人,入库时间,纸质单号,备注"
    : "资产编号,类型,数量,借用人,入库时间,纸质单号,备注";
  const sample = isMultiDepartment()
    ? "CK-2026-001,入库,1,生产一组,张三,2026-06-02T16:30,SZ-IN-100,批量入库"
    : "CK-2026-001,入库,1,张三,2026-06-02T16:30,SZ-IN-100,批量入库";
  const csv = `\ufeff${header}\n${sample}\n`;
  downloadTextFile("入库记录导入模板.csv", csv);
}

function bindContextMenu() {
  const menu = document.querySelector("#contextMenu");
  const content = document.querySelector(".content");
  if (!menu || !content) return;

  content.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    const left = Math.min(event.clientX, window.innerWidth - 220);
    const top = Math.min(event.clientY, window.innerHeight - 260);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.classList.add("open");
    menu.setAttribute("aria-hidden", "false");
    setTimeout(() => document.addEventListener("click", closeContextMenu, { once: true }), 0);
  });

  menu.querySelectorAll("[data-context-action]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      const action = event.currentTarget.dataset.contextAction;
      closeContextMenu();
      if (action === "refresh") {
        await refresh();
        return;
      }
      if (action === "records-import") {
        view = "records";
        recordMode = "import";
        render();
        requestAnimationFrame(() => document.querySelector("#inboundImportForm")?.scrollIntoView({ behavior: "smooth", block: "center" }));
        return;
      }
      view = action;
      if (action === "records") recordMode = "manual";
      if (action === "assets") assetDrawerOpen = true;
      render();
      if (action === "records") requestAnimationFrame(() => document.querySelector("#recordForm")?.scrollIntoView({ behavior: "smooth", block: "center" }));
      if (action === "users") requestAnimationFrame(() => document.querySelector("#userForm")?.scrollIntoView({ behavior: "smooth", block: "center" }));
    });
  });
}

function bindDepartmentContextMenu() {
  const menu = document.querySelector("#departmentContextMenu");
  if (!menu) return;
  let selectedDepartmentName = "";

  document.querySelectorAll("[data-department-name]").forEach((button) => {
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      selectedDepartmentName = button.dataset.departmentName;
      const left = Math.min(event.clientX, window.innerWidth - 180);
      const top = Math.min(event.clientY, window.innerHeight - 120);
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
      menu.classList.add("open");
      menu.setAttribute("aria-hidden", "false");
      setTimeout(() => document.addEventListener("click", closeDepartmentContextMenu, { once: true }), 0);
    });
  });

  menu.querySelector("[data-department-delete]")?.addEventListener("click", async () => {
    closeDepartmentContextMenu();
    if (!selectedDepartmentName) return;
    if (!confirm(`确定删除部门“${selectedDepartmentName}”吗？`)) return;
    try {
      state = await api("/api/settings/departments/delete", {
        method: "POST",
        body: JSON.stringify(withActor({ department: selectedDepartmentName }))
      });
      render();
    } catch (exc) {
      alert(exc.message);
    }
  });
}

function closeDepartmentContextMenu() {
  const menu = document.querySelector("#departmentContextMenu");
  if (!menu) return;
  menu.classList.remove("open");
  menu.setAttribute("aria-hidden", "true");
}

function closeContextMenu() {
  const menu = document.querySelector("#contextMenu");
  if (!menu) return;
  menu.classList.remove("open");
  menu.setAttribute("aria-hidden", "true");
}

async function deleteUser(userId) {
  const target = state.users.find((user) => user.id === userId);
  const label = target ? `${target.name}（${target.username}）` : "该用户";
  if (!confirm(`确定删除 ${label} 吗？删除后该用户将不能登录，历史出入库记录仍会保留。`)) return;
  try {
    state = await api("/api/users/delete", {
      method: "POST",
      body: JSON.stringify(withActor({ targetUserId: userId }))
    });
    render();
  } catch (exc) {
    alert(exc.message);
  }
}

async function promoteUser(userId, roleId = "admin") {
  const target = state.users.find((user) => user.id === userId);
  const label = target ? `${target.name}（${target.username}）` : "该用户";
  if (!confirm(`确定把 ${label} 的角色调整为${roleLabel(roleId)}吗？`)) return;
  try {
    state = await api("/api/users/promote", {
      method: "POST",
      body: JSON.stringify(withActor({ targetUserId: userId, roleId }))
    });
    render();
  } catch (exc) {
    alert(exc.message);
  }
}

async function revokeAdmin(userId) {
  const target = state.users.find((user) => user.id === userId);
  const label = target ? `${target.name}（${target.username}）` : "该用户";
  if (!confirm(`确定撤销 ${label} 的管理员权限吗？撤销后该用户将变为普通用户。`)) return;
  try {
    state = await api("/api/users/revoke-admin", {
      method: "POST",
      body: JSON.stringify(withActor({ targetUserId: userId }))
    });
    render();
  } catch (exc) {
    alert(exc.message);
  }
}

async function requestAdminRole() {
  const reason = prompt("请输入申请管理员权限的原因", "需要管理资产和出入库记录");
  if (reason === null) return;
  try {
    state = await api("/api/admin-requests", {
      method: "POST",
      body: JSON.stringify(withActor({ reason }))
    });
    alert("管理员权限申请已提交。");
    render();
  } catch (exc) {
    alert(exc.message);
  }
}

async function approveAdminRequest(requestId) {
  const target = state.adminRequests?.find((item) => item.id === requestId);
  const label = target ? `${target.userName || "该用户"}（${target.username || "-"}）` : "该用户";
  if (!confirm(`确定批准 ${label} 成为管理员吗？`)) return;
  try {
    state = await api("/api/admin-requests/approve", {
      method: "POST",
      body: JSON.stringify(withActor({ requestId }))
    });
    render();
  } catch (exc) {
    alert(exc.message);
  }
}

async function ignoreAdminRequest(requestId) {
  try {
    state = await api("/api/admin-requests/ignore", {
      method: "POST",
      body: JSON.stringify(withActor({ requestId }))
    });
    render();
  } catch (exc) {
    alert(exc.message);
  }
}

async function approveAssetRequest(requestId) {
  const request = state.assetRequests?.find((item) => item.id === requestId);
  const label = request ? `${request.assetName} × ${request.quantity}` : "该申请";
  const note = prompt(`确认批准 ${label} 吗？可填写处理备注`, "");
  if (note === null) return;
  try {
    state = await api("/api/asset-requests/approve", {
      method: "POST",
      body: JSON.stringify(withActor({ requestId, note }))
    });
    render();
  } catch (exc) {
    alert(exc.message);
  }
}

async function rejectAssetRequest(requestId) {
  const request = state.assetRequests?.find((item) => item.id === requestId);
  const label = request ? `${request.assetName} × ${request.quantity}` : "该申请";
  const note = prompt(`请输入驳回 ${label} 的原因`, "");
  if (note === null) return;
  try {
    state = await api("/api/asset-requests/reject", {
      method: "POST",
      body: JSON.stringify(withActor({ requestId, note }))
    });
    render();
  } catch (exc) {
    alert(exc.message);
  }
}

async function updatePurchaseWish(wishId, status) {
  const wish = state.purchaseWishes?.find((item) => item.id === wishId);
  const label = wish ? `${wish.itemName} × ${wish.quantity}` : "该需求";
  const note = prompt(`确认将 ${label} 标记为「${status}」吗？可填写处理备注`, wish?.handleNote || "");
  if (note === null) return;
  try {
    state = await api("/api/purchase-wishes/update", {
      method: "POST",
      body: JSON.stringify(withActor({ wishId, status, note }))
    });
    render();
  } catch (exc) {
    alert(exc.message);
  }
}

async function markAllMessagesRead() {
  try {
    state = await api("/api/admin-requests/mark-read", {
      method: "POST",
      body: JSON.stringify(withActor())
    });
    render();
  } catch (exc) {
    alert(exc.message);
  }
}

async function changeMyPassword() {
  const oldPassword = prompt("请输入旧密码");
  if (oldPassword === null) return;
  const newPassword = prompt("请输入新密码（至少 4 位）");
  if (newPassword === null) return;
  if (newPassword.length < 4) {
    alert("新密码至少需要 4 位。");
    return;
  }
  try {
    state = await api("/api/users/password", {
      method: "POST",
      body: JSON.stringify(withActor({ oldPassword, newPassword }))
    });
    alert("密码已修改，请使用新密码登录。");
    render();
  } catch (exc) {
    alert(exc.message);
  }
}

async function toggleViewMode() {
  if (!isRealAdmin()) return;
  const nextMode = isUserViewMode() ? "admin" : "user";
  if (nextMode === "user" && ["users", "baseData", "settings", "audit"].includes(view)) {
    view = "dashboard";
  }
  if (nextMode === "user") {
    localStorage.setItem(VIEW_MODE_KEY, "user");
  } else {
    localStorage.removeItem(VIEW_MODE_KEY);
  }
  await refresh();
}

async function resetUserPassword(userId) {
  const target = state.users.find((user) => user.id === userId);
  const label = target ? `${target.name}（${target.username}）` : "该用户";
  const newPassword = prompt(`请输入 ${label} 的新密码（至少 4 位）`, "");
  if (newPassword === null) return;
  if (newPassword.length < 4) {
    alert("新密码至少需要 4 位。");
    return;
  }
  try {
    state = await api("/api/users/password", {
      method: "POST",
      body: JSON.stringify(withActor({ targetUserId: userId, newPassword }))
    });
    alert("密码已重置。");
    render();
  } catch (exc) {
    alert(exc.message);
  }
}

function bindUserContextMenu() {
  const menu = document.querySelector("#userContextMenu");
  if (!menu || !can("users.manage")) return;
  let selectedUserId = "";

  document.querySelectorAll("[data-user-row]").forEach((row) => {
    row.addEventListener("contextmenu", (event) => {
      const target = state.users.find((user) => user.id === row.dataset.userRow);
      if (!target || !target.active || target.id === state.currentUser.id) return;
      event.preventDefault();
      selectedUserId = target.id;
      const promoteButton = menu.querySelector("[data-user-promote]");
      if (promoteButton) promoteButton.hidden = target.role !== "user";
      const revokeButton = menu.querySelector("[data-user-revoke-admin]");
      if (revokeButton) revokeButton.hidden = target.role !== "admin";
      const left = Math.min(event.clientX, window.innerWidth - 180);
      const top = Math.min(event.clientY, window.innerHeight - 120);
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
      menu.classList.add("open");
      menu.setAttribute("aria-hidden", "false");
      setTimeout(() => document.addEventListener("click", closeUserContextMenu, { once: true }), 0);
    });
  });

  menu.querySelector("[data-user-delete]")?.addEventListener("click", async () => {
    closeUserContextMenu();
    if (selectedUserId) await deleteUser(selectedUserId);
  });

  menu.querySelector("[data-user-promote]")?.addEventListener("click", async () => {
    closeUserContextMenu();
    if (selectedUserId) await promoteUser(selectedUserId);
  });

  menu.querySelector("[data-user-revoke-admin]")?.addEventListener("click", async () => {
    closeUserContextMenu();
    if (selectedUserId) await revokeAdmin(selectedUserId);
  });

  menu.querySelector("[data-user-password]")?.addEventListener("click", async () => {
    closeUserContextMenu();
    if (selectedUserId) await resetUserPassword(selectedUserId);
  });
}

function closeUserContextMenu() {
  const menu = document.querySelector("#userContextMenu");
  if (!menu) return;
  menu.classList.remove("open");
  menu.setAttribute("aria-hidden", "true");
}

function bindEvents() {
  document.querySelector("#loginForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = document.querySelector("#loginError");
    error.textContent = "";
    try {
      const payload = formData(event.target);
      const rememberLogin = Boolean(payload.rememberLogin);
      delete payload.rememberLogin;
      const data = await api("/api/login", { method: "POST", body: JSON.stringify(payload) });
      localStorage.removeItem(USER_KEY);
      sessionStorage.removeItem(SESSION_USER_KEY);
      if (rememberLogin) {
        localStorage.setItem(USER_KEY, data.user.id);
      } else {
        sessionStorage.setItem(SESSION_USER_KEY, data.user.id);
      }
      state.currentUser = data.user;
      view = "dashboard";
      await refresh();
    } catch (exc) {
      error.textContent = exc.message;
    }
  });

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      view = button.dataset.view;
      render();
    });
  });

  document.querySelector("#logoutBtn")?.addEventListener("click", () => {
    localStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(SESSION_USER_KEY);
    localStorage.removeItem(VIEW_MODE_KEY);
    state.currentUser = null;
    render();
  });

  document.querySelector("#requestAdminBtn")?.addEventListener("click", requestAdminRole);
  document.querySelector("#changeMyPasswordBtn")?.addEventListener("click", changeMyPassword);
  document.querySelector("#toggleViewModeBtn")?.addEventListener("click", toggleViewMode);
  document.querySelector("#messageCenterBtn")?.addEventListener("click", () => {
    messagePanelOpen = !messagePanelOpen;
    render();
  });
  document.querySelector("#markAllMessagesRead")?.addEventListener("click", markAllMessagesRead);

  document.querySelector("#printAssets")?.addEventListener("click", () => {
    const oldTitle = document.title;
    document.title = "";
    window.print();
    setTimeout(() => {
      document.title = oldTitle;
    }, 1000);
  });
  document.querySelector("#exportPrintTemplates")?.addEventListener("click", async () => {
    try {
      await downloadAssetPrintTemplates();
    } catch (error) {
      alert(error.message || "生成模板失败");
    }
  });
  document.querySelector("#downloadAssets")?.addEventListener("click", downloadAssetsTable);

  bindSearchInput("#dashboardSearch", (value) => {
    dashboardSearch = value;
  });

  bindSearchInput("#assetSearch", (value) => {
    assetFilter = value;
  });

  document.querySelector("#assetStatusFilter")?.addEventListener("change", (event) => {
    assetStatusFilter = event.target.value;
    render();
  });

  document.querySelector("#assetKeeperFilter")?.addEventListener("change", (event) => {
    assetKeeperFilter = event.target.value;
    render();
  });

  document.querySelector("#assetBorrowerFilter")?.addEventListener("change", (event) => {
    assetBorrowerFilter = event.target.value;
    if (assetBorrowerFilter !== "all") assetStatusFilter = "checked_out";
    render();
  });

  document.querySelector("#clearBorrowerDetail")?.addEventListener("click", () => {
    assetBorrowerFilter = "all";
    render();
  });

  document.querySelector("#assetSortField")?.addEventListener("change", (event) => {
    assetSortField = event.target.value;
    render();
  });

  document.querySelector("#assetSortDir")?.addEventListener("change", (event) => {
    assetSortDir = event.target.value;
    render();
  });

  document.querySelector("#clearAssetSelection")?.addEventListener("click", () => {
    selectedAssetId = "";
    assetFilter = "";
    assetStatusFilter = "all";
    assetKeeperFilter = "all";
    assetBorrowerFilter = "all";
    assetSortField = "model";
    assetSortDir = "asc";
    render();
  });

  bindSearchInput("#inventorySearch", (value) => {
    inventoryFilter = value;
  });

  document.querySelector("#clearInventorySearch")?.addEventListener("click", () => {
    inventoryFilter = "";
    render();
  });

  document.querySelector("#inventoryAdjustForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = withActor(formData(event.target));
    payload.quantity = Number(payload.quantity);
    try {
      state = await api("/api/inventory/adjust", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      render();
    } catch (exc) {
      alert(exc.message);
    }
  });

  document.querySelectorAll("[data-safe-stock]").forEach((button) => {
    button.addEventListener("click", async () => {
      const assetId = button.dataset.safeStock;
      const value = prompt("请输入安全库存数量", button.dataset.safeStockValue || "0");
      if (value === null) return;
      const safeStock = Math.max(0, Number(value || 0));
      try {
        state = await api("/api/inventory/safe-stock", {
          method: "POST",
          body: JSON.stringify(withActor({ assetId, safeStock }))
        });
        render();
      } catch (exc) {
        alert(exc.message);
      }
    });
  });

  document.querySelector("#assetCategoryForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = withActor(formData(event.target));
    const endpoint = payload.categoryId ? "/api/assets/categories/update" : "/api/assets/categories/add";
    try {
      state = await api(endpoint, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      render();
    } catch (exc) {
      alert(exc.message);
    }
  });

  document.querySelector("#resetCategoryForm")?.addEventListener("click", () => {
    const form = document.querySelector("#assetCategoryForm");
    if (!form) return;
    form.reset();
    form.categoryId.value = "";
  });

  document.querySelectorAll("[data-category-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const category = assetCategoryItems().find((item) => item.id === button.dataset.categoryEdit);
      const form = document.querySelector("#assetCategoryForm");
      if (!category || !form) return;
      form.categoryId.value = category.id;
      form.name.value = category.name || "";
      form.code.value = category.code || "";
      form.categoryType.value = category.category_type || "固定资产";
      form.parentId.value = category.parent_id || "";
      form.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });

  document.querySelectorAll("[data-category-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const category = assetCategoryItems().find((item) => item.id === button.dataset.categoryDelete);
      if (!category) return;
      if (!confirm(`确定删除类别“${category.name}”吗？已被资产或子分类使用的类别不能删除。`)) return;
      try {
        state = await api("/api/assets/categories/delete", {
          method: "POST",
          body: JSON.stringify(withActor({ categoryId: category.id }))
        });
        render();
      } catch (exc) {
        alert(exc.message);
      }
    });
  });

  document.querySelector("#locationForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = withActor(formData(event.target));
    const endpoint = payload.locationId ? "/api/locations/update" : "/api/locations/add";
    try {
      state = await api(endpoint, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      render();
    } catch (exc) {
      alert(exc.message);
    }
  });

  document.querySelector("#resetLocationForm")?.addEventListener("click", () => {
    const form = document.querySelector("#locationForm");
    if (!form) return;
    form.reset();
    form.locationId.value = "";
  });

  document.querySelectorAll("[data-location-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const location = locations().find((item) => item.id === button.dataset.locationEdit);
      const form = document.querySelector("#locationForm");
      if (!location || !form) return;
      form.locationId.value = location.id;
      form.name.value = location.name || "";
      form.parentId.value = location.parent_id || "";
      form.type.value = location.type || "仓库";
      form.code.value = location.code || "";
      form.managerId.value = location.manager_id || "";
      form.remark.value = location.remark || "";
      form.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });

  document.querySelectorAll("[data-location-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const location = locations().find((item) => item.id === button.dataset.locationDelete);
      if (!location) return;
      if (!confirm(`确定删除位置“${location.name}”吗？已被资产使用的位置不能删除。`)) return;
      try {
        state = await api("/api/locations/delete", {
          method: "POST",
          body: JSON.stringify(withActor({ locationId: location.id }))
        });
        render();
      } catch (exc) {
        alert(exc.message);
      }
    });
  });

  document.querySelector("#openAssetDrawer")?.addEventListener("click", () => {
    assetDrawerOpen = true;
    editingAssetId = "";
    render();
  });

  document.querySelector("#closeAssetDrawer")?.addEventListener("click", () => {
    assetDrawerOpen = false;
    editingAssetId = "";
    render();
  });

  document.querySelector("#cancelAssetDrawer")?.addEventListener("click", () => {
    assetDrawerOpen = false;
    editingAssetId = "";
    render();
  });

  document.querySelector("#assetDrawerBackdrop")?.addEventListener("click", () => {
    assetDrawerOpen = false;
    editingAssetId = "";
    render();
  });

  document.querySelectorAll("[data-edit-asset]").forEach((button) => {
    button.addEventListener("click", () => {
      editingAssetId = button.dataset.editAsset;
      assetDrawerOpen = true;
      render();
    });
  });

  document.querySelectorAll("[data-view-asset]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedAssetDetailId = button.dataset.viewAsset;
      render();
    });
  });

  document.querySelector("#closeAssetDetail")?.addEventListener("click", () => {
    selectedAssetDetailId = "";
    clearAssetUrlParam();
    render();
  });

  document.querySelector("#assetDetailBackdrop")?.addEventListener("click", () => {
    selectedAssetDetailId = "";
    clearAssetUrlParam();
    render();
  });

  document.querySelectorAll("[data-copy-asset-url]").forEach((button) => {
    button.addEventListener("click", async () => {
      const asset = state.assets.find((item) => item.id === button.dataset.copyAssetUrl);
      if (!asset) return;
      const url = assetDetailUrl(asset);
      try {
        await navigator.clipboard.writeText(url);
        alert("资产详情链接已复制。");
      } catch {
        prompt("复制资产详情链接：", url);
      }
    });
  });

  document.querySelector("#printAssetLabel")?.addEventListener("click", () => {
    const oldTitle = document.title;
    document.body.classList.add("printing-label");
    document.title = "";
    window.print();
    setTimeout(() => {
      document.body.classList.remove("printing-label");
      document.title = oldTitle;
    }, 1000);
  });

  document.querySelectorAll("[data-delete-record]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!isDeveloperMode() && !confirm("确定删除这条出入库记录吗？")) return;
      try {
        state = await api("/api/records/delete", {
          method: "POST",
          body: JSON.stringify(withActor({ recordId: button.dataset.deleteRecord }))
        });
        render();
      } catch (exc) {
        alert(exc.message);
      }
    });
  });

  document.querySelectorAll("[data-delete-asset]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!isDeveloperMode() && !confirm("确定删除这个资产吗？已有出入库记录的资产需要先删除相关记录。")) return;
      try {
        state = await api("/api/assets/delete", {
          method: "POST",
          body: JSON.stringify(withActor({ assetId: button.dataset.deleteAsset }))
        });
        render();
      } catch (exc) {
        alert(exc.message);
      }
    });
  });

  document.querySelector("#recordFilter")?.addEventListener("change", (event) => {
    recordFilter = event.target.value;
    render();
  });

  document.querySelectorAll("[data-suspect-duplicate-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      suspectDuplicateMode = button.dataset.suspectDuplicateMode || "expanded";
      localStorage.setItem(SUSPECT_DUPLICATE_MODE_KEY, suspectDuplicateMode);
      render();
    });
  });

  document.querySelector("#checkScopeType")?.addEventListener("change", (event) => {
    const target = document.querySelector("#checkScopeValue");
    const template = document.querySelector("#checkScopeOptions");
    const source = template?.content.querySelector(`[data-scope="${event.target.value}"]`);
    if (target && source) target.innerHTML = source.innerHTML;
  });

  document.querySelector("#inventoryCheckForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      state = await api("/api/inventory-checks", {
        method: "POST",
        body: JSON.stringify(withActor(formData(event.target)))
      });
      render();
    } catch (exc) {
      alert(exc.message);
    }
  });

  document.querySelectorAll("[data-save-check-item]").forEach((button) => {
    button.addEventListener("click", async () => {
      const itemId = button.dataset.saveCheckItem;
      try {
        state = await api("/api/inventory-checks/item", {
          method: "POST",
          body: JSON.stringify(withActor({
            itemId,
            actualLocation: document.querySelector(`[data-check-location="${itemId}"]`)?.value || "",
            actualStatus: document.querySelector(`[data-check-status="${itemId}"]`)?.value || "",
            actualKeeperId: document.querySelector(`[data-check-keeper="${itemId}"]`)?.value || "",
            remark: document.querySelector(`[data-check-remark="${itemId}"]`)?.value || ""
          }))
        });
        render();
      } catch (exc) {
        alert(exc.message);
      }
    });
  });

  document.querySelectorAll("[data-complete-check]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("确定完成这个盘点任务吗？未保存的明细会按盘亏处理。")) return;
      try {
        state = await api("/api/inventory-checks/complete", {
          method: "POST",
          body: JSON.stringify(withActor({ taskId: button.dataset.completeCheck }))
        });
        render();
      } catch (exc) {
        alert(exc.message);
      }
    });
  });

  document.querySelector("#checkScanForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      state = await api("/api/inventory-checks/scan", {
        method: "POST",
        body: JSON.stringify(withActor(formData(event.target)))
      });
      render();
    } catch (exc) {
      alert(exc.message);
    }
  });

  document.querySelector("#checkSurplusForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = withActor(formData(event.target));
    payload.quantity = Number(payload.quantity || 1);
    try {
      state = await api("/api/inventory-checks/surplus", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      render();
    } catch (exc) {
      alert(exc.message);
    }
  });

  document.querySelector("#startCheckQrScanner")?.addEventListener("click", async () => {
    await startQrScanner((raw) => {
      const input = document.querySelector("#checkScanForm input[name='scanText']");
      if (input) input.value = raw;
    });
  });

  document.querySelectorAll("[data-export-check]").forEach((button) => {
    button.addEventListener("click", () => {
      window.location.href = `/api/inventory-checks/export?taskId=${encodeURIComponent(button.dataset.exportCheck)}&userId=${encodeURIComponent(state.currentUser.id)}`;
    });
  });

  document.querySelectorAll("[data-export-report]").forEach((button) => {
    button.addEventListener("click", () => {
      window.location.href = `/api/reports/export?type=${encodeURIComponent(button.dataset.exportReport)}&userId=${encodeURIComponent(state.currentUser.id)}`;
    });
  });

  document.querySelector("#recordKindFilter")?.addEventListener("change", (event) => {
    recordKindFilter = event.target.value;
    render();
  });

  document.querySelector("#auditStartTime")?.addEventListener("change", (event) => {
    auditStartTime = event.target.value;
    render();
  });

  document.querySelector("#auditEndTime")?.addEventListener("change", (event) => {
    auditEndTime = event.target.value;
    render();
  });

  document.querySelector("#auditFilterField")?.addEventListener("change", (event) => {
    auditFilterField = event.target.value;
    auditFilterQuery = "";
    render();
  });

  bindSearchInput("#auditFilterQuery", (value) => {
    auditFilterQuery = value;
  });

  document.querySelector("#auditFilterQuery")?.addEventListener("change", (event) => {
    auditFilterQuery = event.target.value;
    render();
  });

  document.querySelector("#clearAuditFilter")?.addEventListener("click", () => {
    auditFilterField = "all";
    auditFilterQuery = "";
    auditStartTime = "";
    auditEndTime = "";
    render();
  });

  document.querySelectorAll("[data-record-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      recordMode = button.dataset.recordMode;
      render();
    });
  });

  document.querySelectorAll("[data-download-archive]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await downloadImportArchive(button.dataset.downloadArchive);
      } catch (exc) {
        alert(`下载失败：${exc.message}`);
      }
    });
  });

  document.querySelector("#departmentFilter")?.addEventListener("change", (event) => {
    selectedDepartment = event.target.value;
    render();
  });

  document.querySelector("#downloadInboundTemplate")?.addEventListener("click", downloadInboundTemplate);

  document.querySelectorAll("[data-import-kind]").forEach((button) => {
    button.addEventListener("click", () => {
      importKind = button.dataset.importKind;
      render();
    });
  });

  document.querySelectorAll("#bulkFileInput, #bulkFolderInput").forEach((input) => {
    input.addEventListener("change", () => {
      renderSelectedFiles(selectedImportFiles(document.querySelector("#bulkImportForm"), importConfig().extensions));
    });
  });

  const uploadZone = document.querySelector("[data-upload-zone]");
  uploadZone?.addEventListener("dragover", (event) => {
    event.preventDefault();
    uploadZone.classList.add("dragging");
  });
  uploadZone?.addEventListener("dragleave", () => uploadZone.classList.remove("dragging"));
  uploadZone?.addEventListener("drop", (event) => {
    event.preventDefault();
    uploadZone.classList.remove("dragging");
    const input = document.querySelector("#bulkFileInput");
    if (input && event.dataTransfer?.files?.length) {
      input.files = event.dataTransfer.files;
      renderSelectedFiles(selectedImportFiles(document.querySelector("#bulkImportForm"), importConfig().extensions));
    }
  });

  document.querySelector("#bulkImportForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const config = importConfig();
    const files = selectedImportFiles(event.target, config.extensions);
    if (!files.length) {
      alert(importKind === "word" ? "请选择 .docx 文件，或选择包含 Word 文件的文件夹" : "请选择 .xlsx 或 .csv 文件，或选择包含这些文件的文件夹");
      return;
    }
    const result = await importFilesBatch(files, config.endpoint, config.resultKey);
    if (importKind === "word") {
      wordImportResult = result;
    } else {
      importResult = result;
    }
    render();
  });

  document.querySelector("#assetForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = withActor(formData(event.target));
    payload.quantity = Number(payload.quantity);
    const endpoint = payload.assetId ? "/api/assets/update" : "/api/assets";
    state = await api(endpoint, { method: "POST", body: JSON.stringify(payload) });
    assetDrawerOpen = false;
    editingAssetId = "";
    render();
  });

  document.querySelector("#recordForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = withActor(formData(event.target));
    payload.quantity = Number(payload.quantity);
    const photoFile = event.target.photoFile?.files?.[0];
    delete payload.photoFile;
    payload.photo = await imageToDataUrl(photoFile);
    state = await api("/api/records", { method: "POST", body: JSON.stringify(payload) });
    render();
  });

  document.querySelector("#recordForm")?.addEventListener("input", updateManualRecordPreview);
  document.querySelector("#recordForm")?.addEventListener("change", updateManualRecordPreview);
  document.querySelector("#recordForm")?.addEventListener("reset", () => {
    setTimeout(() => {
      const form = document.querySelector("#recordForm");
      form?.querySelectorAll("[data-record-type]").forEach((item, index) => item.classList.toggle("active", index === 0));
      if (form?.type) form.type.value = "入库";
      updateManualRecordPreview();
    }, 0);
  });

  document.querySelectorAll("[data-record-type]").forEach((button) => {
    button.addEventListener("click", () => {
      const form = document.querySelector("#recordForm");
      form.querySelectorAll("[data-record-type]").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      form.type.value = button.dataset.recordType;
      updateManualRecordPreview();
    });
  });

  document.querySelectorAll("[data-quantity-step]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = document.querySelector("#recordForm input[name='quantity']");
      input.value = Math.max(1, Number(input.value || 1) + Number(button.dataset.quantityStep));
      updateManualRecordPreview();
    });
  });

  document.querySelector("#saveDraftBtn")?.addEventListener("click", () => {
    localStorage.setItem("warehouse-record-draft", JSON.stringify(formData(document.querySelector("#recordForm"))));
    alert("草稿已保存在本机浏览器");
  });

  document.querySelector("#paperForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    state = await api("/api/paper", { method: "POST", body: JSON.stringify(withActor(formData(event.target))) });
    render();
  });

  document.querySelector("#assetRequestForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = withActor(formData(event.target));
    payload.quantity = Number(payload.quantity);
    try {
      state = await api("/api/asset-requests", { method: "POST", body: JSON.stringify(payload) });
      alert("资产申请已提交。");
      render();
    } catch (exc) {
      alert(exc.message);
    }
  });

  document.querySelector("#purchaseWishForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = withActor(formData(event.target));
    payload.quantity = Number(payload.quantity);
    try {
      state = await api("/api/purchase-wishes", { method: "POST", body: JSON.stringify(payload) });
      alert("需求已加入清单。");
      render();
    } catch (exc) {
      alert(exc.message);
    }
  });

  document.querySelectorAll("[data-archive-paper]").forEach((button) => {
    button.addEventListener("click", async () => {
      state = await api("/api/paper/archive", { method: "POST", body: JSON.stringify(withActor({ paperId: button.dataset.archivePaper })) });
      render();
    });
  });

  document.querySelector("#userForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = withActor(formData(event.target));
    payload.active = payload.active === "true";
    try {
      state = await api("/api/users", { method: "POST", body: JSON.stringify(payload) });
      render();
    } catch (exc) {
      alert(exc.message);
    }
  });

  document.querySelectorAll("[data-delete-user]").forEach((button) => {
    button.addEventListener("click", async () => {
      await deleteUser(button.dataset.deleteUser);
    });
  });

  document.querySelectorAll("[data-promote-user]").forEach((button) => {
    button.addEventListener("click", async () => {
      await promoteUser(button.dataset.promoteUser, button.dataset.roleId || "admin");
    });
  });

  document.querySelectorAll("[data-revoke-admin]").forEach((button) => {
    button.addEventListener("click", async () => {
      await revokeAdmin(button.dataset.revokeAdmin);
    });
  });

  document.querySelectorAll("[data-approve-admin-request]").forEach((button) => {
    button.addEventListener("click", async () => {
      await approveAdminRequest(button.dataset.approveAdminRequest);
    });
  });

  document.querySelectorAll("[data-ignore-admin-request]").forEach((button) => {
    button.addEventListener("click", async () => {
      await ignoreAdminRequest(button.dataset.ignoreAdminRequest);
    });
  });

  document.querySelectorAll("[data-approve-asset-request]").forEach((button) => {
    button.addEventListener("click", async () => {
      await approveAssetRequest(button.dataset.approveAssetRequest);
    });
  });

  document.querySelectorAll("[data-reject-asset-request]").forEach((button) => {
    button.addEventListener("click", async () => {
      await rejectAssetRequest(button.dataset.rejectAssetRequest);
    });
  });

  document.querySelectorAll("[data-update-wish]").forEach((button) => {
    button.addEventListener("click", async () => {
      await updatePurchaseWish(button.dataset.updateWish, button.dataset.wishStatus);
    });
  });

  document.querySelectorAll("[data-reset-password]").forEach((button) => {
    button.addEventListener("click", async () => {
      await resetUserPassword(button.dataset.resetPassword);
    });
  });

  document.querySelector("#departmentSettingsForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = withActor({
      departments: event.target.departments.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
    });
    state = await api("/api/settings/departments", { method: "POST", body: JSON.stringify(payload) });
    render();
  });

  document.querySelector("#multiDepartmentForm")?.addEventListener("change", async (event) => {
    if (event.target.name !== "enabled") return;
    state = await api("/api/settings/multi-department", {
      method: "POST",
      body: JSON.stringify(withActor({ enabled: event.target.checked }))
    });
    selectedDepartment = "all";
    render();
  });

  document.querySelector("#developerModeForm")?.addEventListener("change", async (event) => {
    if (event.target.name !== "enabled") return;
    state = await api("/api/settings/developer-mode", {
      method: "POST",
      body: JSON.stringify(withActor({ enabled: event.target.checked }))
    });
    loginSettings.adminPrefillEnabled = Boolean(state.settings?.adminPrefillEnabled);
    if (!event.target.checked) loginSettings.adminPrefillEnabled = false;
    render();
  });

  document.querySelector("#adminPrefillForm")?.addEventListener("change", async (event) => {
    if (event.target.name !== "enabled") return;
    state = await api("/api/settings/admin-prefill", {
      method: "POST",
      body: JSON.stringify(withActor({ enabled: event.target.checked }))
    });
    loginSettings.adminPrefillEnabled = Boolean(state.settings?.adminPrefillEnabled);
    render();
  });

  document.querySelector("#assetDetailLabelForm")?.addEventListener("change", async (event) => {
    if (event.target.name !== "enabled") return;
    state = await api("/api/settings/asset-detail-label", {
      method: "POST",
      body: JSON.stringify(withActor({ enabled: event.target.checked }))
    });
    render();
  });

  document.querySelector("#paperModuleForm")?.addEventListener("change", async (event) => {
    if (event.target.name !== "enabled") return;
    state = await api("/api/settings/paper-module", {
      method: "POST",
      body: JSON.stringify(withActor({ enabled: event.target.checked }))
    });
    render();
  });

  document.querySelector("#loginBackgroundFile")?.addEventListener("change", (event) => {
    const fileName = event.target.files?.[0]?.name || "";
    const form = document.querySelector("#loginBackgroundForm");
    const preview = form?.querySelector(".login-bg-preview");
    if (preview && event.target.files?.[0]) {
      preview.textContent = fileName;
      preview.classList.add("pending");
    }
  });

  document.querySelector("#loginBackgroundForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = document.querySelector("#loginBackgroundFile")?.files?.[0];
    if (!file) {
      alert("请先选择一张展示图。");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert("图片太大，请选择 5MB 以内的图片。");
      return;
    }
    const image = await imageToDataUrl(file);
    state = await api("/api/settings/login-background", {
      method: "POST",
      body: JSON.stringify(withActor({ image }))
    });
    loginSettings.loginBackgroundImage = state.settings?.loginBackgroundImage || "";
    render();
  });

  document.querySelector("#resetLoginBackground")?.addEventListener("click", async () => {
    state = await api("/api/settings/login-background", {
      method: "POST",
      body: JSON.stringify(withActor({ image: "" }))
    });
    loginSettings.loginBackgroundImage = "";
    render();
  });

  document.querySelectorAll("[data-save-print-template]").forEach((button) => {
    button.addEventListener("click", async () => {
      const kind = button.dataset.savePrintTemplate;
      const file = document.querySelector(`#${kind}PrintTemplateFile`)?.files?.[0];
      if (!file) {
        alert("请先选择一个 .docx 模板文件。");
        return;
      }
      if (!file.name.toLowerCase().endsWith(".docx")) {
        alert("打印模板必须是 .docx 文件。");
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        alert("模板文件不能超过 2MB。");
        return;
      }
      try {
        state = await api("/api/settings/print-template", {
          method: "POST",
          body: JSON.stringify(withActor({
            kind,
            fileName: file.name,
            contentBase64: await fileToBase64(file)
          }))
        });
        alert("打印模板已保存。");
        render();
      } catch (exc) {
        alert(exc.message);
      }
    });
  });

  document.querySelectorAll("[data-reset-print-template]").forEach((button) => {
    button.addEventListener("click", async () => {
      const kind = button.dataset.resetPrintTemplate;
      try {
        state = await api("/api/settings/print-template/reset", {
          method: "POST",
          body: JSON.stringify(withActor({ kind }))
        });
        render();
      } catch (exc) {
        alert(exc.message);
      }
    });
  });

  document.querySelector("#servicePortForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = withActor({ port: Number(event.target.port.value) });
    state = await api("/api/settings/service-port", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    if (state.portNotice) alert(state.portNotice);
    render();
  });

  document.querySelector("#copyPortCommand")?.addEventListener("click", async () => {
    const command = portApplyCommand();
    try {
      await navigator.clipboard.writeText(command);
      alert("端口重启命令已复制。");
    } catch {
      prompt("复制下面的命令，在 PowerShell 里执行：", command);
    }
  });

  document.querySelectorAll("[data-order-type]").forEach((button) => {
    button.addEventListener("click", () => {
      orderType = button.dataset.orderType;
      render();
    });
  });

  const orderForms = [
    ["#claimOrderForm", "/api/claim-orders"],
    ["#borrowOrderForm", "/api/borrow-orders"],
    ["#transferOrderForm", "/api/transfer-orders"],
    ["#repairOrderForm", "/api/repair-orders"],
    ["#scrapOrderForm", "/api/scrap-orders"]
  ];
  orderForms.forEach(([selector, endpoint]) => {
    document.querySelector(selector)?.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        state = await api(endpoint, { method: "POST", body: JSON.stringify(withActor(formData(event.target))) });
        render();
      } catch (exc) {
        alert(exc.message);
      }
    });
  });

  document.querySelectorAll("[data-return-borrow]").forEach((button) => {
    button.addEventListener("click", async () => {
      const returnCheck = prompt("请输入归还验收结果", "外观/数量验收正常");
      if (returnCheck === null) return;
      try {
        state = await api("/api/borrow-orders/return", {
          method: "POST",
          body: JSON.stringify(withActor({ orderId: button.dataset.returnBorrow, returnCheck }))
        });
        render();
      } catch (exc) {
        alert(exc.message);
      }
    });
  });

  document.querySelectorAll("[data-finish-repair]").forEach((button) => {
    button.addEventListener("click", async () => {
      const result = prompt("请输入维修结果", "维修完成，可正常使用");
      if (result === null) return;
      try {
        state = await api("/api/repair-orders/finish", {
          method: "POST",
          body: JSON.stringify(withActor({ orderId: button.dataset.finishRepair, result }))
        });
        render();
      } catch (exc) {
        alert(exc.message);
      }
    });
  });

  document.querySelector("#openQrAsset")?.addEventListener("click", () => {
    openAssetFromQrText(document.querySelector("#qrAssetLookup")?.value || "");
  });

  document.querySelector("#qrAssetLookup")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      openAssetFromQrText(event.target.value);
    }
  });

  document.querySelector("#startQrScanner")?.addEventListener("click", startQrScanner);

  document.querySelector("#clearDebugFiles")?.addEventListener("click", async () => {
    try {
      state = await api("/api/debug/clear-files", {
        method: "POST",
        body: JSON.stringify(withActor())
      });
      alert("业务数据已清空，用户已保留。");
      render();
    } catch (exc) {
      alert(exc.message);
    }
  });

  bindContextMenu();
  bindDepartmentContextMenu();
  bindUserContextMenu();
}

loadState();

