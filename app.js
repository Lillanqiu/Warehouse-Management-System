const USER_KEY = "warehouse-current-user";
const SESSION_USER_KEY = "warehouse-session-user";
const VIEW_MODE_KEY = "warehouse-view-mode";
const APP_VERSION = "20260607-asset-category-manager-v73";

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
  settings: { departments: [], assetCategories: [], multiDepartmentEnabled: false, developerModeEnabled: false, adminPrefillEnabled: false, loginBackgroundImage: "", servicePort: "", printAssetTemplateName: "", printAssetTemplateCustom: false, printConsumableTemplateName: "", printConsumableTemplateCustom: false }
};
let loginSettings = { adminPrefillEnabled: false, adminPrefillPassword: "", loginBackgroundImage: "", appVersion: APP_VERSION };
let view = "dashboard";
let assetFilter = "";
let selectedAssetId = "";
let assetStatusFilter = "all";
let assetKeeperFilter = "all";
let assetCategoryManagerOpen = false;
let assetDrawerOpen = false;
let editingAssetId = "";
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
let searchRenderTimer = null;
let messagePanelOpen = false;
let composingInputs = new Set();

function viewRoleParam() {
  return localStorage.getItem(VIEW_MODE_KEY) === "user" ? "&viewRole=user" : "";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
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
  render();
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
  return state.currentUser?.role === "admin";
}

function isRealAdmin() {
  return state.currentUser?.actualRole === "admin" || state.currentUser?.role === "admin";
}

function isUserViewMode() {
  return isRealAdmin() && state.currentUser?.role !== "admin";
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
  const configured = state.settings?.assetCategories || [];
  if (configured.length) return configured;
  const fromAssets = [...new Set(state.assets.map((asset) => String(asset.category || "").trim()).filter(Boolean))].sort();
  return fromAssets.length ? fromAssets : ["固定资产", "低值易耗品", "耗材", "购进软件"];
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
    return assetGroupMatches(group, assetFilter);
  });
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
  const text = { in_stock: "在库", checked_out: "出库/出借", repair: "维修中", retired: "报废" }[status] || status;
  return `<span class="badge ${cls}">${text}</span>`;
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
    ["records", isAdmin() ? "出入库登记" : "我的出入库", "⇄"],
    ["assetRequests", isAdmin() ? "资产申请" : "申请资产", "□"],
    ["purchaseWishes", "需求清单", "☆"],
    ["paper", "纸质单据方案", "▤"],
    ...(isAdmin() ? [["users", pendingAdminRequests ? `用户管理(${pendingAdminRequests})` : "用户管理", "◉"], ["settings", "设置", "⚙"], ["audit", "操作记录", "◎"]] : [])
  ];
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
              <span>${isUserViewMode() ? "普通用户视角" : user.role === "admin" ? "管理员" : "普通用户"}${isMultiDepartment() ? ` · ${user.department}` : ""}</span>
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
            ${isAdmin() ? renderMessageCenter() : ""}
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
      ${isAdmin() ? `<button class="primary" id="openAssetDrawer" type="button">+ 新增资产</button>` : ""}
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
    assetRequests: isAdmin() ? "资产申请管理" : "申请资产",
    purchaseWishes: isAdmin() ? "采购需求清单" : "我的需求清单",
    records: isAdmin() ? "出入库登记" : "我的出入库状态",
    paper: "纸质单据电子化方案",
    users: "用户管理",
    settings: "系统设置",
    audit: "后台操作记录"
  }[view];
}

function pageSubtitle() {
  return {
    dashboard: "从数据库读取库存、出库、纸质单据和近期操作。",
    assets: "管理员可打印资产表，普通用户仅看与自己相关资产。",
    assetRequests: isAdmin() ? "处理普通用户提交的资产领用申请。" : "填写需要领用的资产、数量和用途，等待管理员处理。",
    purchaseWishes: isAdmin() ? "汇总每个人下一年度想要或需要的设备，为预算和采购提供参考。" : "写下自己希望采购或补充的设备，管理员会用于预算和采购参考。",
    records: "登记入库时间、出库时间、经办人和纸质单据编号。",
    paper: "把手写材料通过拍照、编号、复核和电子台账串起来。",
    users: "维护多用户架构和角色权限。",
    settings: "维护系统基础配置。",
    audit: "追踪登录、登记、修改、纸质单据处理等动作。"
  }[view];
}

