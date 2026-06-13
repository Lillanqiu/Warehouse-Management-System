const USER_KEY = "warehouse-current-user";
const SESSION_USER_KEY = "warehouse-session-user";
const TOKEN_KEY = "warehouse-current-session-token";
const SESSION_TOKEN_KEY = "warehouse-session-token";
const VIEW_MODE_KEY = "warehouse-view-mode";
const SUSPECT_DUPLICATE_MODE_KEY = "warehouse-suspect-duplicate-mode";
const APP_VERSION = "20260613-user-checkbox-v158";
const IMPORT_PREVIEW_ROW_LIMIT = 50;
const PURCHASE_WISH_DEFAULT_UPLIFT = 30;
const DRAWER_WIDTH_STORAGE_PREFIX = "warehouse-drawer-width";

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
  settings: { departments: [], assetCategories: [], assetCategoryItems: [], locations: [], deviceGroupRules: [], multiDepartmentEnabled: false, developerModeEnabled: false, adminPrefillEnabled: false, assetDetailLabelEnabled: true, paperModuleEnabled: true, loginBackgroundImage: "", servicePort: "", printAssetTemplateName: "", printAssetTemplateCustom: false, printConsumableTemplateName: "", printConsumableTemplateCustom: false }
};
let loginSettings = { adminPrefillEnabled: false, adminPrefillPassword: "", loginBackgroundImage: "", appVersion: APP_VERSION };
let view = "dashboard";
let assetFilter = "";
let selectedAssetId = "";
let assetStatusFilter = "all";
let assetCategoryFilters = [];
let assetFamilyFilter = "all";
let assetCategoryPanelOpen = false;
let assetAdvancedFiltersOpen = false;
let assetKeeperFilter = "all";
let assetBorrowerFilter = "all";
let assetSortField = "outTime";
let assetSortDir = "desc";
let assetPage = 1;
let assetPageSize = 10;
let inventoryFilter = "";
let inventoryView = "status";
let inventoryAdjustSource = "manual";
let assetDrawerOpen = false;
let editingAssetId = "";
let selectedAssetDetailId = "";
let dashboardSearch = "";
let dashboardMode = "list";
let dashboardCategory = "";
let dashboardUsageUserId = "";
let recordFilter = "all";
let recordKindFilter = "all";
let selectedDepartment = "all";
let recordMode = "import";
let recordStatsPeriod = nowLocal().slice(0, 7);
let importKind = "inbound";
let importResult = null;
let wordImportResult = null;
let assetLocationUpdateResult = null;
let assetImageUpdateResult = null;
let auditFilterField = "all";
let auditFilterQuery = "";
let auditStartTime = "";
let auditEndTime = "";
let orderType = "claim";
let reportType = "ledger";
let deviceGroupFilter = "";
let selectedDeviceGroupKeys = new Set();
let deviceGroupDraftName = "";
let deviceGroupDraftFamily = "";
let selectedAssetGroupKeys = new Set();
let ledgerDrawerKey = "";
let ledgerDrawerMode = "";
let recordActionMode = "inbound";
let recordPrefillAssetId = "";
let requestSection = "asset";
let systemSection = "users";
let selectedCheckTaskId = "";
let selectedCheckGroupKey = "";
let activeCheckItemId = "";
let searchRenderTimer = null;
let messagePanelOpen = false;
let suspectDuplicateMode = localStorage.getItem(SUSPECT_DUPLICATE_MODE_KEY) || "expanded";
let composingInputs = new Set();
let systemHealth = null;
let systemHealthCheckedAt = "";
let systemHealthLoading = false;
let loginNotice = "";
let userRepairState = null;
let userRepairOptions = { includeInactive: false, skipAdmin: true, skipReferenced: true };

function drawerWidthStorageKey(kind) {
  return `${DRAWER_WIDTH_STORAGE_PREFIX}-${kind || "default"}`;
}

function savedDrawerWidth(kind, fallback) {
  const raw = Number(localStorage.getItem(drawerWidthStorageKey(kind)) || 0);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function drawerWidthStyle(kind, fallback) {
  const width = savedDrawerWidth(kind, fallback);
  return `style="--drawer-width: ${Math.round(width)}px" data-drawer-kind="${attrText(kind)}"`;
}

function renderDrawerResizeHandle(label = "拖动调整窗口宽度") {
  return `<button class="drawer-resize-handle" data-drawer-resize-handle type="button" aria-label="${label}" title="${label}"></button>`;
}

function viewRoleParam() {
  return localStorage.getItem(VIEW_MODE_KEY) === "user" ? "&viewRole=user" : "";
}

function clearStoredSession() {
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(SESSION_USER_KEY);
  sessionStorage.removeItem(SESSION_TOKEN_KEY);
}

function storedSession() {
  const localUserId = localStorage.getItem(USER_KEY);
  const localToken = localStorage.getItem(TOKEN_KEY);
  if (localUserId && localToken) return { userId: localUserId, sessionToken: localToken };
  const sessionUserId = sessionStorage.getItem(SESSION_USER_KEY);
  const sessionToken = sessionStorage.getItem(SESSION_TOKEN_KEY);
  if (sessionUserId && sessionToken) return { userId: sessionUserId, sessionToken };
  if (localUserId || localToken || sessionUserId || sessionToken) clearStoredSession();
  return null;
}

function saveStoredSession(userId, sessionToken, remember) {
  clearStoredSession();
  const userStore = remember ? localStorage : sessionStorage;
  const tokenStore = remember ? localStorage : sessionStorage;
  userStore.setItem(remember ? USER_KEY : SESSION_USER_KEY, userId);
  tokenStore.setItem(remember ? TOKEN_KEY : SESSION_TOKEN_KEY, sessionToken);
}

function sessionToken() {
  return storedSession()?.sessionToken || "";
}

function authQuery(userId = state.currentUser?.id) {
  const token = sessionToken();
  return `userId=${encodeURIComponent(userId || "")}&sessionToken=${encodeURIComponent(token)}${viewRoleParam()}`;
}

function handleSessionExpired(message = "登录已过期，请重新登录。") {
  loginNotice = message || "登录已过期，请重新登录。";
  clearStoredSession();
  localStorage.removeItem(VIEW_MODE_KEY);
  state.currentUser = null;
  view = "dashboard";
  render();
  const error = new Error(loginNotice);
  error.status = 401;
  error.code = "SESSION_EXPIRED";
  return error;
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...options
    });
  } catch (exc) {
    throw new Error(exc?.message === "Failed to fetch" ? "网络请求中断：服务可能正在重启、后端处理异常、文件较大或浏览器连接被断开，请稍后重试。" : exc.message || "网络请求失败");
  }
  const data = await response.json();
  if (!response.ok) {
    if (data.code === "SESSION_EXPIRED") throw handleSessionExpired(data.error);
    const error = new Error(data.error || "请求失败");
    error.status = response.status;
    error.code = data.code || "";
    throw error;
  }
  return data;
}

async function loadState() {
  await loadLoginSettings();
  const saved = storedSession();
  if (!saved) {
    render();
    return;
  }
  try {
    const data = await api(`/api/state?${authQuery(saved.userId)}`);
    ensureFreshVersion(data);
    state = data;
    applyAssetUrlSelection();
  } catch {
    clearStoredSession();
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
  state = await api(`/api/state?${authQuery()}`);
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

function attrText(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
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

function isLikelyPersonName(value) {
  const text = String(value || "").trim();
  if (text.length < 2) return false;
  if (/\d/.test(text)) return false;
  if (!/[\u4e00-\u9fffA-Za-z]/.test(text)) return false;
  if (/[ _\-\/\\#@%:]/.test(text)) return false;
  const lower = text.toLowerCase();
  if (/\b(?:cpu|gpu|ssd|hdd|nvme|m\.2|m2|usb|hdmi|vga|dvi)\b/.test(lower)) return false;
  const assetHints = [
    "资产", "耗材", "设备", "办公", "办公椅", "办公桌", "台式", "台式机", "电脑", "显示器", "显示屏",
    "电源", "电源线", "键盘", "鼠标", "主机", "笔记本", "服务器", "路由器", "交换机", "打印机", "硬盘", "内存",
    "网线", "网卡", "网关", "网口", "数据线", "线缆", "适配器", "转换", "插线板", "机箱", "机柜", "显卡", "摄像头",
    "耳机", "音箱", "投影", "投影仪", "扫描", "复印", "复印机"
  ];
  if (assetHints.some((hint) => text.includes(hint) || lower.includes(hint))) return false;
  return true;
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
  return (state.users || [])
    .filter((user) => user.id === state.currentUser?.id || isLikelyPersonName(user.name))
    .filter((user) => user.active === true);
}

function activeUsersByDepartment() {
  if (!isMultiDepartment()) return selectableUsers();
  return selectableUsers().filter((user) => selectedDepartment === "all" || user.department === selectedDepartment);
}

function assetName(assetId) {
  const asset = state.assets.find((item) => item.id === assetId);
  return asset ? `${asset.name}（${asset.code}）` : "未知资产";
}

const DEVICE_FAMILY_RULES = [
  { id: "computer", name: "电脑设备", icon: "▣", terms: ["电脑", "笔记本", "台式", "主机", "工作站", "服务器", "昭阳", "thinkpad", "小主机", "迷你主机", "mini pc"] },
  { id: "display", name: "显示设备", icon: "▤", terms: ["显示器", "显示屏", "屏幕", "监视器", "投影", "电视", "aoc"] },
  { id: "storage", name: "存储设备", icon: "◉", terms: ["硬盘", "固态", "ssd", "m.2", "m2", "nvme", "pcie", "u盘", "存储", "sa1000", "三星750", "三星970", "三星980", "三星990", "机械硬盘"] },
  { id: "teaching", name: "教学资料", icon: "▥", terms: ["教材", "教程", "文档", "资料", "讲义", "办公教学", "python", "软件工具", "图书"] },
  { id: "peripheral", name: "外设配件", icon: "◆", terms: ["键盘", "鼠标", "耳机", "网卡", "无线网卡", "扩展坞", "转接器", "适配器", "线缆", "数据线", "hdmi", "usb", "type-c", "typec", "支架", "配件", "套件"] },
  { id: "consumable", name: "耗材用品", icon: "◍", terms: ["耗材", "墨盒", "硒鼓", "纸", "电池", "网线"] },
  { id: "other", name: "其他设备", icon: "◇", terms: [] }
];

function textHasAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function deviceFamilyRule(id) {
  return DEVICE_FAMILY_RULES.find((rule) => rule.id === id);
}

function deviceFamily(asset) {
  const text = rawAssetComparableText(asset);
  if (textHasAny(text, ["硬盘", "固态", "ssd", "m.2", "m2", "nvme", "pcie", "u盘", "sa1000", "三星750", "三星970", "三星980", "三星990"])) return deviceFamilyRule("storage");
  if (textHasAny(text, ["键盘", "鼠标", "耳机", "网卡", "无线网卡", "扩展坞", "转接器", "适配器", "线缆", "数据线", "hdmi", "type-c", "typec", "支架"])) return deviceFamilyRule("peripheral");
  if (textHasAny(text, ["显示器", "显示屏", "屏幕", "监视器", "投影", "电视", "aoc"]) && !textHasAny(text, ["主机", "套件"])) return deviceFamilyRule("display");
  const matched = DEVICE_FAMILY_RULES.find((rule) => rule.id !== "consumable" && rule.terms.length && textHasAny(text, rule.terms));
  if (matched) return matched;
  if (assetKind(asset) === "耗材") return deviceFamilyRule("consumable");
  return DEVICE_FAMILY_RULES.find((rule) => rule.terms.length && textHasAny(text, rule.terms))
    || deviceFamilyRule("other");
}

function deviceGroupRules() {
  return state.settings?.deviceGroupRules || [];
}

function deviceGroupRuleForSourceKey(sourceKey) {
  return deviceGroupRules().find((rule) => rule.sourceKey === sourceKey);
}

function manualDeviceGroupKey(rule) {
  const name = String(rule?.groupName || "").trim();
  return `manual|${compactAssetText(name) || name.toLowerCase()}`;
}

function manualDeviceGroupSummaries() {
  const summaries = new Map();
  for (const rule of deviceGroupRules()) {
    const key = `${rule.groupName}|${rule.familyId || ""}`;
    if (!summaries.has(key)) {
      summaries.set(key, {
        groupName: rule.groupName,
        familyId: rule.familyId || "",
        sourceKeys: []
      });
    }
    summaries.get(key).sourceKeys.push(rule.sourceKey);
  }
  return [...summaries.values()].sort((a, b) => a.groupName.localeCompare(b.groupName, "zh-Hans-CN", { numeric: true, sensitivity: "base" }));
}

function compactAssetText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/think\s*pad/g, "thinkpad")
    .replace(/mini\s*pc|迷你电脑/g, "迷你主机")
    .replace(/显示屏|屏幕|监视器/g, "显示器")
    .replace(/机械键盘|有线键盘|无线键盘|键鼠套装/g, "键盘")
    .replace(/固态硬盘|移动硬盘|机械硬盘|硬碟/g, "硬盘")
    .replace(/固态/g, "硬盘")
    .replace(/内存条/g, "内存")
    .replace(/[\s　·•.,，。:：;；、/\\|_+\-—–~～"'“”‘’()[\]{}【】<>《》]/g, "")
    .trim();
}

function rawAssetComparableText(asset) {
  return [asset?.name, asset?.spec, asset?.brand]
    .filter(Boolean)
    .join(" ")
    .normalize("NFKC")
    .toLowerCase();
}

function stripCapacityText(value) {
  return String(value || "")
    .replace(/\d{1,3}\s*g(?:b)?\s*\+\s*\d+(?:\.\d+)?\s*t(?:b)?/gi, "")
    .replace(/\d{1,3}\s*g(?:b)?\s*\+\s*\d{3,4}\s*g(?:b)?/gi, "")
    .replace(/\d{1,3}g\d+(?:\.\d+)?t/g, "")
    .replace(/\d{1,3}g\d{3,4}g/g, "")
    .replace(/\d{3,4}g$/g, "")
    .replace(/\d+(?:\.\d+)?t$/g, "");
}

function normalizedStorageSize(value, unit) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  if (String(unit || "").toLowerCase().startsWith("t")) return `${number}t`;
  return `${Math.round(number)}g`;
}

function assetConfigKey(asset) {
  const raw = rawAssetComparableText(asset);
  const keys = [];
  for (const match of raw.matchAll(/(\d{1,3})\s*g(?:b)?\s*\+\s*(\d+(?:\.\d+)?)\s*t(?:b)?/g)) {
    keys.push(`${Number(match[1])}g+${Number(match[2])}t`);
  }
  for (const match of raw.matchAll(/(\d{1,3})\s*g(?:b)?\s*\+\s*(\d{3,4})\s*g(?:b)?/g)) {
    keys.push(`${Number(match[1])}g+${Number(match[2])}g`);
  }
  if (!keys.length) {
    const compact = compactAssetText(raw);
    const joined = compact.match(/(\d{1,3})g(\d+(?:\d)?)t/);
    if (joined) keys.push(`${Number(joined[1])}g+${Number(joined[2])}t`);
    const joinedG = compact.match(/(\d{1,3})g(\d{3,4})g/);
    if (joinedG) keys.push(`${Number(joinedG[1])}g+${Number(joinedG[2])}g`);
  }
  if (!keys.length) {
    for (const match of raw.matchAll(/(\d+(?:\.\d+)?)\s*(t|tb|g|gb)\b/g)) {
      const size = normalizedStorageSize(match[1], match[2]);
      if (size) keys.push(size);
    }
  }
  return [...new Set(keys)].join("+");
}

function assetBrandKey(asset) {
  const raw = rawAssetComparableText(asset);
  const compact = compactAssetText(raw);
  const brand = String(asset?.brand || "").trim();
  if (brand) return compactAssetText(brand);
  if (compact.includes("联想") || compact.includes("lenovo") || compact.includes("thinkpad") || compact.includes("昭阳")) return "联想";
  if (compact.includes("aoc")) return "aoc";
  if (compact.includes("铭凡")) return "铭凡";
  if (compact.includes("金士顿") || compact.includes("kingston")) return "金士顿";
  if (compact.includes("三星") || compact.includes("samsung")) return "三星";
  return "";
}

function isM2StorageAsset(asset) {
  const raw = rawAssetComparableText(asset);
  const compact = compactAssetText(raw);
  return textHasAny(raw, ["m.2", "m2", "nvme", "pcie"])
    || compact.includes("sa1000m8")
    || /(?:三星|samsung)?(?:970|980|990)(?:evo|pro)?/.test(compact);
}

function assetComparableName(asset) {
  let text = stripCapacityText(compactAssetText(asset?.name));
  if (!text) return "未命名资产";
  text = text.replace(/显示器\d+$/g, "显示器");
  text = text.replace(/笔记本电脑|手提电脑/g, "笔记本");
  text = text.replace(/台式电脑|台式机电脑|电脑主机/g, "台式机");
  const lenovoZhaoyang = text.match(/^(联想)?昭阳(x\d{2,4})/);
  if (lenovoZhaoyang) return `${lenovoZhaoyang[1] || "联想"}昭阳${lenovoZhaoyang[2]}`;
  const thinkpad = text.match(/^(联想)?thinkpad(p\d+[a-z]?)/);
  if (thinkpad) return `${thinkpad[1] || "联想"}thinkpad${thinkpad[2]}`;
  const aoc = text.match(/^aoc(显示器)?/);
  if (aoc) return "aoc显示器";
  const minix = text.match(/^铭凡(ms\d+)?/);
  if (minix) return minix[1] ? `铭凡${minix[1]}` : "铭凡小主机";
  const kingston = text.match(/^金士顿(sa\d+)/);
  if (kingston) return `金士顿${kingston[1]}`;
  const samsung = text.match(/^三星(\d{3,4})/);
  if (samsung) return `三星${samsung[1]}`;
  if (text.includes("显示器")) return `${assetBrandKey(asset) || ""}显示器`.trim() || "显示器";
  if (text.includes("键盘")) return `${assetBrandKey(asset) || ""}键盘`.trim() || "键盘";
  if (text.includes("网卡")) return `${assetBrandKey(asset) || ""}网卡`.trim() || "网卡";
  if (text.includes("硬盘")) return `${assetBrandKey(asset) || ""}硬盘`.trim() || "硬盘";
  return text;
}

function assetDeviceType(asset) {
  const raw = rawAssetComparableText(asset);
  const compact = compactAssetText(raw);
  const family = deviceFamily(asset);
  if (family?.id === "computer") {
    if (textHasAny(raw, ["笔记本", "notebook", "laptop", "thinkpad", "昭阳", "悦plus", "红米笔记本", "p15v", "x7-16", "x716"])) {
      return { key: "laptop", title: "笔记本电脑系列" };
    }
    if (textHasAny(raw, ["小主机", "迷你主机", "mini pc", "ms01", "台式", "工作站", "主机"])) {
      return { key: "desktop", title: "小主机 / 工作站" };
    }
    return { key: "computer", title: "电脑设备" };
  }
  if (family?.id === "display") {
    const brand = assetBrandKey(asset);
    return { key: `display-${brand || "generic"}`, title: brand ? `${brand.toUpperCase()} 显示器` : "显示设备" };
  }
  if (family?.id === "storage") {
    if (compact.includes("硬盘盒")) return { key: "drive-enclosure", title: "硬盘盒 / 存储扩展盒" };
    if (isM2StorageAsset(asset)) return { key: "m2-ssd", title: "M.2 固态硬盘" };
    if (compact.includes("硬盘")) return { key: "drive", title: "存储设备 / 硬盘" };
    return { key: "storage", title: "存储设备" };
  }
  if (family?.id === "peripheral") {
    if (compact.includes("键盘") || compact.includes("鼠标")) return { key: "keyboard-mouse", title: "键盘鼠标配件" };
    if (compact.includes("网卡")) return { key: "network-card", title: "无线网卡" };
    if (compact.includes("扩展坞") || compact.includes("转接器") || compact.includes("适配器")) return { key: "adapter", title: "扩展坞 / 转接器" };
    return { key: "peripheral", title: "外设配件" };
  }
  if (family?.id === "teaching") return { key: "teaching", title: "教学资料" };
  if (family?.id === "consumable") return { key: "consumable", title: "耗材用品" };
  return { key: assetComparableName(asset), title: assetModelText(asset) };
}

function assetLogicalGroupKey(asset) {
  const type = assetDeviceType(asset);
  const family = deviceFamily(asset);
  const nameKey = ["other", "consumable"].includes(family?.id) ? assetComparableName(asset) : type.key;
  return [family?.id || "other", nameKey].join("|");
}

function assetLogicalGroupTitle(asset) {
  const type = assetDeviceType(asset);
  return type.title || assetModelText(asset);
}

function assetModelText(asset) {
  const name = String(asset?.name || "").trim();
  const spec = String(asset?.spec || "").trim();
  return [name, spec].filter(Boolean).join(" · ") || "未命名资产";
}

function assetAutoGroupKey(asset) {
  const family = deviceFamily(asset);
  return [
    family?.id || "other",
    assetLogicalGroupKey(asset)
  ].join("|");
}

function assetManualGroupRule(asset) {
  return deviceGroupRuleForSourceKey(assetAutoGroupKey(asset));
}

function assetGroupKey(asset) {
  const manualRule = assetManualGroupRule(asset);
  return manualRule ? manualDeviceGroupKey(manualRule) : assetAutoGroupKey(asset);
}

function groupCategoryText(group) {
  return displayCategoryText(blank([...new Set(group.assets.map((asset) => asset.category || assetKind(asset)).filter(Boolean))].join("；")));
}

function groupKindText(group) {
  return [...new Set(group.assets.map((asset) => assetKind(asset)).filter(Boolean))].join(" / ") || "资产";
}

function assetGroups() {
  const groups = new Map();
  for (const asset of state.assets) {
    const key = assetGroupKey(asset);
    const sourceKey = assetAutoGroupKey(asset);
    const manualRule = deviceGroupRuleForSourceKey(sourceKey);
    const variant = assetModelText(asset);
    if (!groups.has(key)) {
      const family = manualRule?.familyId ? (deviceFamilyRule(manualRule.familyId) || deviceFamily(asset)) : deviceFamily(asset);
      groups.set(key, {
        key,
        id: asset.id,
        name: asset.name || "未命名资产",
        spec: asset.spec || "",
        model: manualRule?.groupName || assetLogicalGroupTitle(asset),
        category: displayCategoryText(asset.category || "-"),
        familyId: family?.id || "other",
        familyName: family?.name || "其他设备",
        familyIcon: family?.icon || "◇",
        manual: Boolean(manualRule),
        manualName: manualRule?.groupName || "",
        quantity: 0,
        count: 0,
        aliases: new Map(),
        configKeys: new Set(),
        sourceKeys: new Set(),
        assets: []
      });
    }
    const group = groups.get(key);
    group.quantity += Number(asset.quantity || 0);
    group.count += 1;
    group.aliases.set(variant, (group.aliases.get(variant) || 0) + Number(asset.quantity || 1));
    if (assetConfigKey(asset)) group.configKeys.add(assetConfigKey(asset));
    group.sourceKeys.add(sourceKey);
    if (manualRule) {
      group.manual = true;
      group.manualName = manualRule.groupName || group.manualName;
    }
    group.assets.push(asset);
    if ((!group.category || group.category === "-") && asset.category) group.category = displayCategoryText(asset.category);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    category: groupCategoryText(group),
    kindText: groupKindText(group),
    aliasEntries: [...group.aliases.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hans-CN", { numeric: true })),
    aliasList: [...group.aliases.keys()],
    configList: [...group.configKeys],
    sourceKeyList: [...group.sourceKeys],
    sourceGroupCount: group.sourceKeys.size,
    variantCount: group.aliases.size
  })).sort((a, b) => a.model.localeCompare(b.model, "zh-Hans-CN"));
}

function assetGroupById(assetId) {
  const asset = state.assets.find((item) => item.id === assetId);
  if (!asset) return null;
  return assetGroups().find((group) => group.key === assetGroupKey(asset)) || null;
}

function ledgerField(value, fallback) {
  const text = String(value || "").trim();
  return text || fallback;
}

function displayCategoryText(value) {
  const text = String(value || "").trim();
  if (!text) return "-";
  return text
    .split("；")
    .map((part) => part.trim().replace(/^\[[^\]]+\]\s*/, ""))
    .filter(Boolean)
    .join("；") || text;
}

function assetLedgerGroupKey(asset) {
  return [
    "ledger",
    ledgerField(asset.category, "未分类"),
    ledgerField(asset.name, "未命名资产"),
    ledgerField(asset.spec, "未填写规格")
  ].join("|||");
}

function summarizeValues(items, getter, limit = 2) {
  const counts = new Map();
  items.forEach((item) => {
    const value = blank(getter(item));
    if (value === "-") return;
    counts.set(value, (counts.get(value) || 0) + 1);
  });
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hans-CN", { numeric: true }));
  if (!entries.length) return "-";
  const visible = entries.slice(0, limit).map(([name, count]) => `${name}(${count})`).join("、");
  return entries.length > limit ? `${visible}、...` : visible;
}

function ledgerStatusCounts(assets) {
  return assets.reduce((counts, asset) => {
    const status = asset.status || "in_stock";
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
}

function ledgerGroupMatchesAssetFilters(asset) {
  const flow = assetFlow(asset);
  if (assetStatusFilter !== "all" && asset.status !== assetStatusFilter) return false;
  if (assetCategoryFilters.length && !assetCategoryFilters.includes(assetKind(asset)) && !assetCategoryFilters.includes(asset.category)) return false;
  if (assetFamilyFilter !== "all" && deviceFamily(asset)?.id !== assetFamilyFilter) return false;
  if (assetKeeperFilter !== "all" && asset.keeperId !== assetKeeperFilter && flow.borrowerId !== assetKeeperFilter) return false;
  if (assetBorrowerFilter !== "all") {
    const hasRecord = state.records.some((record) => record.assetId === asset.id && record.userId === assetBorrowerFilter && record.type === "出库");
    if (asset.keeperId !== assetBorrowerFilter && asset.useUserId !== assetBorrowerFilter && flow.borrowerId !== assetBorrowerFilter && !hasRecord) return false;
  }
  if (!assetMatches(asset, assetFilter)) return false;
  return true;
}

function buildAssetLedgerGroups(assets) {
  const groups = new Map();
  for (const asset of assets) {
    const key = assetLedgerGroupKey(asset);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        id: asset.id,
        name: ledgerField(asset.name, "未命名资产"),
        model: ledgerField(asset.name, "未命名资产"),
        spec: ledgerField(asset.spec, "未填写规格"),
        category: displayCategoryText(ledgerField(asset.category, "未分类")),
        familyId: deviceFamily(asset)?.id || "other",
        familyName: "底账分组",
        familyIcon: "▦",
        quantity: 0,
        count: 0,
        aliases: new Map(),
        configKeys: new Set(),
        sourceKeys: new Set([key]),
        assets: []
      });
    }
    const group = groups.get(key);
    const quantity = Number(asset.quantity || 0) || 1;
    group.quantity += quantity;
    group.count += 1;
    group.assets.push(asset);
    group.aliases.set(assetModelText(asset), (group.aliases.get(assetModelText(asset)) || 0) + quantity);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    aliasEntries: [...group.aliases.entries()],
    aliasList: [...group.aliases.keys()],
    configList: [group.spec].filter(Boolean),
    sourceKeyList: [group.key],
    sourceGroupCount: 1,
    variantCount: group.aliases.size,
    statusCounts: ledgerStatusCounts(group.assets),
    locationSummary: summarizeValues(group.assets, (asset) => asset.location, 3),
    departmentSummary: summarizeValues(group.assets, (asset) => asset.useDepartment, 2),
    userSummary: summarizeValues(group.assets, (asset) => assetFlow(asset).borrowerName !== "-" ? assetFlow(asset).borrowerName : userName(asset.useUserId || asset.keeperId), 3)
  })).sort(compareAssetGroups);
}

function allAssetLedgerGroups() {
  return buildAssetLedgerGroups(state.assets.filter((asset) => assetKind(asset) === "资产"));
}

function assetLedgerGroupByKey(key) {
  return allAssetLedgerGroups().find((group) => group.key === key) || null;
}

function assetLedgerGroups() {
  const assets = state.assets
    .filter((asset) => assetKind(asset) === "资产")
    .filter(ledgerGroupMatchesAssetFilters);
  const groups = buildAssetLedgerGroups(assets);
  const validKeys = new Set(groups.map((group) => group.key));
  selectedAssetGroupKeys = new Set([...selectedAssetGroupKeys].filter((key) => validKeys.has(key)));
  if (ledgerDrawerKey && !assetLedgerGroupByKey(ledgerDrawerKey)) {
    ledgerDrawerKey = "";
    ledgerDrawerMode = "";
  }
  return groups;
}

function selectedAssetGroups(groups = assetLedgerGroups()) {
  return groups.filter((group) => selectedAssetGroupKeys.has(group.key));
}

