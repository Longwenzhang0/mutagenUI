"use strict";

// ---------- Wails 绑定 ----------
function backend() {
  return window.go && window.go.main && window.go.main.App;
}

const $ = (id) => document.getElementById(id);

// ---------- 统一图标按钮 ----------
const ICONS = {
  pencil:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>',
  trash:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  image:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
};

function iconButton(icon, title, danger) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "mini-icon" + (danger ? " danger" : "");
  b.title = title;
  b.innerHTML = ICONS[icon];
  return b;
}

// ---------- 状态 ----------
let sessions = [];
let selectedId = null; // session identifier
let pollTimer = null;
let isDragging = false;

// 实时搜索
let searchQuery = "";

function matchesSearch(s) {
  if (!searchQuery) return true;
  const q = searchQuery;
  return (
    keyOf(s).toLowerCase().includes(q) ||
    (s.alphaUrl || "").toLowerCase().includes(q) ||
    (s.betaUrl || "").toLowerCase().includes(q) ||
    statusLabel(s).toLowerCase().includes(q)
  );
}

// 侧边栏布局（排序/分组），持久化在 config.json 里
let layout = { sortMode: "manual", groups: [], ungrouped: [] };

function normalizeLayout(l) {
  return {
    sortMode: (l && l.sortMode) || "manual",
    groups: ((l && l.groups) || []).map((g) => ({
      name: g.name,
      collapsed: !!g.collapsed,
      sessions: g.sessions || [],
    })),
    ungrouped: (l && l.ungrouped) || [],
  };
}

function persistLayout() {
  const api = backend();
  if (api) api.SaveLayout(layout).catch(showError);
}

// ---------- Toast ----------
let toastTimer = null;
function toast(msg, isError) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.toggle("error", !!isError);
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), isError ? 6000 : 2500);
}

function showError(err) {
  toast(String(err && err.message ? err.message : err), true);
}

// ---------- 状态样式归类 ----------
function statusClass(s) {
  if (s.paused) return "";
  const st = String(s.status || "").toLowerCase();
  if (s.lastError || s.conflictCount > 0 || s.problemCount > 0 || st.includes("halt") || st.includes("error")) return "err";
  if (st.includes("watch")) return "ok";
  return "busy"; // connecting / scanning / staging / transitioning ...
}

function statusLabel(s) {
  if (s.paused) return "已暂停 ⏸";
  return s.status || "unknown";
}

// ---------- 会话列表渲染（分组 + 排序 + 拖拽） ----------
function keyOf(s) {
  return s.name || s.identifier;
}

function statusPriority(s) {
  if (s.paused) return 3;
  const cls = statusClass(s);
  return cls === "err" ? 0 : cls === "busy" ? 1 : 2;
}

function orderSessions(list) {
  if (layout.sortMode === "name") {
    return [...list].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
  }
  if (layout.sortMode === "status") {
    return [...list].sort((a, b) => statusPriority(a) - statusPriority(b) || keyOf(a).localeCompare(keyOf(b)));
  }
  return list; // manual：保持 layout 中的顺序
}

// ---------- 自实现拖拽 ----------
// 不用 HTML5 DnD：Wails 开启原生文件拖放后会在 WKWebView 层接管拖拽会话，
// 页面内的 dragstart/drop 不再触发，所以改用鼠标事件实现。
let dragState = null; // {key, li, started, startX, startY, overEl}

function dropTargetAt(x, y) {
  const el = document.elementFromPoint(x, y);
  return el ? el.closest("#session-list li") : null;
}

function startSessionDrag(e, key, li) {
  if (e.button !== 0) return;
  dragState = { key, li, started: false, startX: e.clientX, startY: e.clientY, overEl: null };

  const onMove = (ev) => {
    if (!dragState) return;
    if (!dragState.started) {
      if (Math.abs(ev.clientX - dragState.startX) + Math.abs(ev.clientY - dragState.startY) < 5) return;
      dragState.started = true;
      isDragging = true;
      li.classList.add("dragging");
      document.body.classList.add("drag-cursor");
    }
    ev.preventDefault();
    const t = dropTargetAt(ev.clientX, ev.clientY);
    if (dragState.overEl && dragState.overEl !== t) dragState.overEl.classList.remove("drag-over");
    if (t && t !== li && t.dataset.key !== dragState.key) {
      t.classList.add("drag-over");
      dragState.overEl = t;
    } else {
      dragState.overEl = null;
    }
  };

  const onUp = (ev) => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    const st = dragState;
    dragState = null;
    if (!st || !st.started) return; // 只是普通点击，交给 click 处理
    if (st.overEl) st.overEl.classList.remove("drag-over");
    st.li.classList.remove("dragging");
    document.body.classList.remove("drag-cursor");
    isDragging = false;

    const t = dropTargetAt(ev.clientX, ev.clientY);
    if (!t || t === st.li) {
      render();
      return;
    }
    if (t.classList.contains("group-header")) {
      const gname = t.dataset.groupTarget;
      moveKey(st.key, gname === "" ? null : gname, null);
    } else if (t.dataset.key && t.dataset.key !== st.key) {
      const targetGroup = t.dataset.group === "" ? null : t.dataset.group;
      moveKey(st.key, targetGroup, t.dataset.key);
    } else {
      render();
    }
  };

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