function renderView() {
  return {
    dashboard: renderDashboard,
    assets: renderAssets,
    assetRequests: renderAssetRequests,
    purchaseWishes: renderPurchaseWishes,
    records: renderRecords,
    paper: renderPaper,
    users: renderUsers,
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
        ${isAdmin() ? `<button class="secondary" id="toggleCategoryManager" type="button">${assetCategoryManagerOpen ? "收起类别管理" : "类别管理"}</button>` : ""}
        <button class="secondary" id="clearAssetSelection" type="button">重置</button>
      </div>
      ${isAdmin() && assetCategoryManagerOpen ? renderAssetCategoryManager() : ""}
      <div class="asset-list-panel">
        <div class="asset-list-title">
          <h3>资产列表</h3>
          <span>共 ${groups.length} 类 / ${printableAssets.length} 条明细</span>
        </div>
      <div class="table-wrap asset-table-wrap">
        <table>
          <thead>
            <tr>
              <th>型号/规格</th><th>类别</th><th>数量</th><th>位置</th><th>状态</th><th>当前使用/保管</th><th>入库详情</th><th>出库详情</th><th>文件来源</th>${isAdmin() ? "<th>操作</th>" : ""}
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
                ${isAdmin() ? `<td><div class="row-actions">${group.count === 1 ? `<button class="ghost small" data-edit-asset="${group.id}" type="button">编辑</button><button class="danger small" data-delete-asset="${group.id}" type="button">删除</button>` : `<span class="mini-meta">已按型号归类</span>`}</div></td>` : ""}
              </tr>
            `).join("") || `<tr><td colspan="${isAdmin() ? 10 : 9}" class="empty">暂无资产</td></tr>`}
          </tbody>
        </table>
      </div>
      </div>
    </section>
    ${renderPrintableAssetSheets(printableAssets)}
    ${isAdmin() && assetDrawerOpen ? renderAssetDrawer() : ""}
  `;
}

function renderAssetCategoryManager() {
  const categories = assetCategories();
  return `
    <section class="asset-category-manager no-print">
      <div class="section-title">
        <h2>类别管理</h2>
        <span class="hint">用于新增资产、资产状态归类和打印类别选择。</span>
      </div>
      <form id="assetCategoryForm" class="category-form">
        <div class="field">
          <label>类别列表</label>
          <textarea name="categories" required>${categories.join("\n")}</textarea>
        </div>
        <div class="setting-actions">
          <button class="primary" type="submit">保存类别</button>
        </div>
      </form>
      <div class="department-tags">
        ${categories.map((category) => `<button class="department-tag" data-category-name="${category}" title="删除未使用类别" type="button">${category}</button>`).join("")}
      </div>
      <p class="hint">每行一个类别。已被资产使用的类别不能直接删除，需要先把相关资产调整到其他类别。</p>
    </section>
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
          <div class="field"><label><b>*</b> 类别</label><select name="category" required>${categoryOptions}</select></div>
          <div class="field"><label>规格</label><input name="spec" value="${asset.spec || ""}" placeholder="请输入规格型号" /></div>
          <div class="field"><label><b>*</b> 数量</label><input name="quantity" type="number" min="1" value="${asset.quantity || 1}" required placeholder="请输入数量" /></div>
          <div class="field"><label><b>*</b> 位置</label><input name="location" required value="${asset.location || ""}" placeholder="请输入位置" /></div>
          <div class="field"><label><b>*</b> 保管人</label><select name="keeperId">${selectableUsers().map((u) => `<option value="${u.id}" ${asset.keeperId === u.id ? "selected" : ""}>${u.name}</option>`).join("")}</select></div>
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

function renderRecords() {
  const records = state.records.filter((record) => {
    const typeMatched = recordFilter === "all" || record.type === recordFilter;
    const kindMatched = recordKindFilter === "all" || recordKind(record) === recordKindFilter;
    return typeMatched && kindMatched;
  });
  const assetRecordCount = state.records.filter((record) => recordKind(record) === "资产").length;
  const consumableRecordCount = state.records.filter((record) => recordKind(record) === "耗材").length;
  return `
    ${isAdmin() ? renderRecordModePanel() : ""}
    <section class="panel">
      <div class="section-title"><h2>${isAdmin() ? "全部出入库记录" : "我的出入库记录"}</h2></div>
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
  const userOptions = activeUsersByDepartment().map((u) => `<option value="${u.id}">${u.name} · ${u.department}</option>`).join("");
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
          ${isAdmin() ? `<div class="field"><label>关联用户</label><select name="ownerId">${selectableUsers().map((u) => `<option value="${u.id}">${u.name}</option>`).join("")}</select></div>` : ""}
          <div class="field"><label>识别文本 / 人工摘录</label><textarea name="text" required placeholder="资产、数量、时间、经手人、用途"></textarea></div>
          <button class="primary" type="submit">加入复核队列</button>
        </form>
      </section>
    </div>
    <section class="panel">
      <div class="section-title"><h2>纸质单据队列</h2></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>单号</th><th>来源</th><th>关联用户</th><th>状态</th><th>识别内容</th>${isAdmin() ? "<th>操作</th>" : ""}</tr></thead>
          <tbody>
            ${state.paperQueue.map((item) => `
              <tr>
                <td>${item.paperNo}</td><td>${item.source}</td><td>${userName(item.ownerId)}</td><td>${statusBadge(item.status)}</td><td>${item.text}</td>
                ${isAdmin() ? `<td><button class="secondary" data-archive-paper="${item.id}" type="button">归档</button></td>` : ""}
              </tr>
            `).join("") || `<tr><td colspan="${isAdmin() ? 6 : 5}" class="empty">暂无纸质单据</td></tr>`}
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
  return `
    ${!isAdmin() ? `
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
        <h2>${isAdmin() ? "资产申请列表" : "我的资产申请"}</h2>
        <span class="hint">待处理 ${requests.filter((item) => item.status === "待处理").length} 条</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              ${isAdmin() ? "<th>申请人</th>" : ""}<th>资产名称</th><th>类别</th><th>规格</th><th>数量</th><th>用途</th><th>时间</th><th>状态</th><th>处理备注</th>${isAdmin() ? "<th>操作</th>" : ""}
            </tr>
          </thead>
          <tbody>
            ${requests.map((item) => `
              <tr>
                ${isAdmin() ? `<td>${item.userName || userName(item.userId)}</td>` : ""}<td>${item.assetName}</td><td>${blank(item.category)}</td><td>${blank(item.spec)}</td><td>${item.quantity}</td><td>${blank(item.reason)}</td><td>${fmt(item.createdAt)}</td><td>${requestStatusBadge(item.status)}</td><td>${blank(item.handleNote)}</td>
                ${isAdmin() ? `<td>${item.status === "待处理" ? `<div class="row-actions"><button class="secondary small" data-approve-asset-request="${item.id}" type="button">批准</button><button class="ghost small" data-reject-asset-request="${item.id}" type="button">驳回</button></div>` : "-"}</td>` : ""}
              </tr>
            `).join("") || `<tr><td colspan="${isAdmin() ? 10 : 8}" class="empty">暂无资产申请</td></tr>`}
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
  const pending = wishes.filter((item) => item.status === "待采购" || item.status === "已采纳").length;
  const totalQuantity = wishes.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  return `
    <section class="panel">
      <div class="section-title">
        <h2>${isAdmin() ? "下一年度采购需求汇总" : "提交想要的设备"}</h2>
        <span class="hint">当前 ${wishes.length} 项，数量合计 ${totalQuantity}，待跟进 ${pending} 项</span>
      </div>
      ${!isAdmin() ? `
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
      <div class="section-title"><h2>${isAdmin() ? "全部需求" : "我的需求"}</h2></div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              ${isAdmin() ? `<th>提交人</th>${isMultiDepartment() ? "<th>部门</th>" : ""}` : ""}<th>设备名称</th><th>类别</th><th>规格</th><th>数量</th><th>优先级</th><th>期望时间</th><th>用途说明</th><th>状态</th><th>处理备注</th>${isAdmin() ? "<th>操作</th>" : ""}
            </tr>
          </thead>
          <tbody>
            ${wishes.map((item) => `
              <tr>
                ${isAdmin() ? `<td>${item.userName || userName(item.userId)}</td>${isMultiDepartment() ? `<td>${item.userDepartment || userDepartment(item.userId)}</td>` : ""}` : ""}
                <td>${item.itemName}</td><td>${blank(item.category)}</td><td>${blank(item.spec)}</td><td>${item.quantity}</td><td>${priorityBadge(item.priority)}</td><td>${blank(item.expectedTime)}</td><td>${blank(item.reason)}</td><td>${requestStatusBadge(item.status)}</td><td>${blank(item.handleNote)}</td>
                ${isAdmin() ? `<td><div class="row-actions"><button class="secondary small" data-update-wish="${item.id}" data-wish-status="已采纳" type="button">采纳</button><button class="secondary small" data-update-wish="${item.id}" data-wish-status="暂缓" type="button">暂缓</button><button class="secondary small" data-update-wish="${item.id}" data-wish-status="已采购" type="button">已采购</button><button class="ghost small" data-update-wish="${item.id}" data-wish-status="已关闭" type="button">关闭</button></div></td>` : ""}
              </tr>
            `).join("") || `<tr><td colspan="${isAdmin() ? (isMultiDepartment() ? 12 : 11) : 9}" class="empty">暂无采购需求</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderUsers() {
  if (!isAdmin()) return "";
  const departmentOptions = departments().map((department) => `<option value="${department}">${department}</option>`).join("");
  return `
    <section class="panel">
      <div class="section-title"><h2>新增用户</h2></div>
      <form id="userForm" class="form-grid">
        <div class="field"><label>账号自动生成</label><input disabled placeholder="保存后按姓名缩写生成，如 张三 -> zs" /></div>
        <div class="field"><label>姓名</label><input name="name" required /></div>
        <div class="field"><label>初始密码</label><input name="password" required placeholder="请填写临时密码" /></div>
        ${isMultiDepartment() ? `<div class="field"><label>部门选项</label><select name="department" required>${departmentOptions}</select></div>` : `<input type="hidden" name="department" value="${state.currentUser.department}" />`}
        <div class="field"><label>角色</label><select name="role"><option value="user">普通用户</option><option value="admin">管理员</option></select></div>
        <div class="field"><label>状态</label><select name="active"><option value="true">启用</option><option value="false">停用</option></select></div>
        <button class="primary" type="submit">保存用户</button>
      </form>
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
                    ${user.role === "user" ? `<button class="secondary small" data-promote-user="${user.id}" type="button">设为管理员</button>` : ""}
                    ${user.role === "admin" ? `<button class="secondary small" data-revoke-admin="${user.id}" type="button">撤销管理员</button>` : ""}
                    <button class="secondary small" data-reset-password="${user.id}" type="button">改密码</button>
                    <button class="danger small" data-delete-user="${user.id}" type="button">删除</button>
                  ` : `<span class="hint">已停用</span>`}
                </td>
                <td>${user.role === "admin" ? "管理员" : "普通用户"}</td>
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
  if (!isAdmin()) return "";
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

function renderAudit() {
  if (!isAdmin()) return "";
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
  const adminItems = isAdmin()
    ? `
      <button data-context-action="assets" type="button">新建资产</button>
      <button data-context-action="records" type="button">新增出入库</button>
      <button data-context-action="records-import" type="button">批量导入记录</button>
      <button data-context-action="users" type="button">新增用户</button>
      <button data-context-action="settings" type="button">系统设置</button>
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
  let latestState = state;
  for (const file of files) {
    const fileName = file.webkitRelativePath || file.name;
    try {
      latestState = await api(endpoint, {
        method: "POST",
        body: JSON.stringify(withActor({
          fileName,
          contentBase64: await fileToBase64(file)
        }))
      });
      const result = latestState[resultKey] || { imported: 0, skipped: [] };
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
  state = latestState;
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
  const headers = ["序号", "物品名称", "资产编号", "配置", "数量", "类别"];
  const rows = filteredAssets().map((asset, index) => [
    index + 1,
    asset.name,
    asset.code,
    blank(asset.spec),
    asset.quantity,
    [asset.category, assetKind(asset)].filter(Boolean).join(" / ")
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

async function promoteUser(userId) {
  const target = state.users.find((user) => user.id === userId);
  const label = target ? `${target.name}（${target.username}）` : "该用户";
  if (!confirm(`确定把 ${label} 设为管理员吗？管理员可以查看全部数据、删除用户和修改系统设置。`)) return;
  try {
    state = await api("/api/users/promote", {
      method: "POST",
      body: JSON.stringify(withActor({ targetUserId: userId }))
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
  if (nextMode === "user" && ["users", "settings", "audit"].includes(view)) {
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
  if (!menu || !isAdmin()) return;
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

  document.querySelector("#clearAssetSelection")?.addEventListener("click", () => {
    selectedAssetId = "";
    assetFilter = "";
    assetStatusFilter = "all";
    assetKeeperFilter = "all";
    render();
  });

  document.querySelector("#toggleCategoryManager")?.addEventListener("click", () => {
    assetCategoryManagerOpen = !assetCategoryManagerOpen;
    render();
  });

  document.querySelector("#assetCategoryForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const categories = event.target.categories.value
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
    try {
      state = await api("/api/assets/categories", {
        method: "POST",
        body: JSON.stringify(withActor({ categories }))
      });
      render();
    } catch (exc) {
      alert(exc.message);
    }
  });

  document.querySelectorAll("[data-category-name]").forEach((button) => {
    button.addEventListener("click", async () => {
      const category = button.dataset.categoryName;
      if (!confirm(`确定删除类别“${category}”吗？已被资产使用的类别不能删除。`)) return;
      try {
        state = await api("/api/assets/categories/delete", {
          method: "POST",
          body: JSON.stringify(withActor({ category }))
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
      await promoteUser(button.dataset.promoteUser);
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