function selectedLedgerAssets(groups = assetLedgerGroups()) {
  const selected = selectedAssetGroups(groups);
  return (selected.length ? selected : groups).flatMap((group) => group.assets.filter((asset) => assetKind(asset) === "资产"));
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

function assetVisual(asset, size = "normal") {
  const image = asset?.image || "";
  const label = assetKind(asset) === "耗材" ? "耗" : "资";
  if (image) {
    return `<span class="asset-thumb ${size}"><img src="${image}" alt="${asset?.name || "资产图片"}" /></span>`;
  }
  return `<span class="asset-thumb ${size} fallback">${label}</span>`;
}

function assetGroupVisual(group) {
  const asset = group.assets.find((item) => item.image) || group.assets[0] || {};
  return assetVisual(asset);
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
  return `
    <div class="flow-detail compact-flow" title="${attrText(parts.join("；"))}">
      <span>${type}：${time}</span>
      <span>${actorLabel}：${userName(record.userId)} / ${record.quantity || "-"} / ${record.paperNo || "-"}</span>
    </div>
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

function groupMetric(group, status) {
  return group.assets
    .filter((asset) => asset.status === status)
    .reduce((sum, asset) => sum + Number(asset.quantity || 1), 0);
}

function groupAvailableCount(group) {
  return groupMetric(group, "in_stock");
}

function groupUsingCount(group) {
  return groupMetric(group, "checked_out");
}

function assetGroupAliasChips(group, limit = 4) {
  const entries = group.aliasEntries || group.aliasList?.map((name) => [name, 1]) || [];
  if (!entries.length) return `<span class="variant-chip muted">暂无变体</span>`;
  const chips = entries.slice(0, limit).map(([name, count]) => `<span class="variant-chip">${name}<em>×${count}</em></span>`);
  if (entries.length > limit) chips.push(`<span class="variant-chip muted">+${entries.length - limit}</span>`);
  return chips.join("");
}

function selectedDeviceGroups(groups = assetGroups()) {
  const validKeys = new Set(groups.map((group) => group.key));
  selectedDeviceGroupKeys = new Set([...selectedDeviceGroupKeys].filter((key) => validKeys.has(key)));
  return groups.filter((group) => selectedDeviceGroupKeys.has(group.key));
}

function selectedDeviceSourceKeys(groups = assetGroups()) {
  return [...new Set(selectedDeviceGroups(groups).flatMap((group) => group.sourceKeyList || []))];
}

function deviceGroupByKey(key, groups = assetGroups()) {
  return groups.find((group) => group.key === key);
}

function defaultDeviceGroupFamily(groups) {
  if (deviceGroupDraftFamily) return deviceGroupDraftFamily;
  const familyIds = [...new Set(groups.map((group) => group.familyId).filter(Boolean))];
  return familyIds.length === 1 ? familyIds[0] : (familyIds[0] || "computer");
}

function renderManualDeviceGroupSummary() {
  const summaries = manualDeviceGroupSummaries();
  if (!summaries.length) return "";
  return `
    <div class="manual-device-group-list">
      ${summaries.map((summary) => {
        const family = deviceFamilyRule(summary.familyId) || deviceFamilyRule("other");
        return `
          <div class="manual-device-group-item">
            <div>
              <strong>${summary.groupName}</strong>
              <span>${family?.name || "其他设备"} · ${summary.sourceKeys.length} 个原始组</span>
            </div>
            <button class="danger small" data-unassign-manual-name="${attrText(summary.groupName)}" type="button">取消归类</button>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderDeviceGroupAssignPanel(groups) {
  if (!can("base_data.manage")) return "";
  const selectedGroups = selectedDeviceGroups(groups);
  const selectedSourceCount = selectedDeviceSourceKeys(groups).length;
  const defaultName = deviceGroupDraftName || (selectedGroups.length === 1 ? selectedGroups[0].manualName || selectedGroups[0].model : "");
  const familyValue = defaultDeviceGroupFamily(selectedGroups);
  const knownNames = [...new Set(deviceGroupRules().map((rule) => rule.groupName).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN", { numeric: true, sensitivity: "base" }));
  return `
    <div class="device-group-assign-panel">
      <form id="deviceGroupAssignForm" class="device-group-assign-form">
        <div class="device-group-assign-title">
          <strong>手动选择归类</strong>
          <span>已选 ${selectedGroups.length} 个当前组 / ${selectedSourceCount} 个原始组</span>
        </div>
        <input name="groupName" list="manualDeviceGroupNames" required placeholder="输入标准归类名称，例如：电脑设备" value="${attrText(defaultName)}" />
        <select name="familyId">
          ${DEVICE_FAMILY_RULES.map((family) => `<option value="${family.id}" ${familyValue === family.id ? "selected" : ""}>${family.name}</option>`).join("")}
        </select>
        <button class="primary" type="submit" ${selectedGroups.length ? "" : "disabled"}>保存归类</button>
        <button class="ghost" id="clearDeviceGroupSelection" type="button">清空选择</button>
        <datalist id="manualDeviceGroupNames">
          ${knownNames.map((name) => `<option value="${attrText(name)}"></option>`).join("")}
        </datalist>
      </form>
      ${renderManualDeviceGroupSummary()}
    </div>
  `;
}

function deviceFamilyBuckets(groups = assetGroups()) {
  const buckets = new Map();
  for (const group of groups) {
    if (!buckets.has(group.familyId)) {
      buckets.set(group.familyId, {
        id: group.familyId,
        name: group.familyName,
        icon: group.familyIcon,
        groups: [],
        quantity: 0,
        available: 0,
        using: 0,
        variants: 0
      });
    }
    const bucket = buckets.get(group.familyId);
    bucket.groups.push(group);
    bucket.quantity += Number(group.quantity || 0);
    bucket.available += groupAvailableCount(group);
    bucket.using += groupUsingCount(group);
    bucket.variants += group.variantCount || 0;
  }
  const order = DEVICE_FAMILY_RULES.map((rule) => rule.id);
  return [...buckets.values()].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

function renderDeviceFamilySidebar(groups) {
  const buckets = deviceFamilyBuckets(groups);
  const total = buckets.reduce((sum, bucket) => sum + bucket.quantity, 0);
  return `
    <aside class="device-family-sidebar no-print">
      <div class="device-family-head">
        <strong>设备分类</strong>
        <button class="ghost small" data-device-family="all" type="button">全部</button>
      </div>
      <div class="device-family-search">
        <input id="deviceGroupSearch" placeholder="搜索分类或逻辑组" value="${attrText(deviceGroupFilter)}" />
      </div>
      <div class="device-family-list">
        <button class="${assetFamilyFilter === "all" ? "active" : ""}" data-device-family="all" type="button">
          <span class="device-family-icon">▦</span>
          <strong>全部资产</strong>
          <em>${total}</em>
        </button>
        ${buckets.map((bucket) => `
          <button class="${assetFamilyFilter === bucket.id ? "active" : ""}" data-device-family="${bucket.id}" type="button">
            <span class="device-family-icon">${bucket.icon}</span>
            <strong>${bucket.name}</strong>
            <em>${bucket.quantity}</em>
          </button>
        `).join("")}
      </div>
    </aside>
  `;
}

function renderDeviceGroupCard(group) {
  const locations = assetGroupLocations(group);
  const statusLabel = assetGroupStatus(group);
  const selected = selectedDeviceGroupKeys.has(group.key);
  const canManageGroups = can("base_data.manage");
  return `
    <article class="device-group-card ${selected ? "selected" : ""} ${group.manual ? "manual" : ""}">
      <div class="device-group-main">
        ${assetGroupVisual(group)}
        <div>
          <strong>${group.model}</strong>
          <p>${group.familyName} / ${group.category}${group.manual ? " / 手动归类" : ""}</p>
        </div>
      </div>
      <div class="device-group-metrics">
        <span><em>总数</em><b>${group.quantity}</b></span>
        <span><em>可用</em><b>${groupAvailableCount(group)}</b></span>
        <span><em>使用中</em><b>${groupUsingCount(group)}</b></span>
      </div>
      <div class="device-group-status">
        ${statusLabel}
        <span class="mini-meta">${locations === "-" ? "未填写位置" : locations}</span>
      </div>
      <div class="device-group-actions">
        ${canManageGroups ? `
          <label class="device-select-line">
            <input data-device-group-select="${attrText(group.key)}" type="checkbox" ${selected ? "checked" : ""} />
            <span>选择</span>
          </label>
          <button class="ghost small" data-assign-device-group="${attrText(group.key)}" type="button">归类</button>
          ${group.manual ? `<button class="danger small" data-unassign-device-group="${attrText(group.key)}" type="button">取消</button>` : ""}
        ` : ""}
        <button class="ghost small" data-view-asset="${group.id}" type="button">详情</button>
      </div>
      <div class="device-variant-chips">
        ${assetGroupAliasChips(group)}
      </div>
    </article>
  `;
}

function renderDeviceGroupOverview(groups) {
  const query = deviceGroupFilter.trim().toLowerCase();
  const visibleGroups = groups.filter((group) => {
    if (assetFamilyFilter !== "all" && group.familyId !== assetFamilyFilter) return false;
    if (!query) return true;
    return includesQuery([
      group.model,
      group.familyName,
      group.category,
      assetGroupLocations(group),
      ...(group.aliasList || [])
    ], query);
  });
  const buckets = deviceFamilyBuckets(visibleGroups);
  return `
    <section class="device-group-overview no-print">
      ${renderDeviceFamilySidebar(groups)}
      <div class="device-group-board">
        <div class="device-board-head">
          <div>
            <h3>设备归类管理</h3>
            <span>系统先自动归并；你勾选多个设备组保存后，会按手动归类优先合并显示。</span>
          </div>
          <div class="device-board-summary">
            <strong>${visibleGroups.length}</strong><span>逻辑组</span>
            <strong>${visibleGroups.reduce((sum, group) => sum + group.variantCount, 0)}</strong><span>写法</span>
            <strong>${visibleGroups.reduce((sum, group) => sum + Number(group.quantity || 0), 0)}</strong><span>件数</span>
          </div>
        </div>
        ${renderDeviceGroupAssignPanel(groups)}
        ${buckets.map((bucket) => `
          <section class="device-family-section">
            <div class="device-family-title">
              <span class="device-family-icon">${bucket.icon}</span>
              <div>
                <h4>${bucket.name}</h4>
                <p>包含 ${bucket.groups.length} 个逻辑组 / ${bucket.variants} 种写法 / ${bucket.quantity} 件</p>
              </div>
            </div>
            <div class="device-group-list">
              ${bucket.groups.map(renderDeviceGroupCard).join("")}
            </div>
          </section>
        `).join("") || `<div class="empty compact-empty">暂无匹配的设备组</div>`}
      </div>
    </section>
  `;
}

function assetGroupMatches(group, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return includesQuery([
    group.model,
    group.name,
    group.spec,
    group.category,
    group.familyName,
    ...(group.aliasList || []),
    ...group.assets.flatMap((asset) => [asset.id, asset.code, asset.name, asset.spec, asset.location]),
    group.quantity,
    assetGroupLocations(group),
    assetGroupPeople(group),
    assetGroupRecordDetail(group, "入库", "text"),
    assetGroupRecordDetail(group, "出库", "text"),
    assetGroupSourceFiles(group)
  ], q);
}

function filteredAssetGroups(options = {}) {
  const includeFamilyFilter = options.includeFamilyFilter !== false;
  return assetGroups().filter((group) => {
    if (selectedAssetId && !group.assets.some((asset) => asset.id === selectedAssetId)) return false;
    if (assetStatusFilter !== "all" && !group.assets.some((asset) => asset.status === assetStatusFilter)) return false;
    if (assetCategoryFilters.length && !group.assets.some((asset) => assetCategoryFilters.includes(assetKind(asset)) || assetCategoryFilters.includes(asset.category))) return false;
    if (assetKeeperFilter !== "all" && !group.assets.some((asset) => asset.keeperId === assetKeeperFilter || assetFlow(asset).borrowerId === assetKeeperFilter)) return false;
    if (assetBorrowerFilter !== "all" && !group.assets.some((asset) => {
      const flow = assetFlow(asset);
      return asset.keeperId === assetBorrowerFilter
        || asset.useUserId === assetBorrowerFilter
        || flow.borrowerId === assetBorrowerFilter
        || state.records.some((record) => record.assetId === asset.id && record.userId === assetBorrowerFilter && record.type === "出库");
    })) return false;
    if (includeFamilyFilter && assetFamilyFilter !== "all" && group.familyId !== assetFamilyFilter) return false;
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
  if (assetKind(asset) === "耗材") return "耗材领用";
  if (record.note?.includes("Word领用单导入")) return "资产领用";
  return "-";
}

function hasRealAssetCode(asset) {
  const code = String(asset?.code || "").trim();
  return Boolean(code) && !/^(IMPORT|CONSUMABLE)-/i.test(code);
}

function assetKind(asset) {
  return hasRealAssetCode(asset) ? "资产" : "耗材";
}

function recordKind(record) {
  const asset = state.assets.find((item) => item.id === record.assetId);
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

function personNameFromImportFileName(value) {
  const base = fileBaseName(value).replace(/\.[^.]+$/, "");
  const withoutDate = base
    .replace(/[（(][^）)]*[）)]/g, " ")
    .replace(/\b20\d{2}[.\-_/年]\d{1,2}(?:[.\-_/月]\d{1,2})?日?\b/g, " ");
  const parts = withoutDate.split(/[-—_]+/).map((item) => item.trim()).filter(Boolean);
  const candidates = [];
  for (const part of parts.length ? parts : [withoutDate]) {
    if (part.includes("资产")) candidates.push(part.split("资产")[0]);
    if (part.includes("耗材")) candidates.push(part.split("耗材")[0]);
    candidates.push(part);
  }
  const generic = new Set(["资产", "资产表", "资产清单", "使用表", "领用表", "耗材", "耗材表", "耗材清单", "清单", "底表", "项目内系统清点", "系统清点", "清点", "盘点", "表格", "表", "新"]);
  for (const item of candidates) {
    let clean = item
      .replace(/(人员)?(资产|耗材)(使用|领用)?(表|清单)?$/g, "")
      .replace(/(项目内)?系统清点$/g, "")
      .replace(/(清点|盘点|清单|表格|表)$/g, "")
      .replace(/^[\s\-—_：:（）()[\]【】]+|[\s\-—_：:（）()[\]【】]+$/g, "");
    for (const label of ["老师", "教师", "同学"]) {
      if (clean.includes(label)) {
        const prefix = clean.split(label)[0];
        if (prefix.length > 1 && prefix.length <= 8) {
          clean = prefix;
          break;
        }
      }
    }
    clean = clean.replace(/(老师|教师|同学)$/g, "");
    if (!clean || clean.length > 20 || /^\d+$/.test(clean) || generic.has(clean)) continue;
    return clean;
  }
  return "";
}

function statusBadge(status) {
  const cls = status === "in_stock" || status === "已入库" || status === "已归档" ? "ok" : status === "checked_out" || status === "使用中" || status === "待复核" ? "warn" : "bad";
  const text = statusText(status);
  return `<span class="badge ${cls}">${text}</span>`;
}

function statusText(status) {
  return { in_stock: "在库可用", checked_out: "使用中", repair: "维修中", retired: "已报废" }[status] || status || "-";
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
  const defaultUser = "admin";
  const defaultPassword = loginSettings.adminPrefillPassword || "admin";
  return `
    <section class="login-shell" ${loginBackgroundStyle()}>
      <div class="login-copy">
        <h1>厂库出入库管理系统</h1>
        <p>系统运行在 Docker 服务中，登录、资产、出入库、纸质单据和后台操作记录全部写入容器数据库。</p>
      </div>
      <form class="login-panel" id="loginForm">
        <h2>用户登录</h2>
        ${loginNotice ? `<p class="login-notice">${attrText(loginNotice)}</p>` : ""}
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

function canView(viewKey) {
  if (viewKey === "requests") return canMenu("assetRequests") || canMenu("purchaseWishes");
  if (viewKey === "system") return canMenu("users") || canMenu("baseData") || canMenu("settings") || canMenu("audit");
  if (["paper", "assetRequests", "purchaseWishes", "users", "baseData", "settings", "audit"].includes(viewKey)) return false;
  return canMenu(viewKey);
}

function activeNavKey() {
  if (view === "inventory") return "records";
  if (["assetRequests", "purchaseWishes"].includes(view)) return "requests";
  if (["users", "baseData", "settings", "audit"].includes(view)) return "system";
  return view;
}

function normalizeViewKey(viewKey) {
  if (viewKey === "inventory") return "records";
  if (viewKey === "paper") return "records";
  if (["assetRequests", "purchaseWishes"].includes(viewKey)) return "requests";
  if (["users", "baseData", "settings", "audit"].includes(viewKey)) return "system";
  return viewKey;
}

function renderShell() {
  const user = state.currentUser;
  if (view === "dashboard") normalizeDashboardModeState();
  const pendingAdminRequests = (state.adminRequests || []).filter((item) => item.status === "待处理").length;
  const navItems = [
    ["dashboard", "总览", "⌂"],
    ["assets", "资产台账", "▦"],
    ["records", can("records.manage") ? "出入库登记" : "我的出入库", "⇄"],
    ["orders", "业务办理", "▧"],
    ["checks", "盘点管理", "☑"],
    ["requests", can("asset_requests.manage") ? "申请与采购" : "申请与采购", "□"],
    ["reports", "报表统计", "▨"],
    ["system", pendingAdminRequests ? `系统管理(${pendingAdminRequests})` : "系统管理", "⚙"]
  ].filter(([key]) => canView(key));
  const activeKey = activeNavKey();
  const contentClasses = ["content", `content-${activeKey}`];
  if (view === "dashboard") contentClasses.push(`dashboard-mode-${dashboardMode}`);
  return `
    <section class="layout">
      <aside class="sidebar">
        <div class="brand">
          <strong>学校资产管理系统</strong>
          <span>资产全流程管理</span>
        </div>
        <nav class="nav">
          ${navItems.map(([key, label, icon]) => `
            <button data-view="${key}" class="${activeKey === key ? "active" : ""}">
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
      <section class="${contentClasses.join(" ")}">
        <header class="topbar">
          <div>
            <h1>${pageTitle()}</h1>
            ${pageSubtitle() ? `<p>${pageSubtitle()}</p>` : ""}
          </div>
          <div class="topbar-actions">
            ${view === "assets" ? renderAssetTopbarActions() : ""}
            ${view === "records" ? renderRecordTopbarActions() : ""}
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
  const pendingTotal = pending.length + assetPending.length;
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
        </div>
      ` : ""}
    </div>
  `;
}

function pageTitle() {
  return {
    dashboard: "资产底账总览",
    assets: "资产台账",
    inventory: "出入库登记",
    checks: "盘点管理",
    orders: "业务办理",
    reports: "报表统计",
    requests: "申请与采购",
    assetRequests: isAdmin() ? "资产申请管理" : "申请资产",
    purchaseWishes: isAdmin() ? "采购需求清单" : "我的需求清单",
    records: isAdmin() ? "出入库登记" : "我的出入库状态",
    paper: "纸质单据电子化方案",
    system: "系统管理",
    users: "用户管理",
    baseData: "基础数据",
    settings: "系统设置",
    audit: "后台操作记录"
  }[view];
}

function pageSubtitle() {
  return {
    dashboard: "以学校资产底表为核心，串联资产台账、人员使用、耗材流转、出入库流水和盘点结果。",
    assets: "资产只展示台账、当前位置、当前状态和状态驱动操作。",
    inventory: "耗材入库、领用、退回和盘点修正统一在出入库登记中处理。",
    checks: "按位置、分类、责任人或状态生成盘点任务，录入实际结果并生成差异。",
    orders: "办理资产出借、归还、调拨、维修和报废等正式业务流程。",
    reports: "按资产总账、分类、部门、位置、责任人、流水和盘点差异导出报表。",
    requests: "统一处理资产领用申请和下一年度采购需求。",
    assetRequests: isAdmin() ? "处理普通用户提交的资产领用申请。" : "填写需要领用的资产、数量和用途，等待管理员处理。",
    purchaseWishes: isAdmin() ? "汇总每个人下一年度想要或需要的设备，为预算和采购提供参考。" : "写下自己希望采购或补充的设备，管理员会用于预算和采购参考。",
    records: "",
    paper: "把手写材料通过拍照、编号、复核和电子台账串起来。",
    system: "集中维护用户、基础数据、系统设置、高级维护和操作记录。",
    users: "维护多用户架构和角色权限。",
    baseData: "维护资产类别等基础数据。",
    settings: "维护系统基础配置。",
    audit: "追踪登录、登记、修改、纸质单据处理等动作。"
  }[view];
}

function renderView() {
  const key = normalizeViewKey(view);
  const renderer = {
    dashboard: renderDashboard,
    assets: renderAssets,
    inventory: renderInventory,
    checks: renderInventoryChecks,
    orders: renderOrders,
    reports: renderReports,
    requests: renderRequests,
    assetRequests: renderAssetRequests,
    purchaseWishes: renderPurchaseWishes,
    records: renderRecords,
    paper: renderPaper,
    system: renderSystemManagement,
    users: renderUsers,
    baseData: renderBaseData,
    settings: renderSettings,
    audit: renderAudit
  }[key] || renderDashboard;
  return renderer();
}

function renderRecordTopbarActions() {
  return `
    <div class="record-page-actions no-print">
      <label class="record-period-control">
        <span>统计周期：</span>
        <input id="recordStatsPeriod" type="month" value="${recordStatsPeriod}" />
      </label>
      <button class="secondary" id="refreshRecordsBtn" type="button">⟳ 刷新</button>
    </div>
  `;
}

function renderDashboard() {
  const matchedAssets = state.assets.filter((asset) => assetMatches(asset, dashboardSearch));
  const matchedRecords = state.records.filter((record) => recordMatches(record, dashboardSearch));
  const metrics = dashboardMetrics(matchedAssets, matchedRecords);
  normalizeDashboardModeState();
  return `
    ${renderDashboardOverviewCards(metrics)}
    ${renderDashboardContent(metrics)}
    ${ledgerDrawerKey ? renderLedgerDetailDrawer() : ""}
  `;
}

function normalizeDashboardModeState() {
  if (dashboardMode === "usage") dashboardMode = "assetUsage";
  if (!["list", "category", "assetUsage", "consumableUsage", "stock"].includes(dashboardMode)) dashboardMode = "list";
}

function dashboardMetrics(assets, records) {
  const fixedAssets = assets.filter((asset) => assetKind(asset) === "资产");
  const consumables = assets.filter((asset) => assetKind(asset) === "耗材");
  const assetIds = new Set(assets.map((asset) => asset.id));
  const checkItems = (state.inventoryCheckItems || []).filter((item) => assetIds.has(item.assetId));
  const groupRows = dashboardLedgerGroups(assets);
  const categoryRows = dashboardCategoryRows(groupRows);
  const assetPeopleRows = dashboardPeopleRows(assets, records, "asset");
  const consumablePeopleRows = dashboardPeopleRows(assets, records, "consumable");
  const currentUsingAssets = fixedAssets.filter((asset) => dashboardAssetInPersonalUse(asset) && dashboardUsageUserValid(dashboardAssetUsageUserId(asset)));
  const consumableRecords = records.filter((record) => recordKind(record) === "耗材" && record.type === "出库");
  const unavailable = fixedAssets.filter((asset) => ["repair", "retired"].includes(asset.status));
  const checkAbnormal = checkItems.filter((item) => item.diffType && item.diffType !== "正常" && item.diffType !== "未盘点");
  const importExceptionCount = (state.importArchives || []).reduce((sum, item) => sum + Number((item.result?.skipped || []).length || 0), 0);
  const codeCount = fixedAssets.filter((asset) => String(asset.code || "").trim()).length;
  const totalAmount = fixedAssets.reduce((sum, asset) => sum + dashboardAssetAmount(asset), 0);
  const inStockCount = assets.filter((asset) => (asset.status || "in_stock") === "in_stock").length;
  return {
    assets,
    records,
    fixedAssets,
    consumables,
    groupRows,
    categoryRows,
    peopleRows: assetPeopleRows,
    assetPeopleRows,
    consumablePeopleRows,
    scopeLabel: dashboardSearch ? "匹配底表明细" : "底表明细",
    assetCount: assets.length,
    groupCount: groupRows.length,
    categoryCount: categoryRows.length,
    fixedCount: fixedAssets.length,
    fixedCodeCoverage: `${codeCount}/${fixedAssets.length || 0}`,
    consumableCount: consumables.length,
    consumableQuantity: consumables.reduce((sum, asset) => sum + Number(asset.quantity || 0), 0),
    consumableRecordQuantity: consumablePeopleRows.reduce((sum, row) => sum + Number(row.consumableQuantity || 0), 0),
    currentUsingCount: currentUsingAssets.length,
    borrowedFixedCount: currentUsingAssets.length,
    totalAmount,
    inStockCount,
    checkItems,
    checkAbnormalCount: checkAbnormal.length,
    importExceptionCount,
    unavailableCount: unavailable.length,
    exceptionCount: unavailable.length + checkAbnormal.length + importExceptionCount,
    recentRecords: [...records].sort((a, b) => recordMillis(b) - recordMillis(a))
  };
}

function dashboardAssetAmount(asset) {
  const total = Number(asset.totalAmount || 0);
  if (total) return total;
  return Number(asset.unitPrice || 0) * Number(asset.quantity || 0);
}

function dashboardLedgerKey(asset) {
  return [
    String(asset.category || "未分类").trim() || "未分类",
    String(asset.name || "未命名资产").trim() || "未命名资产",
    String(asset.spec || "未填写规格").trim() || "未填写规格"
  ].join("|||");
}

function dashboardLedgerGroups(assets) {
  const groups = new Map();
  for (const asset of assets) {
    const key = dashboardLedgerKey(asset);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        ledgerKey: assetLedgerGroupKey(asset),
        category: displayCategoryText(asset.category || "未分类"),
        name: asset.name || "未命名资产",
        spec: asset.spec || "未填写规格",
        quantity: 0,
        assets: [],
        locations: new Set(),
        departments: new Set(),
        statuses: new Map()
      });
    }
    const group = groups.get(key);
    const quantity = Number(asset.quantity || 0) || 1;
    group.quantity += quantity;
    group.assets.push(asset);
    if (asset.location) group.locations.add(asset.location);
    if (asset.useDepartment || asset.department) group.departments.add(asset.useDepartment || asset.department);
    const status = asset.status || "in_stock";
    group.statuses.set(status, (group.statuses.get(status) || 0) + 1);
  }
  return [...groups.values()].sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true }));
}

const DASHBOARD_CATEGORY_RULES = [
  { id: "computer", name: "计算机设备", icon: "▣", terms: ["电脑", "笔记本", "台式", "主机", "工作站", "服务器", "昭阳", "thinkpad", "小主机", "迷你主机", "mini pc", "图形工作站", "移动工作站"] },
  { id: "display", name: "显示设备", icon: "▤", terms: ["显示器", "液晶显示器", "显示屏", "屏幕", "监视器", "投影", "电视", "aoc"] },
  { id: "network", name: "网络设备", icon: "◌", terms: ["网络", "交换机", "路由器", "防火墙", "通信", "网卡", "无线网卡", "ap", "视频监控", "监控", "摄像"] },
  { id: "storage", name: "存储设备", icon: "◉", terms: ["硬盘", "固态", "ssd", "m.2", "m2", "nvme", "pcie", "u盘", "存储", "sa1000", "三星750", "三星970", "三星980", "三星990", "机械硬盘"] },
  { id: "office", name: "办公设备", icon: "▥", terms: ["打印", "扫描", "文件袋", "文件柜", "档案", "办公", "桌", "椅", "柜"] },
  { id: "turnover", name: "周转器材", icon: "◇", terms: ["周转", "收纳", "工具箱"] },
  { id: "peripheral", name: "外设配件", icon: "◆", terms: ["键盘", "鼠标", "耳机", "扩展坞", "转接器", "适配器", "线缆", "数据线", "hdmi", "usb", "type-c", "typec", "支架", "配件", "套件", "电源"] },
  { id: "teaching", name: "教学资料", icon: "▧", terms: ["教材", "教程", "文档", "资料", "讲义", "python", "软件工具", "图书"] },
  { id: "consumable", name: "耗材用品", icon: "◍", terms: ["耗材", "墨盒", "硒鼓", "纸", "电池"] },
  { id: "other", name: "其他设备", icon: "◇", terms: [] }
];

function dashboardAssetCategory(asset) {
  const text = rawAssetComparableText(asset);
  const matched = DASHBOARD_CATEGORY_RULES.find((rule) => rule.id !== "other" && textHasAny(text, rule.terms));
  if (matched) return matched;
  if (assetKind(asset) === "耗材") return DASHBOARD_CATEGORY_RULES.find((rule) => rule.id === "consumable");
  return DASHBOARD_CATEGORY_RULES.find((rule) => rule.id === "other");
}

function dashboardCategoryRows(groupRows) {
  const rows = new Map();
  for (const group of groupRows) {
    const family = dashboardGroupFamily(group);
    const key = family.id;
    if (!rows.has(key)) {
      rows.set(key, {
        key,
        name: family.name,
        icon: family.icon,
        quantity: 0,
        groupCount: 0,
        groups: [],
        locations: new Set(),
        statuses: new Map()
      });
    }
    const row = rows.get(key);
    row.quantity += Number(group.quantity || 0);
    row.groupCount += 1;
    row.groups.push(group);
    group.locations.forEach((location) => row.locations.add(location));
    group.statuses.forEach((count, status) => row.statuses.set(status, (row.statuses.get(status) || 0) + count));
  }
  const order = new Map(DASHBOARD_CATEGORY_RULES.map((item, index) => [item.id, index]));
  return [...rows.values()].sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99) || b.quantity - a.quantity);
}

function dashboardGroupFamily(group) {
  const familyCounts = new Map();
  for (const asset of group.assets || []) {
    const family = dashboardAssetCategory(asset);
    const quantity = Number(asset.quantity || 0) || 1;
    familyCounts.set(family.id, (familyCounts.get(family.id) || 0) + quantity);
  }
  const [familyId] = [...familyCounts.entries()].sort((a, b) => b[1] - a[1])[0] || ["other", 0];
  return DASHBOARD_CATEGORY_RULES.find((rule) => rule.id === familyId) || DASHBOARD_CATEGORY_RULES.find((rule) => rule.id === "other");
}

function dashboardGroupStatus(group) {
  const entries = [...group.statuses.entries()].sort((a, b) => b[1] - a[1]);
  if (!entries.length) return "-";
  if (entries.length === 1) return statusBadge(entries[0][0]);
  return `<span class="badge warn">混合</span><span class="mini-meta">${entries.map(([status, count]) => `${statusText(status)} ${count}`).join(" / ")}</span>`;
}

function dashboardSetText(values, limit = 2) {
  const list = [...values].filter(Boolean);
  if (!list.length) return "-";
  const visible = list.slice(0, limit).join("；");
  return list.length > limit ? `${visible} 等 ${list.length} 处` : visible;
}

function renderDashboardContent(metrics) {
  if (dashboardMode === "category") return renderDashboardCategoryPanel(metrics);
  if (dashboardMode === "assetUsage") return renderDashboardUsagePanel(metrics, "asset");
  if (dashboardMode === "consumableUsage") return renderDashboardUsagePanel(metrics, "consumable");
  if (dashboardMode === "stock") {
    const rows = dashboardLedgerGroups(metrics.assets.filter((asset) => (asset.status || "in_stock") === "in_stock"));
    return renderDashboardLedgerGroupsPanel(metrics, {
      rows,
      title: "在库资产清单",
      hint: `当前在库 ${metrics.inStockCount} 件`,
      emptyTitle: "还没有在库资产",
      emptyText: "资产入库后会默认进入在库状态；借出、维修或报废的资产不会出现在这里。",
      showQuantity: true
    });
  }
  return renderDashboardLedgerGroupsPanel(metrics, {
    title: "资产清单",
    hint: dashboardSearch ? `筛选出 ${metrics.groupRows.length} 条` : `共 ${metrics.groupRows.length} 条数据`
  });
}