function containerOf(groupName) {
  if (groupName === null) return layout.ungrouped;
  const g = layout.groups.find((x) => x.name === groupName);
  return g ? g.sessions : layout.ungrouped;
}

function removeKeyFromLayout(k) {
  for (const g of layout.groups) {
    const i = g.sessions.indexOf(k);
    if (i >= 0) {
      g.sessions.splice(i, 1);
      return;
    }
  }
  const i = layout.ungrouped.indexOf(k);
  if (i >= 0) layout.ungrouped.splice(i, 1);
}

// 把内存中"未落库"的会话 key 补进 layout，保证拖拽操作有据可依
function materializeLayout() {
  const placed = new Set([...layout.ungrouped, ...layout.groups.flatMap((g) => g.sessions)]);
  for (const s of sessions) {
    if (!placed.has(keyOf(s))) layout.ungrouped.push(keyOf(s));
  }
}

function moveKey(k, groupName, beforeKey) {
  materializeLayout();
  removeKeyFromLayout(k);
  const c = containerOf(groupName);
  const idx = beforeKey === null ? c.length : c.indexOf(beforeKey);
  c.splice(idx < 0 ? c.length : idx, 0, k);
  persistLayout();
  render();
}

function makeSessionItem(s, groupName) {
  const li = document.createElement("li");
  li.dataset.id = s.identifier;
  if (s.identifier === selectedId) li.classList.add("selected");

  const dot = document.createElement("span");
  dot.className = "status-dot " + statusClass(s);

  const info = document.createElement("div");
  info.className = "sess-info";
  const name = document.createElement("div");
  name.className = "sess-name";
  name.textContent = s.name || s.identifier.slice(0, 8);
  const st = document.createElement("div");
  st.className = "sess-status";
  st.textContent = statusLabel(s);
  info.append(name, st);

  li.append(dot, info);
  li.dataset.key = keyOf(s);
  li.dataset.group = groupName === null ? "" : groupName;
  li.addEventListener("click", () => {
    selectedId = s.identifier;
    render();
  });

  // 拖拽（仅手动排序模式，搜索过滤时禁用以免插入位置产生歧义）
  if (layout.sortMode === "manual" && !searchQuery) {
    li.addEventListener("mousedown", (e) => startSessionDrag(e, keyOf(s), li));
  }
  return li;
}

function makeGroupHeader(g) {
  const li = document.createElement("li");
  li.className = "group-header" + (g && g.collapsed ? " collapsed" : "");
  const isUngroupedHeader = g === null;

  const chevron = document.createElement("span");
  chevron.className = "chevron";
  chevron.textContent = "▼";
  const name = document.createElement("span");
  name.textContent = isUngroupedHeader ? "未分组" : g.name;
  const count = document.createElement("span");
  count.className = "group-count";
  li.append(chevron, name, count);

  if (!isUngroupedHeader) {
    const actions = document.createElement("span");
    actions.className = "group-actions";
    const rename = iconButton("pencil", "重命名");
    rename.addEventListener("click", async (e) => {
      e.stopPropagation();
      const newName = await askText("重命名分组", g.name);
      if (!newName || newName === g.name) return;
      if (layout.groups.some((x) => x.name === newName)) {
        toast("已存在同名分组", true);
        return;
      }
      g.name = newName;
      persistLayout();
      render();
    });
    const del = iconButton("trash", "删除分组", true);
    del.addEventListener("click", async (e) => {
      e.stopPropagation();
      const api = backend();
      if (!(await api.Confirm("删除分组", `删除分组「${g.name}」？组内会话会移到未分组（会话本身不受影响）。`))) return;
      layout.ungrouped.push(...g.sessions);
      layout.groups = layout.groups.filter((x) => x !== g);
      persistLayout();
      render();
    });
    actions.append(rename, del);
    li.appendChild(actions);

    li.addEventListener("click", () => {
      g.collapsed = !g.collapsed;
      persistLayout();
      render();
    });
  }

  // 拖到分组标题上 = 放入该组末尾（未分组标题同理），
  // 目标识别在 startSessionDrag 的 mouseup 里通过 dataset.groupTarget 完成
  li.dataset.groupTarget = isUngroupedHeader ? "" : g.name;
  return { li, count };
}

function renderList() {
  const ul = $("session-list");
  ul.innerHTML = "";
  const byKey = new Map(sessions.map((s) => [keyOf(s), s]));
  const used = new Set();
  const searching = !!searchQuery;
  let shown = 0;

  for (const g of layout.groups) {
    const members = g.sessions.map((k) => byKey.get(k)).filter(Boolean);
    members.forEach((s) => used.add(keyOf(s)));
    const visible = members.filter(matchesSearch);
    if (searching && !visible.length) continue; // 搜索时隐藏无匹配的分组
    const { li, count } = makeGroupHeader(g);
    count.textContent = searching ? `(${visible.length}/${members.length})` : `(${members.length})`;
    ul.appendChild(li);
    // 搜索时强制展开折叠的分组，保证匹配项可见
    if (!g.collapsed || searching) {
      for (const s of orderSessions(visible)) {
        ul.appendChild(makeSessionItem(s, g.name));
        shown++;
      }
    }
  }

  // 未分组：先按 layout 顺序，再补上新出现的会话
  const ungrouped = [];
  for (const k of layout.ungrouped) {
    if (byKey.has(k) && !used.has(k)) {
      ungrouped.push(byKey.get(k));
      used.add(k);
    }
  }
  for (const s of sessions) {
    if (!used.has(keyOf(s))) ungrouped.push(s);
  }
  const visibleUngrouped = ungrouped.filter(matchesSearch);
  if (layout.groups.length && (!searching || visibleUngrouped.length)) {
    const { li, count } = makeGroupHeader(null);
    count.textContent = searching
      ? `(${visibleUngrouped.length}/${ungrouped.length})`
      : `(${ungrouped.length})`;
    ul.appendChild(li);
  }
  for (const s of orderSessions(visibleUngrouped)) {
    ul.appendChild(makeSessionItem(s, null));
    shown++;
  }

  if (searching && !shown) {
    const li = document.createElement("li");
    li.className = "no-match";
    li.textContent = `没有匹配「${searchQuery}」的会话`;
    ul.appendChild(li);
  }
}

// ---------- 问题诊断建议 ----------
function topDir(path) {
  const i = path.indexOf("/");
  return i > 0 ? path.slice(0, i) + "/" : path;
}

function adviceForProblem(p) {
  const err = (p.error || "").toLowerCase();
  if (err.includes("symbolic link") && err.includes("absolute")) {
    return `该符号链接指向绝对路径，mutagen 默认的 portable 符号链接模式无法同步它。` +
      `如果它在虚拟环境/依赖目录里（如 ${topDir(p.path)}），正确做法是把整个目录加入忽略规则` +
      `——这类目录本就不该跨机器同步，应在两端各自生成。` +
      `注意：忽略规则无法在现有会话上修改，需「终止」后重新创建会话（可先把当前配置存为预设）。`;
  }
  if (err.includes("permission denied")) {
    return "对该路径没有读写权限。到对应机器上修复权限，或将其加入忽略规则（需重建会话）。处理后点「立即同步」。";
  }
  if (err.includes("no space left")) {
    return "目标磁盘已满，清理空间后点「立即同步」。";
  }
  if (err.includes("too many open files") || err.includes("watch")) {
    return "文件监听资源不足，尝试减小同步范围（忽略大目录）或重启会话。";
  }
  return "到对应机器上处理该文件后点「立即同步」重试；若想跳过它，可将该路径加入忽略规则（需终止后重建会话）。";
}

const CONFLICT_ADVICE =
  "两端都修改了该文件，mutagen 不确定保留哪边。在你想保留的那一端重新保存一次该文件，然后点「立即同步」；" +
  "或点「重置」让两端重新完整对比。若希望以后冲突自动以本地为准，请用 two-way-resolved 模式重建会话。";

// ---------- 详情渲染 ----------
function renderDetail() {
  const s = sessions.find((x) => x.identifier === selectedId);
  const detail = $("detail");
  const empty = $("empty-state");

  if (!s) {
    detail.classList.add("hidden");
    empty.classList.remove("hidden");
    $("empty-message").textContent = sessions.length
      ? "没有选中的会话"
      : "还没有同步会话，点击左下角「新建会话」开始";
    return;
  }
  empty.classList.add("hidden");
  detail.classList.remove("hidden");

  $("detail-name").textContent = s.name || s.identifier.slice(0, 8);
  const badge = $("detail-status");
  badge.textContent = statusLabel(s);
  badge.className = "badge " + statusClass(s);

  $("detail-alpha").textContent = s.alphaUrl || "-";
  $("detail-beta").textContent = s.betaUrl || "-";
  const ac = $("detail-alpha-conn");
  ac.textContent = s.alphaConnected ? "● 已连接" : "○ 未连接";
  ac.className = "conn" + (s.alphaConnected ? " on" : "");
  const bc = $("detail-beta-conn");
  bc.textContent = s.betaConnected ? "● 已连接" : "○ 未连接";
  bc.className = "conn" + (s.betaConnected ? " on" : "");

  const conflicts = $("detail-conflicts");
  conflicts.textContent = "冲突: " + s.conflictCount;
  conflicts.className = s.conflictCount > 0 ? "warn" : "";
  const problems = $("detail-problems");
  problems.textContent = "问题: " + s.problemCount;
  problems.className = s.problemCount > 0 ? "warn" : "";

  const errEl = $("detail-error");
  if (s.lastError) {
    errEl.textContent = s.lastError;
    errEl.classList.remove("hidden");
  } else {
    errEl.classList.add("hidden");
  }

  renderIssues(s);
  renderPicResults(s);
  updatePicStatus();

  $("btn-pause").disabled = s.paused;
  $("btn-resume").disabled = !s.paused;

  $("detail-raw").textContent = JSON.stringify(s.raw, null, 2);
}