function renderDashboardOverviewCards(metrics) {
  return `
    <section class="dashboard-overview-cards no-print">
      ${renderDashboardOverviewStatCard("list", "清单总数", metrics.assetCount, "底账资产明细", "▤")}
      ${renderDashboardOverviewStatCard("category", "资产类别", metrics.categoryCount, "按资产分类查看", "▦")}
      ${renderDashboardOverviewStatCard("assetUsage", "资产使用情况", metrics.currentUsingCount, "按人员借用资产", "人")}
      ${renderDashboardOverviewStatCard("consumableUsage", "耗材使用情况", metrics.consumableRecordQuantity, "按人员领用耗材", "▣")}
      ${renderDashboardOverviewStatCard("stock", "在库", metrics.inStockCount, "当前可用资产", "▥")}
    </section>
  `;
}

function renderDashboardOverviewStatCard(mode, label, value, sub, icon) {
  const active = dashboardMode === mode;
  return `
    <button class="dashboard-overview-stat clickable ${active ? "active" : ""}" data-dashboard-mode="${mode}" type="button" aria-label="查看${label}">
      <span class="dashboard-card-icon">${icon}</span>
      <div>
        <span>${label}</span>
        <strong>${value}</strong>
        <em>${sub}</em>
      </div>
      <i class="dashboard-card-arrow">›</i>
    </button>
  `;
}

function dashboardImportAction() {
  return can("records.manage")
    ? { label: "导入学校资产底表", action: { view: "records", mode: "import", importKind: "inbound" } }
    : { label: "查看资产台账", action: { view: "assets" } };
}

function dashboardImportEmptyAction() {
  const item = dashboardImportAction();
  return { label: item.label, ...item.action };
}

function renderDashboardLedgerGroupsPanel(metrics, options = {}) {
  const sourceRows = options.rows || metrics.groupRows;
  const rows = sourceRows.slice(0, dashboardSearch ? 20 : 10);
  const title = options.title || "资产清单";
  const hint = options.hint || (dashboardSearch ? `筛选出 ${sourceRows.length} 条` : `共 ${sourceRows.length} 条数据`);
  return `
    <section class="dashboard-panel ledger-groups-panel">
      <div class="dashboard-table-head">
        <div class="section-title compact-title">
          <h2>${title}</h2>
          <span class="hint">${hint}</span>
        </div>
        <div class="dashboard-table-tools no-print">
          <div class="dashboard-inline-search">
            <span>⌕</span>
            <input id="dashboardSearch" placeholder="搜索资产编号、名称、规格、位置或使用人" value="${attrText(dashboardSearch)}" />
          </div>
          <button class="secondary small" data-empty-action="${attrText(JSON.stringify({ view: "assets" }))}" type="button">查看台账</button>
        </div>
      </div>
      ${renderDashboardLedgerTable(rows, {
        showCategory: options.showCategory,
        showQuantity: options.showQuantity,
        emptyTitle: options.emptyTitle || "还没有学校资产底表",
        emptyText: options.emptyText || "先导入学校资产 Excel 底表，后续台账、人员绑定、耗材扣库和盘点才有统一数据源。"
      })}
      <div class="dashboard-table-foot">
        <span>共 ${sourceRows.length} 条数据</span>
        <span>${dashboardSearch ? "显示前 20 条匹配结果" : "默认显示前 10 条"}</span>
      </div>
    </section>
  `;
}

function renderDashboardLedgerTable(rows, options = {}) {
  const showCategory = Boolean(options.showCategory);
  const showQuantity = Boolean(options.showQuantity);
  const colspan = 5 + (showCategory ? 1 : 0) + (showQuantity ? 1 : 0);
  return `
    <div class="table-wrap compact-table dashboard-ledger-table">
      <table>
        <thead>
          <tr>
            <th>资产名称</th>
            ${showCategory ? "<th>资产类别</th>" : ""}
            <th>资产规格</th>
            <th>资产状态</th>
            <th>资产位置</th>
            ${showQuantity ? "<th>数量</th>" : ""}
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((group) => `
            <tr>
              <td><strong>${attrText(group.name)}</strong></td>
              ${showCategory ? `<td>${attrText(group.category)}</td>` : ""}
              <td>${attrText(group.spec)}</td>
              <td>${dashboardGroupStatus(group)}</td>
              <td>${attrText(dashboardSetText(group.locations))}<div class="mini-meta">${attrText(dashboardSetText(group.departments))}</div></td>
              ${showQuantity ? `<td>${group.quantity}</td>` : ""}
              <td><button class="ghost small dashboard-detail-link" data-ledger-open-group="${attrText(group.ledgerKey)}" type="button">查看详情</button></td>
            </tr>
          `).join("") || emptyActionRow(colspan, options.emptyTitle, options.emptyText, [dashboardImportEmptyAction()])}
        </tbody>
      </table>
    </div>
  `;
}

function renderDashboardCategoryPanel(metrics) {
  const categories = metrics.categoryRows;
  const activeKey = dashboardCategory && categories.some((row) => row.key === dashboardCategory)
    ? dashboardCategory
    : categories[0]?.key || "";
  const active = categories.find((row) => row.key === activeKey) || null;
  const rows = active?.groups || [];
  return `
    <section class="dashboard-panel dashboard-category-panel">
      <div class="dashboard-category-layout">
        <aside class="dashboard-category-sidebar no-print">
          <div class="section-title compact-title">
            <h2>资产类别</h2>
            <span class="hint">共 ${categories.length} 类</span>
          </div>
          <div class="dashboard-category-list">
            ${categories.map((category) => `
              <button class="${category.key === activeKey ? "active" : ""}" data-dashboard-category="${attrText(category.key)}" type="button">
                <span>${attrText(category.name)}</span>
                <b>${category.quantity}</b>
              </button>
            `).join("") || renderEmptyAction("还没有资产类别", "导入学校资产底表后，系统会按资产分类自动生成这里的类别。", [dashboardImportEmptyAction()])}
          </div>
        </aside>
        <div class="dashboard-category-main">
          <div class="dashboard-table-head">
            <div class="section-title compact-title">
              <h2>${attrText(active?.name || "资产类别")}</h2>
              <span class="hint">${active ? `${active.groupCount} 组 / ${active.quantity} 件` : "等待导入底表"}</span>
            </div>
            <div class="dashboard-table-tools no-print">
              <div class="dashboard-inline-search">
                <span>⌕</span>
                <input id="dashboardSearch" placeholder="搜索资产名称、规格、位置" value="${attrText(dashboardSearch)}" />
              </div>
              <button class="secondary small" data-empty-action="${attrText(JSON.stringify({ view: "assets" }))}" type="button">查看台账</button>
            </div>
          </div>
          ${renderDashboardLedgerTable(rows, {
            showQuantity: true,
            emptyTitle: "这个类别下还没有资产",
            emptyText: "导入底表后，资产会按资产分类、名称和规格自动进入对应类别。"
          })}
        </div>
      </div>
    </section>
  `;
}

function dashboardPeopleRows(assets, records, usageKind = "asset") {
  const rows = new Map();
  const ensure = (userId) => {
    const id = userId || "u-import-unknown";
    if (!rows.has(id)) {
      rows.set(id, {
        userId: id,
        name: dashboardPersonName(id),
        department: dashboardPersonDepartment(id),
        fixed: 0,
        consumableQuantity: 0,
        consumableRecords: 0,
        currentUsing: 0,
        returned: 0,
        overdue: 0,
        abnormal: 0
      });
    }
    return rows.get(id);
  };
  if (usageKind === "asset") {
    for (const asset of assets) {
      if (assetKind(asset) !== "资产" || !dashboardAssetInPersonalUse(asset)) continue;
      const userId = dashboardAssetUsageUserId(asset);
      if (!dashboardUsageUserValid(userId)) continue;
      const row = ensure(userId);
      row.fixed += 1;
      row.currentUsing += 1;
      if (["repair", "retired"].includes(asset.status)) row.abnormal += 1;
    }
  }
  if (usageKind === "consumable") {
    for (const record of records) {
      if (recordKind(record) !== "耗材" || record.type !== "出库") continue;
      const userId = dashboardRecordUsageUserId(record);
      if (!dashboardUsageUserValid(userId)) continue;
      const row = ensure(userId);
      row.consumableQuantity += Number(record.quantity || 0);
      row.consumableRecords += 1;
    }
  }
  if (usageKind === "asset") {
    for (const record of records) {
      if (recordKind(record) !== "资产" || record.type !== "入库") continue;
      const userId = dashboardRecordUsageUserId(record);
      if (dashboardUsageUserValid(userId) && rows.has(userId)) rows.get(userId).returned += Number(record.quantity || 0);
    }
  }
  rows.forEach((row) => {
    row.overdue = dashboardPersonOverdueCount(row.userId);
  });
  return [...rows.values()]
    .filter((row) => usageKind === "consumable" ? row.consumableQuantity : (row.fixed || row.currentUsing || row.returned || row.abnormal))
    .sort((a, b) => (b.currentUsing + b.consumableQuantity + b.fixed) - (a.currentUsing + a.consumableQuantity + a.fixed));
}

function dashboardPersonKey(userId) {
  return userId || "u-import-unknown";
}

function dashboardVirtualOwnerKey(name) {
  return `import-owner:${name}`;
}

function dashboardVirtualOwnerName(key) {
  return String(key || "").startsWith("import-owner:") ? String(key).slice("import-owner:".length) : "";
}

function dashboardPersonName(userId) {
  return dashboardVirtualOwnerName(userId) || userName(userId);
}

function dashboardPersonDepartment(userId) {
  return dashboardVirtualOwnerName(userId) ? "按导入文件识别" : userDepartment(userId);
}

function dashboardLooksLikePersonName(name) {
  const clean = String(name || "").replace(/\s+/g, "");
  if (!clean || ["未知用户", "未填写"].includes(clean)) return false;
  if (/(管理员|系统|仓库|仓储|资产|管理处|管理|部门|学院|中心|办公室|项目|网管|后勤处|教务处|财务处|专业|班级)/.test(clean)) return false;
  return true;
}

function dashboardUsageUserValid(userId) {
  const key = dashboardPersonKey(userId);
  if (!key || key === "u-import-unknown") return false;
  const virtualName = dashboardVirtualOwnerName(key);
  if (virtualName) return dashboardLooksLikePersonName(virtualName);
  const user = state.users.find((item) => item.id === key);
  if (!user || user.active === false) return false;
  const cleanName = String(user.name || "").replace(/\s+/g, "");
  if (user.id === "u-admin" || user.username === "admin" || ["系统管理员", "管理员"].includes(cleanName)) return false;
  return dashboardLooksLikePersonName(user.name);
}

function dashboardPersonOverdueCount(userId) {
  const key = dashboardPersonKey(userId);
  const now = Date.now();
  return (state.borrowOrders || []).filter((order) => {
    if (dashboardPersonKey(order.borrowerId) !== key) return false;
    if (order.status === "已归还" || order.actualReturnDate) return false;
    if (!order.expectedReturnDate) return false;
    return new Date(order.expectedReturnDate).getTime() < now;
  }).length;
}

function dashboardAssetUsageUserId(asset) {
  const currentUserId = dashboardAssetCurrentUserId(asset);
  if (currentUserId && dashboardUsageUserValid(currentUserId)) return currentUserId;
  const latestOut = latestAssetRecord(asset, "出库");
  const importOwner = dashboardImportOwnerForRecord(latestOut, asset);
  if (importOwner) return dashboardVirtualOwnerKey(importOwner);
  const flow = assetFlow(asset);
  if (flow.borrowerId) return dashboardPersonKey(flow.borrowerId);
  if (currentUserId) return currentUserId;
  return "";
}

function dashboardAssetCurrentUserId(asset) {
  if (!(asset.status === "checked_out" || asset.status === "使用中")) return "";
  return dashboardPersonKey(asset.useUserId || asset.keeperId || "");
}

function dashboardAssetInPersonalUse(asset) {
  if (assetKind(asset) !== "资产") return false;
  const flow = assetFlow(asset);
  return asset.status === "checked_out" || Boolean(flow.borrowerId);
}

function dashboardRecordUsageUserId(record) {
  const asset = dashboardRecordAsset(record);
  const importOwner = dashboardImportOwnerForRecord(record, asset);
  if (importOwner) return dashboardVirtualOwnerKey(importOwner);
  return dashboardPersonKey(record?.userId);
}

function dashboardImportOwnerForRecord(record, asset) {
  if (!record || !asset) return "";
  const user = state.users.find((item) => item.id === record.userId);
  const userKey = compactAssetText(user?.name);
  const assetKeys = [asset.name, asset.spec].map(compactAssetText).filter(Boolean);
  if (!userKey || !assetKeys.includes(userKey)) return "";
  const file = sourceFilesFromText(record.note).slice(-1)[0] || sourceFilesFromText(asset.remark).slice(-1)[0] || "";
  const owner = personNameFromImportFileName(file);
  return owner && compactAssetText(owner) !== userKey ? owner : "";
}

function dashboardPersonFixedAssets(userId, assets) {
  return assets
    .filter((asset) => assetKind(asset) === "资产" && dashboardAssetUsageUserId(asset) === userId)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "zh-Hans-CN", { numeric: true })
      || String(a.code || "").localeCompare(String(b.code || ""), "zh-Hans-CN", { numeric: true }));
}

function dashboardPersonConsumableRecords(userId, records) {
  return records
    .filter((record) => recordKind(record) === "耗材" && record.type === "出库" && dashboardRecordUsageUserId(record) === userId)
    .sort((a, b) => recordMillis(b) - recordMillis(a));
}

function dashboardPersonRecordRows(userId, records) {
  return records
    .filter((record) => dashboardRecordUsageUserId(record) === userId)
    .sort((a, b) => recordMillis(b) - recordMillis(a))
    .slice(0, 12);
}

function dashboardRecordAsset(record) {
  return state.assets.find((asset) => asset.id === record.assetId) || null;
}

function renderDashboardUsagePanel(metrics, usageKind = "asset") {
  const isConsumable = usageKind === "consumable";
  const rows = isConsumable ? metrics.consumablePeopleRows : metrics.assetPeopleRows;
  const selectedRow = rows.find((row) => row.userId === dashboardUsageUserId) || null;
  const title = isConsumable ? "耗材使用情况" : "资产使用情况";
  const hint = isConsumable
    ? `共 ${rows.length} 个人员 / ${metrics.consumableRecordQuantity} 件耗材已领用`
    : `共 ${rows.length} 个人员 / ${metrics.currentUsingCount} 件资产使用中`;
  return `
    <section class="dashboard-panel dashboard-usage-panel">
      <div class="dashboard-table-head">
        <div class="section-title compact-title">
          <h2>${title}</h2>
          <span class="hint">${hint}</span>
        </div>
        <div class="dashboard-table-tools no-print">
          <div class="dashboard-inline-search">
            <span>⌕</span>
            <input id="dashboardSearch" placeholder="搜索姓名、部门或资产名称" value="${attrText(dashboardSearch)}" />
          </div>
          <button class="secondary small" data-empty-action="${attrText(JSON.stringify({ view: "records", mode: "import", importKind: isConsumable ? "personConsumable" : "personAsset" }))}" type="button">导入人员表</button>
        </div>
      </div>
      <div class="dashboard-usage-tabs no-print">
        <button class="${!isConsumable ? "active" : ""}" data-dashboard-mode="assetUsage" type="button">资产使用情况</button>
        <button class="${isConsumable ? "active" : ""}" data-dashboard-mode="consumableUsage" type="button">耗材使用情况</button>
      </div>
      ${rows.length ? `
        <div class="dashboard-usage-cards">
          ${rows.map((row) => renderDashboardUsageCard(row, metrics, selectedRow?.userId === row.userId, usageKind)).join("")}
        </div>
        ${selectedRow ? `
          <div class="dashboard-usage-detail-shell">
            <div class="asset-list-title">
              <div>
                <h3>${attrText(selectedRow.name)}的${isConsumable ? "耗材领用明细" : "资产使用明细"}</h3>
                <span>${attrText(selectedRow.department || "-")} · ${isConsumable ? `耗材领用 ${selectedRow.consumableQuantity} 件` : `固定资产 ${selectedRow.fixed} 件`}</span>
              </div>
              <button class="ghost small" data-dashboard-person-clear type="button">收起明细</button>
            </div>
            ${renderDashboardUsageDetail(selectedRow, metrics, usageKind)}
          </div>
        ` : ""}
      ` : renderEmptyAction(`还没有${isConsumable ? "耗材" : "资产"}使用记录`, isConsumable ? "导入人员耗材领用表或登记耗材领用后，这里会按人员汇总。" : "导入人员资产使用表或划一笔出借后，这里会按人员汇总。", can("records.manage") ? [{ label: isConsumable ? "导入耗材表" : "导入人员资产表", view: "records", mode: "import", importKind: isConsumable ? "personConsumable" : "personAsset" }] : [{ label: "查看资产台账", view: "assets" }])}
    </section>
  `;
}

function renderDashboardUsageCard(row, metrics, active, usageKind = "asset") {
  const isConsumable = usageKind === "consumable";
  return `
    <button class="dashboard-usage-card ${active ? "active" : ""}" data-dashboard-person-card="${attrText(row.userId)}" type="button">
      <span class="dashboard-usage-avatar ${isConsumable ? "consumable" : ""}">${isConsumable ? "耗" : "人"}</span>
      <span class="dashboard-usage-card-main">
        <span class="dashboard-usage-card-head">
          <span>
            <strong>${attrText(row.name)}</strong>
            <em>${attrText(row.department || "-")}</em>
          </span>
          <span class="dashboard-usage-card-metrics">
            <span><b>${isConsumable ? row.consumableQuantity : row.currentUsing}</b><em>${isConsumable ? "领用耗材" : "使用中资产"}</em></span>
            <span><b class="${!isConsumable && row.overdue ? "bad-text" : ""}">${isConsumable ? row.consumableRecords : row.overdue}</b><em>${isConsumable ? "领用次数" : "逾期"}</em></span>
          </span>
        </span>
        ${renderDashboardUsagePreview(row, metrics, usageKind)}
      </span>
    </button>
  `;
}

function renderDashboardUsagePreview(row, metrics, usageKind = "asset") {
  const fixedAssets = usageKind === "asset" ? dashboardPersonFixedAssets(row.userId, metrics.assets).slice(0, 3) : [];
  const consumableRecords = usageKind === "consumable" ? dashboardPersonConsumableRecords(row.userId, metrics.records).slice(0, 3) : [];
  const items = usageKind === "asset"
    ? fixedAssets.map((asset) => ({
      label: `${asset.name || "-"}${asset.spec ? ` ${asset.spec}` : ""}`,
      badge: statusBadge(asset.status)
    }))
    : consumableRecords.map((record) => {
      const asset = dashboardRecordAsset(record);
      return {
        label: `${asset?.name || assetName(record.assetId)} × ${record.quantity || 0}`,
        badge: `<span class="badge ok">已领用</span>`
      };
    });
  if (!items.length) return `<span class="dashboard-usage-preview empty">暂无${usageKind === "consumable" ? "耗材" : "资产"}预览</span>`;
  return `
    <span class="dashboard-usage-preview">
      <strong>${usageKind === "consumable" ? "领用耗材" : "借用资产"}（预览）</strong>
      ${items.map((item) => `<span><i>${attrText(item.label)}</i>${item.badge}</span>`).join("")}
    </span>
  `;
}

function renderDashboardUsageDetail(row, metrics, usageKind = "asset") {
  if (!row) return `<div class="empty compact-empty">请选择人员查看明细。</div>`;
  const fixedAssets = dashboardPersonFixedAssets(row.userId, metrics.assets);
  const consumableRecords = dashboardPersonConsumableRecords(row.userId, metrics.records);
  const records = dashboardPersonRecordRows(row.userId, metrics.records);
  const isConsumable = usageKind === "consumable";
  return `
    <section class="dashboard-usage-detail">
      <div class="dashboard-usage-summary">
        <div><span>固定资产</span><strong>${fixedAssets.length}</strong></div>
        <div><span>耗材领用</span><strong>${consumableRecords.reduce((sum, record) => sum + Number(record.quantity || 0), 0)}</strong></div>
        <div><span>使用中</span><strong>${row.currentUsing}</strong></div>
        <div><span>异常</span><strong>${row.abnormal}</strong></div>
      </div>
      ${!isConsumable ? `<div class="dashboard-usage-section"><h3>固定资产</h3>${renderDashboardPersonAssetTable(fixedAssets)}</div>` : ""}
      ${isConsumable ? `<div class="dashboard-usage-section"><h3>耗材领用</h3>${renderDashboardPersonConsumableTable(consumableRecords)}</div>` : ""}
      <div class="dashboard-usage-section">
        <h3>最近出入库记录</h3>
        ${renderDashboardPersonRecordList(records.filter((record) => usageKind === "consumable" ? recordKind(record) === "耗材" : recordKind(record) === "资产"))}
      </div>
    </section>
  `;
}