function renderIssues(s) {
  const section = $("detail-issues");
  const ul = $("issue-list");
  const problems = s.problems || [];
  const conflicts = s.conflicts || [];
  if (!problems.length && !conflicts.length) {
    section.classList.add("hidden");
    return;
  }
  section.classList.remove("hidden");
  ul.innerHTML = "";

  const sideLabel = { alpha: "本地", beta: "远程" };
  const kindLabel = { scan: "扫描", transition: "写入" };

  for (const p of problems) {
    const li = document.createElement("li");
    const tag = document.createElement("span");
    tag.className = "issue-tag";
    tag.textContent = (sideLabel[p.side] || p.side) + "·" + (kindLabel[p.kind] || p.kind);
    const path = document.createElement("span");
    path.className = "issue-path";
    path.textContent = p.path || "(未知路径)";
    const err = document.createElement("div");
    err.className = "issue-error";
    err.textContent = p.error || "";
    const advice = document.createElement("div");
    advice.className = "issue-advice";
    advice.textContent = adviceForProblem(p);
    li.append(tag, path, err, advice);
    ul.appendChild(li);
  }

  for (const root of conflicts) {
    const li = document.createElement("li");
    const tag = document.createElement("span");
    tag.className = "issue-tag";
    tag.textContent = "冲突";
    const path = document.createElement("span");
    path.className = "issue-path";
    path.textContent = root;
    const advice = document.createElement("div");
    advice.className = "issue-advice";
    advice.textContent = CONFLICT_ADVICE;
    li.append(tag, path, advice);
    ul.appendChild(li);
  }

  const hiddenCount = (s.problemCount - problems.length) + (s.conflictCount - conflicts.length);
  if (hiddenCount > 0) {
    const li = document.createElement("li");
    li.className = "issue-error";
    li.textContent = `另有 ${hiddenCount} 个问题未列出（mutagen 只返回前若干条），可在终端用 mutagen sync list -l 查看`;
    ul.appendChild(li);
  }
}

function render() {
  renderList();
  renderDetail();
}

// ---------- 轮询 ----------
async function refresh() {
  const api = backend();
  if (!api) return;
  try {
    const list = (await api.ListSessions()) || [];
    sessions = list;
    if (selectedId && !sessions.some((s) => s.identifier === selectedId)) {
      selectedId = null;
    }
    if (!selectedId && sessions.length) {
      selectedId = sessions[0].identifier;
    }
    if (!isDragging) render();
  } catch (err) {
    // 轮询失败不弹 toast 轰炸，只在空状态区提示
    sessions = [];
    selectedId = null;
    render();
    $("empty-message").textContent = "无法获取会话列表：" + err;
  }
}

function startPolling() {
  refresh();
  pollTimer = setInterval(refresh, 2000);
}

// ---------- 会话操作 ----------
function sessionName(s) {
  return s.name || s.identifier;
}

async function doAction(fn, okMsg) {
  const s = sessions.find((x) => x.identifier === selectedId);
  if (!s) return;
  try {
    await fn(sessionName(s));
    toast(okMsg);
    refresh();
  } catch (err) {
    showError(err);
  }
}

// ---------- 新建会话 ----------
function fillFromPreset(p) {
  $("create-name").value = p.name === "__default__" ? "" : p.name || "";
  $("create-alpha").value = p.alpha || "";
  $("create-beta").value = p.beta || "";
  $("create-mode").value = p.mode || "two-way-resolved";
  $("create-ignore-vcs").checked = !!p.ignoreVCS;
  $("create-ignores").value = (p.ignores || []).join("\n");
}

async function openCreateModal() {
  const api = backend();
  try {
    const cfg = await api.GetConfig();
    const sel = $("create-preset");
    sel.innerHTML = '<option value="">（不使用预设）</option>';
    for (const p of cfg.presets || []) {
      const opt = document.createElement("option");
      opt.value = p.name;
      opt.textContent = p.name;
      sel.appendChild(opt);
    }
    sel.dataset.presets = JSON.stringify(cfg.presets || []);
  } catch (err) {
    showError(err);
  }
  const groupSel = $("create-group");
  groupSel.innerHTML = '<option value="">（不分组）</option>';
  for (const g of layout.groups) {
    const opt = document.createElement("option");
    opt.value = g.name;
    opt.textContent = g.name;
    groupSel.appendChild(opt);
  }
  $("modal-create").classList.remove("hidden");
}

function readCreateForm() {
  return {
    name: $("create-name").value.trim(),
    alpha: $("create-alpha").value.trim(),
    beta: $("create-beta").value.trim(),
    mode: $("create-mode").value,
    ignoreVCS: $("create-ignore-vcs").checked,
    ignores: $("create-ignores")
      .value.split("\n")
      .map((x) => x.trim())
      .filter(Boolean),
  };
}

// ---------- 图片速传 ----------
let picResults = {}; // session identifier -> [SentImage]
let picTransfers = {}; // session identifier -> {stage, done, total, start}
let picMode = "abs"; // abs | rel

function picPath(img) {
  return picMode === "abs" ? img.remoteAbs : img.remoteRel;
}

async function copyText(text) {
  try {
    if (window.runtime && window.runtime.ClipboardSetText) {
      await window.runtime.ClipboardSetText(text);
    } else {
      await navigator.clipboard.writeText(text);
    }
    return true;
  } catch (err) {
    showError(err);
    return false;
  }
}

// 从会话原始状态里提取 mutagen 本轮同步的 staging 进度
// （字节/文件计数 + 当前正在传输的文件），字段名跨版本做了防御
function stagingInfo(s) {
  if (!s || !s.raw) return null;
  for (const key of ["beta", "betaState", "alpha", "alphaState"]) {
    const st = s.raw[key];
    if (!st || typeof st !== "object") continue;
    const p = st.stagingProgress;
    if (!p || typeof p !== "object") continue;
    const doneFiles = p.receivedFiles ?? p.received ?? 0;
    const totalFiles = p.expectedFiles ?? p.expected ?? 0;
    const doneBytes = p.receivedSize ?? p.receivedByteSize ?? 0;
    const totalBytes = p.expectedSize ?? p.expectedByteSize ?? 0;
    let percent = null;
    if (totalBytes > 0) percent = Math.min(100, Math.floor((doneBytes / totalBytes) * 100));
    else if (totalFiles > 0) percent = Math.min(100, Math.floor((doneFiles / totalFiles) * 100));
    const current = typeof p.path === "string" ? p.path.split("/").pop() : "";
    return { percent, doneFiles, totalFiles, current };
  }
  return null;
}

function setPicBar(percent) {
  const bar = $("pic-bar");
  if (percent === null || percent === undefined) {
    bar.classList.add("hidden");
    return;
  }
  bar.classList.remove("hidden");
  $("pic-bar-fill").style.width = percent + "%";
}

// 只反映"当前选中会话"的传输状态；切换会话不会串台
function updatePicStatus() {
  const status = $("pic-status");
  const dz = $("drop-zone");
  const t = picTransfers[selectedId];
  if (!t) {
    status.classList.add("hidden");
    dz.classList.remove("busy");
    setPicBar(null);
    return;
  }
  dz.classList.add("busy");
  status.classList.remove("hidden");
  if (t.stage === "copy") {
    status.textContent = t.total
      ? `复制中 ${Math.min(t.done + 1, t.total)}/${t.total}…`
      : "准备中…";
    setPicBar(null);
  } else {
    const secs = Math.floor((Date.now() - t.start) / 1000);
    const s = sessions.find((x) => x.identifier === selectedId);
    const sp = stagingInfo(s);
    if (sp && sp.totalFiles > 0) {
      const cur = sp.current ? ` · ${sp.current}` : "";
      status.textContent =
        `同步中 ${sp.percent !== null ? sp.percent + "%" : ""}` +
        `（第 ${Math.min(sp.doneFiles + 1, sp.totalFiles)}/${sp.totalFiles} 个文件${cur}）· ${secs}s`;
      setPicBar(sp.percent);
    } else {
      // staging 未开始或已结束（扫描/收尾阶段），退回时间显示
      status.textContent = `已复制 ${t.total} 张，正在同步到远端… ${secs}s`;
      setPicBar(null);
    }
  }
}

async function runTransfer(invoke) {
  const s = sessions.find((x) => x.identifier === selectedId);
  if (!s) {
    toast("请先在左侧选择一个会话", true);
    return;
  }
  const id = s.identifier;
  if (picTransfers[id]) {
    toast("该会话正在传输图片，请稍候", true);
    return;
  }
  picTransfers[id] = { stage: "copy", done: 0, total: 0, start: Date.now() };
  updatePicStatus();
  // flush 期间加密轮询，让 staging 进度更实时
  const fastPoll = setInterval(refresh, 800);
  try {
    const res = await invoke(id);
    picResults[id] = res;
    toast(`已同步 ${res.length} 张图片，复制路径可粘贴给远端工具读图`);
  } catch (err) {
    showError(err);
  } finally {
    clearInterval(fastPoll);
    delete picTransfers[id];
    renderDetail();
  }
}

function sendImages(paths) {
  if (!paths || !paths.length) return;
  runTransfer((id) => backend().SendImagesToSession(id, paths));
}

// 剪贴板图片：读成 base64 交给后端落盘
function pasteTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
    "-" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds())
  );
}

async function pasteImages(files) {
  const ts = pasteTimestamp();
  const blobs = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const b64 = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1]);
      r.onerror = () => reject(new Error("读取剪贴板图片失败"));
      r.readAsDataURL(f);
    });
    const ext = ((f.type || "").split("/")[1] || "png").replace("jpeg", "jpg");
    const suffix = files.length > 1 ? `-${i + 1}` : "";
    blobs.push({ name: `pasted-${ts}${suffix}.${ext}`, data: b64 });
  }
  runTransfer((id) => backend().SendImageBlobs(id, blobs));
}

function renderPicResults(s) {
  const box = $("pic-results");
  const list = picResults[s.identifier] || [];
  if (!list.length) {
    box.classList.add("hidden");
    return;
  }
  box.classList.remove("hidden");
  const ul = $("pic-list");
  ul.innerHTML = "";
  for (const img of list) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "pic-icon";
    name.innerHTML = ICONS.image;
    const p = document.createElement("span");
    p.className = "pic-path";
    p.textContent = picPath(img);
    p.title = `远端机器上的路径：${picPath(img)}\n点击复制，粘贴给远端工具即可读图`;
    const mark = document.createElement("span");
    mark.className = "pic-copied";
    li.append(name, p, mark);
    li.addEventListener("click", async () => {
      if (await copyText(picPath(img))) {
        mark.textContent = "已复制 ✓";
        setTimeout(() => (mark.textContent = ""), 1600);
      }
    });
    ul.appendChild(li);
  }
}