function renderDashboardPersonAssetTable(assets) {
  if (!assets.length) return `<div class="empty compact-empty">这个人当前没有绑定固定资产。</div>`;
  return `
    <div class="table-wrap compact-table dashboard-usage-table">
      <table>
        <thead><tr><th>资产编号</th><th>资产名称</th><th>规格型号</th><th>当前状态</th><th>当前位置</th><th>开始日期</th></tr></thead>
        <tbody>
          ${assets.map((asset) => {
            const latestOut = latestAssetRecord(asset, "出库");
            return `
              <tr>
                <td>${attrText(blank(asset.code || asset.id))}</td>
                <td>${attrText(asset.name || "-")}</td>
                <td>${attrText(blank(asset.spec))}</td>
                <td>${statusBadge(asset.status)}</td>
                <td>${attrText(blank(asset.location))}</td>
                <td>${attrText(fmt(latestOut?.outTime) || "-")}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderDashboardPersonConsumableTable(records) {
  if (!records.length) return `<div class="empty compact-empty">这个人还没有耗材领用记录。</div>`;
  return `
    <div class="table-wrap compact-table dashboard-usage-table">
      <table>
        <thead><tr><th>耗材名称</th><th>规格型号</th><th>数量</th><th>单位</th><th>领用日期</th></tr></thead>
        <tbody>
          ${records.map((record) => {
            const asset = dashboardRecordAsset(record);
            return `
              <tr>
                <td>${attrText(asset?.name || assetName(record.assetId))}</td>
                <td>${attrText(blank(asset?.spec))}</td>
                <td>${Number(record.quantity || 0)}</td>
                <td>${attrText(blank(asset?.unit || record.unit || "件"))}</td>
                <td>${attrText(fmt(record.outTime || record.inTime) || "-")}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderDashboardPersonRecordList(records) {
  if (!records.length) return `<div class="empty compact-empty">还没有这个人的出入库流水。</div>`;
  return `
    <div class="dashboard-usage-records">
      ${records.map((record) => `
        <article>
          <strong>${attrText(record.type || "-")} · ${attrText(assetName(record.assetId))}</strong>
          <span>${attrText(fmt(recordTime(record)))} / 数量 ${record.quantity || "-"} / 单号 ${attrText(record.paperNo || "-")}</span>
          <em>${attrText(recordDisplayNote(record))}</em>
        </article>
      `).join("")}
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

function renderEmptyAction(title, description, actions = []) {
  return `
    <div class="empty-action">
      <strong>${title}</strong>
      <p>${description}</p>
      <div class="empty-action-buttons">
        ${actions.map((action) => `<button class="${action.danger ? "danger" : "secondary"} small" data-empty-action="${attrText(JSON.stringify(action))}" type="button">${action.label}</button>`).join("")}
      </div>
    </div>
  `;
}

function emptyActionRow(colspan, title, description, actions = []) {
  return `<tr><td colspan="${colspan}" class="empty">${renderEmptyAction(title, description, actions)}</td></tr>`;
}

function recordEntryActions() {
  if (!can("records.manage")) return [{ label: "查看资产台账", view: "assets" }];
  return [
    { label: "新增入库", view: "records", mode: "manual", action: "inbound" },
    { label: "电子档导入", view: "records", mode: "import" }
  ];
}

function consumableEntryActions() {
  if (!can("records.manage")) return [{ label: "查看出入库记录", view: "records" }];
  return [
    { label: "耗材领用", view: "records", mode: "manual", action: "consume" },
    { label: "新增入库", view: "records", mode: "manual", action: "inbound" }
  ];
}

function renderAssetBatchToolbar(groups) {
  if (!can("assets.manage") && !can("reports.export")) return "";
  const selected = selectedAssetGroups(groups);
  return `
    <div class="asset-batch-toolbar no-print">
      <span>已选 ${selected.length} 组 / ${selectedLedgerAssets(groups).length} 条资产</span>
      <div class="row-actions">
        ${can("assets.manage") ? `<button class="secondary small" id="batchUpdateAssetLocations" type="button">更新位置</button>` : ""}
        ${can("assets.manage") ? `<button class="secondary small" id="batchUpdateAssetImages" type="button">增加参考图</button>` : ""}
        <button class="secondary small" id="batchExportAssets" type="button">批量导出</button>
        <button class="secondary small" id="batchPrintAssetLabels" type="button">批量打印标签</button>
        ${can("base_data.manage") ? `<button class="secondary small" id="batchClassifyAssets" type="button">批量归类</button>` : ""}
        ${can("checks.manage") ? `<button class="secondary small" id="batchInventoryCheck" type="button">批量盘点</button>` : ""}
        ${selected.length ? `<button class="ghost small" id="clearAssetGroupSelectionInline" type="button">清空选择</button>` : ""}
      </div>
    </div>
  `;
}

function groupHasStatus(group, status) {
  return group.assets.some((asset) => asset.status === status);
}

function ledgerAssetsByStatus(group, status) {
  if (!status || status === "all") return group.assets;
  return group.assets.filter((asset) => (asset.status || "in_stock") === status);
}

function ledgerStatusTone(status) {
  return {
    checked_out: "using",
    in_stock: "available",
    repair: "repair",
    retired: "retired"
  }[status] || "default";
}

function renderLedgerStatusButtons(group) {
  const order = ["checked_out", "repair", "retired", "in_stock"];
  return `
    <div class="ledger-status-buttons">
      ${order.map((status) => {
        const count = group.statusCounts?.[status] || 0;
        if (!count) return "";
        return `<button class="ledger-status-chip ${ledgerStatusTone(status)}" data-ledger-status="${status}" data-ledger-group="${attrText(group.key)}" type="button">${statusText(status)} ${count}</button>`;
      }).join("") || `<span class="ledger-status-chip muted">暂无状态</span>`}
    </div>
  `;
}

function renderAssetLedgerActions(group) {
  if (!can("assets.manage")) return `<td><button class="ghost small" data-ledger-open-group="${attrText(group.key)}" type="button">查看明细</button></td>`;
  return `
    <td>
      <div class="row-actions">
        <button class="primary small" data-ledger-open-group="${attrText(group.key)}" type="button">查看明细</button>
        ${groupHasStatus(group, "in_stock") ? `<button class="ghost small" data-ledger-status="in_stock" data-ledger-group="${attrText(group.key)}" type="button">在库划一笔</button>` : ""}
      </div>
    </td>
  `;
}

function renderAssets() {
  const groups = assetLedgerGroups();
  const printableAssets = selectedLedgerAssets(groups);
  const totalPages = Math.max(1, Math.ceil(groups.length / assetPageSize));
  if (assetPage > totalPages) assetPage = totalPages;
  const pagedGroups = groups.slice((assetPage - 1) * assetPageSize, assetPage * assetPageSize);
  const keeperOptions = selectableUsers().map((user) => `<option value="${user.id}" ${assetKeeperFilter === user.id ? "selected" : ""}>${user.name}</option>`).join("");
  const borrowerOptions = selectableUsers().map((user) => `<option value="${user.id}" ${assetBorrowerFilter === user.id ? "selected" : ""}>${user.name}${isMultiDepartment() ? ` · ${user.department}` : ""}</option>`).join("");
  const familyOptions = DEVICE_FAMILY_RULES.map((family) => `<option value="${family.id}" ${assetFamilyFilter === family.id ? "selected" : ""}>${family.name}</option>`).join("");
  return `
    <section class="asset-workspace">
      ${renderAssetStatusSummary()}
      <div class="asset-list-panel">
        <div class="asset-filter-card no-print">
          <div class="asset-filter-main">
            <input id="assetSearch" placeholder="搜索资产编号、条码、名称、借用人、位置、纸质单号" value="${assetFilter}" />
            <select id="assetStatusFilter">
              <option value="all" ${assetStatusFilter === "all" ? "selected" : ""}>状态：全部</option>
              <option value="in_stock" ${assetStatusFilter === "in_stock" ? "selected" : ""}>状态：在库可用</option>
              <option value="checked_out" ${assetStatusFilter === "checked_out" ? "selected" : ""}>状态：使用中</option>
              <option value="repair" ${assetStatusFilter === "repair" ? "selected" : ""}>状态：维修中</option>
              <option value="retired" ${assetStatusFilter === "retired" ? "selected" : ""}>状态：已报废</option>
            </select>
            <div class="asset-category-filter">
              <button class="${assetCategoryPanelOpen ? "active" : ""}" id="toggleAssetCategoryPanel" type="button">分类：${assetCategoryFilters.length ? assetCategoryFilters.map(displayCategoryText).join("、") : "全部"} <span>⌄</span></button>
              ${assetCategoryPanelOpen ? renderAssetCategoryPanel() : ""}
            </div>
            <select id="assetSortField">
              <option value="outTime" ${assetSortField === "outTime" ? "selected" : ""}>排序：出库/入库时间</option>
              <option value="inTime" ${assetSortField === "inTime" ? "selected" : ""}>排序：最近入库</option>
              <option value="model" ${assetSortField === "model" ? "selected" : ""}>排序：资产名称</option>
              <option value="category" ${assetSortField === "category" ? "selected" : ""}>排序：分类</option>
              <option value="quantity" ${assetSortField === "quantity" ? "selected" : ""}>排序：数量</option>
              <option value="location" ${assetSortField === "location" ? "selected" : ""}>排序：位置</option>
            </select>
            <button class="advanced-filter-button" id="toggleAdvancedAssetFilters" type="button">展开高级筛选 <span>⌄</span></button>
          </div>
          <div class="asset-advanced-filters ${assetAdvancedFiltersOpen || assetFamilyFilter !== "all" || assetKeeperFilter !== "all" || assetBorrowerFilter !== "all" ? "show" : ""}">
            <select id="assetFamilyFilter">
              <option value="all" ${assetFamilyFilter === "all" ? "selected" : ""}>设备分类：全部</option>
              ${familyOptions}
            </select>
            <select id="assetKeeperFilter">
              <option value="all" ${assetKeeperFilter === "all" ? "selected" : ""}>保管人：全部</option>
              ${keeperOptions}
            </select>
            <select id="assetBorrowerFilter">
              <option value="all" ${assetBorrowerFilter === "all" ? "selected" : ""}>查看出借详情：全部人员</option>
              ${borrowerOptions}
            </select>
            <select id="assetSortDir">
              <option value="desc" ${assetSortDir === "desc" ? "selected" : ""}>降序排序</option>
              <option value="asc" ${assetSortDir === "asc" ? "selected" : ""}>升序排序</option>
            </select>
            <button class="secondary" id="clearAssetSelection" type="button">重置筛选</button>
          </div>
        </div>
        <div class="asset-list-title">
          <h3>资产分组汇总</h3>
          <span>按 资产分类 + 资产名称 + 规格型号 汇总，共 ${groups.length} 组 / ${printableAssets.length} 条资产编号</span>
          ${renderAssetPagination(groups.length, totalPages, "top")}
        </div>
      ${renderAssetBatchToolbar(groups)}
      ${assetLocationUpdateResult ? renderImportResult("位置更新结果", assetLocationUpdateResult) : ""}
      ${assetImageUpdateResult ? renderImportResult("参考图更新结果", assetImageUpdateResult) : ""}
      <div class="table-wrap asset-table-wrap">
        <table>
          <thead>
            <tr>
              <th class="select-col"><input data-asset-select-all type="checkbox" ${pagedGroups.length && pagedGroups.every((group) => selectedAssetGroupKeys.has(group.key)) ? "checked" : ""} /></th>
              <th>资产分类</th>
              <th>资产名称</th>
              <th>规格型号</th>
              <th>数量</th>
              <th>状态汇总</th>
              <th>位置汇总</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${pagedGroups.map((group) => `
              <tr>
                <td class="select-col"><input data-asset-group-select="${attrText(group.key)}" type="checkbox" ${selectedAssetGroupKeys.has(group.key) ? "checked" : ""} /></td>
                <td>${attrText(group.category)}</td>
                <td>
                  <button class="asset-ledger-name" data-ledger-open-group="${attrText(group.key)}" type="button">
                    <strong>${attrText(group.name)}</strong>
                    <span>${group.count} 个资产编号</span>
                  </button>
                </td>
                <td>${attrText(group.spec)}</td>
                <td>${group.quantity}</td>
                <td>${renderLedgerStatusButtons(group)}</td>
                <td>${attrText(group.locationSummary)}<div class="mini-meta">${attrText(group.departmentSummary)}</div></td>
                ${renderAssetLedgerActions(group)}
              </tr>
            `).join("") || `<tr><td colspan="8" class="empty">${renderEmptyAction("资产台账为空", "先导入学校资产 Excel 底表，系统会按资产分类、资产名称、规格型号自动形成父级分组。", [{ label: "新增入库", view: "records", mode: "manual", action: "inbound" }, { label: "导入学校资产底表", view: "records", mode: "import" }])}</td></tr>`}
          </tbody>
        </table>
      </div>
      ${renderAssetPagination(groups.length, totalPages, "bottom")}
      </div>
    </section>
    ${renderPrintableAssetSheets(printableAssets)}
    ${can("assets.manage") && assetDrawerOpen ? renderAssetDrawer() : ""}
    ${ledgerDrawerKey ? renderLedgerDetailDrawer() : ""}
    ${selectedAssetDetailId ? renderAssetDetailDrawer() : ""}
  `;
}

function assetCurrentUserName(asset) {
  const flow = assetFlow(asset);
  const name = flow.borrowerName && flow.borrowerName !== "-" && flow.borrowerName !== "未知用户"
    ? flow.borrowerName
    : userName(asset.useUserId || asset.keeperId);
  return name === "未知用户" ? "-" : name;
}

function assetCurrentDepartment(asset) {
  const flow = assetFlow(asset);
  return flow.borrowDepartment && flow.borrowDepartment !== "-"
    ? flow.borrowDepartment
    : blank(asset.useDepartment || userDepartment(asset.useUserId || asset.keeperId));
}

function assetRemarkField(asset, labels) {
  const parts = String(asset.remark || "").split("；").map((item) => item.trim()).filter(Boolean);
  for (const label of labels) {
    const found = parts.find((part) => part.startsWith(`${label}：`) || part.startsWith(`${label}:`));
    if (found) return found.replace(`${label}：`, "").replace(`${label}:`, "").trim();
  }
  return "";
}

function ledgerDrawerTitle(mode) {
  if (mode === "checked_out") return "使用中资产";
  if (mode === "in_stock") return "在库资产编号";
  if (mode === "repair") return "维修中资产";
  if (mode === "retired") return "已报废资产";
  return "资产详情";
}

function renderLedgerDrawerTabs(group) {
  const tabs = [
    ["group", "全部", group.assets.length],
    ["checked_out", "使用中", group.statusCounts?.checked_out || 0],
    ["in_stock", "在库", group.statusCounts?.in_stock || 0],
    ["repair", "维修", group.statusCounts?.repair || 0],
    ["retired", "报废", group.statusCounts?.retired || 0]
  ].filter(([, , count], index) => index === 0 || count);
  return `
    <div class="ledger-drawer-tabs">
      ${tabs.map(([mode, label, count]) => `<button class="${ledgerDrawerMode === mode ? "active" : ""}" data-ledger-drawer-tab="${mode}" data-ledger-group="${attrText(group.key)}" type="button">${label}<span>${count}</span></button>`).join("")}
    </div>
  `;
}

function renderLedgerGroupSummary(group) {
  const totalAmount = group.assets.reduce((sum, asset) => sum + Number(asset.totalAmount || Number(asset.unitPrice || 0) * Number(asset.quantity || 0)), 0);
  return `
    <section class="ledger-drawer-summary">
      <div><span>资产分类</span><strong>${attrText(group.category)}</strong></div>
      <div><span>资产名称</span><strong>${attrText(group.name)}</strong></div>
      <div><span>规格型号</span><strong>${attrText(group.spec)}</strong></div>
      <div><span>资产编号</span><strong>${group.assets.length}</strong></div>
      <div><span>位置汇总</span><strong>${attrText(group.locationSummary)}</strong></div>
      <div><span>台账原值</span><strong>${formatMoney(totalAmount)}</strong></div>
    </section>
  `;
}

function ledgerUsingPeople(group) {
  const rows = new Map();
  for (const asset of ledgerAssetsByStatus(group, "checked_out")) {
    const userId = assetFlow(asset).borrowerId || asset.useUserId || asset.keeperId || "unknown";
    if (!rows.has(userId)) {
      rows.set(userId, {
        userId,
        name: userId === "unknown" ? "未绑定使用人" : userName(userId),
        department: userId === "unknown" ? "-" : userDepartment(userId),
        assets: []
      });
    }
    rows.get(userId).assets.push(asset);
  }
  return [...rows.values()].sort((a, b) => b.assets.length - a.assets.length || a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true }));
}

function renderLedgerUsingPeople(group) {
  const rows = ledgerUsingPeople(group);
  if (!rows.length) return `<div class="empty compact-empty">这一组当前没有使用中的资产。</div>`;
  return `
    <section class="ledger-people-list">
      ${rows.map((row) => `
        <article class="ledger-person-card">
          <div>
            <strong>${attrText(row.name)}</strong>
            <span>${attrText(row.department)}</span>
          </div>
          <b>${row.assets.length}</b>
          <p>${row.assets.map((asset) => attrText(asset.code)).join("、")}</p>
        </article>
      `).join("")}
    </section>
  `;
}

function renderLedgerCheckoutForm(asset) {
  if (!can("records.manage") || (asset.status || "in_stock") !== "in_stock") return "";
  const options = selectableUsers()
    .map((user) => `<option value="${user.id}">${attrText(user.name)}${isMultiDepartment() ? ` · ${attrText(user.department)}` : ""}</option>`)
    .join("");
  return `
    <form class="ledger-checkout-form" data-ledger-checkout-form="${asset.id}">
      <input type="hidden" name="assetId" value="${asset.id}" />
      <select name="userId" required>
        <option value="">选择使用人</option>
        ${options}
      </select>
      <button class="primary small" type="submit">划到名下</button>
    </form>
  `;
}

function renderLedgerLocationCell(asset) {
  return `
    <div class="ledger-location-cell">
      <span>${attrText(blank(asset.location))}</span>
      ${can("assets.manage") ? `<button class="ghost small" data-ledger-location-edit="${asset.id}" type="button">更新位置</button>` : ""}
    </div>
  `;
}

function renderLedgerAssetRows(group, mode) {
  const assets = ledgerAssetsByStatus(group, mode === "group" ? "all" : mode);
  if (!assets.length) return `<div class="empty compact-empty">当前筛选下没有资产编号。</div>`;
  return `
    <div class="table-wrap compact-table ledger-detail-table">
      <table>
        <thead>
          <tr><th>资产编号</th><th>状态</th><th>当前部门</th><th>当前使用人</th><th>具体存放地点</th><th>取得日期</th><th>资产原值</th><th>清查盘点</th><th>清查盘盈</th><th>操作</th></tr>
        </thead>
        <tbody>
          ${assets.map((asset) => `
            <tr data-ledger-asset-row="${asset.id}">
              <td><button class="ledger-code-button" data-ledger-focus-asset="${asset.id}" type="button">${attrText(asset.code)}</button></td>
              <td>${statusBadge(asset.status)}</td>
              <td>${attrText(assetCurrentDepartment(asset))}</td>
              <td>${attrText(assetCurrentUserName(asset))}</td>
              <td>${renderLedgerLocationCell(asset)}</td>
              <td>${attrText(blank(asset.purchaseDate || asset.inboundDate))}</td>
              <td>${Number(asset.totalAmount || asset.unitPrice || 0).toFixed(2)}</td>
              <td>${attrText(blank(assetRemarkField(asset, ["清查盘点情况", "4月12日清查盘点情况"])))}</td>
              <td>${attrText(blank(assetRemarkField(asset, ["清查盘盈情况"])))}</td>
              <td>${renderLedgerCheckoutForm(asset) || `<button class="ghost small" data-view-asset="${asset.id}" type="button">查看</button>`}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderLedgerDetailDrawer() {
  const group = assetLedgerGroupByKey(ledgerDrawerKey);
  if (!group) return "";
  const mode = ledgerDrawerMode || "group";
  return `
    <div class="drawer-backdrop no-print" id="ledgerDetailBackdrop"></div>
    <aside class="asset-drawer ledger-detail-drawer resizable-drawer no-print" ${drawerWidthStyle("ledger-detail", 920)} aria-label="资产台账明细">
      ${renderDrawerResizeHandle("拖动调整资产台账明细宽度")}
      <div class="drawer-head">
        <div>
          <h2>${ledgerDrawerTitle(mode)}</h2>
          <p>${attrText(group.category)} / ${attrText(group.name)} / ${attrText(group.spec)}</p>
        </div>
        <button class="ghost icon-button" id="closeLedgerDetail" type="button">×</button>
      </div>
      <div class="drawer-body">
        ${renderLedgerGroupSummary(group)}
        ${renderLedgerDrawerTabs(group)}
        ${mode === "checked_out" ? renderLedgerUsingPeople(group) : ""}
        ${renderLedgerAssetRows(group, mode)}
      </div>
    </aside>
  `;
}

function renderAssetStatusSummary() {
  const assets = assetLedgerGroups().flatMap((group) => group.assets.filter((asset) => assetKind(asset) === "资产"));
  const total = assets.length;
  const using = assets.filter((asset) => asset.status === "checked_out").length;
  const available = assets.filter((asset) => asset.status === "in_stock").length;
  const repairing = assets.filter((asset) => asset.status === "repair").length;
  const retired = assets.filter((asset) => asset.status === "retired").length;
  return `
    <div class="asset-status-summary no-print">
      ${assetStatusCard("资产总数", total, "所有资产明细数量", "total")}
      ${assetStatusCard("使用中", using, "当前出库/出借数量", "using")}
      ${assetStatusCard("在库可用", available, "当前在库资产数量", "available")}
      ${assetStatusCard("维修中", repairing, "维修或处理中资产", "repair")}
      ${assetStatusCard("已报废", retired, "已报废资产数量", "retired")}
    </div>
  `;
}

function renderAssetCategoryPanel() {
  const categories = [...new Set([
    ...state.assets.map((asset) => assetKind(asset)),
    ...state.assets.map((asset) => asset.category),
    ...assetCategories()
  ].filter(Boolean))].slice(0, 28);
  return `
    <div class="asset-filter-popover">
      <div class="asset-filter-popover-actions">
        <button data-asset-category-all type="button">全选</button>
        <button data-asset-category-clear type="button">清空筛选</button>
      </div>
      <div class="asset-category-options">
        ${categories.map((category) => `
          <label class="asset-category-option">
            <input data-asset-category-option="${category}" type="checkbox" ${assetCategoryFilters.includes(category) ? "checked" : ""} />
            <span>${displayCategoryText(category)}</span>
          </label>
        `).join("")}
      </div>
      <div class="asset-filter-popover-footer">
        <button class="ghost" data-asset-category-reset type="button">重置</button>
        <button class="primary" data-asset-category-apply type="button">应用</button>
      </div>
    </div>
  `;
}

function renderAssetPagination(total, totalPages, position) {
  if (!total) return `<span class="asset-pagination empty-page">共 0 条</span>`;
  const pages = [];
  const addPage = (page) => {
    if (page >= 1 && page <= totalPages && !pages.includes(page)) pages.push(page);
  };
  addPage(1);
  addPage(assetPage - 1);
  addPage(assetPage);
  addPage(assetPage + 1);
  addPage(totalPages);
  pages.sort((a, b) => a - b);
  return `
    <div class="asset-pagination ${position}">
      <span>共 ${total} 条</span>
      <select id="${position}AssetPageSize">
        ${[10, 20, 50].map((size) => `<option value="${size}" ${assetPageSize === size ? "selected" : ""}>${size}条/页</option>`).join("")}
      </select>
      <button data-asset-page="${assetPage - 1}" ${assetPage <= 1 ? "disabled" : ""} type="button">‹</button>
      ${pages.map((page, index) => `${index && page - pages[index - 1] > 1 ? `<span>...</span>` : ""}<button class="${assetPage === page ? "active" : ""}" data-asset-page="${page}" type="button">${page}</button>`).join("")}
      <button data-asset-page="${assetPage + 1}" ${assetPage >= totalPages ? "disabled" : ""} type="button">›</button>
      <label class="asset-page-jump">前往 <input id="${position}AssetPageJump" type="number" min="1" max="${totalPages}" value="${assetPage}" /> 页</label>
    </div>
  `;
}

function assetStatusCard(label, value, note, tone) {
  return `
    <article class="asset-status-card ${tone}">
      <span class="asset-status-icon">${label.slice(0, 1)}</span>
      <div>
        <strong>${label}</strong>
        <b>${value}<em> 台/件</em></b>
        <small>${note}</small>
      </div>
    </article>
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

function assetLookupText(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw, window.location.origin);
    const assetParam = url.searchParams.get("asset");
    if (assetParam) return assetParam.trim();
  } catch {
    // Plain asset names or codes are handled below.
  }
  return raw;
}

function resolveInventoryAsset(value) {
  const query = assetLookupText(value);
  if (!query) return null;
  const normalized = query.toLowerCase();
  const consumables = state.assets.filter((asset) => assetKind(asset) === "耗材");
  return resolveAssetLookup(query, consumables);
}

function assetSearchParts(asset) {
  return [
    asset.id,
    asset.code,
    asset.name,
    asset.spec,
    asset.category,
    asset.brand,
    asset.location,
    asset.department,
    asset.useDepartment,
    asset.supplier
  ].map((part) => String(part || "").trim()).filter(Boolean);
}

function resolveAssetLookup(value, candidates = state.assets) {
  const query = assetLookupText(value);
  if (!query) return null;
  const normalized = query.toLowerCase();
  return candidates.find((asset) => asset.id === query || asset.code === query)
    || candidates.find((asset) => assetSearchParts(asset).some((part) => part.toLowerCase() === normalized))
    || candidates.find((asset) => assetSearchParts(asset).some((part) => part.toLowerCase().includes(normalized)));
}

function resolveRecordAsset(value) {
  const query = assetLookupText(value);
  if (!query) return null;
  const normalized = query.toLowerCase();
  const group = assetGroups().find((item) => item.id === query || item.key === normalized || item.model.toLowerCase() === normalized)
    || assetGroups().find((item) => [item.name, item.spec, item.model, item.category].some((part) => String(part || "").toLowerCase().includes(normalized)));
  return group?.assets?.[0] || resolveAssetLookup(query);
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

function inventoryAvailabilityBadge(asset) {
  if (asset.status === "retired") return `<span class="badge bad">停用</span>`;
  if (asset.status === "repair") return `<span class="badge warn">维修中</span>`;
  return stockLevelText(asset);
}

function renderInventoryStatusTable(items) {
  return `
    <div class="table-wrap inventory-table-wrap">
      <table>
        <thead><tr><th>耗材</th><th>类别</th><th>规格</th><th>库存数量</th><th>库存状态</th><th>最近流水</th>${can("inventory.manage") ? "<th>操作</th>" : ""}</tr></thead>
        <tbody>
          ${items.map((asset) => `
            <tr>
              <td><strong>${asset.name}</strong><div class="mini-meta">${asset.code}</div></td>
              <td>${blank(asset.category)}</td>
              <td>${blank(asset.spec)}</td>
              <td>${Number(asset.quantity || 0)} ${blank(asset.unit || "件")}</td>
              <td>${inventoryAvailabilityBadge(asset)}</td>
              <td class="mini-meta">${inventoryLatestFlowText(asset)}</td>
              ${can("inventory.manage") ? `<td><span class="mini-meta">按库存流水管理</span></td>` : ""}
            </tr>
          `).join("") || `<tr><td colspan="${can("inventory.manage") ? 7 : 6}" class="empty">${renderEmptyAction("还没有耗材库存", "先新增耗材入库，之后可在这里登记领用、退回和盘点修正。", [{ label: "新增入库", view: "records", mode: "manual", action: "inbound" }, { label: "电子档导入", view: "records", mode: "import" }])}</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function renderInventoryFlowTable(records, emptyText) {
  return `
    <div class="table-wrap inventory-table-wrap">
      <table>
        <thead><tr><th>时间</th><th>类型</th><th>耗材</th><th>数量</th><th>经办/领用人</th><th>单号</th><th>备注</th></tr></thead>
        <tbody>
          ${records.map((record) => `
            <tr>
              <td>${fmt(record.type === "入库" ? record.inTime : record.outTime)}</td>
              <td>${record.type}</td>
              <td>${assetName(record.assetId)}</td>
              <td>${record.quantity}</td>
              <td>${userName(record.userId)}</td>
              <td>${blank(record.paperNo)}</td>
              <td>${recordDisplayNote(record)}</td>
            </tr>
          `).join("") || emptyActionRow(7, emptyText, "先通过日常登记录入耗材入库、领用或退回，系统会在这里沉淀库存流水。", consumableEntryActions())}
        </tbody>
      </table>
    </div>
  `;
}

function renderInventoryUnifiedPanel(items, inboundRecords, outboundRecords, blockedItems, itemOptions) {
  const allRecords = [...inboundRecords, ...outboundRecords].sort((a, b) => recordMillis(b) - recordMillis(a));
  const views = [
    ["status", "耗材状态", items.length],
    ["inbound", "入库流水", inboundRecords.length],
    ["outbound", "出库流水", outboundRecords.length],
    ["all", "全部流水", allRecords.length],
    ["blocked", "异常耗材", blockedItems.length]
  ];
  const active = views.some(([key]) => key === inventoryView) ? inventoryView : "status";
  const content = {
    status: renderInventoryStatusTable(items),
    inbound: renderInventoryFlowTable(inboundRecords, "还没有入库流水"),
    outbound: renderInventoryFlowTable(outboundRecords, "还没有出库流水"),
    all: renderInventoryFlowTable(allRecords, "还没有出入库流水"),
    blocked: renderInventoryStatusTable(blockedItems)
  }[active];
  const hints = {
    status: "按耗材库存数量和安全库存显示当前状态。",
    inbound: "只显示入库、补录等增加方向的流水。",
    outbound: "只显示出库、领用等减少方向的流水。",
    all: "按时间倒序合并展示入库和出库流水。",
    blocked: "只显示维修中或已停用的耗材。"
  };
  return `
    <section class="panel inventory-unified-panel">
      <div class="section-title inventory-unified-title">
        <div>
          <h2>耗材库存与库存流水</h2>
          <span class="hint">${hints[active]}</span>
        </div>
        <div class="inventory-view-tabs" role="tablist" aria-label="库存视图">
          ${views.map(([key, label, count]) => `<button class="${active === key ? "active" : ""}" data-inventory-view="${key}" type="button">${label}<span>${count}</span></button>`).join("")}
        </div>
      </div>
      ${renderInventoryAdjustForm(itemOptions)}
      ${content}
    </section>
  `;
}

function latestInventoryRecord(assetId) {
  return state.records
    .filter((record) => record.assetId === assetId)
    .sort((a, b) => recordMillis(b) - recordMillis(a))[0];
}

function inventoryLatestFlowText(asset) {
  const record = latestInventoryRecord(asset.id);
  if (!record) return "-";
  return `${record.type === "出库" ? "出库/领用" : "入库/补录"} · ${fmt(recordTime(record))} · ${userName(record.userId)} · 数量 ${record.quantity || "-"}`;
}

function renderInventoryAdjustForm(itemOptions) {
  if (!can("inventory.manage")) return "";
  return `
    <div class="inventory-adjust-panel inventory-inline-adjust">
      <div class="section-title"><h3>耗材流水登记</h3><span class="hint">数量只记录本次入库/领用流水。</span></div>
      <form id="inventoryAdjustForm" class="inventory-adjust-form">
        <div class="inventory-source-block">
          <h3>登记方式</h3>
          <div class="source-toggle large">
            ${[
              ["manual", "手动登记"],
              ["link", "扫码/链接"]
            ].map(([key, label]) => `<button class="${inventoryAdjustSource === key ? "active" : ""}" data-inventory-source="${key}" type="button">${label}</button>`).join("")}
          </div>
        </div>
        <div class="form-grid">
          <div class="field wide">
            <label>${inventoryAdjustSource === "link" ? "链接 / 二维码内容 / 资产编号" : "耗材名称 / 编号 / 规格"}</label>
            <input name="assetLookup" list="inventoryAssetOptions" required placeholder="${inventoryAdjustSource === "link" ? "粘贴资产详情链接、二维码内容或资产编号" : "输入耗材名称、编号或规格，系统自动匹配"}" />
            <datalist id="inventoryAssetOptions">${itemOptions}</datalist>
            <p class="hint">${inventoryAdjustSource === "link" ? "支持资产详情 URL、二维码内容、资产编号。" : "不用滚动选择，输入关键字后直接匹配耗材。"}</p>
          </div>
          <div class="field"><label>流水类型</label><select name="mode"><option value="increase">入库</option><option value="decrease">领用</option><option value="increase">退回</option><option value="increase">盘点修正增加</option><option value="decrease">盘点修正减少</option></select></div>
          <div class="field"><label>数量</label><input name="quantity" type="number" min="1" value="1" required /></div>
          <div class="field"><label>经办/领用人</label><select name="userId">${selectableUsers().map((user) => `<option value="${user.id}">${user.name}${isMultiDepartment() ? ` · ${user.department}` : ""}</option>`).join("")}</select></div>
          <div class="field"><label>单号</label><input name="paperNo" placeholder="可选" /></div>
          <div class="field"><label>原因</label><input name="reason" placeholder="入库 / 领用 / 退回 / 盘点修正" /></div>
          <div class="actions form-grid wide"><button class="primary" type="submit">保存流水</button></div>
        </div>
      </form>
    </div>
  `;
}

function renderInventory() {
  const items = inventoryItems();
  const blockedItems = items.filter((asset) => asset.status === "retired" || asset.status === "repair");
  const inboundRecords = inventoryRecords("入库");
  const outboundRecords = inventoryRecords("出库");
  const normalCount = items.length - blockedItems.length;
  const flowCount = inboundRecords.length + outboundRecords.length;
  const itemOptions = items.map((asset) => `<option value="${asset.code}">${asset.name}${asset.spec ? ` · ${asset.spec}` : ""} · ${asset.code}</option>`).join("");
  return `
    <section class="asset-workspace">
      <div class="asset-filter-bar no-print">
        <input id="inventorySearch" placeholder="搜索耗材名称 / 类别 / 规格 / 流水备注" value="${inventoryFilter}" />
        <button class="secondary" id="clearInventorySearch" type="button">重置</button>
      </div>
      <div class="stats">
        <div class="stat"><span>耗材种类</span><strong>${items.length}</strong><em>当前纳入库存管理</em></div>
        <div class="stat"><span>正常库存</span><strong>${normalCount}</strong><em>未维修/停用</em></div>
        <div class="stat"><span>异常耗材</span><strong>${blockedItems.length}</strong><em>维修中或已停用</em></div>
        <div class="stat"><span>流水记录</span><strong>${flowCount}</strong><em>入库 + 出库</em></div>
      </div>
      ${renderInventoryUnifiedPanel(items, inboundRecords, outboundRecords, blockedItems, itemOptions)}
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

function currentCheckTask() {
  const tasks = state.inventoryCheckTasks || [];
  const selected = tasks.find((task) => task.id === selectedCheckTaskId);
  if (selected) return selected;
  const active = tasks.find((task) => task.status !== "已完成") || tasks[0] || null;
  selectedCheckTaskId = active?.id || "";
  return active;
}

function checkAsset(item) {
  return state.assets.find((asset) => asset.id === item.assetId) || {};
}

function checkGroupKeyFromValues(category, name, spec) {
  return [
    "check",
    ledgerField(category, "未分类"),
    ledgerField(name, "未命名资产"),
    ledgerField(spec, "未填写规格")
  ].join("|||");
}

function checkGroupKeyForItem(item) {
  const asset = checkAsset(item);
  return checkGroupKeyFromValues(asset.category, asset.name, asset.spec);
}

function checkGroupKeyForAsset(asset) {
  return checkGroupKeyFromValues(asset.category, asset.name, asset.spec);
}

function emptyCheckGroup(key, asset) {
  return {
    key,
    category: displayCategoryText(ledgerField(asset.category, "未分类")),
    name: ledgerField(asset.name, "未命名资产"),
    spec: ledgerField(asset.spec, "未填写规格"),
    locationSummary: "-",
    departmentSummary: "-",
    items: [],
    assets: [],
    statusCounts: {},
    checked: 0,
    abnormal: 0,
    total: 0
  };
}

function buildCheckGroupsFromItems(items) {
  const groups = new Map();
  for (const item of items) {
    const asset = checkAsset(item);
    const key = checkGroupKeyForItem(item);
    if (!groups.has(key)) groups.set(key, emptyCheckGroup(key, asset));
    const group = groups.get(key);
    const status = item.systemStatus || asset.status || "in_stock";
    group.items.push(item);
    group.assets.push(asset);
    group.statusCounts[status] = (group.statusCounts[status] || 0) + 1;
    group.total += 1;
    if (item.checked) group.checked += 1;
    if (item.diffType && item.diffType !== "正常" && item.diffType !== "未盘点") group.abnormal += 1;
  }
  return finalizeCheckGroups(groups);
}

function buildCheckGroupsFromAssets(assets) {
  const groups = new Map();
  for (const asset of assets) {
    const key = checkGroupKeyForAsset(asset);
    if (!groups.has(key)) groups.set(key, emptyCheckGroup(key, asset));
    const group = groups.get(key);
    const status = asset.status || "in_stock";
    const item = {
      id: asset.id,
      taskId: "",
      assetId: asset.id,
      systemLocation: asset.location || "",
      actualLocation: "",
      systemStatus: status,
      actualStatus: "",
      systemKeeperId: asset.keeperId || asset.useUserId || "",
      actualKeeperId: "",
      checked: 0,
      diffType: "未盘点",
      remark: "",
      previewOnly: true
    };
    group.items.push(item);
    group.assets.push(asset);
    group.statusCounts[status] = (group.statusCounts[status] || 0) + 1;
    group.total += 1;
  }
  return finalizeCheckGroups(groups);
}

function finalizeCheckGroups(groups) {
  return [...groups.values()].map((group) => ({
    ...group,
    locationSummary: summarizeValues(group.items, (item) => item.systemLocation || checkAsset(item).location, 3),
    departmentSummary: summarizeValues(group.assets, (asset) => asset.useDepartment, 2)
  })).sort(compareCheckGroups);
}

function compareCheckGroups(left, right) {
  return left.category.localeCompare(right.category, "zh-Hans-CN", { numeric: true, sensitivity: "base" })
    || left.name.localeCompare(right.name, "zh-Hans-CN", { numeric: true, sensitivity: "base" })
    || left.spec.localeCompare(right.spec, "zh-Hans-CN", { numeric: true, sensitivity: "base" });
}

function checkGroupsForActiveTask(activeTask) {
  if (activeTask) return buildCheckGroupsFromItems(checkTaskItems(activeTask.id));
  return buildCheckGroupsFromAssets(state.assets.filter((asset) => assetKind(asset) === "资产"));
}

function resolveSelectedCheckGroup(groups) {
  const selected = groups.find((group) => group.key === selectedCheckGroupKey) || groups[0] || null;
  selectedCheckGroupKey = selected?.key || "";
  return selected;
}

function firstPendingCheckItem(group) {
  return group?.items.find((item) => !item.checked) || group?.items[0] || null;
}

function resolveActiveCheckItem(group) {
  if (!group) {
    activeCheckItemId = "";
    return null;
  }
  const selected = group.items.find((item) => item.id === activeCheckItemId) || firstPendingCheckItem(group);
  activeCheckItemId = selected?.id || "";
  return selected || null;
}

function selectNextCheckItem(currentItemId) {
  const activeTask = currentCheckTask();
  const groups = activeTask ? buildCheckGroupsFromItems(checkTaskItems(activeTask.id)) : [];
  const flat = groups.flatMap((group) => group.items.map((item) => ({ item, groupKey: group.key })));
  if (!flat.length) {
    selectedCheckGroupKey = "";
    activeCheckItemId = "";
    return;
  }
  const currentIndex = flat.findIndex((entry) => entry.item.id === currentItemId);
  const nextPoolStart = currentIndex >= 0 ? currentIndex + 1 : 0;
  const next = flat.slice(nextPoolStart).find((entry) => !entry.item.checked)
    || flat.slice(0, nextPoolStart).find((entry) => !entry.item.checked)
    || flat[currentIndex + 1]
    || flat[currentIndex]
    || flat[0];
  selectedCheckGroupKey = next?.groupKey || "";
  activeCheckItemId = next?.item.id || "";
}

function checkStatusSummary(statusCounts) {
  const order = ["checked_out", "repair", "retired", "in_stock"];
  const entries = [
    ...order.filter((status) => statusCounts[status]).map((status) => [status, statusCounts[status]]),
    ...Object.entries(statusCounts).filter(([status]) => !order.includes(status))
  ];
  return entries.map(([status, count]) => `<span class="ledger-status-chip ${ledgerStatusTone(status)}">${statusText(status)} ${count}</span>`).join("")
    || `<span class="ledger-status-chip muted">暂无状态</span>`;
}


function blankStatusOptions(selected = "") {
  return `<option value="" ${selected ? "" : "selected"}>留白</option>${statusSelectOptions(selected)}`;
}

function blankKeeperOptions(selected = "") {
  return `<option value="" ${selected ? "" : "selected"}>留白</option>${selectableUsers().map((user) => `<option value="${user.id}" ${selected === user.id ? "selected" : ""}>${user.name}${isMultiDepartment() ? ` · ${user.department}` : ""}</option>`).join("")}`;
}

function renderCheckProgress(activeTask, groups, selectedGroup, checked, total, abnormal) {
  return `
    <div class="check-progress">
      <div class="check-progress-card ${activeTask ? "done" : "active"}">
        <strong>盘点任务</strong>
        <em>${activeTask ? activeTask.checkNo : "从当前资产底账生成范围"}</em>
      </div>
      <div class="check-progress-card ${activeTask ? "active" : ""}">
        <strong>资产清单</strong>
        <em>${groups.length} 个分组 / ${total} 个资产编号</em>
      </div>
      <div class="check-progress-card ${selectedGroup ? "active" : ""}">
        <strong>资产说明</strong>
        <em>${selectedGroup ? `${selectedGroup.name} · ${selectedGroup.total} 个编号` : "选择一个分组查看编号"}</em>
      </div>
      <div class="check-progress-meter">
        <strong>${checked}/${total || 0}</strong>
        <span>已完成</span>
        <em>异常 ${abnormal}</em>
      </div>
    </div>
  `;
}

function renderCheckGroupPanel(groups, activeTask) {
  return `
    <section class="panel check-group-panel">
      <div class="section-title">
        <h2>盘点清单</h2>
        <span class="hint">${activeTask ? `当前任务 ${activeTask.checkNo}` : "依赖已导入学校资产 Excel 底账汇总"}</span>
      </div>
      <div class="table-wrap compact-table">
        <table>
          <thead><tr><th>资产分类</th><th>资产名称</th><th>规格型号</th><th>数量</th><th>状态汇总</th><th>位置汇总</th><th>操作</th></tr></thead>
          <tbody>
            ${groups.map((group) => `
              <tr class="${group.key === selectedCheckGroupKey ? "selected-row" : ""}">
                <td>${attrText(group.category)}</td>
                <td>
                  <button class="asset-ledger-name" data-check-group="${attrText(group.key)}" type="button">
                    <strong>${attrText(group.name)}</strong>
                    <span>${group.total} 个资产编号</span>
                  </button>
                </td>
                <td>${attrText(group.spec)}</td>
                <td>${group.total}</td>
                <td>
                  <div class="ledger-status-buttons">${checkStatusSummary(group.statusCounts)}</div>
                  <div class="mini-meta">已盘 ${group.checked}/${group.total}${group.abnormal ? ` · 异常 ${group.abnormal}` : ""}</div>
                </td>
                <td>${attrText(group.locationSummary)}<div class="mini-meta">${attrText(group.departmentSummary)}</div></td>
                <td><button class="${group.key === selectedCheckGroupKey ? "primary" : "secondary"} small" data-check-group="${attrText(group.key)}" type="button">查看编号</button></td>
              </tr>
            `).join("") || emptyActionRow(7, "还没有可盘点资产", "先导入学校资产 Excel 底表，盘点任务会从这份底账自动生成。", [{ label: "导入学校资产底表", view: "records", mode: "import" }])}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderCheckAssetInfoPanel(selectedGroup, activeItem, activeTask) {
  if (!selectedGroup) {
    return `
      <section class="panel check-asset-info-panel">
        <div class="section-title"><h2>资产说明</h2><span class="hint">请选择左侧资产</span></div>
        ${renderEmptyAction("还没有选中资产", "点击左侧盘点清单里的资产名称后，这里会显示该组所有资产编号。", [])}
      </section>
    `;
  }
  return `
    <section class="panel check-asset-info-panel">
      <div class="section-title">
        <h2>资产说明</h2>
        <span class="hint">${selectedGroup.total} 个资产编号</span>
      </div>
      <div class="check-asset-summary">
        <div><span>资产分类</span><strong>${attrText(selectedGroup.category)}</strong></div>
        <div><span>资产名称</span><strong>${attrText(selectedGroup.name)}</strong></div>
        <div><span>规格型号</span><strong>${attrText(selectedGroup.spec)}</strong></div>
        <div><span>位置汇总</span><strong>${attrText(selectedGroup.locationSummary)}</strong></div>
      </div>
      <div class="check-code-list">
        ${selectedGroup.items.map((item) => {
          const asset = checkAsset(item);
          const isActive = activeItem?.id === item.id;
          return `
            <button class="check-code-card ${isActive ? "active" : ""}" data-check-active-item="${item.id}" data-check-group="${attrText(selectedGroup.key)}" type="button">
              <strong>${attrText(asset.code || item.assetId || "-")}</strong>
              <span>${isActive ? `<span class="badge warn">当前</span>` : checkDiffBadge(item.diffType)}</span>
              <em>${attrText(item.systemLocation || asset.location || "")}</em>
            </button>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function renderCheckSidePanel(activeTask, tasks, checked, total, abnormal, selectedGroup, activeItem, locationOptionsHtml) {
  const taskRows = tasks.map((task) => {
    const taskItems = checkTaskItems(task.id);
    const taskChecked = taskItems.filter((item) => item.checked).length;
    const taskAbnormal = taskItems.filter((item) => item.diffType && item.diffType !== "正常" && item.diffType !== "未盘点").length;
    return `
      <button class="check-task-row ${activeTask?.id === task.id ? "active" : ""}" data-select-check-task="${task.id}" type="button">
        <span>${attrText(task.checkNo)}</span>
        <strong>${taskChecked}/${taskItems.length}</strong>
        <em>${requestStatusBadge(task.status)} 异常 ${taskAbnormal}</em>
      </button>
    `;
  }).join("");
  return `
    <aside class="check-side-panel no-print">
      ${renderCheckAssetInfoPanel(selectedGroup, activeItem, activeTask)}
      <section class="panel">
        <div class="section-title"><h2>任务概况</h2><span class="hint">${activeTask ? attrText(activeTask.checkNo) : "尚未生成任务"}</span></div>
        <div class="check-summary-grid">
          <div><span>底账资产</span><strong>${state.assets.filter((asset) => assetKind(asset) === "资产").length}</strong></div>
          <div><span>任务资产</span><strong>${total}</strong></div>
          <div><span>已盘点</span><strong>${checked}</strong></div>
          <div><span>异常</span><strong>${abnormal}</strong></div>
        </div>
        <p class="hint">保存当前资产编号后，系统会自动定位到下一个未盘点编号；没有填写的实际位置、状态、使用人会保持为空。</p>
        <div class="row-actions">
          ${activeTask && activeTask.status !== "已完成" && can("checks.manage") ? `<button class="secondary small" data-complete-check="${activeTask.id}" type="button">完成任务</button>` : ""}
          ${activeTask && can("reports.export") ? `<button class="ghost small" data-export-check="${activeTask.id}" type="button">导出报告</button>` : ""}
        </div>
      </section>
      <section class="panel">
        <div class="section-title"><h2>盘点任务</h2><span class="hint">共 ${tasks.length} 个</span></div>
        <div class="check-task-list">
          ${taskRows || renderEmptyAction("还没有盘点任务", "先从当前资产底账生成盘点任务，再逐组核对资产编号。", [{ label: "导入学校资产底表", view: "records", mode: "import" }])}
        </div>
      </section>
      ${activeTask && can("checks.manage") ? `
        <section class="panel">
          <div class="section-title"><h2>扫码 / 盘盈</h2><span class="hint">保留原有快速录入能力</span></div>
          <form id="checkScanForm" class="check-side-form">
            <input type="hidden" name="taskId" value="${activeTask.id}" />
            <label>扫码内容<input name="scanText" required placeholder="资产二维码内容或资产编号" /></label>
            <label>实际位置<select name="actualLocation"><option value="">留白</option>${locationOptionsHtml}</select></label>
            <label>实际状态<select name="actualStatus">${blankStatusOptions("")}</select></label>
            <label>实际责任人<select name="actualKeeperId">${blankKeeperOptions("")}</select></label>
            <label>备注<input name="remark" placeholder="扫码盘点" /></label>
            <div class="row-actions"><button class="primary small" type="submit">提交扫码</button><button class="secondary small" id="startCheckQrScanner" type="button">摄像头扫码</button></div>
          </form>
          <form id="checkSurplusForm" class="check-side-form">
            <input type="hidden" name="taskId" value="${activeTask.id}" />
            <label>盘盈资产名称<input name="name" required placeholder="现场发现但系统无记录的资产" /></label>
            <label>编号<input name="code" placeholder="留空自动生成" /></label>
            <label>分类<select name="category">${assetCategories().map((category) => `<option value="${category}">${category}</option>`).join("")}</select></label>
            <label>位置<select name="location">${locationOptionsHtml}</select></label>
            <label>责任人<select name="keeperId">${userOptions()}</select></label>
            <label>数量<input name="quantity" type="number" min="1" value="1" /></label>
            <label>备注<input name="remark" placeholder="盘盈说明" /></label>
            <button class="secondary small" type="submit">录入盘盈</button>
          </form>
        </section>
      ` : ""}
    </aside>
  `;
}

function renderInventoryChecks() {
  if (!can("checks.view")) return "";
  const tasks = state.inventoryCheckTasks || [];
  const activeTask = currentCheckTask();
  const locationOptionsHtml = locations().map((location) => `<option value="${location.name}">${location.name}</option>`).join("");
  const groups = checkGroupsForActiveTask(activeTask);
  const selectedGroup = resolveSelectedCheckGroup(groups);
  const activeItem = resolveActiveCheckItem(selectedGroup);
  const items = activeTask ? checkTaskItems(activeTask.id) : groups.flatMap((group) => group.items);
  const checked = items.filter((item) => item.checked).length;
  const abnormal = items.filter((item) => item.diffType && item.diffType !== "正常" && item.diffType !== "未盘点").length;
  return `
    <section class="check-workspace">
      ${renderCheckProgress(activeTask, groups, selectedGroup, checked, items.length, abnormal)}
      <div class="check-layout">
        <div class="check-main">
          ${renderCheckGroupPanel(groups, activeTask)}
        </div>
        ${renderCheckSidePanel(activeTask, tasks, checked, items.length, abnormal, selectedGroup, activeItem, locationOptionsHtml)}
      </div>
    </section>
  `;
}

function availableOrderAssets() {
  return state.assets.filter((asset) => asset.status !== "retired");
}

function orderAssetCandidates(kind = orderType) {
  const candidates = availableOrderAssets();
  if (["claim", "borrow"].includes(kind)) {
    return candidates.filter((asset) => asset.status !== "repair");
  }
  return candidates;
}

function resolveOrderAsset(value, kind = orderType) {
  return resolveAssetLookup(value, orderAssetCandidates(kind));
}

function orderAssetLookupField(kind) {
  const candidates = orderAssetCandidates(kind);
  const options = candidates
    .map((asset) => `<option value="${attrText(asset.code || asset.id)}" label="${attrText(`${asset.name}${asset.spec ? ` · ${asset.spec}` : ""} · ${statusText(asset.status)}`)}"></option>`)
    .join("");
  return `
    <input type="hidden" name="assetId" value="" />
    <div class="field wide order-asset-lookup" data-order-asset-kind="${kind}">
      <label>资产</label>
      <input name="assetLookup" list="orderAssetOptions-${kind}" required placeholder="输入资产名称、编号、规格，或粘贴扫码详情链接" autocomplete="off" />
      <datalist id="orderAssetOptions-${kind}">${options}</datalist>
      <p class="asset-lookup-hint">已排除不可办理的已报废资产，不用滚动长列表。</p>
    </div>
  `;
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
    ["stock-flow", "库存流水", "数量变动明细"],
    ["transfer", "调拨明细", "部门、位置和责任人流转"],
    ["repair", "维修明细", "维修过程和费用"],
    ["asset-flow", "资产流转日志", "台账状态变更轨迹"],
    ["scrap", "报废资产清单", "已报废资产"],
    ["consumable-status", "耗材状态异常清单", "维修中或已报废的耗材"]
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
          <div><strong>盘点差异报告</strong><p class="hint">${latestTask ? `最新任务 ${latestTask.checkNo}` : "还没有盘点任务"}</p></div>
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
        ${dashboardStatCard("耗材异常", inventoryItems().filter((asset) => ["repair", "retired"].includes(asset.status)).length, "维修/报废", "!")}
      </div>
    </section>
  `;
}

function renderOrderForm() {
  if (!orderAssetCandidates(orderType).length) {
    return renderEmptyAction("还没有可办理业务的资产", "先新增资产入库，资产进入台账后才能办理领用、借用、调拨、维修或报废。", recordEntryActions());
  }
  if (orderType === "claim") {
    return `
      <form id="claimOrderForm" class="form-grid">
        ${orderAssetLookupField("claim")}
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
        ${orderAssetLookupField("borrow")}
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
        ${orderAssetLookupField("transfer")}
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
        ${orderAssetLookupField("repair")}
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
      ${orderAssetLookupField("scrap")}
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
                <td>${can("orders.manage") && item.status === "借用中" ? `<button class="secondary small" data-return-borrow="${item.id}" type="button">归还验收</button>` : "-"}</td>
              </tr>
            `).join("") || emptyActionRow(9, "还没有领用或借用单", "通过上方业务办理创建领用单或借用单，后续归还验收会在这里处理。", [{ label: "创建借用单", view: "orders", orderType: "borrow" }, { label: "创建领用单", view: "orders", orderType: "claim" }])}
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
            ${orders.map((item) => `<tr><td>${item.orderNo}</td><td>${assetName(item.assetId)}</td><td>${blank(item.oldDepartment)} / ${blank(item.oldLocation)}</td><td>${blank(item.newDepartment)} / ${blank(item.newLocation)}</td><td>${userName(item.newKeeperId)}</td><td>${blank(item.reason)}</td><td>${requestStatusBadge(item.status)}</td></tr>`).join("") || emptyActionRow(7, "还没有调拨单", "资产跨部门、跨位置或责任人变更时，在业务办理中创建调拨单。", [{ label: "创建调拨单", view: "orders", orderType: "transfer" }, { label: "查看资产台账", view: "assets" }])}
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
            ${orders.map((item) => `<tr><td>${item.orderNo}</td><td>${assetName(item.assetId)}</td><td>${requestStatusBadge(item.status)}</td><td>${blank(item.repairer)}</td><td>${Number(item.cost || 0).toFixed(2)}</td><td>${blank(item.result || item.faultDesc)}</td><td>${can("orders.manage") && item.status !== "已完成" ? `<button class="secondary small" data-finish-repair="${item.id}" type="button">完成</button>` : "-"}</td></tr>`).join("") || emptyActionRow(7, "还没有维修单", "资产故障或保养时，在业务办理中创建维修单并保留维修过程。", [{ label: "创建维修单", view: "orders", orderType: "repair" }, { label: "查看资产台账", view: "assets" }])}
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
            ${orders.map((item) => `<tr><td>${item.orderNo}</td><td>${assetName(item.assetId)}</td><td>${userName(item.applicantId)}</td><td>${blank(item.scrapDate)}</td><td>${Number(item.residualValue || 0).toFixed(2)}</td><td>${requestStatusBadge(item.status)}</td><td>${blank(item.reason)}</td></tr>`).join("") || emptyActionRow(7, "还没有报废单", "资产达到报废条件时，在业务办理中创建报废单并留存处理原因。", [{ label: "创建报废单", view: "orders", orderType: "scrap" }, { label: "查看资产台账", view: "assets" }])}
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
        <h2>设备归类管理</h2>
        <span class="hint">可勾选多个设备组保存为同一标准归类；未手动指定的设备仍按系统规则自动归类。</span>
      </div>
      ${renderDeviceGroupOverview(assetGroups())}
    </section>
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
        }).join("") || emptyActionRow(6, "还没有资产分类", "先创建分类，后续资产入库、批量归类和报表统计都会使用这套分类。", [{ label: "创建分类", view: "system", systemSection: "baseData" }, { label: "新增入库", view: "records", mode: "manual", action: "inbound" }])}
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
            }).join("") || emptyActionRow(8, "还没有位置数据", "先创建仓库、楼栋、教室或办公室位置，资产入库和调拨时就能直接选择。", [{ label: "创建位置", view: "system", systemSection: "baseData" }, { label: "新增入库", view: "records", mode: "manual", action: "inbound" }])}
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
    <aside class="asset-drawer resizable-drawer no-print" ${drawerWidthStyle("asset-form", 520)} aria-label="${isEdit ? "编辑资产" : "新增资产"}">
      ${renderDrawerResizeHandle("拖动调整资产表单宽度")}
      <form id="assetForm">
        <input type="hidden" name="assetId" value="${asset.id || ""}" />
        <div class="drawer-head">
          <h2>${isEdit ? "编辑资产" : "新增资产"}</h2>
          <button class="ghost icon-button" id="closeAssetDrawer" type="button">×</button>
        </div>
        <div class="drawer-body">
          <input type="hidden" name="image" value="${asset.image || ""}" />
          <div class="field"><label>资产编号</label><input name="code" value="${asset.code || ""}" placeholder="自动生成" /></div>
          <div class="field"><label><b>*</b> 资产名称</label><input name="name" required value="${asset.name || ""}" placeholder="请输入资产名称" /></div>
          <div class="field wide">
            <label>资产图片</label>
            <label class="photo-upload asset-image-upload ${asset.image ? "has-image" : ""}" ${asset.image ? `style="background-image:url('${String(asset.image).replaceAll("'", "%27")}')"` : ""}>
              <input name="imageFile" type="file" accept="image/*" />
              <span>${asset.image ? "" : "☁"}</span>
              <strong>${asset.image ? "点击更换资产图片" : "点击上传资产图片"}</strong>
              <em id="assetImageFileName">支持 JPG、PNG、WebP，自动压缩</em>
            </label>
            ${asset.image ? `<label class="check-line"><input name="removeImage" type="checkbox" /><span>移除当前图片</span></label>` : ""}
          </div>
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
        <span>分类：${displayCategoryText(asset.category)}</span>
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
    <aside class="asset-drawer asset-detail-drawer resizable-drawer no-print" ${drawerWidthStyle("asset-detail", 720)} aria-label="资产详情">
      ${renderDrawerResizeHandle("拖动调整资产详情宽度")}
      <div class="drawer-head">
        <h2>资产详情</h2>
        <button class="ghost icon-button" id="closeAssetDetail" type="button">×</button>
      </div>
      <div class="drawer-body">
        <section class="detail-hero">
          ${assetVisual(asset, "large")}
          <div>
            <span class="hint">${asset.code}</span>
            <h3>${asset.name}</h3>
            <p>${asset.spec || "未填写规格"} · ${displayCategoryText(asset.category)}</p>
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
            `).join("") || emptyActionRow(isMultiDepartment() ? 13 : 12, "还没有出入库流水", "新增入库、划一笔出借、归还登记和耗材领用都会保留完整流水。", recordKindFilter === "耗材" ? consumableEntryActions() : recordEntryActions())}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderRecordModePanel() {
  return `
    <section class="record-mode-panel">
      <div class="mode-tabs record-tabs" role="tablist" aria-label="出入库管理方式">
        <button class="${recordMode === "manual" ? "active" : ""}" data-record-mode="manual" type="button">日常登记</button>
        <button class="${recordMode === "import" ? "active" : ""}" data-record-mode="import" type="button">电子档导入</button>
      </div>
      ${recordMode === "manual" ? renderRecordFormInner() : renderImportPanelInner()}
    </section>
  `;
}

function renderImportPanelInner() {
  const config = importConfig();
  const result = activeImportResult();
  return `
      <section class="record-import-shell">
        <form id="bulkImportForm" class="import-flow import-board">
          <div class="import-progress">
            ${[
              ["1", "上传文件", "选择或拖拽文件上传"],
              ["2", "预览与校验", "校验数据并预览结果"],
              ["3", "确认导入", "确认无误后完成导入"]
            ].map(([index, title, desc], stepIndex) => `
              <div class="import-progress-step ${stepIndex === 0 ? "active" : ""}">
                <span>${index}</span>
                <div><strong>${title}</strong><em>${desc}</em></div>
              </div>
            `).join("")}
          </div>
          <div class="record-import-grid">
            <section class="import-upload-panel">
              <div class="import-panel-title">
                <div><span class="panel-title-icon">▧</span><h3>上传文件</h3></div>
                <em>${attrText(config.shortLabel)}</em>
              </div>
              <div class="import-kind-grid compact-import-kind-grid" aria-label="导入文件类型">
                ${importKindOptions().map((item) => `
                  <button class="kind-card ${importKind === item.key ? "active" : ""}" data-import-kind="${item.key}" type="button">
                    <b>${item.icon}</b>
                    <span><strong>${item.label}</strong><em>${item.desc}</em></span>
                  </button>
                `).join("")}
              </div>
              <input id="bulkFileInput" name="file" class="visually-hidden" type="file" accept="${config.accept}" multiple />
              <input id="bulkFolderInput" name="folder" class="visually-hidden" type="file" accept="${config.accept}" multiple webkitdirectory directory />
              <div class="upload-zone" data-upload-zone>
                <div class="upload-icon">⇧</div>
                <strong>将文件拖拽到此处，或点击<span>选择文件</span></strong>
                <p>${attrText(config.uploadHint)}</p>
                <div class="upload-actions">
                  <label class="primary" for="bulkFileInput">▣ 选择文件</label>
                  <label class="secondary" for="bulkFolderInput">▢ 选择文件夹</label>
                </div>
              </div>
              <div class="selected-files" id="selectedImportFiles">
                <span class="hint">尚未选择文件</span>
              </div>
              <div class="import-template-actions">
                <span>快速下载模板</span>
                <button class="secondary small" id="downloadInboundTemplate" data-template-format="csv" type="button">Excel / CSV 模板下载</button>
              </div>
              <div class="import-submit-row">
                <span class="hint">${attrText(config.description)}</span>
                <button class="primary" type="submit">${attrText(config.button)}</button>
              </div>
            </section>
            ${renderImportPreviewPanel(result)}
          </div>
        </form>
        <div class="record-import-info-grid">
          ${renderImportGuideCard()}
          ${renderPaperDigitalCard()}
        </div>
      </section>
      ${result ? renderImportResult(`${config.resultTitle}结果`, result) : ""}
      ${renderImportArchives()}
  `;
}

function importKindOptions() {
  return [
    { key: "inbound", icon: "1", label: "学校资产底表", desc: "资产/耗材建账入库" },
    { key: "personAsset", icon: "2", label: "人员资产使用表", desc: "按资产编号绑定人员" },
    { key: "personConsumable", icon: "3", label: "人员耗材领用表", desc: "按耗材库存扣减" },
    { key: "word", icon: "4", label: "Word 出借单", desc: "纸质单据电子化" }
  ];
}

function importKindLabel(kind = importKind) {
  return importKindOptions().find((item) => item.key === kind)?.label || "电子档导入";
}

function activeImportResult() {
  return importKind === "word" ? wordImportResult : importResult;
}

function importPreviewMetrics(result = activeImportResult()) {
  if (result) {
    const skipped = result.skipped || [];
    const recognized = Math.max(importProcessedCount(result) + skipped.length, Number(result.processedRows || 0));
    const abnormal = skipped.length + Number(result.duplicateRows || 0) + Number(result.duplicateFiles || 0);
    return {
      recognized,
      abnormal,
      importable: Math.max(0, recognized - abnormal)
    };
  }
  if (importKind === "personAsset") {
    const rows = state.records.filter((record) => recordKind(record) === "资产" && record.type === "出库");
    return { recognized: rows.length, abnormal: 0, importable: rows.length };
  }
  if (importKind === "personConsumable") {
    const rows = state.records.filter((record) => recordKind(record) === "耗材" && record.type === "出库");
    return { recognized: rows.length, abnormal: 0, importable: rows.length };
  }
  if (importKind === "word") {
    const rows = (state.importArchives || []).filter((item) => String(item.category || "").includes("Word"));
    return { recognized: rows.length, abnormal: (state.paperQueue || []).length, importable: rows.length };
  }
  return { recognized: state.assets.length, abnormal: 0, importable: state.assets.length };
}

function renderImportPreviewPanel(result) {
  const metrics = importPreviewMetrics(result);
  return `
    <section class="import-preview-panel">
      <div class="import-panel-title">
        <div><span class="panel-title-icon">☷</span><h3>预览与校验</h3></div>
        <div class="row-actions">
          <button class="secondary small" data-import-recheck type="button">⟳ 重新校验</button>
          <button class="secondary small" data-import-rules type="button">查看校验规则</button>
        </div>
      </div>
      <div class="import-preview-metrics">
        <div class="ok"><span>识别记录数</span><strong>${metrics.recognized}</strong><em>条</em></div>
        <div class="warn"><span>异常项</span><strong>${metrics.abnormal}</strong><em>条</em></div>
        <div class="info"><span>可导入</span><strong>${metrics.importable}</strong><em>条</em></div>
      </div>
      <div class="table-wrap compact-table import-preview-table">
        <table>
          <thead>${renderImportPreviewHeader()}</thead>
          <tbody>${renderImportPreviewRows(result)}</tbody>
        </table>
      </div>
      <div class="import-preview-foot">
        <button class="download-link" data-empty-action="${attrText(JSON.stringify({ view: "reports", reportType: "ledger" }))}" type="button">查看全部预览数据（${metrics.recognized}条）</button>
        <span><i class="dot ok"></i>通过 <i class="dot warn"></i>异常 <i class="dot bad"></i>错误</span>
      </div>
    </section>
  `;
}

function renderImportPreviewHeader() {
  if (activeImportResult()?.files?.length) {
    return `<tr><th>序号</th><th>文件名称</th><th>导入类型</th><th>识别记录</th><th>异常</th><th>成功导入</th><th>校验结果</th></tr>`;
  }
  if (importKind === "personConsumable") {
    return `<tr><th>序号</th><th>耗材名称</th><th>规格型号</th><th>数量</th><th>使用人</th><th>领用时间</th><th>校验结果</th></tr>`;
  }
  if (importKind === "word") {
    return `<tr><th>序号</th><th>文件名称</th><th>单据类型</th><th>识别记录</th><th>异常</th><th>上传时间</th><th>校验结果</th></tr>`;
  }
  return `<tr><th>序号</th><th>资产编号</th><th>资产名称</th><th>类别</th><th>数量</th><th>使用人</th><th>入库时间</th><th>校验结果</th></tr>`;
}

function renderImportPreviewRows(result) {
  if (result?.files?.length) {
    return result.files.slice(0, IMPORT_PREVIEW_ROW_LIMIT).map((item, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${attrText(item.fileName)}</td>
        <td>${attrText(importKindLabel())}</td>
        <td>${importProcessedCount(item)}</td>
        <td>${Number(item.skipped || 0)}</td>
        <td>${Number(item.imported || 0)}</td>
        <td>${renderImportCheckBadge(Number(item.skipped || 0), item.error)}</td>
      </tr>
    `).join("");
  }
  if (importKind === "personConsumable") {
    const records = state.records.filter((record) => recordKind(record) === "耗材" && record.type === "出库").slice(0, IMPORT_PREVIEW_ROW_LIMIT);
    return records.map((record, index) => {
      const asset = state.assets.find((item) => item.id === record.assetId);
      return `
        <tr>
          <td>${index + 1}</td>
          <td>${attrText(asset?.name || assetName(record.assetId))}</td>
          <td>${attrText(blank(asset?.spec))}</td>
          <td>${Number(record.quantity || 0)}</td>
          <td>${attrText(userName(record.userId))}</td>
          <td>${attrText(fmt(record.outTime || record.inTime))}</td>
          <td>${renderImportCheckBadge(0)}</td>
        </tr>
      `;
    }).join("") || emptyImportPreviewRow(7, "上传人员耗材领用表后，将在这里预览扣库结果。");
  }
  if (importKind === "word") {
    const archives = (state.importArchives || []).filter((item) => String(item.category || "").includes("Word")).slice(0, IMPORT_PREVIEW_ROW_LIMIT);
    return archives.map((item, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${attrText(item.fileName)}</td>
        <td>${attrText(item.category || "Word 单据")}</td>
        <td>${importProcessedCount(item.result || {})}</td>
        <td>${Number((item.result?.skipped || []).length || 0)}</td>
        <td>${attrText(fmt(item.uploadedAt))}</td>
        <td>${renderImportCheckBadge(Number((item.result?.skipped || []).length || 0))}</td>
      </tr>
    `).join("") || emptyImportPreviewRow(7, "上传 Word 出借单后，将在这里预览识别结果。");
  }
  if (importKind === "personAsset") {
    const records = state.records.filter((record) => recordKind(record) === "资产" && record.type === "出库").slice(0, IMPORT_PREVIEW_ROW_LIMIT);
    return records.map((record, index) => {
      const asset = state.assets.find((item) => item.id === record.assetId);
      return `
        <tr>
          <td>${index + 1}</td>
          <td>${attrText(asset?.code || record.assetId)}</td>
          <td>${attrText(asset?.name || assetName(record.assetId))}</td>
          <td>${attrText(displayCategoryText(asset?.category || "-"))}</td>
          <td>${Number(record.quantity || 1)}</td>
          <td>${attrText(userName(record.userId))}</td>
          <td>${attrText(fmt(record.outTime || record.inTime))}</td>
          <td>${renderImportCheckBadge(0)}</td>
        </tr>
      `;
    }).join("") || emptyImportPreviewRow(8, "上传人员资产使用表后，将在这里预览人员绑定结果。");
  }
  const assets = state.assets.slice(0, IMPORT_PREVIEW_ROW_LIMIT);
  return assets.map((asset, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${attrText(asset.code || asset.id)}</td>
      <td>${attrText(asset.name || "-")}</td>
      <td>${attrText(displayCategoryText(asset.category || "-"))}</td>
      <td>${Number(asset.quantity || 1)}</td>
      <td>${attrText(assetCurrentUserName(asset))}</td>
      <td>${attrText(fmt(asset.inboundDate || asset.purchaseDate))}</td>
      <td>${renderImportCheckBadge(0)}</td>
    </tr>
  `).join("") || emptyImportPreviewRow(8, "上传学校资产底表后，将在这里预览资产和耗材建账结果。");
}

function emptyImportPreviewRow(colspan, text) {
  return `<tr><td colspan="${colspan}" class="empty">${attrText(text)}</td></tr>`;
}

function renderImportCheckBadge(abnormal = 0, error = "") {
  if (error) return `<span class="import-check-badge bad">错误</span>`;
  if (Number(abnormal || 0) > 0) return `<span class="import-check-badge warn">异常</span>`;
  return `<span class="import-check-badge ok">通过</span>`;
}

function renderImportGuideCard() {
  return `
    <section class="import-guide-card">
      <div class="guide-title"><span>i</span><h3>导入说明</h3></div>
      <ul>
        <li>请先下载导入模板，按模板格式准备数据后上传。</li>
        <li>学校资产底表用于建账；人员资产表只绑定已有资产编号，不新增重复资产。</li>
        <li>人员耗材领用表会按耗材名称和规格匹配库存，库存不足时标记异常。</li>
        <li>系统会校验必填项、格式、重复文件和重复行，校验通过后再写入底账和流水。</li>
      </ul>
    </section>
  `;
}

function renderPaperDigitalCard() {
  return `
    <section class="paper-digital-card">
      <div class="guide-title"><span>▤</span><h3>纸质单据电子化</h3></div>
      <p>支持纸质出借单、耗材领用单通过 Word 模板或扫描件进入电子档导入，自动识别后生成流水，减少手工录入错误。</p>
      <button class="secondary" data-import-kind="word" type="button">前往扫描识别</button>
    </section>
  `;
}

function importProcessedCount(result = {}) {
  const explicit = Number(result.processedRows || result.processed || 0);
  if (explicit) return explicit;
  const imported = Number(result.imported || 0);
  const created = Number(result.createdAssets || 0);
  const existing = Number(result.existingAssets || 0);
  const updated = Number(result.updatedAssets || 0);
  return Math.max(imported, created) + Math.max(existing, updated);
}

function renderImportResult(title, result) {
  const skipped = result.skipped || [];
  const files = result.files || [];
  const metrics = [
    ["处理合计", importProcessedCount(result)],
    ["生成流水", result.imported],
    ["新建资产", result.createdAssets],
    ["已存在", result.existingAssets],
    ["已更新", result.updatedAssets],
    ["重复行", result.duplicateRows],
    ["重复文件", result.duplicateFiles],
    ["待复核", result.paperCreated],
    ["错误/异常", skipped.length]
  ];
  return `
    <div class="import-result">
      <div class="import-result-head">
        <strong>${attrText(title)}</strong>
        <span>${attrText(importResultSummary(result))}</span>
      </div>
      <div class="import-result-metrics">
        ${metrics.map(([label, value]) => `<div><span>${label}</span><strong>${Number(value || 0)}</strong></div>`).join("")}
      </div>
      ${result.message ? `<p class="hint">${attrText(result.message)}</p>` : ""}
      ${files.length ? `
        <div class="table-wrap">
          <table>
            <thead><tr><th>文件</th><th>处理合计</th><th>生成流水</th><th>新建资产</th><th>已存在</th><th>已更新</th><th>重复行</th><th>重复文件</th><th>待复核</th><th>错误 / 异常</th></tr></thead>
            <tbody>${files.map((item) => `<tr>
              <td>${attrText(item.fileName)}</td>
              <td>${importProcessedCount(item)}</td>
              <td>${Number(item.imported || 0)}</td>
              <td>${Number(item.createdAssets || 0)}</td>
              <td>${Number(item.existingAssets || 0)}</td>
              <td>${Number(item.updatedAssets || 0)}</td>
              <td>${Number(item.duplicateRows || 0)}</td>
              <td>${Number(item.duplicateFiles || 0)}</td>
              <td>${Number(item.paperCreated || 0)}</td>
              <td>${item.error ? attrText(item.error) : Number(item.skipped || 0)}</td>
            </tr>`).join("")}</tbody>
          </table>
        </div>
      ` : ""}
      ${skipped.length ? `
        <div class="table-wrap">
          <table>
            <thead><tr><th>文件/行号</th><th>原因</th></tr></thead>
            <tbody>${skipped.map((item) => `<tr><td>${attrText(item.file ? `${item.file} / ${item.row}` : item.row)}</td><td>${attrText(item.reason)}</td></tr>`).join("")}</tbody>
          </table>
        </div>
      ` : ""}
    </div>
  `;
}

function importResultSummary(result = {}) {
  const parts = [
    `处理 ${importProcessedCount(result)} 行`,
    `生成流水 ${Number(result.imported || 0)} 条`,
    `新建 ${Number(result.createdAssets || 0)} 个`,
    `已存在 ${Number(result.existingAssets || 0)} 个`,
    `已更新 ${Number(result.updatedAssets || 0)} 个`,
    `重复行 ${Number(result.duplicateRows || 0)} 条`,
    `重复文件 ${Number(result.duplicateFiles || 0)} 个`,
    `错误/异常 ${(result.skipped || []).length} 条`
  ];
  if (Number(result.paperCreated || 0)) parts.splice(6, 0, `待复核 ${Number(result.paperCreated || 0)} 条`);
  return parts.join("，");
}

function renderImportArchives() {
  if (!state.importArchives?.length) {
    return `
      <section class="import-history-panel">
        <div class="section-title"><h2>导入历史</h2><span class="hint">导入后会保留原始电子档和校验结果</span></div>
        ${renderEmptyAction("还没有导入历史", "导入学校资产底表、人员资产表、人员耗材表或 Word 单据后，会在这里看到处理记录。", [{ label: "导入Word单据", view: "records", mode: "import", importKind: "word" }, { label: "新增入库", view: "records", mode: "manual", action: "inbound" }])}
      </section>
    `;
  }
  return `
    <section class="import-history-panel">
      <div class="section-title">
        <h2>导入历史</h2>
        <select aria-label="导入历史类型筛选">
          <option>全部类型</option>
        </select>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>导入时间</th><th>文件名称</th><th>导入类型</th><th>上传人</th><th>识别记录数</th><th>成功导入</th><th>异常/错误</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            ${state.importArchives.map((item) => `
              <tr>
                <td>${fmt(item.uploadedAt)}</td>
                <td>${attrText(item.fileName)}</td>
                <td>${attrText(importArchiveType(item))}</td>
                <td>${userName(item.uploadedBy)}</td>
                <td>${importProcessedCount(item.result || {})}</td>
                <td>${Number(item.result?.imported || 0)}</td>
                <td>${importArchiveAbnormalCount(item)}</td>
                <td>${renderImportArchiveStatus(item)}</td>
                <td>
                  <div class="row-actions">
                    <button class="ghost small" data-import-archive-detail="${item.id}" type="button">查看详情</button>
                    <button class="secondary small" data-download-archive="${item.id}" type="button">下载结果</button>
                  </div>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function importArchiveType(item) {
  const category = String(item.category || "");
  if (category.includes("Word")) return "Word 出借单";
  if (category.includes("耗材")) return "人员耗材领用表";
  if (category.includes("出库") || category.includes("出借")) return "人员资产使用表";
  if (category.includes("入库")) return "学校资产底表";
  return category || "电子档导入";
}

function importArchiveAbnormalCount(item) {
  const result = item.result || {};
  return Number((result.skipped || []).length || 0) + Number(result.duplicateRows || 0) + Number(result.duplicateFiles || 0);
}

function renderImportArchiveStatus(item) {
  const abnormal = importArchiveAbnormalCount(item);
  const imported = Number(item.result?.imported || 0);
  if (abnormal && imported) return `<span class="import-history-status warn">部分成功</span>`;
  if (abnormal && !imported) return `<span class="import-history-status bad">导入异常</span>`;
  return `<span class="import-history-status ok">导入成功</span>`;
}

function importArchiveDetailText(item) {
  const result = item.result || {};
  const skipped = Number((result.skipped || []).length || 0);
  const duplicates = Number(result.duplicateRows || 0) + Number(result.duplicateFiles || 0);
  const abnormal = skipped + duplicates;
  return [
    `文件名称：${item.fileName || "-"}`,
    `导入类型：${importArchiveType(item)}`,
    `上传时间：${fmt(item.uploadedAt)}`,
    `上传人：${userName(item.uploadedBy)}`,
    `识别记录数：${importProcessedCount(result)}`,
    `成功导入：${Number(result.imported || 0)}`,
    `新建资产：${Number(result.createdAssets || 0)}`,
    `已存在：${Number(result.existingAssets || 0)}`,
    `已更新：${Number(result.updatedAssets || 0)}`,
    `需处理异常：${skipped}`,
    `重复未写入：${duplicates}`,
    `合计未写入/需确认：${abnormal}`,
    result.message ? `说明：${result.message}` : ""
  ].filter(Boolean).join("\n");
}

function recordActionConfig(action = recordActionMode) {
  return {
    inbound: { label: "新增入库", type: "入库", inTime: nowLocal(), outTime: "", note: "新增入库" },
    lend: { label: "划一笔出借", type: "出库", inTime: "", outTime: nowLocal(), note: "划一笔出借" },
    return: { label: "归还登记", type: "入库", inTime: nowLocal(), outTime: "", note: "归还登记" },
    consume: { label: "耗材领用", type: "出库", inTime: "", outTime: nowLocal(), note: "耗材领用" }
  }[action] || { label: "新增入库", type: "入库", inTime: nowLocal(), outTime: "", note: "" };
}

function recordDefaultGroup(groups) {
  if (recordPrefillAssetId) {
    const matched = groups.find((group) => group.assets.some((asset) => asset.id === recordPrefillAssetId));
    if (matched) return matched;
  }
  if (recordActionMode === "consume") {
    return groups.find((group) => group.assets.some((asset) => assetKind(asset) === "耗材")) || groups[0] || {};
  }
  return groups.find((group) => group.assets.some((asset) => assetKind(asset) === "资产")) || groups[0] || {};
}

function renderRecordFormInner() {
  const deptOptions = [`<option value="all" ${selectedDepartment === "all" ? "selected" : ""}>全部部门</option>`]
    .concat(departments().map((department) => `<option value="${department}" ${selectedDepartment === department ? "selected" : ""}>${department}</option>`))
    .join("");
  const userOptions = activeUsersByDepartment().map((u) => `<option value="${u.id}">${u.name}${isMultiDepartment() ? ` · ${u.department}` : ""}</option>`).join("");
  const groups = assetGroups();
  const defaultGroup = recordDefaultGroup(groups);
  const action = recordActionConfig();
  const recordAssetOptions = groups
    .map((group) => `<option value="${attrText(group.model)}" label="${attrText(`${group.category || "-"} · 共 ${group.quantity || 0} 台/件`)}"></option>`)
    .join("");
  return `
    <form id="recordForm" class="manual-flow">
      <div class="manual-main">
        <div class="section-title manual-title"><h2>日常登记</h2><button class="ghost small" type="reset">清空选择</button></div>
        <div class="daily-action-grid">
          ${[
            ["inbound", "新增入库", "资产入库后默认为在库 / 未出借"],
            ["lend", "划一笔出借", "不新增资产，只把原资产标记为已借出"],
            ["return", "归还登记", "已借出的资产归还后回到在库"],
            ["consume", "耗材领用", "耗材只记录数量和库存流水"]
          ].map(([key, label, desc]) => `
            <button class="${recordActionMode === key ? "active" : ""}" data-record-action="${key}" type="button">
              <strong>${label}</strong><span>${desc}</span>
            </button>
          `).join("")}
        </div>
        <section class="manual-step">
          <div class="step-head"><span class="step-index">1</span><h3>资产信息</h3></div>
          <input type="hidden" name="assetId" value="${defaultGroup.id || ""}" />
          <div class="field asset-lookup-field">
            <label>资产</label>
            <input name="assetLookup" list="recordAssetOptions" value="${attrText(defaultGroup.model || "")}" required placeholder="输入资产名称、编号、规格，或粘贴扫码详情链接" autocomplete="off" />
            <datalist id="recordAssetOptions">${recordAssetOptions}</datalist>
            <div class="asset-lookup-hint" id="assetLookupHint">${defaultGroup.model ? `已选：${defaultGroup.model}` : "先录入资产后再登记出入库"}</div>
          </div>
          <div class="asset-info-grid">
            <div><span>型号/规格</span><strong id="assetCodePreview">${defaultGroup.model || "-"}</strong></div>
            <div><span>分类</span><strong id="assetCategoryPreview">${defaultGroup.category || "-"}</strong></div>
            <div><span>当前库存</span><strong id="assetQuantityPreview">${defaultGroup.quantity || 0} 台/件</strong></div>
          </div>
        </section>
        <section class="manual-step">
          <div class="step-head"><span class="step-index">2</span><h3>登记信息</h3></div>
          <input type="hidden" name="type" value="${action.type}" />
          <div class="manual-grid">
            <div class="field wide"><label>类型</label><div class="type-segments">
              <button class="${recordActionMode === "inbound" ? "active" : ""}" data-record-type="入库" data-record-action="inbound" type="button">新增入库</button>
              <button class="${recordActionMode === "lend" ? "active" : ""}" data-record-type="出库" data-record-action="lend" type="button">划一笔</button>
              <button class="${recordActionMode === "return" ? "active" : ""}" data-record-type="入库" data-record-action="return" type="button">归还登记</button>
            </div></div>
            <div class="field"><label>数量</label><div class="quantity-stepper"><button data-quantity-step="-1" type="button">−</button><input name="quantity" type="number" min="1" value="1" required /><button data-quantity-step="1" type="button">+</button></div></div>
            <div class="field"><label>借用人 / 归还人</label><select name="userId" required>${userOptions}</select></div>
            ${isMultiDepartment() ? `<div class="field"><label>部门</label><select id="departmentFilter">${deptOptions}</select></div>` : ""}
            <div class="field"><label>入库/归还时间</label><input name="inTime" type="datetime-local" value="${action.inTime}" /></div>
            <div class="field"><label>出库/借出时间</label><input name="outTime" type="datetime-local" value="${action.outTime}" /></div>
            <div class="field"><label>纸质单号</label><input name="paperNo" placeholder="如 SZ-003" /></div>
          </div>
        </section>
        <section class="manual-step">
          <div class="step-head"><span class="step-index">3</span><h3>附件与备注</h3></div>
          <div class="manual-grid">
            <div class="field"><label>现场照片（可选）</label><label class="photo-upload"><input name="photoFile" type="file" accept="image/*" capture="environment" /><span>☁</span><strong>点击上传现场照片</strong><em id="photoFileName">支持 JPG、PNG</em></label></div>
            <div class="field"><label>备注（可选）</label><textarea name="note" maxlength="200" placeholder="来源、用途、验收情况等">${action.note}</textarea></div>
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
              <dt>类型</dt><dd id="summaryType">${action.label}</dd>
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

function renderPaperQueuePanel() {
  const canManagePaper = can("paper.manage");
  return `
    <section class="embedded-panel">
      <div class="section-title"><h2>纸质单据电子化</h2><span class="hint">手写材料在这里补录、复核和归档。</span></div>
      <div class="paper-import-grid">
        <form id="paperForm" class="form-grid">
          <div class="field"><label>纸质单号</label><input name="paperNo" required placeholder="SZ-2026-001" /></div>
          <div class="field"><label>单据来源</label><input name="source" required placeholder="手写入库单 / 出库单" /></div>
          ${canManagePaper ? `<div class="field"><label>关联用户</label><select name="ownerId">${selectableUsers().map((u) => `<option value="${u.id}">${u.name}</option>`).join("")}</select></div>` : ""}
          <div class="field wide"><label>识别文本 / 人工摘录</label><textarea name="text" required placeholder="资产、数量、时间、经手人、用途"></textarea></div>
          <button class="primary" type="submit">加入复核队列</button>
        </form>
        <div class="paper-guidance">
          <strong>处理流程</strong>
          <span>编号</span>
          <span>拍照或扫描</span>
          <span>人工摘录</span>
          <span>复核后归档</span>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>单号</th><th>来源</th><th>关联用户</th><th>状态</th><th>识别内容</th>${canManagePaper ? "<th>操作</th>" : ""}</tr></thead>
          <tbody>
            ${state.paperQueue.map((item) => `
              <tr>
                <td>${item.paperNo}</td><td>${item.source}</td><td>${userName(item.ownerId)}</td><td>${statusBadge(item.status)}</td><td>${item.text}</td>
                ${canManagePaper ? `<td><button class="secondary small" data-archive-paper="${item.id}" type="button">归档</button></td>` : ""}
              </tr>
            `).join("") || `<tr><td colspan="${canManagePaper ? 6 : 5}" class="empty">${renderEmptyAction("还没有纸质单据", "可先录入纸质单号和人工摘录，也可以直接导入 Word 单据。", [{ label: "导入Word单据", view: "records", mode: "import" }])}</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderPaper() {
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
    </div>
    <section class="panel">${renderPaperQueuePanel()}</section>
  `;
}

function requestStatusBadge(status) {
  const cls = status === "已批准" ? "ok" : status === "待处理" ? "warn" : "bad";
  return `<span class="badge ${cls}">${status || "-"}</span>`;
}

function renderRequests() {
  const tabs = [
    ["asset", "资产申请", canMenu("assetRequests")],
    ["purchase", "采购需求", canMenu("purchaseWishes")]
  ].filter(([, , allowed]) => allowed);
  if (!tabs.length) return "";
  if (!tabs.some(([key]) => key === requestSection)) requestSection = tabs[0][0];
  return `
    <section class="panel merged-page">
      <div class="mode-tabs" role="tablist" aria-label="申请与采购">
        ${tabs.map(([key, label]) => `<button class="${requestSection === key ? "active" : ""}" data-request-section="${key}" type="button">${label}</button>`).join("")}
      </div>
    </section>
    ${requestSection === "purchase" ? renderPurchaseWishes() : renderAssetRequests()}
  `;
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
            `).join("") || emptyActionRow(canManageRequests ? 10 : 8, "还没有资产申请", canManageRequests ? "教师提交资产申请后会汇总到这里，管理员可审批并安排采购或调拨。" : "提交资产申请后，管理员会在这里处理审批状态。", canManageRequests ? [{ label: "查看采购需求", view: "requests", requestSection: "wish" }, { label: "查看资产台账", view: "assets" }] : [{ label: "提交资产申请", view: "requests", requestSection: "asset" }, { label: "查看需求清单", view: "requests", requestSection: "wish" }])}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderPurchaseWishes() {
  const wishes = state.purchaseWishes || [];
  const canManageWishes = can("purchase_wishes.manage");
  const pending = wishes.filter((item) => item.status === "待采购" || item.status === "已采纳").length;
  const totalQuantity = wishes.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const totalAmount = wishes.reduce((sum, item) => sum + purchaseWishTotal(item), 0);
  return `
    <section class="panel">
      <div class="section-title">
        <h2>${canManageWishes ? "采购需求汇总" : "提交采购需求"}</h2>
        <span class="hint">当前 ${wishes.length} 项，数量合计 ${totalQuantity}，金额合计 ${formatMoney(totalAmount)}，待跟进 ${pending} 项</span>
        <button class="secondary small" id="exportPurchaseWishes" type="button">导出Excel</button>
      </div>
      ${!canManageWishes ? `
        <form id="purchaseWishForm" class="form-grid">
          <div class="field"><label>名称（产品名称）</label><input name="itemName" required placeholder="例如 笔记本、显示器、网线、硬盘" /></div>
          <div class="field"><label>技术参数</label><input name="spec" placeholder="型号、容量、配置或参数要求" /></div>
          <div class="field"><label>数量</label><input name="quantity" type="number" min="1" value="1" required /></div>
          <div class="field"><label>单价</label><input name="unitPrice" type="number" min="0" step="0.01" value="0" /></div>
          <div class="field"><label>上浮选项</label><select name="upliftPreset"><option value="0">不上浮</option><option value="10">上浮 10%</option><option value="20">上浮 20%</option><option value="30" selected>上浮 30%</option><option value="custom">自定义上浮</option></select></div>
          <div class="field"><label>自定义上浮（%）</label><input name="upliftRate" type="number" min="0" step="1" value="30" /></div>
          <div class="field"><label>总价</label><input name="totalAmount" type="number" min="0" step="0.01" value="0.00" readonly data-calculated-total /><span class="field-note">数量 × 单价 ×（1 + 上浮比例）</span></div>
          <div class="field"><label>品目</label><input name="itemType" placeholder="设备 / 耗材 / 软件 / 工具" /></div>
          <div class="field wide"><label>备注</label><textarea name="reason" placeholder="使用场景、课程、竞赛、现有设备不足或采购说明"></textarea></div>
          <button class="primary" type="submit">加入需求清单</button>
        </form>
      ` : ""}
    </section>
    <section class="panel">
      <div class="section-title"><h2>${canManageWishes ? "全部需求" : "我的需求"}</h2><span class="hint">导出表格按“名称、技术参数、单位、数量、单价、总价、品目、备注”生成。</span></div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>名称</th><th>技术参数</th><th>单位</th><th>数量</th><th>单价</th><th>总价</th><th>品目</th><th>备注</th>${canManageWishes ? "<th>处理</th>" : ""}
            </tr>
          </thead>
          <tbody>
            ${wishes.map((item) => `
              <tr>
                <td>${attrText(item.itemName)}</td>
                <td>${attrText(blank(item.spec))}</td>
                <td>${attrText(item.unit || "件")}</td>
                <td>${Number(item.quantity || 0)}</td>
                <td>${formatMoney(item.unitPrice || 0)}</td>
                <td>${formatMoney(purchaseWishTotal(item))}</td>
                <td>${attrText(blank(item.itemType || item.category))}</td>
                <td>${attrText(blank(item.reason || item.handleNote))}${canManageWishes ? `<div class="mini-meta">${item.userName || userName(item.userId)} · ${requestStatusBadge(item.status)}</div>` : ""}</td>
                ${canManageWishes ? `<td><div class="row-actions"><button class="secondary small" data-update-wish="${item.id}" data-wish-status="已采纳" type="button">采纳</button><button class="secondary small" data-update-wish="${item.id}" data-wish-status="暂缓" type="button">暂缓</button><button class="secondary small" data-update-wish="${item.id}" data-wish-status="已采购" type="button">已采购</button><button class="ghost small" data-update-wish="${item.id}" data-wish-status="已关闭" type="button">关闭</button></div></td>` : ""}
              </tr>
            `).join("") || emptyActionRow(canManageWishes ? 9 : 8, "还没有采购需求", canManageWishes ? "教师提交的年度采购需求会汇总到这里，可用于预算和采购跟进。" : "把下一年度想要采购的设备加入需求清单，便于统一汇总。", canManageWishes ? [{ label: "查看资产申请", view: "requests", requestSection: "asset" }] : [{ label: "提交采购需求", view: "requests", requestSection: "purchase" }, { label: "提交资产申请", view: "requests", requestSection: "asset" }])}
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
            ${(state.roles || []).map((role) => `<tr><td>${role.name}</td><td>${blank(role.description)}</td><td>${(role.menus || []).join(" / ")}</td><td>${(role.permissions || []).length}</td></tr>`).join("") || emptyActionRow(4, "还没有角色数据", "角色权限由系统初始化或后台配置生成，先检查系统设置和初始化状态。", [{ label: "查看系统设置", view: "system", systemSection: "settings" }])}
          </tbody>
        </table>
      </div>
    </section>
    ${can("users.manage") ? `<section class="panel">
      <div class="section-title"><h2>历史导入用户重检</h2><span class="hint">扫描历史导入中被误识别为用户的资产名，默认只做停用修复，不删除数据。</span></div>
      <div class="form-grid" style="grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); margin-bottom: 10px;">
        <label><input id="repairUserIncludeInactive" type="checkbox" ${userRepairOptions.includeInactive ? "checked" : ""}/> 包含已停用用户</label>
        <label><input id="repairUserSkipAdmin" type="checkbox" ${userRepairOptions.skipAdmin ? "checked" : ""}/> 跳过管理员</label>
        <label><input id="repairUserSkipReferenced" type="checkbox" ${userRepairOptions.skipReferenced ? "checked" : ""}/> 跳过有关联资产/记录账号</label>
      </div>
      <div class="row-actions">
        <button class="secondary small" id="runUserRepairDryrun" type="button">预检可疑用户</button>
        <button class="danger small" id="runUserRepairFix" type="button">执行修复（停用）</button>
        <button class="secondary small" id="runUserRepairFixFromList" type="button">按预检列表修复（不重扫）</button>
        <button class="danger small" id="runUserRepairDeleteFromList" type="button">按预检列表清除（不可恢复）</button>
        <button class="ghost small" id="clearUserRepairState" type="button">清空结果</button>
      </div>
      ${renderUserRepairResult()}
    </section>` : ""}
    <section class="panel">
      <div class="section-title">
        <h2>用户列表</h2>
      </div>
      ${can("users.manage") ? `<div class="row-actions user-batch-actions">
        <label class="hint"><input id="selectAllImportedUserRows" type="checkbox" /> 全选当前列表</label>
        <span class="hint" id="selectedImportedUserRowsCount">已选 0 条</span>
        <button class="danger small" id="clearSelectedImportedUserRows" type="button" disabled>批量删除所选（不可恢复）</button>
      </div>` : ""}
      <div class="table-wrap">
        <table>
          <thead><tr>${can("users.manage") ? `<th class="user-select-col">选择</th>` : ""}<th>账号</th><th>姓名</th><th>操作</th><th>角色</th>${isMultiDepartment() ? "<th>部门</th>" : ""}<th>状态</th></tr></thead>
          <tbody>
            ${(state.users || []).filter((user) => user.id === state.currentUser?.id || isLikelyPersonName(user.name)).map((user) => `
              <tr data-user-row="${user.id}">
                ${can("users.manage") ? `<td class="user-select-col">${user.id === state.currentUser.id ? "" : `<input data-imported-user-select="${user.id}" type="checkbox" title="选择 ${user.name}" />`}</td>` : ""}
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

function renderUserRepairResult() {
  if (!userRepairState) {
    return "<p class=\"hint\">尚未运行，建议先点“预检可疑用户”查看结果。</p>";
  }
  if (userRepairState.loading) {
    return `<p class=\"hint\">扫描中...</p>`;
  }
  if (["fix", "delete"].includes(userRepairState.mode)) {
    const updated = userRepairState.updated || [];
    const skipped = userRepairState.skipped || [];
    const modeLabel = userRepairState.mode === "delete" ? "删除" : "停用";
    return `
      <p>预检命中 <b>${userRepairState.checked || 0}</b> 条，已${modeLabel} <b>${updated.length}</b> 条，跳过 <b>${skipped.length}</b> 条。</p>
      ${updated.length ? `<h4>已${modeLabel}</h4><div class="table-wrap"><table><thead><tr><th>账号</th><th>姓名</th><th>部门</th><th>原因</th></tr></thead><tbody>${updated.map((item) => `<tr><td>${item.username}</td><td>${item.name}</td><td>${item.department || "-"}</td><td>${item.reason}</td></tr>`).join("")}</tbody></table></div>` : ""}
      ${skipped.length ? `<h4>跳过</h4><div class="table-wrap"><table><thead><tr><th>账号</th><th>姓名</th><th>部门</th><th>原因</th></tr></thead><tbody>${skipped.map((item) => `<tr><td>${item.username}</td><td>${item.name}</td><td>${item.department || "-"}</td><td>${item.reason}</td></tr>`).join("")}</tbody></table></div>` : ""}
    `;
  }
  const candidates = userRepairState.candidates || [];
    return `
      <p>本次预检命中 <b>${userRepairState.checked || candidates.length || 0}</b> 条可疑记录。</p>
      ${!candidates.length ? "<p class=\"hint\">未发现明显误识别用户。</p>" : `
      <div class="table-wrap">
        <table>
          <thead><tr><th>账号</th><th>姓名</th><th>部门</th><th>资产引用</th><th>记录引用</th><th>异常特征</th><th>可修复</th></tr></thead>
          <tbody>
            ${candidates.map((item) => {
              const refs = item.referenceCounts || {};
              const assetRefs = Number(refs.keeperAssetsCount || 0) + Number(refs.useUserAssetsCount || 0) + Number(refs.paperOwnerCount || 0);
              return `<tr><td>${item.username}</td><td>${item.name}</td><td>${item.department || "-"}</td><td>${assetRefs}</td><td>${Number(refs.recordsCount || 0)}</td><td>${item.lookLikeAssetName ? "疑似资产名" : "其他可疑名"}</td><td>${item.canRepair ? "可修复" : "暂不可修复"}</td></tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    `}
    `;
}

function getUserRepairCandidateIds() {
  const candidates = (userRepairState && userRepairState.mode === "dryrun" ? userRepairState.candidates : null) || [];
  return [...new Set((candidates || []).map((item) => String(item.id || "").trim()).filter(Boolean))];
}

function purchaseWishTotal(item) {
  const explicit = Number(item.totalAmount || 0);
  if (explicit) return explicit;
  return Number(item.quantity || 0) * Number(item.unitPrice || 0) * (1 + PURCHASE_WISH_DEFAULT_UPLIFT / 100);
}

function purchaseWishUpliftRate(form) {
  const rate = Number(form?.upliftRate?.value ?? PURCHASE_WISH_DEFAULT_UPLIFT);
  return Number.isFinite(rate) ? Math.max(0, rate) : PURCHASE_WISH_DEFAULT_UPLIFT;
}

function purchaseWishCalculatedTotal(form) {
  const quantity = Math.max(1, Number(form?.quantity?.value || 1) || 1);
  const unitPrice = Math.max(0, Number(form?.unitPrice?.value || 0) || 0);
  return quantity * unitPrice * (1 + purchaseWishUpliftRate(form) / 100);
}

function updatePurchaseWishTotal(form) {
  if (!form) return 0;
  const total = purchaseWishCalculatedTotal(form);
  if (form.totalAmount) form.totalAmount.value = formatMoney(total);
  return total;
}

function formatMoney(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toFixed(2) : "0.00";
}

function isSuperAdmin() {
  return state.currentUser?.username === "admin" || state.currentUser?.id === "u-admin";
}

function renderSystemManagement() {
  const tabs = [
    ["users", "用户与角色", canMenu("users")],
    ["baseData", "基础数据", canMenu("baseData")],
    ["settings", "系统设置", canMenu("settings")],
    ["audit", "操作记录", canMenu("audit")]
  ].filter(([, , allowed]) => allowed);
  if (!tabs.length) return "";
  if (!tabs.some(([key]) => key === systemSection)) systemSection = tabs[0][0];
  const renderers = {
    users: renderUsers,
    baseData: renderBaseData,
    settings: renderSettings,
    audit: renderAudit
  };
  return `
    <section class="panel merged-page">
      <div class="mode-tabs" role="tablist" aria-label="系统管理">
        ${tabs.map(([key, label]) => `<button class="${systemSection === key ? "active" : ""}" data-system-section="${key}" type="button">${label}</button>`).join("")}
      </div>
    </section>
    ${(renderers[systemSection] || renderers[tabs[0][0]])()}
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
            `).join("") || emptyActionRow(6, "还没有管理员权限申请", "普通用户申请管理员权限后会出现在这里，由现有管理员审批。", [{ label: "查看用户列表", view: "system", systemSection: "users" }])}
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
  return `$env:WAREHOUSE_HOST_PORT='${port}'; docker compose -p warehouse up --build -d`;
}

function updateContainerCommand() {
  return "docker compose -p warehouse up --build -d";
}

function healthCheckCommand(port = state.settings?.servicePort || "38280") {
  return `Invoke-RestMethod http://127.0.0.1:${port}/api/health`;
}

function renderLaunchReadinessPanel() {
  const health = systemHealth;
  const statusTone = health?.ok ? "ok" : health ? "bad" : "warn";
  const statusTextValue = health?.ok ? "正常" : health ? "异常" : "未检查";
  return `
    <div class="maintenance-block launch-panel">
      <div class="section-title"><h2>上线检查</h2><span class="hint">用于上线前确认容器、后端和数据库是否正常。</span></div>
      <div class="launch-check-grid">
        <article class="launch-check-card ${statusTone}">
          <span>服务状态</span>
          <strong>${systemHealthLoading ? "检查中..." : statusTextValue}</strong>
          <p>${health?.ok ? `健康检查通过，版本 ${health.appVersion || APP_VERSION}` : health?.error || "点击检查服务，确认后端和 SQLite 是否可用。"}</p>
        </article>
        <article class="launch-check-card">
          <span>当前访问</span>
          <strong>${state.settings?.servicePort || "38280"}</strong>
          <p>浏览器访问端口。修改端口后需要重建 Docker 容器。</p>
        </article>
        <article class="launch-check-card">
          <span>数据状态</span>
          <strong>${health?.assets ?? state.assets.length} 项资产</strong>
          <p>用户 ${health?.users ?? state.users.length} 个，数据库 ${health?.database || "/data/warehouse.db"}。</p>
        </article>
      </div>
      <div class="launch-command-box">
        <div>
          <strong>更新容器命令</strong>
          <p class="hint">代码更新或设置变更后，在项目目录执行。</p>
          <code class="inline-command short-command">${updateContainerCommand()}</code>
        </div>
        <div>
          <strong>健康检查命令</strong>
          <p class="hint">上线后执行，返回 ok: true 即可继续使用。</p>
          <code class="inline-command short-command">${healthCheckCommand()}</code>
        </div>
      </div>
      <div class="setting-actions launch-actions">
        <button class="primary" id="checkSystemHealth" type="button">${systemHealthLoading ? "检查中..." : "检查服务"}</button>
        <button class="secondary" id="copyUpdateCommand" type="button">复制更新命令</button>
        <button class="secondary" id="copyHealthCommand" type="button">复制检查命令</button>
        ${systemHealthCheckedAt ? `<span class="hint">上次检查：${systemHealthCheckedAt}</span>` : ""}
      </div>
    </div>
  `;
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
      </form>` : ""}
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
    ${renderAdvancedMaintenancePanel()}
  `;
}

function renderAdvancedMaintenancePanel() {
  if (!can("settings.view")) return "";
  return `
    <section class="panel advanced-maintenance">
      <div class="section-title"><h2>高级维护</h2><span class="hint">服务健康、Docker 命令、端口配置和危险操作集中放在这里。</span></div>
      ${renderLaunchReadinessPanel()}
      <form id="servicePortForm" class="setting-row">
        <div>
          <strong>后台端口设置</strong>
          <p class="hint">当前访问端口：${state.settings?.servicePort || "38280"}。保存后会记录端口，真正生效还需要在 PowerShell 执行复制出来的端口重启命令。</p>
          <code class="inline-command short-command">${portApplyCommand()}</code>
        </div>
        <div class="port-setting">
          <input name="port" type="number" min="1" max="65535" required value="${state.settings?.servicePort || "38280"}" />
          <button class="primary" type="submit">保存端口</button>
          <button class="secondary" id="copyPortCommand" type="button">复制命令</button>
        </div>
      </form>
      ${isSuperAdmin() && isDeveloperMode() ? `
      <div class="debug-tools danger-zone">
        <div>
          <strong>危险操作：清空除登录账号外的全部数据</strong>
          <p class="hint">清空资产底表、耗材库存、出入库流水、导入留档、纸质待复核、申请采购、盘点、部门、分类、位置、系统设置和操作记录；只保留用户登录账号。当前资产 ${state.assets.length} 个，记录 ${state.records.length} 条，留档 ${state.importArchives.length} 个。</p>
        </div>
        <button class="danger" id="clearDebugFiles" type="button">清空，仅保留登录账号</button>
      </div>` : ""}
    </section>
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
            ${audits.map((audit) => `<tr><td>${fmt(audit.time)}</td><td>${userName(audit.user_id || audit.userId)}</td><td>${auditIpDisplay(audit.ip)}</td><td>${audit.action}</td><td>${audit.detail}</td></tr>`).join("") || emptyActionRow(5, "没有符合筛选条件的操作记录", "清空筛选后可查看全部登录、导入、登记和系统操作流水。", [{ label: "清空筛选", view: "system", systemSection: "audit", auditClear: true }, { label: "返回总览", view: "dashboard" }])}
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
    ${can("assets.manage") ? `
    <div class="context-menu compact asset-row-context-menu" id="assetRowContextMenu" aria-hidden="true">
      <button data-asset-row-location type="button">更新位置</button>
      <button data-asset-row-image type="button">上传参考图</button>
      <button data-asset-row-view type="button">查看资产</button>
    </div>` : ""}
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

function updateManualRecordPreview() {
  const form = document.querySelector("#recordForm");
  if (!form) return;
  const lookupValue = form.assetLookup?.value || form.assetId?.value;
  const resolvedAsset = resolveRecordAsset(lookupValue) || state.assets.find((item) => item.id === form.assetId?.value) || null;
  if (resolvedAsset?.id && form.assetId) form.assetId.value = resolvedAsset.id;
  const asset = resolvedAsset || {};
  const group = assetGroupById(asset.id);
  const user = state.users.find((item) => item.id === form.userId?.value) || {};
  const activeType = form.querySelector("[data-record-type].active");
  const typeText = recordActionConfig().label || activeType?.textContent?.trim() || form.type?.value || "-";
  document.querySelector("#assetCodePreview").textContent = group?.model || assetModelText(asset) || "-";
  document.querySelector("#assetCategoryPreview").textContent = group?.category || asset.category || "-";
  document.querySelector("#assetQuantityPreview").textContent = `${group?.quantity ?? asset.quantity ?? 0} 台/件`;
  const hint = document.querySelector("#assetLookupHint");
  if (hint) {
    hint.textContent = resolvedAsset?.id
      ? `已选：${group?.model || assetModelText(asset)}${asset.code ? `（${asset.code}）` : ""}`
      : (String(lookupValue || "").trim() ? "未匹配到资产，请检查名称、编号或扫码链接。" : "输入资产名称、编号、规格，或粘贴扫码详情链接。");
    hint.classList.toggle("warn", !resolvedAsset?.id && Boolean(String(lookupValue || "").trim()));
  }
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

function updateOrderAssetLookup(form) {
  if (!form) return null;
  const wrapper = form.querySelector(".order-asset-lookup");
  const input = form.assetLookup;
  const hidden = form.assetId;
  const hint = wrapper?.querySelector(".asset-lookup-hint");
  const kind = wrapper?.dataset.orderAssetKind || orderType;
  const asset = resolveOrderAsset(input?.value || hidden?.value, kind);
  if (hidden) hidden.value = asset?.id || "";
  if (hint) {
    const hasText = Boolean(String(input?.value || "").trim());
    hint.textContent = asset
      ? `已选：${asset.name}（${asset.code}） · ${statusText(asset.status)}`
      : (hasText ? "未匹配到可办理资产，请检查名称、编号或扫码链接。" : "输入资产名称、编号、规格，或粘贴扫码详情链接。");
    hint.classList.toggle("warn", !asset && hasText);
  }
  return asset;
}

function withActor(payload = {}) {
  return { ...payload, actorId: state.currentUser.id, sessionToken: sessionToken() };
}

function formData(form) {
  return Object.fromEntries(new FormData(form));
}

async function copyText(text, successMessage, promptTitle) {
  try {
    await navigator.clipboard.writeText(text);
    alert(successMessage);
  } catch {
    prompt(promptTitle, text);
  }
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
      shortLabel: "Word 出借单",
      resultTitle: "Word 出借单导入",
      button: "确认导入 Word 单据",
      uploadHint: "支持 .docx，单次可上传多个文件，也可选择包含 Word 单据的文件夹",
      description: "标准表格会自动导入出借记录；手写图片或扫描件会进入待复核队列。"
    };
  }
  if (importKind === "personAsset") {
    return {
      accept: ".docx,.doc,.xlsx,.csv",
      extensions: [".docx", ".doc", ".xlsx", ".csv"],
      endpoint: "/api/records/import-person-assets",
      resultKey: "importResult",
      shortLabel: "人员资产使用表",
      resultTitle: "人员资产使用表导入",
      button: "确认导入人员资产表",
      uploadHint: "支持 .docx、.xlsx、.csv；旧版 .doc 请先另存为 .docx。资产编号必须已存在于学校资产底表。",
      description: "Word 表格、Excel 或 CSV 都会按资产编号匹配底表，匹配成功后绑定到使用人名下并生成出库流水。"
    };
  }
  if (importKind === "personConsumable") {
    return {
      accept: ".docx,.doc,.xlsx,.csv",
      extensions: [".docx", ".doc", ".xlsx", ".csv"],
      endpoint: "/api/records/import-person-consumables",
      resultKey: "importResult",
      shortLabel: "人员耗材领用表",
      resultTitle: "人员耗材领用表导入",
      button: "确认导入耗材领用表",
      uploadHint: "支持 .docx、.xlsx、.csv；旧版 .doc 请先另存为 .docx。按耗材名称、规格型号和数量匹配库存。",
      description: "Word 表格、Excel 或 CSV 都会按耗材名称和规格匹配现有库存；库存不足、耗材不存在或人员缺失会标记异常。"
    };
  }
  return {
    accept: ".docx,.doc,.xlsx,.csv",
    extensions: [".docx", ".doc", ".xlsx", ".csv"],
    endpoint: "/api/records/import-inbound",
    resultKey: "importResult",
    shortLabel: "学校资产底表",
    resultTitle: "学校资产底表导入",
    button: "确认导入学校资产底表",
    uploadHint: "支持 .docx、.xlsx、.csv；旧版 .doc 请先另存为 .docx，固定资产和耗材都可以在这里建账。",
    description: `表头建议包含：资产分类、资产名称、规格型号、资产编号、数量、取得日期、部门、存放地点、状态。`
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
  const summary = { processedRows: 0, imported: 0, createdAssets: 0, existingAssets: 0, updatedAssets: 0, duplicateRows: 0, duplicateFiles: 0, paperCreated: 0, skipped: [], files: [] };
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
      summary.processedRows += importProcessedCount(result);
      summary.imported += Number(result.imported || 0);
      summary.createdAssets += Number(result.createdAssets || 0);
      summary.existingAssets += Number(result.existingAssets || 0);
      summary.updatedAssets += Number(result.updatedAssets || 0);
      summary.duplicateRows += Number(result.duplicateRows || 0);
      summary.duplicateFiles += Number(result.duplicateFiles || 0);
      summary.paperCreated += Number(result.paperCreated || 0);
      summary.skipped.push(...(result.skipped || []).map((item) => ({ ...item, file: fileName })));
      summary.files.push({
        fileName,
        processedRows: importProcessedCount(result),
        imported: Number(result.imported || 0),
        createdAssets: Number(result.createdAssets || 0),
        existingAssets: Number(result.existingAssets || 0),
        updatedAssets: Number(result.updatedAssets || 0),
        duplicateRows: Number(result.duplicateRows || 0),
        duplicateFiles: Number(result.duplicateFiles || 0),
        paperCreated: Number(result.paperCreated || 0),
        skipped: (result.skipped || []).length
      });
    } catch (exc) {
      summary.skipped.push({ row: fileName, reason: exc.message });
      summary.files.push({
        fileName,
        processedRows: 0,
        imported: 0,
        createdAssets: 0,
        existingAssets: 0,
        updatedAssets: 0,
        duplicateRows: 0,
        duplicateFiles: 0,
        paperCreated: 0,
        skipped: 1,
        error: exc.message
      });
    }
  }
  state = await api(`/api/state?${authQuery()}`);
  ensureFreshVersion(state);
  applyAssetUrlSelection();
  summary.message = `已处理 ${files.length} 个文件`;
  return summary;
}

function openAssetLocationUpdateImport() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".xlsx,.csv";
  input.multiple = true;
  input.style.display = "none";
  document.body.appendChild(input);
  input.addEventListener("change", async () => {
    const files = Array.from(input.files || []).filter((file) => [".xlsx", ".csv"].some((extension) => file.name.toLowerCase().endsWith(extension)));
    input.remove();
    if (!files.length) {
      alert("请选择 .xlsx 或 .csv 位置更新表。表头至少包含资产编号和新位置。");
      return;
    }
    try {
      assetLocationUpdateResult = await importFilesBatch(files, "/api/assets/location-import", "locationUpdateResult");
      alert(importResultSummary(assetLocationUpdateResult));
      render();
    } catch (exc) {
      alert(exc.message || "位置更新失败");
    }
  }, { once: true });
  input.click();
}

function openAssetImageUpdateImport() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".xlsx,.csv";
  input.multiple = true;
  input.style.display = "none";
  document.body.appendChild(input);
  input.addEventListener("change", async () => {
    const files = Array.from(input.files || []).filter((file) => [".xlsx", ".csv"].some((extension) => file.name.toLowerCase().endsWith(extension)));
    input.remove();
    if (!files.length) {
      alert("请选择 .xlsx 或 .csv 参考图表。表头至少包含资产名称；图片可插在 Excel 对应行，或填写在参考图/图片列。");
      return;
    }
    try {
      assetImageUpdateResult = await importFilesBatch(files, "/api/assets/image-import", "imageUpdateResult");
      alert(importResultSummary(assetImageUpdateResult));
      render();
    } catch (exc) {
      alert(exc.message || "参考图更新失败");
    }
  }, { once: true });
  input.click();
}

async function updateSingleAssetLocation(assetId) {
  const asset = state.assets.find((item) => item.id === assetId);
  if (!asset) return;
  const location = prompt(`更新“${asset.name}（${asset.code || "无编号"}）”的位置`, asset.location || "");
  if (location === null) return;
  const cleanLocation = location.trim();
  if (!cleanLocation) {
    alert("位置不能为空。");
    return;
  }
  try {
    state = await api("/api/assets/location", {
      method: "POST",
      body: JSON.stringify(withActor({ assetId: asset.id, location: cleanLocation }))
    });
    render();
  } catch (exc) {
    alert(exc.message || "位置更新失败");
  }
}

function uploadSingleAssetReferenceImage(assetId) {
  const asset = state.assets.find((item) => item.id === assetId);
  if (!asset) return;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/webp,image/gif";
  input.style.display = "none";
  document.body.appendChild(input);
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      alert("图片太大，请选择 8MB 以内的图片。");
      return;
    }
    try {
      const image = await imageToDataUrl(file);
      state = await api("/api/assets/image", {
        method: "POST",
        body: JSON.stringify(withActor({ assetId: asset.id, image }))
      });
      render();
    } catch (exc) {
      alert(exc.message || "参考图上传失败");
    }
  }, { once: true });
  input.click();
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
  const data = await api(`/api/import-archives/content?id=${encodeURIComponent(archiveId)}&${authQuery()}`);
  downloadBlob(data.fileName || "导入留档文件", base64ToBlob(data.contentBase64));
}

function fileNameFromDisposition(disposition, fallback) {
  const text = String(disposition || "");
  const utfMatch = text.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch) return decodeURIComponent(utfMatch[1]);
  const plainMatch = text.match(/filename="?([^";]+)"?/i);
  return plainMatch ? plainMatch[1] : fallback;
}

async function throwDownloadError(response, fallback) {
  let data = {};
  try {
    data = await response.json();
  } catch {}
  if (data.code === "SESSION_EXPIRED") throw handleSessionExpired(data.error);
  const error = new Error(data.error || fallback || "下载失败");
  error.status = response.status;
  error.code = data.code || "";
  throw error;
}

async function downloadAuthorizedUrl(url, fallbackName, fallbackError = "下载失败") {
  const response = await fetch(url);
  if (!response.ok) await throwDownloadError(response, fallbackError);
  const blob = await response.blob();
  const fileName = fileNameFromDisposition(response.headers.get("Content-Disposition"), fallbackName);
  downloadBlob(fileName, blob);
}

async function downloadAssetPrintTemplates() {
  const assetIds = (view === "assets" ? selectedLedgerAssets() : filteredAssets()).map((asset) => asset.id);
  if (!assetIds.length) {
    alert("没有可打印的资产数据。");
    return;
  }
  const response = await fetch("/api/assets/print-template", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor({ assetIds }))
  });
  if (!response.ok) await throwDownloadError(response, "生成模板失败");
  const blob = await response.blob();
  const fileName = fileNameFromDisposition(response.headers.get("Content-Disposition"), "资产申请确认单.docx");
  downloadBlob(fileName, blob);
}

function filteredAssets() {
  return filteredAssetGroups().flatMap((group) => group.assets);
}

function downloadAssetsTable() {
  const headers = ["序号", "资产编号", "物品名称", "品牌", "类别", "规格", "单位", "数量", "单价", "总金额", "购置日期", "入库日期", "供应商", "使用部门", "使用人", "位置", "状态", "资产来源", "创建人", "更新时间", "备注"];
  const rows = (view === "assets" ? selectedLedgerAssets() : filteredAssets()).map((asset, index) => [
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
  const templates = {
    inbound: {
      fileName: "学校资产底表导入模板.csv",
      header: "资产分类,资产名称,规格型号,资产编号,数量,单位,资产原值,取得日期,部门,具体存放地点,资产状态,清查盘点情况,清查盘盈情况,纸质单号,备注",
      sample: "电子设备,联想笔记本电脑,ThinkPad X1,304014-2010105-000001,1,台,6800,2026-06-01,训练中心,701室,在库,未盘点,,RK-20260601,学校资产底表导入"
    },
    personAsset: {
      fileName: "人员资产使用表导入模板.csv",
      header: isMultiDepartment()
        ? "资产编号,资产名称,规格型号,类型,数量,部门,使用人,出库时间,纸质单号,备注"
        : "资产编号,资产名称,规格型号,类型,数量,使用人,出库时间,纸质单号,备注",
      sample: isMultiDepartment()
        ? "304014-2010105-000001,联想笔记本电脑,ThinkPad X1,出库,1,训练中心,张三,2026-06-01,CK-20260601,人员资产使用表导入"
        : "304014-2010105-000001,联想笔记本电脑,ThinkPad X1,出库,1,张三,2026-06-01,CK-20260601,人员资产使用表导入"
    },
    personConsumable: {
      fileName: "人员耗材领用表导入模板.csv",
      header: isMultiDepartment()
        ? "耗材名称,规格型号,类型,数量,单位,部门,使用人,出库时间,纸质单号,备注"
        : "耗材名称,规格型号,类型,数量,单位,使用人,出库时间,纸质单号,备注",
      sample: isMultiDepartment()
        ? "A4打印纸,80g,出库,5,包,训练中心,李四,2026-06-01,HC-20260601,人员耗材领用表导入"
        : "A4打印纸,80g,出库,5,包,李四,2026-06-01,HC-20260601,人员耗材领用表导入"
    },
    word: {
      fileName: "Word出借单导入说明.csv",
      header: "单据类型,支持格式,必填内容,说明",
      sample: "出借单或耗材领用单,.docx,申领人/物品名称/数量/领用日期,可上传单个 Word 文件或整个文件夹"
    }
  };
  const template = templates[importKind] || templates.inbound;
  const csv = `\ufeff${template.header}\n${template.sample}\n`;
  downloadTextFile(template.fileName, csv);
}

function importRuleText() {
  if (importKind === "personAsset") {
    return "人员资产使用表校验规则：资产编号必须已存在于学校资产底表；资产不能处于维修或报废；同一资产已被他人使用时标记冲突；导入后只更新原资产状态并生成出库流水。";
  }
  if (importKind === "personConsumable") {
    return "人员耗材领用表校验规则：按耗材名称和规格型号匹配库存；库存数量必须足够；耗材不存在、库存不足或领用人缺失会标记异常；导入后扣减库存并生成耗材出库流水。";
  }
  if (importKind === "word") {
    return "Word 单据校验规则：优先识别标准表格；无法自动识别的扫描件进入待复核；重复文件不会重复生成流水。";
  }
  return "学校资产底表校验规则：按资产编号去重，已有资产执行增量更新；资产分类、资产名称、规格型号用于归类；耗材会按名称和规格进入库存管理。";
}

function recheckImportPreview() {
  renderSelectedFiles(selectedImportFiles(document.querySelector("#bulkImportForm"), importConfig().extensions));
  alert("已重新读取当前选择文件。导入前系统会在后台再次校验必填项、重复文件、重复行和匹配关系。");
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
        requestAnimationFrame(() => document.querySelector("#bulkImportForm")?.scrollIntoView({ behavior: "smooth", block: "center" }));
        return;
      }
      view = normalizeViewKey(action);
      if (["users", "baseData", "settings", "audit"].includes(action)) systemSection = action;
      if (action === "assetRequests") requestSection = "asset";
      if (action === "purchaseWishes") requestSection = "purchase";
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

async function repairImportedUsers(mode) {
  if (!can("users.manage")) return;
  const payload = {
    mode,
    includeInactive: Boolean(document.querySelector("#repairUserIncludeInactive")?.checked),
    skipAdmin: Boolean(document.querySelector("#repairUserSkipAdmin")?.checked),
    skipReferenced: Boolean(document.querySelector("#repairUserSkipReferenced")?.checked),
  };
  if (mode === "fixFromList" || mode === "deleteFromList") {
    const candidateIds = getUserRepairCandidateIds();
    if (!candidateIds.length) {
      const actionText = mode === "deleteFromList" ? "清除" : "修复";
      alert(`请先运行“预检可疑用户”，确认有可处理项后，再点击“按预检列表${actionText}”。`);
      return;
    }
    payload.candidateIds = candidateIds;
  }
  const isDirectFix = mode === "fix" || mode === "fixFromList" || mode === "deleteFromList";
  const finalMode = mode === "fixFromList" ? "fix" : mode === "deleteFromList" ? "delete" : mode;
  payload.mode = finalMode;
  if (finalMode === "delete") {
    payload.unlinkReferences = true;
  }
  userRepairOptions = {
    includeInactive: payload.includeInactive,
    skipAdmin: payload.skipAdmin,
    skipReferenced: payload.skipReferenced,
  };
  if (isDirectFix) {
    if (finalMode === "delete") {
      if (!confirm("该操作会先解绑选中的可疑账号历史引用，再执行不可恢复删除，请确认无误后继续。")) return;
    } else {
      if (!confirm("该操作将停用可疑账号（默认不删除），是否继续？请先确认预检结果无误。")) return;
    }
  }
  userRepairState = { mode: finalMode, loading: true };
  render();
  try {
    userRepairState = await api("/api/users/repair", {
      method: "POST",
      body: JSON.stringify(withActor(payload)),
    });
    applyUserRepairResultToState(userRepairState);
    if (userRepairState?.checked) {
      userRepairState.source = finalMode === "fix" && payload.candidateIds ? "candidate-only" : "full-scan";
    }
    if (finalMode === "delete") {
      userRepairState.source = payload.candidateIds ? "candidate-only" : "full-scan";
    }
    render();
    if (finalMode === "fix") {
      alert(`修复完成：停用 ${userRepairState.updatedCount || 0} 条，跳过 ${userRepairState.skippedCount || 0} 条。`);
      return;
    }
    if (finalMode === "delete") {
      alert(`清除完成：清除 ${userRepairState.updatedCount || 0} 条，跳过 ${userRepairState.skippedCount || 0} 条。`);
    }
  } catch (exc) {
    userRepairState = null;
    alert(exc.message);
    render();
  }
}

function applyUserRepairResultToState(result) {
  const changedIds = new Set((result?.updated || []).map((item) => String(item.id || "").trim()).filter(Boolean));
  if (!changedIds.size) return;
  if (result.mode === "delete") {
    state.users = (state.users || []).filter((user) => !changedIds.has(String(user.id)));
    return;
  }
  if (result.mode === "fix") {
    state.users = (state.users || []).map((user) => changedIds.has(String(user.id)) ? { ...user, active: false } : user);
  }
}

function updateSelectedImportedUserRowsUI() {
  const selectedCount = document.querySelectorAll("[data-imported-user-select]:checked").length;
  const countLabel = document.querySelector("#selectedImportedUserRowsCount");
  const batchButton = document.querySelector("#clearSelectedImportedUserRows");
  const selectAll = document.querySelector("#selectAllImportedUserRows");
  const rowCheckboxes = [...document.querySelectorAll("[data-imported-user-select]")];
  if (countLabel) countLabel.textContent = `已选 ${selectedCount} 条`;
  if (batchButton) batchButton.disabled = selectedCount === 0;
  if (selectAll) {
    selectAll.checked = rowCheckboxes.length > 0 && selectedCount === rowCheckboxes.length;
    selectAll.indeterminate = selectedCount > 0 && selectedCount < rowCheckboxes.length;
  }
}

async function clearSelectedImportedUsers() {
  if (!can("users.manage")) return;
  const selectedIds = [...document.querySelectorAll("[data-imported-user-select]:checked")]
    .map((item) => String(item.dataset.importedUserSelect || "").trim())
    .filter(Boolean);
  if (!selectedIds.length) {
    alert("请先在用户列表左侧勾选需要批量删除的记录。");
    return;
  }
  const selectedUsers = selectedIds
    .map((id) => state.users.find((user) => String(user.id) === id))
    .filter(Boolean);
  const preview = selectedUsers.slice(0, 6).map((user) => user.name).join("、");
  const suffix = selectedUsers.length > 6 ? ` 等 ${selectedUsers.length} 条` : ` ${selectedUsers.length} 条`;
  if (!confirm(`将删除你勾选的用户：${preview}${suffix}。系统会先解绑历史引用，再执行不可恢复删除；管理员和当前账号会跳过。是否继续？`)) return;
  userRepairState = { mode: "delete", loading: true };
  render();
  try {
    userRepairState = await api("/api/users/repair", {
      method: "POST",
      body: JSON.stringify(withActor({
        mode: "delete",
        candidateIds: selectedIds,
        includeInactive: true,
        skipAdmin: true,
        unlinkReferences: true,
        forceSelected: true,
      })),
    });
    applyUserRepairResultToState(userRepairState);
    userRepairState.source = "selected-list";
    render();
    alert(`删除完成：删除 ${userRepairState.updatedCount || 0} 条，跳过 ${userRepairState.skippedCount || 0} 条。`);
  } catch (exc) {
    userRepairState = null;
    alert(exc.message);
    render();
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
  if (nextMode === "user" && ["system", "users", "baseData", "settings", "audit"].includes(view)) {
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

function bindAssetRowContextMenu() {
  const menu = document.querySelector("#assetRowContextMenu");
  if (!menu || !can("assets.manage")) return;
  let selectedAssetId = "";

  document.querySelectorAll("[data-ledger-asset-row]").forEach((row) => {
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      selectedAssetId = row.dataset.ledgerAssetRow || "";
      const left = Math.min(event.clientX, window.innerWidth - 190);
      const top = Math.min(event.clientY, window.innerHeight - 170);
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
      menu.classList.add("open");
      menu.setAttribute("aria-hidden", "false");
      setTimeout(() => document.addEventListener("click", closeAssetRowContextMenu, { once: true }), 0);
    });
  });

  menu.querySelector("[data-asset-row-location]")?.addEventListener("click", async () => {
    closeAssetRowContextMenu();
    if (selectedAssetId) await updateSingleAssetLocation(selectedAssetId);
  });

  menu.querySelector("[data-asset-row-image]")?.addEventListener("click", () => {
    closeAssetRowContextMenu();
    if (selectedAssetId) uploadSingleAssetReferenceImage(selectedAssetId);
  });

  menu.querySelector("[data-asset-row-view]")?.addEventListener("click", () => {
    closeAssetRowContextMenu();
    if (!selectedAssetId) return;
    selectedAssetDetailId = selectedAssetId;
    render();
  });
}

function closeAssetRowContextMenu() {
  const menu = document.querySelector("#assetRowContextMenu");
  if (!menu) return;
  menu.classList.remove("open");
  menu.setAttribute("aria-hidden", "true");
}

function bindResizableDrawers() {
  document.querySelectorAll("[data-drawer-resize-handle]").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => {
      const drawer = handle.closest(".asset-drawer");
      if (!drawer) return;
      event.preventDefault();
      const kind = drawer.dataset.drawerKind || "default";
      const startX = event.clientX;
      const startWidth = drawer.getBoundingClientRect().width;
      const minWidth = Math.min(360, Math.max(280, window.innerWidth - 32));
      const maxWidth = Math.max(minWidth, window.innerWidth - 32);
      document.body.classList.add("drawer-resizing");
      const resize = (moveEvent) => {
        const nextWidth = Math.min(maxWidth, Math.max(minWidth, startWidth + startX - moveEvent.clientX));
        drawer.style.setProperty("--drawer-width", `${Math.round(nextWidth)}px`);
      };
      const stop = () => {
        const finalWidth = Math.round(drawer.getBoundingClientRect().width);
        localStorage.setItem(drawerWidthStorageKey(kind), String(finalWidth));
        document.body.classList.remove("drawer-resizing");
        window.removeEventListener("pointermove", resize);
        window.removeEventListener("pointerup", stop);
        window.removeEventListener("pointercancel", stop);
      };
      window.addEventListener("pointermove", resize);
      window.addEventListener("pointerup", stop);
      window.addEventListener("pointercancel", stop);
    });
  });
}

function bindEvents() {
  bindResizableDrawers();

  document.querySelector("#loginForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = document.querySelector("#loginError");
    error.textContent = "";
    try {
      const payload = formData(event.target);
      const rememberLogin = Boolean(payload.rememberLogin);
      delete payload.rememberLogin;
      const data = await api("/api/login", { method: "POST", body: JSON.stringify(payload) });
      saveStoredSession(data.user.id, data.sessionToken, rememberLogin);
      loginNotice = "";
      state.currentUser = data.user;
      view = "dashboard";
      await refresh();
    } catch (exc) {
      error.textContent = exc.message;
    }
  });

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      view = normalizeViewKey(button.dataset.view);
      render();
    });
  });

  document.querySelectorAll("[data-request-section]").forEach((button) => {
    button.addEventListener("click", () => {
      requestSection = button.dataset.requestSection || "asset";
      render();
    });
  });

  document.querySelectorAll("[data-system-section]").forEach((button) => {
    button.addEventListener("click", () => {
      systemSection = button.dataset.systemSection || "users";
      render();
    });
  });

  document.querySelector("#logoutBtn")?.addEventListener("click", async () => {
    try {
      await api("/api/logout", { method: "POST", body: JSON.stringify(withActor({})) });
    } catch {}
    loginNotice = "";
    clearStoredSession();
    localStorage.removeItem(VIEW_MODE_KEY);
    state.currentUser = null;
    view = "dashboard";
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
      if (error.code !== "SESSION_EXPIRED") alert(error.message || "生成模板失败");
    }
  });
  document.querySelector("#downloadAssets")?.addEventListener("click", downloadAssetsTable);

  document.querySelectorAll("[data-empty-action]").forEach((button) => {
    button.addEventListener("click", () => {
      let action = {};
      try {
        action = JSON.parse(button.dataset.emptyAction || "{}");
      } catch {}
      if (action.view) view = normalizeViewKey(action.view);
      if (action.mode) recordMode = action.mode;
      if (action.action) recordActionMode = action.action;
      if (action.importKind) importKind = action.importKind;
      if (action.assetStatusFilter) assetStatusFilter = action.assetStatusFilter;
      if (action.requestSection) requestSection = action.requestSection;
      if (action.systemSection) systemSection = action.systemSection;
      if (action.orderType) orderType = action.orderType;
      if (action.inventoryView) inventoryView = action.inventoryView;
      if (action.auditClear) {
        auditFilterField = "all";
        auditKeyword = "";
        auditStartTime = "";
        auditEndTime = "";
      }
      render();
    });
  });

  bindSearchInput("#dashboardSearch", (value) => {
    dashboardSearch = value;
  });

  document.querySelectorAll("[data-dashboard-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      dashboardMode = button.dataset.dashboardMode || "list";
      if (dashboardMode !== "usage") dashboardUsageUserId = "";
      ledgerDrawerKey = "";
      ledgerDrawerMode = "";
      render();
    });
  });

  document.querySelectorAll("[data-dashboard-category]").forEach((button) => {
    button.addEventListener("click", () => {
      dashboardCategory = button.dataset.dashboardCategory || "";
      render();
    });
  });

  document.querySelectorAll("[data-dashboard-person-card]").forEach((button) => {
    button.addEventListener("click", () => {
      dashboardUsageUserId = button.dataset.dashboardPersonCard || "";
      render();
    });
  });

  document.querySelector("[data-dashboard-person-clear]")?.addEventListener("click", () => {
    dashboardUsageUserId = "";
    render();
  });

  bindSearchInput("#assetSearch", (value) => {
    assetFilter = value;
    assetPage = 1;
  });

  bindSearchInput("#deviceGroupSearch", (value) => {
    deviceGroupFilter = value;
  });

  document.querySelectorAll("[data-device-family]").forEach((button) => {
    button.addEventListener("click", () => {
      assetFamilyFilter = button.dataset.deviceFamily || "all";
      assetPage = 1;
      render();
    });
  });

  document.querySelector("[data-asset-select-all]")?.addEventListener("change", (event) => {
    const visibleKeys = [...document.querySelectorAll("[data-asset-group-select]")].map((input) => input.dataset.assetGroupSelect);
    if (event.target.checked) {
      visibleKeys.forEach((key) => selectedAssetGroupKeys.add(key));
    } else {
      visibleKeys.forEach((key) => selectedAssetGroupKeys.delete(key));
    }
    render();
  });

  document.querySelectorAll("[data-asset-group-select]").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.assetGroupSelect;
      if (input.checked) selectedAssetGroupKeys.add(key);
      else selectedAssetGroupKeys.delete(key);
      render();
    });
  });

  document.querySelector("#clearAssetGroupSelectionInline")?.addEventListener("click", () => {
    selectedAssetGroupKeys.clear();
    render();
  });

  document.querySelector("#batchUpdateAssetLocations")?.addEventListener("click", openAssetLocationUpdateImport);
  document.querySelector("#batchUpdateAssetImages")?.addEventListener("click", openAssetImageUpdateImport);
  document.querySelector("#batchExportAssets")?.addEventListener("click", downloadAssetsTable);
  document.querySelector("#batchPrintAssetLabels")?.addEventListener("click", async () => {
    try {
      await downloadAssetPrintTemplates();
    } catch (error) {
      if (error.code !== "SESSION_EXPIRED") alert(error.message || "生成模板失败");
    }
  });
  document.querySelector("#batchClassifyAssets")?.addEventListener("click", () => {
    const groups = selectedAssetGroups();
    if (!groups.length) {
      alert("请先勾选要批量归类的资产组。");
      return;
    }
    selectedDeviceGroupKeys = new Set(groups.flatMap((group) => group.assets.map((asset) => assetAutoGroupKey(asset))));
    view = "system";
    systemSection = "baseData";
    render();
  });
  document.querySelector("#batchInventoryCheck")?.addEventListener("click", () => {
    view = "checks";
    render();
  });

  document.querySelectorAll("[data-asset-primary-action]").forEach((button) => {
    button.addEventListener("click", () => {
      recordPrefillAssetId = button.dataset.assetId || "";
      recordActionMode = button.dataset.assetPrimaryAction === "return" ? "return" : "lend";
      recordMode = "manual";
      view = "records";
      render();
      requestAnimationFrame(() => document.querySelector("#recordForm")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    });
  });

  document.querySelectorAll("[data-ledger-open-group]").forEach((button) => {
    button.addEventListener("click", () => {
      ledgerDrawerKey = button.dataset.ledgerOpenGroup || "";
      ledgerDrawerMode = "group";
      selectedAssetDetailId = "";
      render();
    });
  });

  document.querySelectorAll("[data-ledger-status]").forEach((button) => {
    button.addEventListener("click", () => {
      ledgerDrawerKey = button.dataset.ledgerGroup || "";
      ledgerDrawerMode = button.dataset.ledgerStatus || "group";
      selectedAssetDetailId = "";
      render();
    });
  });

  document.querySelectorAll("[data-ledger-drawer-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      ledgerDrawerKey = button.dataset.ledgerGroup || ledgerDrawerKey;
      ledgerDrawerMode = button.dataset.ledgerDrawerTab || "group";
      render();
    });
  });

  document.querySelector("#closeLedgerDetail")?.addEventListener("click", () => {
    ledgerDrawerKey = "";
    ledgerDrawerMode = "";
    render();
  });
  document.querySelector("#ledgerDetailBackdrop")?.addEventListener("click", () => {
    ledgerDrawerKey = "";
    ledgerDrawerMode = "";
    render();
  });

  document.querySelectorAll("[data-ledger-focus-asset]").forEach((button) => {
    button.addEventListener("click", () => {
      const form = document.querySelector(`[data-ledger-checkout-form="${CSS.escape(button.dataset.ledgerFocusAsset || "")}"]`);
      const select = form?.querySelector("select[name='userId']");
      select?.focus();
    });
  });

  document.querySelectorAll("[data-ledger-location-edit]").forEach((button) => {
    button.addEventListener("click", () => updateSingleAssetLocation(button.dataset.ledgerLocationEdit));
  });

  document.querySelectorAll("[data-ledger-checkout-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const payload = withActor(formData(event.currentTarget));
      if (!payload.userId) {
        alert("请选择要划到名下的使用人。");
        return;
      }
      payload.type = "出库";
      payload.quantity = 1;
      payload.outTime = nowLocal();
      payload.inTime = "";
      payload.paperNo = "";
      payload.note = "资产台账划一笔";
      try {
        state = await api("/api/records", { method: "POST", body: JSON.stringify(payload) });
        ledgerDrawerMode = "checked_out";
        render();
      } catch (exc) {
        alert(exc.message);
      }
    });
  });

  document.querySelectorAll("[data-device-group-select]").forEach((input) => {
    input.addEventListener("change", () => {
      const groupKey = input.dataset.deviceGroupSelect;
      const group = deviceGroupByKey(groupKey);
      if (input.checked) {
        selectedDeviceGroupKeys.add(groupKey);
        if (!deviceGroupDraftName && group) deviceGroupDraftName = group.manualName || group.model || "";
        if (!deviceGroupDraftFamily && group) deviceGroupDraftFamily = group.familyId || "";
      } else {
        selectedDeviceGroupKeys.delete(groupKey);
        if (!selectedDeviceGroupKeys.size) {
          deviceGroupDraftName = "";
          deviceGroupDraftFamily = "";
        }
      }
      render();
    });
  });

  document.querySelectorAll("[data-assign-device-group]").forEach((button) => {
    button.addEventListener("click", () => {
      const group = deviceGroupByKey(button.dataset.assignDeviceGroup);
      if (!group) return;
      selectedDeviceGroupKeys = new Set([group.key]);
      deviceGroupDraftName = group.manualName || group.model || "";
      deviceGroupDraftFamily = group.familyId || "";
      render();
      setTimeout(() => document.querySelector("#deviceGroupAssignForm")?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
    });
  });

  document.querySelector("#clearDeviceGroupSelection")?.addEventListener("click", () => {
    selectedDeviceGroupKeys.clear();
    deviceGroupDraftName = "";
    deviceGroupDraftFamily = "";
    render();
  });

  document.querySelector("#deviceGroupAssignForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = withActor(formData(event.target));
    payload.sourceKeys = selectedDeviceSourceKeys();
    if (!payload.sourceKeys.length) {
      alert("请先勾选要归到一起的设备组。");
      return;
    }
    try {
      state = await api("/api/device-groups/assign", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      selectedDeviceGroupKeys.clear();
      deviceGroupDraftName = "";
      deviceGroupDraftFamily = "";
      assetPage = 1;
      render();
    } catch (exc) {
      alert(exc.message);
    }
  });

  document.querySelectorAll("[data-unassign-device-group]").forEach((button) => {
    button.addEventListener("click", async () => {
      const group = deviceGroupByKey(button.dataset.unassignDeviceGroup);
      if (!group) return;
      if (!confirm(`确定取消“${group.model}”的手动归类吗？`)) return;
      try {
        state = await api("/api/device-groups/unassign", {
          method: "POST",
          body: JSON.stringify(withActor({ sourceKeys: group.sourceKeyList || [] }))
        });
        selectedDeviceGroupKeys.delete(group.key);
        render();
      } catch (exc) {
        alert(exc.message);
      }
    });
  });

  document.querySelectorAll("[data-unassign-manual-name]").forEach((button) => {
    button.addEventListener("click", async () => {
      const groupName = button.dataset.unassignManualName;
      if (!groupName) return;
      if (!confirm(`确定取消“${groupName}”下的全部手动归类吗？`)) return;
      try {
        state = await api("/api/device-groups/unassign", {
          method: "POST",
          body: JSON.stringify(withActor({ groupName }))
        });
        selectedDeviceGroupKeys.clear();
        render();
      } catch (exc) {
        alert(exc.message);
      }
    });
  });

  document.querySelector("#assetStatusFilter")?.addEventListener("change", (event) => {
    assetStatusFilter = event.target.value;
    assetPage = 1;
    render();
  });

  document.querySelector("#toggleAssetCategoryPanel")?.addEventListener("click", () => {
    assetCategoryPanelOpen = !assetCategoryPanelOpen;
    render();
  });

  document.querySelectorAll("[data-asset-category-option]").forEach((input) => {
    input.addEventListener("change", () => {
      const category = input.dataset.assetCategoryOption;
      assetCategoryFilters = input.checked
        ? [...new Set([...assetCategoryFilters, category])]
        : assetCategoryFilters.filter((item) => item !== category);
      assetPage = 1;
      render();
    });
  });

  document.querySelector("[data-asset-category-all]")?.addEventListener("click", () => {
    assetCategoryFilters = [...new Set([
      ...state.assets.map((asset) => assetKind(asset)),
      ...state.assets.map((asset) => asset.category),
      ...assetCategories()
    ].filter(Boolean))].slice(0, 28);
    assetPage = 1;
    render();
  });

  document.querySelector("[data-asset-category-clear]")?.addEventListener("click", () => {
    assetCategoryFilters = [];
    assetPage = 1;
    render();
  });

  document.querySelector("[data-asset-category-reset]")?.addEventListener("click", () => {
    assetCategoryFilters = [];
    assetPage = 1;
    render();
  });

  document.querySelector("[data-asset-category-apply]")?.addEventListener("click", () => {
    assetCategoryPanelOpen = false;
    render();
  });

  document.querySelector("#assetFamilyFilter")?.addEventListener("change", (event) => {
    assetFamilyFilter = event.target.value;
    assetPage = 1;
    render();
  });

  document.querySelector("#assetKeeperFilter")?.addEventListener("change", (event) => {
    assetKeeperFilter = event.target.value;
    assetPage = 1;
    render();
  });

  document.querySelector("#assetBorrowerFilter")?.addEventListener("change", (event) => {
    assetBorrowerFilter = event.target.value;
    if (assetBorrowerFilter !== "all") assetStatusFilter = "checked_out";
    assetPage = 1;
    render();
  });

  document.querySelector("#clearBorrowerDetail")?.addEventListener("click", () => {
    assetBorrowerFilter = "all";
    render();
  });

  document.querySelector("#assetSortField")?.addEventListener("change", (event) => {
    assetSortField = event.target.value;
    assetPage = 1;
    render();
  });

  document.querySelector("#assetSortDir")?.addEventListener("change", (event) => {
    assetSortDir = event.target.value;
    assetPage = 1;
    render();
  });

  document.querySelector("#toggleAdvancedAssetFilters")?.addEventListener("click", () => {
    assetAdvancedFiltersOpen = !assetAdvancedFiltersOpen;
    render();
  });

  document.querySelector("#clearAssetSelection")?.addEventListener("click", () => {
    selectedAssetId = "";
    assetFilter = "";
    assetFamilyFilter = "all";
    deviceGroupFilter = "";
    assetStatusFilter = "all";
    assetCategoryFilters = [];
    assetCategoryPanelOpen = false;
    assetAdvancedFiltersOpen = false;
    assetKeeperFilter = "all";
    assetBorrowerFilter = "all";
    assetSortField = "outTime";
    assetSortDir = "desc";
    ledgerDrawerKey = "";
    ledgerDrawerMode = "";
    assetPage = 1;
    render();
  });

  document.querySelectorAll("[data-asset-page]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextPage = Number(button.dataset.assetPage || assetPage);
      if (!Number.isFinite(nextPage) || nextPage < 1) return;
      assetPage = nextPage;
      render();
    });
  });

  document.querySelectorAll("#topAssetPageSize, #bottomAssetPageSize").forEach((select) => {
    select.addEventListener("change", (event) => {
      assetPageSize = Number(event.target.value || 10);
      assetPage = 1;
      render();
    });
  });

  document.querySelectorAll("#topAssetPageJump, #bottomAssetPageJump").forEach((input) => {
    input.addEventListener("change", (event) => {
      assetPage = Math.max(1, Number(event.target.value || 1));
      render();
    });
  });

  bindSearchInput("#inventorySearch", (value) => {
    inventoryFilter = value;
  });

  document.querySelector("#clearInventorySearch")?.addEventListener("click", () => {
    inventoryFilter = "";
    render();
  });

  document.querySelectorAll("[data-inventory-view]").forEach((button) => {
    button.addEventListener("click", () => {
      inventoryView = button.dataset.inventoryView || "status";
      render();
    });
  });

  document.querySelector("#inventoryAdjustForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = withActor(formData(event.target));
    const asset = resolveInventoryAsset(payload.assetLookup);
    if (!asset) {
      alert("没有匹配到耗材。请确认输入的是耗材名称、资产编号、规格，或有效资产详情链接。");
      return;
    }
    payload.assetId = asset.id;
    delete payload.assetLookup;
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

  document.querySelectorAll("[data-inventory-source]").forEach((button) => {
    button.addEventListener("click", () => {
      inventoryAdjustSource = button.dataset.inventorySource || "manual";
      render();
    });
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
      ledgerDrawerKey = "";
      ledgerDrawerMode = "";
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
      selectedCheckTaskId = state.inventoryCheckTasks?.[0]?.id || "";
      selectedCheckGroupKey = "";
      activeCheckItemId = "";
      render();
    } catch (exc) {
      alert(exc.message);
    }
  });

  document.querySelectorAll("[data-select-check-task]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedCheckTaskId = button.dataset.selectCheckTask || "";
      selectedCheckGroupKey = "";
      activeCheckItemId = "";
      render();
    });
  });

  document.querySelectorAll("[data-check-group]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedCheckGroupKey = button.dataset.checkGroup || "";
      const activeTask = currentCheckTask();
      const group = checkGroupsForActiveTask(activeTask).find((entry) => entry.key === selectedCheckGroupKey);
      activeCheckItemId = firstPendingCheckItem(group)?.id || "";
      render();
    });
  });

  document.querySelectorAll("[data-check-active-item]").forEach((button) => {
    button.addEventListener("click", () => {
      activeCheckItemId = button.dataset.checkActiveItem || "";
      selectedCheckGroupKey = button.dataset.checkGroup || selectedCheckGroupKey;
      render();
    });
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
        selectNextCheckItem(itemId);
        render();
        requestAnimationFrame(() => {
          const target = document.querySelector(`[data-check-active-item="${CSS.escape(activeCheckItemId || "")}"]`);
          target?.closest("tr")?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
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
    button.addEventListener("click", async () => {
      try {
        await downloadAuthorizedUrl(
          `/api/inventory-checks/export?taskId=${encodeURIComponent(button.dataset.exportCheck)}&${authQuery()}`,
          "盘点报告.csv",
          "导出盘点报告失败"
        );
      } catch (exc) {
        if (exc.code !== "SESSION_EXPIRED") alert(exc.message);
      }
    });
  });

  document.querySelectorAll("[data-export-report]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await downloadAuthorizedUrl(
          `/api/reports/export?type=${encodeURIComponent(button.dataset.exportReport)}&${authQuery()}`,
          "资产报表.csv",
          "导出报表失败"
        );
      } catch (exc) {
        if (exc.code !== "SESSION_EXPIRED") alert(exc.message);
      }
    });
  });

  document.querySelector("#exportPurchaseWishes")?.addEventListener("click", async () => {
    try {
      await downloadAuthorizedUrl(
        `/api/purchase-wishes/export?${authQuery()}`,
        "采购需求表.xlsx",
        "导出采购需求失败"
      );
    } catch (exc) {
      if (exc.code !== "SESSION_EXPIRED") alert(exc.message);
    }
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
        if (exc.code !== "SESSION_EXPIRED") alert(`下载失败：${exc.message}`);
      }
    });
  });

  document.querySelectorAll("[data-import-archive-detail]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = (state.importArchives || []).find((archive) => archive.id === button.dataset.importArchiveDetail);
      if (item) alert(importArchiveDetailText(item));
    });
  });

  document.querySelector("#departmentFilter")?.addEventListener("change", (event) => {
    selectedDepartment = event.target.value;
    render();
  });

  document.querySelector("#downloadInboundTemplate")?.addEventListener("click", downloadInboundTemplate);
  document.querySelector("#recordStatsPeriod")?.addEventListener("change", (event) => {
    recordStatsPeriod = event.target.value || nowLocal().slice(0, 7);
  });
  document.querySelector("#refreshRecordsBtn")?.addEventListener("click", refresh);

  document.querySelectorAll("[data-import-kind]").forEach((button) => {
    button.addEventListener("click", () => {
      importKind = button.dataset.importKind;
      render();
    });
  });

  document.querySelector("[data-import-rules]")?.addEventListener("click", () => {
    alert(importRuleText());
  });

  document.querySelector("[data-import-recheck]")?.addEventListener("click", recheckImportPreview);

  document.querySelectorAll("#bulkFileInput, #bulkFolderInput").forEach((input) => {
    input.addEventListener("change", () => {
      renderSelectedFiles(selectedImportFiles(document.querySelector("#bulkImportForm"), importConfig().extensions));
    });
  });

  const uploadZone = document.querySelector("[data-upload-zone]");
  uploadZone?.addEventListener("click", (event) => {
    if (event.target.closest("label, button")) return;
    document.querySelector("#bulkFileInput")?.click();
  });
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
      alert(`请选择${config.shortLabel}文件，或选择包含这些文件的文件夹。`);
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
    const imageFile = event.target.imageFile?.files?.[0];
    delete payload.imageFile;
    if (payload.removeImage) {
      payload.image = "";
    } else if (imageFile) {
      payload.image = await imageToDataUrl(imageFile);
    }
    delete payload.removeImage;
    const endpoint = payload.assetId ? "/api/assets/update" : "/api/assets";
    state = await api(endpoint, { method: "POST", body: JSON.stringify(payload) });
    assetDrawerOpen = false;
    editingAssetId = "";
    render();
  });

  document.querySelector("#recordForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = withActor(formData(event.target));
    const asset = resolveRecordAsset(payload.assetLookup || payload.assetId);
    if (!asset) {
      alert("没有匹配到资产。请确认输入的是资产名称、编号、规格，或有效资产详情链接。");
      return;
    }
    payload.assetId = asset.id;
    delete payload.assetLookup;
    payload.quantity = Number(payload.quantity);
    const photoFile = event.target.photoFile?.files?.[0];
    delete payload.photoFile;
    payload.photo = await imageToDataUrl(photoFile);
    try {
      state = await api("/api/records", { method: "POST", body: JSON.stringify(payload) });
      render();
    } catch (exc) {
      alert(exc.message);
    }
  });

  document.querySelector("#recordForm")?.addEventListener("input", updateManualRecordPreview);
  document.querySelector("#recordForm")?.addEventListener("change", updateManualRecordPreview);
  document.querySelector("#recordForm")?.addEventListener("reset", () => {
    setTimeout(() => {
      const form = document.querySelector("#recordForm");
      form?.querySelectorAll("[data-record-type]").forEach((item, index) => item.classList.toggle("active", index === 0));
      if (form?.type) form.type.value = "入库";
      recordActionMode = "inbound";
      recordPrefillAssetId = "";
      updateManualRecordPreview();
    }, 0);
  });

  document.querySelectorAll("[data-record-action]:not([data-record-type])").forEach((button) => {
    button.addEventListener("click", () => {
      recordActionMode = button.dataset.recordAction || "inbound";
      render();
      requestAnimationFrame(() => document.querySelector("#recordForm")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    });
  });

  document.querySelectorAll("[data-record-type]").forEach((button) => {
    button.addEventListener("click", () => {
      const form = document.querySelector("#recordForm");
      form.querySelectorAll("[data-record-type]").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      recordActionMode = button.dataset.recordAction || (button.dataset.recordType === "出库" ? "lend" : "inbound");
      const action = recordActionConfig();
      form.type.value = button.dataset.recordType;
      if (form.inTime) form.inTime.value = action.inTime;
      if (form.outTime) form.outTime.value = action.outTime;
      if (form.note && (!form.note.value || ["新增入库", "划一笔出借", "归还登记", "耗材领用"].includes(form.note.value))) form.note.value = action.note;
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

  const purchaseWishForm = document.querySelector("#purchaseWishForm");
  if (purchaseWishForm) {
    updatePurchaseWishTotal(purchaseWishForm);
    purchaseWishForm.addEventListener("input", (event) => {
      if (event.target.name === "upliftRate" && purchaseWishForm.upliftPreset) {
        purchaseWishForm.upliftPreset.value = "custom";
      }
      if (["quantity", "unitPrice", "upliftRate"].includes(event.target.name)) {
        updatePurchaseWishTotal(purchaseWishForm);
      }
    });
    purchaseWishForm.addEventListener("change", (event) => {
      if (event.target.name === "upliftPreset" && event.target.value !== "custom" && purchaseWishForm.upliftRate) {
        purchaseWishForm.upliftRate.value = event.target.value;
      }
      if (["quantity", "unitPrice", "upliftRate", "upliftPreset"].includes(event.target.name)) {
        updatePurchaseWishTotal(purchaseWishForm);
      }
    });
  }

  purchaseWishForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = withActor(formData(event.target));
    payload.quantity = Math.max(1, Number(payload.quantity || 1) || 1);
    payload.unitPrice = Math.max(0, Number(payload.unitPrice || 0) || 0);
    payload.upliftRate = purchaseWishUpliftRate(event.target);
    payload.totalAmount = Number(updatePurchaseWishTotal(event.target).toFixed(2));
    payload.unit = "件";
    delete payload.upliftPreset;
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
  document.querySelector("#selectAllImportedUserRows")?.addEventListener("change", (event) => {
    document.querySelectorAll("[data-imported-user-select]").forEach((checkbox) => {
      checkbox.checked = event.target.checked;
    });
    updateSelectedImportedUserRowsUI();
  });
  document.querySelectorAll("[data-imported-user-select]").forEach((checkbox) => {
    checkbox.addEventListener("change", updateSelectedImportedUserRowsUI);
  });
  document.querySelector("#clearSelectedImportedUserRows")?.addEventListener("click", async () => {
    await clearSelectedImportedUsers();
  });
  updateSelectedImportedUserRowsUI();

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

  document.querySelector("#runUserRepairDryrun")?.addEventListener("click", async () => {
    await repairImportedUsers("dryrun");
  });
  document.querySelector("#runUserRepairFix")?.addEventListener("click", async () => {
    await repairImportedUsers("fix");
  });
  document.querySelector("#runUserRepairFixFromList")?.addEventListener("click", async () => {
    await repairImportedUsers("fixFromList");
  });
  document.querySelector("#runUserRepairDeleteFromList")?.addEventListener("click", async () => {
    await repairImportedUsers("deleteFromList");
  });
  document.querySelector("#clearUserRepairState")?.addEventListener("click", () => {
    userRepairState = null;
    render();
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

  document.querySelector("#assetForm input[name='imageFile']")?.addEventListener("change", (event) => {
    const fileName = event.target.files?.[0]?.name || "支持 JPG、PNG、WebP，自动压缩";
    const label = document.querySelector("#assetImageFileName");
    if (label) label.textContent = fileName;
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

  document.querySelector("#checkSystemHealth")?.addEventListener("click", async () => {
    systemHealthLoading = true;
    render();
    try {
      systemHealth = await api("/api/health");
    } catch (exc) {
      systemHealth = { ok: false, error: exc.message || "健康检查失败" };
    } finally {
      systemHealthCheckedAt = nowLocal();
      systemHealthLoading = false;
      render();
    }
  });

  document.querySelector("#copyUpdateCommand")?.addEventListener("click", async () => {
    await copyText(updateContainerCommand(), "更新容器命令已复制。", "复制下面的命令，在 PowerShell 里执行：");
  });

  document.querySelector("#copyHealthCommand")?.addEventListener("click", async () => {
    await copyText(healthCheckCommand(), "健康检查命令已复制。", "复制下面的命令，在 PowerShell 里执行：");
  });

  document.querySelector("#copyPortCommand")?.addEventListener("click", async () => {
    const command = portApplyCommand();
    await copyText(command, "端口重启命令已复制。", "复制下面的命令，在 PowerShell 里执行：");
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
        const asset = updateOrderAssetLookup(event.target);
        if (!asset) {
          alert("没有匹配到可办理资产。请确认输入的是资产名称、编号、规格，或有效资产详情链接。");
          return;
        }
        const payload = withActor(formData(event.target));
        payload.assetId = asset.id;
        delete payload.assetLookup;
        state = await api(endpoint, { method: "POST", body: JSON.stringify(payload) });
        render();
      } catch (exc) {
        alert(exc.message);
      }
    });
  });

  document.querySelectorAll(".order-asset-lookup input[name='assetLookup']").forEach((input) => {
    input.addEventListener("input", () => updateOrderAssetLookup(input.form));
    input.addEventListener("change", () => updateOrderAssetLookup(input.form));
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
    const confirmation = prompt("危险操作：将清空除登录账号外的全部数据，包括资产、流水、导入留档、部门、分类、位置、系统设置和操作记录。请输入“只保留登录账号”确认。", "");
    if (confirmation !== "只保留登录账号") return;
    try {
      state = await api("/api/debug/clear-files", {
        method: "POST",
        body: JSON.stringify(withActor())
      });
      alert("已清空除登录账号外的全部数据。");
      render();
    } catch (exc) {
      alert(exc.message);
    }
  });

  bindContextMenu();
  bindDepartmentContextMenu();
  bindUserContextMenu();
  bindAssetRowContextMenu();
}

loadState();