// ---------- 通用文本输入弹窗 ----------
let inputResolve = null;

function askText(title, initial) {
  return new Promise((resolve) => {
    inputResolve = resolve;
    $("input-title").textContent = title;
    const f = $("input-field");
    f.value = initial || "";
    $("modal-input").classList.remove("hidden");
    f.focus();
    f.select();
  });
}

function closeInput(ok) {
  if (!inputResolve) return;
  const value = ok ? $("input-field").value.trim() : null;
  $("modal-input").classList.add("hidden");
  const resolve = inputResolve;
  inputResolve = null;
  resolve(value);
}

// ---------- SSH 认证弹窗 ----------
let promptId = null;
// 主机指纹确认（yes/no）用按钮直接回答，避免自由输入答错导致 SSH 反复追问
let promptConfirmMode = false;

function setupPromptListener() {
  if (!window.runtime || !window.runtime.EventsOn) return;
  window.runtime.EventsOn("ssh-prompt", (data) => {
    promptId = data.id;
    promptConfirmMode = !data.masked && /(yes\/no|type 'yes')/i.test(data.prompt);
    $("prompt-text").textContent = data.prompt;
    $("prompt-retry").classList.toggle("hidden", !data.retry);
    $("prompt-save-row").classList.toggle("hidden", !data.canSave);
    $("prompt-save").checked = false;
    const input = $("prompt-input");
    input.classList.toggle("hidden", promptConfirmMode);
    $("btn-prompt-ok").textContent = promptConfirmMode ? "信任并继续" : "连接";
    input.type = data.masked ? "password" : "text";
    input.placeholder = data.masked ? "请输入密码" : "请输入";
    input.value = "";
    $("modal-prompt").classList.remove("hidden");
    if (!promptConfirmMode) input.focus();
  });
  window.runtime.EventsOn("toast-error", (msg) => toast(msg, true));
  // 原生文件拖放（true = 仅在标记了 --wails-drop-target 的元素上触发）
  if (window.runtime.OnFileDrop) {
    window.runtime.OnFileDrop((x, y, paths) => sendImages(paths), true);
  }
  // 后端推送的传图进度
  window.runtime.EventsOn("pic-progress", (data) => {
    const t = picTransfers[data.session];
    if (!t) return;
    t.stage = data.stage;
    t.done = data.done;
    t.total = data.total;
    updatePicStatus();
  });
  // 同步阶段的秒数走表
  setInterval(updatePicStatus, 1000);
}

function submitPrompt(cancelled) {
  if (promptId === null) return;
  const api = backend();
  const save = !$("prompt-save-row").classList.contains("hidden") && $("prompt-save").checked;
  const answer = cancelled ? "" : promptConfirmMode ? "yes" : $("prompt-input").value;
  api.AnswerPrompt(promptId, answer, cancelled, save && !promptConfirmMode);
  promptId = null;
  $("prompt-input").value = "";
  $("modal-prompt").classList.add("hidden");
}

// ---------- 设置 ----------
async function openSettingsModal() {
  const api = backend();
  try {
    const [info, cfg] = await Promise.all([api.GetMutagenInfo(), api.GetConfig()]);
    $("settings-info").textContent = info.ok
      ? `${info.version}${info.bundled ? "（内置）" : ""}\n${info.path}` +
        (info.debugLog ? `\n调试日志: ${info.debugLog}` : "")
      : `⚠ ${info.error}`;
    $("settings-path").value = cfg.mutagenPath || "";

    const ul = $("preset-list");
    ul.innerHTML = "";
    for (const p of cfg.presets || []) {
      const li = document.createElement("li");
      li.className = "preset-item";

      const row = document.createElement("div");
      row.className = "preset-row";
      const span = document.createElement("span");
      span.className = "preset-name";
      span.textContent = p.name;

      const actions = document.createElement("span");
      actions.className = "preset-actions";
      const rename = iconButton("pencil", "重命名");
      rename.addEventListener("click", async (e) => {
        e.stopPropagation();
        const newName = await askText("重命名预设", p.name);
        if (!newName || newName === p.name) return;
        try {
          await api.RenamePreset(p.name, newName);
          toast("已重命名为 " + newName);
          openSettingsModal();
        } catch (err) {
          showError(err);
        }
      });
      const del = iconButton("trash", "删除预设", true);
      del.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!(await api.Confirm("删除预设", `确定删除预设「${p.name}」？`))) return;
        try {
          await api.DeletePreset(p.name);
          li.remove();
          toast("已删除预设 " + p.name);
        } catch (err) {
          showError(err);
        }
      });
      actions.append(rename, del);
      row.append(span, actions);

      // 点击行展开/收起预览
      const preview = document.createElement("div");
      preview.className = "preset-preview hidden";
      const fields = [
        ["本地 (alpha)", p.alpha || "—"],
        ["远程 (beta)", p.beta || "—"],
        ["同步模式", p.mode || "（mutagen 默认 two-way-safe）"],
        ["忽略 VCS", p.ignoreVCS ? "是" : "否"],
        ["忽略规则", (p.ignores || []).length ? p.ignores.join("、") : "无"],
      ];
      for (const [k, v] of fields) {
        const line = document.createElement("div");
        const key = document.createElement("span");
        key.className = "preset-key";
        key.textContent = k;
        const val = document.createElement("span");
        val.className = "preset-val mono";
        val.textContent = v;
        line.append(key, val);
        preview.appendChild(line);
      }
      row.addEventListener("click", () => preview.classList.toggle("hidden"));

      li.append(row, preview);
      ul.appendChild(li);
    }
    if (!(cfg.presets || []).length) {
      ul.innerHTML = '<li><span class="small">暂无预设，可在新建会话或会话详情页保存</span></li>';
    }
  } catch (err) {
    showError(err);
  }
  $("modal-settings").classList.remove("hidden");
}

// ---------- 事件绑定 ----------
function bindEvents() {
  const api = backend();

  $("btn-new").addEventListener("click", openCreateModal);
  $("btn-settings").addEventListener("click", openSettingsModal);

  // 实时搜索
  const searchBox = $("search-box");
  searchBox.addEventListener("input", () => {
    searchQuery = searchBox.value.trim().toLowerCase();
    $("search-clear").classList.toggle("hidden", !searchBox.value);
    renderList();
  });
  $("search-clear").addEventListener("click", () => {
    searchBox.value = "";
    searchQuery = "";
    $("search-clear").classList.add("hidden");
    renderList();
    searchBox.focus();
  });

  // 排序与分组
  $("sort-seg").querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      layout.sortMode = btn.dataset.mode;
      updateSortSeg();
      persistLayout();
      render();
    });
  });
  $("btn-add-group").addEventListener("click", async () => {
    const name = await askText("新分组名称", "");
    if (!name) return;
    if (layout.groups.some((g) => g.name === name)) {
      toast("已存在同名分组", true);
      return;
    }
    layout.groups.push({ name, collapsed: false, sessions: [] });
    persistLayout();
    render();
  });
  $("btn-help").addEventListener("click", () => $("modal-help").classList.remove("hidden"));
  $("btn-help-close").addEventListener("click", () => $("modal-help").classList.add("hidden"));

  // 粘贴剪贴板图片到图片速传（焦点在输入框时不拦截）
  document.addEventListener("paste", (e) => {
    const tag = (document.activeElement && document.activeElement.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    const items = (e.clipboardData && e.clipboardData.items) || [];
    const files = [];
    for (const it of items) {
      if (it.type && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (!files.length) return;
    e.preventDefault();
    pasteImages(files);
  });

  // Esc：先清空搜索，再关闭当前打开的弹窗（认证/输入弹窗走各自的取消逻辑）
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const sb = $("search-box");
    if (document.activeElement === sb && sb.value) {
      sb.value = "";
      searchQuery = "";
      $("search-clear").classList.add("hidden");
      renderList();
      return;
    }
    if (!$("modal-prompt").classList.contains("hidden")) {
      submitPrompt(true);
      return;
    }
    if (!$("modal-input").classList.contains("hidden")) {
      closeInput(false);
      return;
    }
    for (const id of ["modal-help", "modal-settings", "modal-create"]) {
      const m = $(id);
      if (!m.classList.contains("hidden")) {
        m.classList.add("hidden");
        return;
      }
    }
  });

  $("btn-pause").addEventListener("click", () => doAction(api.PauseSession, "已暂停"));
  $("btn-resume").addEventListener("click", () => doAction(api.ResumeSession, "已恢复"));
  $("btn-flush").addEventListener("click", () => doAction(api.FlushSession, "已触发同步"));
  $("btn-reset").addEventListener("click", async () => {
    if (await api.Confirm("重置会话", "重置会话历史？不会删除文件，但会重新完整对比一次。")) {
      doAction(api.ResetSession, "已重置");
    }
  });
  $("btn-session-preset").addEventListener("click", async () => {
    const s = sessions.find((x) => x.identifier === selectedId);
    if (!s) return;
    const name = await askText("预设名称", sessionName(s));
    if (!name) return;
    try {
      await api.SavePreset({
        name,
        alpha: s.alphaUrl || "",
        beta: s.betaUrl || "",
        mode: s.mode || "",
        ignoreVCS: !!s.ignoreVCS,
        ignores: s.ignores || [],
      });
      toast("已存为预设：" + name);
    } catch (err) {
      showError(err);
    }
  });
  $("btn-terminate").addEventListener("click", async () => {
    const s = sessions.find((x) => x.identifier === selectedId);
    if (!s) return;
    if (await api.Confirm("终止会话", `确定终止会话「${sessionName(s)}」？会话将被删除（文件不受影响），此操作不可撤销。`)) {
      doAction(api.TerminateSession, "已终止");
    }
  });

  // 新建弹窗
  $("create-preset").addEventListener("change", (e) => {
    const presets = JSON.parse(e.target.dataset.presets || "[]");
    const p = presets.find((x) => x.name === e.target.value);
    if (p) fillFromPreset(p);
  });

  $("btn-pick-dir").addEventListener("click", async () => {
    try {
      const dir = await api.SelectDirectory();
      if (dir) $("create-alpha").value = dir;
    } catch (err) {
      showError(err);
    }
  });

  $("btn-create-cancel").addEventListener("click", () => $("modal-create").classList.add("hidden"));

  $("btn-create-ok").addEventListener("click", async () => {
    const spec = readCreateForm();
    if (!spec.alpha || !spec.beta) {
      toast("本地路径和远程路径不能为空", true);
      return;
    }
    const btn = $("btn-create-ok");
    btn.disabled = true;
    btn.textContent = "创建中…";
    try {
      await api.CreateSession(spec);
      // 归入所选分组（分组按会话名记录，未命名会话无法归组）
      const groupName = $("create-group").value;
      if (groupName && spec.name) {
        const g = layout.groups.find((x) => x.name === groupName);
        if (g && !g.sessions.includes(spec.name)) {
          removeKeyFromLayout(spec.name);
          g.sessions.push(spec.name);
          persistLayout();
        }
      }
      $("modal-create").classList.add("hidden");
      toast("会话已创建");
      refresh();
    } catch (err) {
      showError(err);
    } finally {
      btn.disabled = false;
      btn.textContent = "创建";
    }
  });

  $("btn-save-preset").addEventListener("click", async () => {
    const spec = readCreateForm();
    const name = await askText("预设名称", spec.name || "");
    if (!name) return;
    try {
      await api.SavePreset({ ...spec, name });
      toast("预设已保存：" + name);
      openCreateModal(); // 刷新预设下拉
    } catch (err) {
      showError(err);
    }
  });

  // 图片速传
  $("btn-pick-images").addEventListener("click", async () => {
    try {
      const paths = await api.SelectImages();
      if (paths && paths.length) sendImages(paths);
    } catch (err) {
      showError(err);
    }
  });
  $("pic-section").querySelectorAll(".pic-seg button").forEach((btn) => {
    btn.addEventListener("click", () => {
      picMode = btn.dataset.pmode;
      $("pic-section").querySelectorAll(".pic-seg button").forEach((b) =>
        b.classList.toggle("active", b.dataset.pmode === picMode)
      );
      const s = sessions.find((x) => x.identifier === selectedId);
      if (s) renderPicResults(s);
    });
  });
  $("btn-copy-all").addEventListener("click", async () => {
    const list = picResults[selectedId] || [];
    if (!list.length) return;
    if (await copyText(list.map(picPath).join("\n"))) {
      toast(`已复制 ${list.length} 条路径`);
    }
  });

  // 通用输入弹窗
  $("btn-input-ok").addEventListener("click", () => closeInput(true));
  $("btn-input-cancel").addEventListener("click", () => closeInput(false));
  $("input-field").addEventListener("keydown", (e) => {
    if (e.key === "Enter") closeInput(true);
    if (e.key === "Escape") closeInput(false);
  });

  // SSH 认证弹窗
  $("btn-prompt-ok").addEventListener("click", () => submitPrompt(false));
  $("btn-prompt-cancel").addEventListener("click", () => submitPrompt(true));
  $("prompt-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitPrompt(false);
    if (e.key === "Escape") submitPrompt(true);
  });

  // 设置弹窗
  $("btn-settings-cancel").addEventListener("click", () => $("modal-settings").classList.add("hidden"));
  $("btn-settings-ok").addEventListener("click", async () => {
    try {
      await api.SetMutagenPath($("settings-path").value.trim());
      $("modal-settings").classList.add("hidden");
      toast("设置已保存");
      checkMutagen();
      refresh();
    } catch (err) {
      showError(err);
    }
  });
}

// ---------- 启动 ----------
async function checkMutagen() {
  const api = backend();
  try {
    const info = await api.GetMutagenInfo();
    if (!info.ok) {
      $("empty-message").textContent = "⚠ " + info.error;
    }
  } catch (err) {
    /* ignore */
  }
}

function updateSortSeg() {
  $("sort-seg").querySelectorAll("button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === layout.sortMode);
  });
}

async function loadLayout() {
  try {
    const cfg = await backend().GetConfig();
    layout = normalizeLayout(cfg.layout);
    updateSortSeg();
  } catch (err) {
    /* 布局加载失败就用默认值 */
  }
}

async function applyPlatform() {
  try {
    const env = await window.runtime.Environment();
    if (env && env.platform === "windows") {
      document.body.classList.add("platform-windows");
      $("paste-key").textContent = "Ctrl+V";
    }
  } catch (err) {
    /* 拿不到环境信息就按 macOS 默认样式 */
  }
}

function waitForBackend(attempts) {
  if (backend()) {
    bindEvents();
    setupPromptListener();
    applyPlatform();
    checkMutagen();
    loadLayout().then(startPolling);
    return;
  }
  if (attempts > 100) {
    $("empty-message").textContent = "无法连接到应用后端（Wails 绑定未加载）";
    return;
  }
  setTimeout(() => waitForBackend(attempts + 1), 100);
}

document.addEventListener("DOMContentLoaded", () => waitForBackend(0));
