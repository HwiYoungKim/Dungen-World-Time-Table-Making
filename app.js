"use strict";

// ===== 상수 =====
const STORAGE_KEY = "moim-scheduler-v2";
const SYNC_API = "https://mantledb.sh/v2/moim-dungeon-world-hyk";
// 네임스페이스 잠금 키 (데이터 자체가 공개용이라 코드에 포함해도 무방, 외부인의 네임스페이스 탈취 방지용)
const SYNC_KEY = "7f4219747d32dd28793aa62ec630d11165e4836d2460f0ed8c61505d87a61d93";
// 공유 코드 목록(레지스트리): GitHub Actions가 이 목록을 보고 저장소에 장기 백업
const REGISTRY_ID = "registry";
// 저장소에 커밋된 장기 백업 (서버 데이터 유실 시 복구용)
const BACKUP_RAW = "https://raw.githubusercontent.com/HwiYoungKim/Dungen-World-Time-Table-Making/main/data/backups";
const DUNGEON_NAMES = [
  "김휘영(GM)", "강신욱", "강태웅", "김다영", "김현진", "박승한", "박현민", "배소윤",
  "서종혁", "손승미", "신재훈", "이듀태", "이형우", "조우성", "차윤석", "황수현"
];
const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];
// 초성/중성만 따로 있는 미완성 한글 (예: ㅐ, ㅋ) 감지
const JAMO_RE = /[\u3131-\u318E\u1100-\u11FF\uA960-\uA97F\uD7B0-\uD7FF]/;

let store = loadStore();
let state = { view: "home", scheduleId: null, tab: "input", pIdx: 0 };

function uid() {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
}

function currentYm() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// ===== 저장소 =====
function defaultStore() {
  return { deviceId: uid(), theme: "auto", schedules: [] };
}

function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seed(defaultStore());
    const s = JSON.parse(raw);
    if (!s.deviceId) s.deviceId = uid();
    if (!Array.isArray(s.schedules)) s.schedules = [];
    s.schedules.forEach(normalizeSchedule);
    return s;
  } catch (e) {
    console.warn("저장 데이터를 불러오지 못했습니다.", e);
    return seed(defaultStore());
  }
}

function seed(s) {
  s.schedules.push({
    id: "dungeon-world-2026",
    title: "던전월드 일정 조율",
    creatorId: s.deviceId,
    createdAt: new Date().toISOString(),
    threshold: 3,
    months: ["2026-09"],
    participants: DUNGEON_NAMES.slice(),
    availability: {}
  });
  s.schedules.forEach(normalizeSchedule);
  return s;
}

function normalizeSchedule(sc) {
  if (!Array.isArray(sc.months) || !sc.months.length) sc.months = [currentYm()];
  if (!Array.isArray(sc.participants)) sc.participants = [];
  if (!sc.availability || typeof sc.availability !== "object") sc.availability = {};
  if (!sc.availabilityMeta || typeof sc.availabilityMeta !== "object") sc.availabilityMeta = {};
  if (!sc.monthOps || typeof sc.monthOps !== "object") sc.monthOps = {};
  if (typeof sc.settingsTs !== "number") sc.settingsTs = 0;
  if (typeof sc.threshold !== "number" || sc.threshold < 1) sc.threshold = 3;
  sc.months.sort();
}

function saveStore() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function getSchedule(id) {
  return store.schedules.find(s => s.id === id) || null;
}

// ===== 유틸 =====
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function ymLabel(ym) {
  const [y, m] = ym.split("-").map(Number);
  return `${y}년 ${m}월`;
}

function dateLabel(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dow = DAY_NAMES[new Date(y, m - 1, d).getDay()];
  return `${m}월 ${d}일 (${dow})`;
}

function nextMonth(ym) {
  let [y, m] = ym.split("-").map(Number);
  m += 1;
  if (m > 12) { m = 1; y += 1; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

function monthRangeLabel(months) {
  if (months.length === 1) return ymLabel(months[0]);
  return `${ymLabel(months[0])} ~ ${ymLabel(months[months.length - 1])}`;
}

function dateCounts(sc) {
  const counts = {};
  for (const name of sc.participants) {
    const dates = sc.availability[name];
    if (!dates) continue;
    for (const d of Object.keys(dates)) {
      if (dates[d]) (counts[d] = counts[d] || []).push(name);
    }
  }
  return counts;
}

// 명단 파싱: 중복 자동 제거 + 미완성 한글 검사
function parseNames(raw) {
  let names = raw.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
  const malformed = names.filter(n => JAMO_RE.test(n));
  if (malformed.length) {
    return { error: `이름에 완성되지 않은 한글(자음/모음만 있는 글자)이 포함되어 있습니다: ${malformed.join(", ")}\n이름란을 다시 입력해 주세요.` };
  }
  names = [...new Set(names)]; // 중복 자동 제거
  return { names };
}

// ===== 중앙 서버 동기화 =====
// 서버가 UTF-8 본문을 깨뜨리는 경우가 있어 한글은 \uXXXX로 이스케이프해서 전송
function jsonAscii(obj) {
  return JSON.stringify(obj).replace(/[\u0080-\uffff]/g,
    c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

function friendlyHttpError(status) {
  if (status === 429 || status === 405)
    return new Error("서버 요청 한도에 도달했습니다. 변경 사항은 이 기기에 보관되니 잠시 후 💾 저장을 다시 눌러주세요.");
  return new Error(`서버 응답 오류 (${status})`);
}

async function apiGet(id) {
  const r = await fetch(`${SYNC_API}/${encodeURIComponent(id)}`, {
    headers: { "X-Mantle-Key": SYNC_KEY }
  });
  if (r.status === 404) {
    const e = new Error("공유 코드를 찾을 수 없습니다.");
    e.notFound = true;
    throw e;
  }
  if (!r.ok) throw friendlyHttpError(r.status);
  const json = await r.json();
  return json.data || null;
}

async function apiPut(id, data) {
  const r = await fetch(`${SYNC_API}/${encodeURIComponent(id)}`, {
    method: "POST", // MantleDB는 POST가 생성/전체 덮어쓰기
    headers: { "Content-Type": "application/json", "X-Mantle-Key": SYNC_KEY },
    body: jsonAscii({ name: "moim-schedule", data })
  });
  if (!r.ok) throw friendlyHttpError(r.status);
}

async function apiCreate(data) {
  const id = "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  await apiPut(id, data);
  return id;
}

// 병합: 서버/다른 기기 데이터와 로컬 데이터 합치기
function mergeSchedule(local, inc) {
  normalizeSchedule(inc);
  // 설정(이름/기준인원/참가자)은 더 최근 변경이 우선
  if ((inc.settingsTs || 0) > (local.settingsTs || 0)) {
    local.title = inc.title;
    local.threshold = inc.threshold;
    local.participants = inc.participants;
    local.settingsTs = inc.settingsTs;
  }
  // 월 추가/삭제 이력: 월별로 더 최근 작업이 우선
  const ops = { ...local.monthOps };
  for (const [ym, op] of Object.entries(inc.monthOps || {})) {
    if (!ops[ym] || op.ts > ops[ym].ts) ops[ym] = op;
  }
  local.monthOps = ops;
  const cand = new Set([...local.months, ...inc.months, ...Object.keys(ops)]);
  local.months = [...cand].filter(ym => !(ops[ym] && ops[ym].op === "del")).sort();
  if (!local.months.length) local.months = [currentYm()];
  // 가능 날짜: 참가자별로 더 최근에 수정한 쪽이 우선
  const metaL = local.availabilityMeta, metaI = inc.availabilityMeta || {};
  const names = new Set([...Object.keys(local.availability), ...Object.keys(inc.availability || {})]);
  for (const n of names) {
    const tl = metaL[n] || 0, ti = metaI[n] || 0;
    if (ti > tl) {
      local.availability[n] = { ...(inc.availability[n] || {}) };
      metaL[n] = ti;
    } else if (tl === 0 && ti === 0) {
      local.availability[n] = { ...(inc.availability[n] || {}), ...(local.availability[n] || {}) };
    }
  }
  purgeRemovedMonths(local);
}

// 조회 중단된 월의 체크 데이터 제거
function purgeRemovedMonths(sc) {
  const live = new Set(sc.months);
  for (const n of Object.keys(sc.availability)) {
    for (const d of Object.keys(sc.availability[n])) {
      if (!live.has(d.slice(0, 7))) delete sc.availability[n][d];
    }
    if (!Object.keys(sc.availability[n]).length) delete sc.availability[n];
  }
}

function exportable(sc) {
  const copy = JSON.parse(JSON.stringify(sc));
  delete copy.dirty;
  return copy;
}

// 서버에서 받아 병합 후 다시 서버에 저장
async function syncSchedule(sc) {
  if (!sc.syncId) return false;
  let remote;
  try {
    remote = await apiGet(sc.syncId);
  } catch (e) {
    // 서버에서 데이터가 사라졌다면 GitHub 장기 백업에서 복구 시도
    if (e.notFound && (await restoreFromBackup(sc))) return true;
    throw e;
  }
  if (remote) mergeSchedule(sc, remote);
  await apiPut(sc.syncId, exportable(sc));
  sc.dirty = false;
  dirtySchedules.delete(sc.id);
  saveStore();
  updateSaveBtn();
  registerCode(sc.syncId, sc.id);
  return true;
}

// 폴링용: 서버에서 받아 병합만 (변경이 있었는지 반환)
async function pullSchedule(sc) {
  if (!sc.syncId) return false;
  let remote;
  try {
    remote = await apiGet(sc.syncId);
  } catch (e) {
    if (e.notFound) return restoreFromBackup(sc);
    throw e;
  }
  if (!remote) return false;
  const before = JSON.stringify(exportable(sc));
  mergeSchedule(sc, remote);
  if (JSON.stringify(exportable(sc)) === before) return false;
  saveStore();
  return true;
}

// ===== 자동 동기화 =====
// 사이트에 들어오거나 탭에 다시 돌아왔을 때 서버 변경분을 자동 반영
// (무료 API 요청을 아끼기 위해 주기적 폴링 없이 복귀 시에만 갱신)
let pollBusy = false;
let lastPollAt = 0;
async function pollAll() {
  if (pollBusy || document.hidden) return;
  if (Date.now() - lastPollAt < 30000) return; // 과도한 요청 방지
  pollBusy = true;
  lastPollAt = Date.now();
  try {
    let changed = false;
    for (const sc of store.schedules) {
      if (!sc.syncId) continue;
      try {
        if (await pullSchedule(sc)) changed = true;
      } catch (e) {
        console.warn("자동 동기화 실패:", e);
      }
    }
    if (changed) {
      // 입력 중일 때는 화면을 다시 그리지 않음 (입력 내용 보호)
      const ae = document.activeElement;
      const editing = ae && ["INPUT", "TEXTAREA", "SELECT"].includes(ae.tagName);
      if (!editing) render(true);
      setSyncStatus("☁️ 다른 참가자의 변경이 반영됨");
    }
  } finally {
    pollBusy = false;
  }
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) pollAll(); });
window.addEventListener("focus", pollAll);

// 공유 코드를 레지스트리에 등록 (GitHub Actions 백업 대상 목록)
// defaultId를 주면 "기본 일정 → 현재 코드" 포인터도 함께 갱신 (모두 자동 연결용)
const registeredCodes = new Set();
async function registerCode(code, defaultId) {
  const key = code + "|" + (defaultId || "");
  if (!code || registeredCodes.has(key)) return;
  registeredCodes.add(key);
  try {
    const reg = (await apiGet(REGISTRY_ID)) || {};
    const codes = Array.isArray(reg.codes) ? reg.codes : [];
    const defaults = reg.defaults && typeof reg.defaults === "object" ? reg.defaults : {};
    let dirty = false;
    if (!codes.includes(code)) { codes.push(code); dirty = true; }
    if (defaultId && defaults[defaultId] !== code) { defaults[defaultId] = code; dirty = true; }
    if (dirty) await apiPut(REGISTRY_ID, { ...reg, codes, defaults });
  } catch (e) {
    registeredCodes.delete(key); // 다음에 재시도
    console.warn("레지스트리 등록 실패:", e);
  }
}

// 기본(공용) 일정은 코드 입력 없이 자동으로 서버에 연결
async function autoConnectDefaults() {
  try {
    const reg = await apiGet(REGISTRY_ID);
    const defaults = reg && reg.defaults;
    if (!defaults) return;
    let changed = false;
    for (const [schedId, code] of Object.entries(defaults)) {
      const sc = getSchedule(schedId);
      if (!sc || !code) continue;
      if (sc.syncId !== code) { sc.syncId = code; changed = true; }
      try { if (await pullSchedule(sc)) changed = true; } catch (e) { console.warn("자동 연결 동기화 실패:", e); }
    }
    if (changed) { saveStore(); render(); setSyncStatus("☁️ 공용 일정 자동 연결됨"); }
  } catch (e) {
    console.warn("자동 연결 실패:", e);
  }
}

// GitHub 저장소에 커밋된 백업에서 복구 → 새 서버 객체 생성
async function restoreFromBackup(sc) {
  try {
    const r = await fetch(`${BACKUP_RAW}/${encodeURIComponent(sc.syncId)}.json?t=${Date.now()}`);
    if (!r.ok) return false;
    const backup = await r.json();
    if (!backup || !Array.isArray(backup.participants)) return false;
    mergeSchedule(sc, backup);
    const newId = await apiCreate(exportable(sc));
    sc.syncId = newId;
    saveStore();
    await registerCode(newId, sc.id);
    alert(`⚠️ 임시 서버에서 데이터가 사라져 GitHub 장기 백업에서 복구했습니다.\n\n새 공유 코드: ${newId}\n\n공용(기본) 일정은 모두에게 자동으로 다시 연결됩니다. 직접 코드로 공유하던 일정이라면 새 코드를 다시 공유해 주세요.`);
    return true;
  } catch (e) {
    console.warn("백업 복구 실패:", e);
    return false;
  }
}

// ===== 수동 저장 =====
// 변경 사항은 로컬에 즉시 저장되고, 서버 업로드는 💾 저장 버튼을 누르거나
// 페이지를 나가거나 닫을 때 자동으로 이루어집니다.
const dirtySchedules = new Set();

function markDirty(sc) {
  sc.dirty = true;
  dirtySchedules.add(sc.id);
  saveStore();
  updateSaveBtn();
}

function updateSaveBtn() {
  const b = document.getElementById("btn-save");
  if (!b) return;
  const n = dirtySchedules.size;
  b.disabled = n === 0;
  b.textContent = n ? `💾 저장 (${n})` : "💾 저장됨";
  b.classList.toggle("save-dirty", n > 0);
}

async function saveAll() {
  const errors = [];
  for (const id of [...dirtySchedules]) {
    const sc = getSchedule(id);
    if (!sc) { dirtySchedules.delete(id); continue; }
    if (!sc.syncId) { sc.dirty = false; dirtySchedules.delete(id); continue; } // 로컬 전용 일정
    try {
      await syncSchedule(sc);
    } catch (e) {
      errors.push(`${sc.title}: ${e.message}`);
    }
  }
  saveStore();
  updateSaveBtn();
  return errors;
}

document.getElementById("btn-save").addEventListener("click", async () => {
  const b = document.getElementById("btn-save");
  b.disabled = true;
  b.textContent = "💾 저장 중...";
  const errors = await saveAll();
  updateSaveBtn();
  if (errors.length) alert("일부 일정 저장에 실패했습니다.\n" + errors.join("\n"));
  else setSyncStatus("💾 서버에 저장 완료");
  render(true);
});

// 페이지를 나가거나 닫을 때 저장 안 된 변경을 자동 업로드 (keepalive 요청)
function flushOnExit() {
  for (const id of [...dirtySchedules]) {
    const sc = getSchedule(id);
    if (!sc || !sc.syncId) { dirtySchedules.delete(id); continue; }
    try {
      fetch(`${SYNC_API}/${encodeURIComponent(sc.syncId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Mantle-Key": SYNC_KEY },
        body: jsonAscii({ name: "moim-schedule", data: exportable(sc) }),
        keepalive: true
      });
      sc.dirty = false;
      dirtySchedules.delete(id);
    } catch (e) { /* 최선 노력 */ }
  }
  saveStore();
  updateSaveBtn();
}
window.addEventListener("pagehide", flushOnExit);
document.addEventListener("visibilitychange", () => { if (document.hidden) flushOnExit(); });

let syncStatusTimer = null;
function setSyncStatus(msg) {
  const el = document.getElementById("sync-status");
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(syncStatusTimer);
  syncStatusTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

async function connectByCode(code) {
  let remote;
  try {
    remote = await apiGet(code);
  } catch (e) {
    // 서버에 없으면 GitHub 장기 백업에서 가져오기 시도
    if (!e.notFound) throw e;
    const r = await fetch(`${BACKUP_RAW}/${encodeURIComponent(code)}.json?t=${Date.now()}`);
    if (!r.ok) throw e;
    remote = await r.json();
    if (!remote || !Array.isArray(remote.participants)) throw e;
    // 백업 데이터로 새 서버 객체를 만들어 계속 공유 가능하게
    normalizeSchedule(remote);
    const newId = await apiCreate(remote);
    let sc = getSchedule(remote.id);
    if (sc) { sc.syncId = newId; mergeSchedule(sc, remote); }
    else { remote.syncId = newId; store.schedules.push(remote); sc = remote; }
    saveStore();
    registerCode(newId, sc.id);
    alert(`⚠️ 임시 서버에서 데이터가 사라져 GitHub 장기 백업에서 복구했습니다.\n\n새 공유 코드: ${newId}\n\n다른 참가자에게는 자동으로 다시 연결됩니다.`);
    return sc;
  }
  if (!remote || !Array.isArray(remote.participants)) {
    throw new Error("해당 코드에 올바른 일정 데이터가 없습니다.");
  }
  let sc = getSchedule(remote.id);
  if (sc) {
    sc.syncId = code;
    mergeSchedule(sc, remote);
  } else {
    normalizeSchedule(remote);
    remote.syncId = code;
    store.schedules.push(remote);
    sc = remote;
  }
  saveStore();
  await apiPut(code, exportable(sc));
  registerCode(code, sc.id);
  return sc;
}

// ===== 테마 =====
const mediaDark = window.matchMedia("(prefers-color-scheme: dark)");

function applyTheme() {
  const mode = store.theme === "auto" ? (mediaDark.matches ? "dark" : "light") : store.theme;
  document.documentElement.dataset.theme = mode;
  const btn = document.getElementById("btn-theme");
  btn.textContent = store.theme === "auto" ? "🌓 자동" : store.theme === "light" ? "☀️ 라이트" : "🌙 다크";
}

mediaDark.addEventListener("change", applyTheme);

document.getElementById("btn-theme").addEventListener("click", () => {
  store.theme = store.theme === "auto" ? "light" : store.theme === "light" ? "dark" : "auto";
  saveStore();
  applyTheme();
});

// ===== 새로고침: 서버에서 최신 데이터 받아오기 =====
document.getElementById("btn-reload").addEventListener("click", async () => {
  const btn = document.getElementById("btn-reload");
  btn.disabled = true;
  btn.textContent = "🔄 동기화 중...";
  store = loadStore(); // 다른 탭 변경분 반영
  const errors = [];
  for (const sc of store.schedules) {
    if (!sc.syncId) continue;
    try {
      await syncSchedule(sc);
    } catch (e) {
      errors.push(`${sc.title}: ${e.message}`);
    }
  }
  btn.disabled = false;
  btn.textContent = "🔄 새로고침";
  applyTheme();
  render();
  if (errors.length) alert("일부 일정 동기화에 실패했습니다.\n" + errors.join("\n"));
  else setSyncStatus("☁️ 최신 데이터로 갱신됨");
});

// ===== 캘린더 빌더 =====
function buildCalendar(ym, cellFn) {
  const [y, m] = ym.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const firstDow = new Date(y, m - 1, 1).getDay();

  const wrap = document.createElement("div");
  wrap.className = "cal-wrap";
  const title = document.createElement("h3");
  title.className = "cal-title";
  title.textContent = ymLabel(ym);
  wrap.appendChild(title);

  const table = document.createElement("table");
  table.className = "calendar";
  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  DAY_NAMES.forEach((d, i) => {
    const th = document.createElement("th");
    th.textContent = d;
    if (i === 0) th.className = "sun";
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  let day = 1;
  for (let week = 0; day <= daysInMonth; week++) {
    const tr = document.createElement("tr");
    for (let dow = 0; dow < 7; dow++) {
      const td = document.createElement("td");
      if ((week === 0 && dow < firstDow) || day > daysInMonth) {
        td.className = "blank";
      } else {
        const iso = `${ym}-${String(day).padStart(2, "0")}`;
        if (dow === 0) td.classList.add("sun");
        td.innerHTML = `<span class="daynum">${day}</span>`;
        const info = cellFn(iso);
        if (info) {
          (info.classes || []).forEach(c => td.classList.add(c));
          if (info.html) td.insertAdjacentHTML("beforeend", info.html);
          if (info.onClick) {
            td.classList.add("clickable");
            td.addEventListener("click", info.onClick);
          }
        }
        day++;
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function heatColor(count, total) {
  if (count === 0) return "";
  const ratio = Math.min(count / total, 1);
  const light = 90 - ratio * 55;
  return `hsl(243, 70%, ${light}%)`;
}

// ===== 렌더링 =====
const app = document.getElementById("app");

function render(keepScroll) {
  app.innerHTML = "";
  if (state.view === "home") renderHome();
  else if (state.view === "new") renderNewForm();
  else if (state.view === "detail") renderDetail();
  if (!keepScroll) window.scrollTo(0, 0);
}

// ----- 홈 -----
function renderHome() {
  const top = document.createElement("div");
  top.className = "home-top";
  top.innerHTML = `<h2>일정 목록</h2>`;
  const newBtn = document.createElement("button");
  newBtn.className = "btn btn-primary";
  newBtn.textContent = "➕ 새로운 일정 관리하기";
  newBtn.addEventListener("click", () => { state = { ...state, view: "new" }; render(); });
  top.appendChild(newBtn);
  app.appendChild(top);

  if (!store.schedules.length) {
    const p = document.createElement("p");
    p.className = "empty-note";
    p.textContent = "아직 일정이 없습니다. 새로운 일정을 만들어 보세요!";
    app.appendChild(p);
  }

  for (const sc of store.schedules) {
    const counts = dateCounts(sc);
    const okDays = Object.values(counts).filter(names => names.length >= sc.threshold).length;
    const card = document.createElement("div");
    card.className = "card schedule-card";
    card.innerHTML = `
      <h3>${escapeHtml(sc.title)}</h3>
      <div class="schedule-meta">
        ${sc.creatorId === store.deviceId ? '<span class="badge">내가 만든 일정</span>' : ""}
        ${sc.syncId ? '<span class="badge">🌐 실시간 공유중</span>' : ""}
        <span class="badge">${sc.participants.length}명</span>
        <span class="badge">${sc.threshold}인 이상 기준</span><br>
        기간: ${monthRangeLabel(sc.months)} · 가능 날짜 ${okDays}일 발견
      </div>`;
    card.addEventListener("click", () => {
      // 기본 화면: 가능한 날짜 캘린더 보기
      state = { view: "detail", scheduleId: sc.id, tab: "result", pIdx: 0 };
      render();
    });
    app.appendChild(card);
  }

  // 공유 코드로 일정 가져오기
  const codeCard = document.createElement("div");
  codeCard.className = "card";
  codeCard.innerHTML = `
    <h3 style="margin:0 0 6px;font-size:0.95rem">🌐 공유 코드로 일정 가져오기</h3>
    <p class="hint" style="margin-top:0">일정을 만든 사람에게 받은 공유 코드를 입력하면 같은 일정에 함께 참여할 수 있습니다.</p>`;
  const row = document.createElement("div");
  row.className = "settings-row";
  const codeInput = document.createElement("input");
  codeInput.type = "text";
  codeInput.placeholder = "공유 코드 입력";
  codeInput.className = "text-input";
  const codeBtn = document.createElement("button");
  codeBtn.className = "btn";
  codeBtn.textContent = "가져오기";
  codeBtn.addEventListener("click", async () => {
    const code = codeInput.value.trim();
    if (!code) { alert("공유 코드를 입력해 주세요."); return; }
    codeBtn.disabled = true;
    codeBtn.textContent = "가져오는 중...";
    try {
      const sc = await connectByCode(code);
      state = { view: "detail", scheduleId: sc.id, tab: "result", pIdx: 0 };
      render();
    } catch (e) {
      alert("가져오기 실패: " + e.message);
      codeBtn.disabled = false;
      codeBtn.textContent = "가져오기";
    }
  });
  row.appendChild(codeInput);
  row.appendChild(codeBtn);
  codeCard.appendChild(row);

  const impBtn = document.createElement("button");
  impBtn.className = "btn btn-small";
  impBtn.style.marginTop = "6px";
  impBtn.textContent = "📥 파일(JSON)로 가져오기";
  impBtn.addEventListener("click", () => startImport());
  codeCard.appendChild(impBtn);
  app.appendChild(codeCard);
}

// ----- 새 일정 폼 -----
function renderNewForm() {
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `
    <h2 style="margin-top:0">새로운 일정 만들기</h2>
    <div class="form-field">
      <label for="f-title">일정 이름</label>
      <input id="f-title" type="text" placeholder="예: 던전월드 10월 모임" maxlength="50">
    </div>
    <div class="form-field">
      <label for="f-names">참가자 명단 (쉼표 또는 줄바꿈으로 구분)</label>
      <textarea id="f-names" placeholder="김휘영,잘생김,카리스마..."></textarea>
      <div class="form-hint">입력한 이름 수만큼 인원이 등록됩니다. 중복된 이름은 자동으로 하나만 남깁니다.</div>
    </div>
    <div class="form-field">
      <label for="f-start">일정을 물어볼 기간 — 시작 월</label>
      <input id="f-start" type="month" value="${currentYm()}" min="2020-01" max="2099-12">
    </div>
    <div class="form-field">
      <label for="f-months">기간 (개월 수)</label>
      <input id="f-months" type="number" value="1" min="1" max="12">
      <div class="form-hint">나중에 설정에서 달을 더 추가하거나 줄일 수 있습니다.</div>
    </div>
    <div class="form-field">
      <label for="f-threshold">몇 명 이상 모이면 "가능한 날짜"로 볼까요?</label>
      <input id="f-threshold" type="number" value="3" min="1" max="99">
    </div>
    <div class="form-actions">
      <button id="f-submit" class="btn btn-primary">만들기</button>
      <button id="f-cancel" class="btn">취소</button>
    </div>`;
  app.appendChild(card);

  card.querySelector("#f-cancel").addEventListener("click", () => {
    state = { ...state, view: "home" };
    render();
  });

  card.querySelector("#f-submit").addEventListener("click", () => {
    const title = card.querySelector("#f-title").value.trim();
    const parsed = parseNames(card.querySelector("#f-names").value);
    if (parsed.error) { alert(parsed.error); return; }
    const names = parsed.names;
    const startYm = card.querySelector("#f-start").value;
    const monthCount = Math.max(1, Math.min(12, +card.querySelector("#f-months").value || 1));
    const threshold = Math.max(1, +card.querySelector("#f-threshold").value || 3);

    if (!title) { alert("일정 이름을 입력해 주세요."); return; }
    if (names.length < 2) { alert("참가자를 2명 이상 입력해 주세요."); return; }
    if (!/^\d{4}-\d{2}$/.test(startYm)) { alert("시작 월을 선택해 주세요."); return; }
    if (threshold > names.length) { alert("기준 인원이 참가자 수보다 많습니다."); return; }

    const months = [];
    let ym = startYm;
    for (let i = 0; i < monthCount; i++) { months.push(ym); ym = nextMonth(ym); }

    const sc = {
      id: uid(),
      title,
      creatorId: store.deviceId,
      createdAt: new Date().toISOString(),
      threshold,
      months,
      participants: names,
      availability: {},
      availabilityMeta: {},
      monthOps: {},
      settingsTs: Date.now()
    };
    store.schedules.push(sc);
    saveStore();
    state = { view: "detail", scheduleId: sc.id, tab: "input", pIdx: 0 };
    render();
  });
}

// ----- 일정 상세 -----
function renderDetail() {
  const sc = getSchedule(state.scheduleId);
  if (!sc) { state = { ...state, view: "home" }; render(); return; }

  const head = document.createElement("div");
  head.className = "detail-head";
  const backBtn = document.createElement("button");
  backBtn.className = "btn btn-small";
  backBtn.textContent = "← 목록";
  backBtn.addEventListener("click", () => { state = { ...state, view: "home" }; render(); });
  const h2 = document.createElement("h2");
  h2.textContent = sc.title;
  head.appendChild(backBtn);
  head.appendChild(h2);
  const syncStatus = document.createElement("span");
  syncStatus.id = "sync-status";
  syncStatus.className = "hint";
  syncStatus.hidden = true;
  head.appendChild(syncStatus);
  app.appendChild(head);

  const tabs = document.createElement("div");
  tabs.className = "tabs";
  const tabDefs = [
    ["result", "🗓️ 가능한 날짜 보기"],
    ["input", "✏️ 날짜 체크"],
    ["share", "⚙️ 공유/설정"]
  ];
  for (const [key, label] of tabDefs) {
    const b = document.createElement("button");
    b.className = "tab" + (state.tab === key ? " active" : "");
    b.textContent = label;
    b.addEventListener("click", () => { state = { ...state, tab: key }; render(); });
    tabs.appendChild(b);
  }
  app.appendChild(tabs);

  if (state.tab === "input") renderInputTab(sc);
  else if (state.tab === "result") renderResultTab(sc);
  else renderShareTab(sc);
}

// ----- 날짜 체크 탭 -----
function renderInputTab(sc) {
  const notice = document.createElement("div");
  notice.className = "notice-big";
  notice.innerHTML = "⚠️ 여기서 체크한 날짜는<br>「<u>시간을 낼 수 있는 날</u>」로 취급됩니다!";
  app.appendChild(notice);

  const bar = document.createElement("div");
  bar.className = "participant-bar";
  const label = document.createElement("label");
  label.textContent = "내 이름:";
  const sel = document.createElement("select");
  sc.participants.forEach((n, i) => {
    const o = document.createElement("option");
    o.value = i;
    o.textContent = n;
    sel.appendChild(o);
  });
  if (state.pIdx >= sc.participants.length) state.pIdx = 0;
  sel.value = state.pIdx;
  sel.addEventListener("change", () => { state = { ...state, pIdx: +sel.value }; render(); });
  const clearBtn = document.createElement("button");
  clearBtn.className = "btn btn-small btn-danger";
  clearBtn.textContent = "내 체크 지우기";
  clearBtn.addEventListener("click", () => {
    const name = sc.participants[state.pIdx];
    if (confirm(`"${name}"의 체크를 모두 지울까요?`)) {
      delete sc.availability[name];
      sc.availabilityMeta[name] = Date.now();
      saveStore();
      markDirty(sc);
      render();
    }
  });
  bar.appendChild(label);
  bar.appendChild(sel);
  bar.appendChild(clearBtn);
  app.appendChild(bar);

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "캘린더에서 시간을 낼 수 있는 날짜를 눌러 체크하세요. 다시 누르면 해제됩니다. 체크 후 상단의 💾 저장을 누르면 바로 업로드되고, 누르지 않아도 페이지를 나갈 때 자동으로 업로드됩니다.";
  app.appendChild(hint);

  const name = sc.participants[state.pIdx];
  const grid = document.createElement("div");
  grid.className = "cal-grid";
  for (const ym of sc.months) {
    grid.appendChild(buildCalendar(ym, iso => {
      const mine = sc.availability[name] || {};
      return {
        classes: mine[iso] ? ["checked"] : [],
        onClick: e => {
          const my = sc.availability[name] || (sc.availability[name] = {});
          if (my[iso]) delete my[iso];
          else my[iso] = true;
          if (!Object.keys(my).length) delete sc.availability[name];
          sc.availabilityMeta[name] = Date.now();
          saveStore();
          markDirty(sc);
          e.currentTarget.classList.toggle("checked");
        }
      };
    }));
  }
  app.appendChild(grid);
}

// ----- 결과 탭 (기본 화면) -----
function renderResultTab(sc) {
  const counts = dateCounts(sc);
  const total = sc.participants.length;

  const reloadHint = document.createElement("p");
  reloadHint.className = "hint";
  reloadHint.textContent = sc.syncId
    ? "다른 참가자의 변경은 30초마다, 그리고 사이트에 다시 들어올 때 자동으로 반영됩니다. 즉시 확인하려면 상단 🔄 새로고침을 누르세요."
    : "이 일정은 아직 실시간 공유가 꺼져 있습니다. [공유/설정]에서 공유 코드를 만들면 모두가 같은 데이터를 보게 됩니다.";
  app.appendChild(reloadHint);

  // 캘린더 시각화 (기본으로 먼저 표시)
  const legend = document.createElement("div");
  legend.className = "legend";
  legend.innerHTML =
    `색이 진할수록 가능한 인원이 많습니다. 숫자 = 가능 인원 수.` +
    ` <span class="meets-sample"></span> 초록 테두리 = ${sc.threshold}인 이상 가능한 날.` +
    ` 날짜를 누르면 가능한 사람 목록이 나옵니다.`;
  app.appendChild(legend);

  const detail = document.createElement("div");
  detail.className = "cell-detail";
  detail.hidden = true;

  const grid = document.createElement("div");
  grid.className = "cal-grid";
  for (const ym of sc.months) {
    grid.appendChild(buildCalendar(ym, iso => {
      const names = counts[iso] || [];
      const c = names.length;
      const classes = [];
      if (c >= sc.threshold) classes.push("meets");
      return {
        classes,
        html: c ? `<span class="count-pill">${c}명</span>` : "",
        onClick: () => {
          detail.hidden = false;
          detail.innerHTML = `<h3>${dateLabel(iso)} — 가능인원 ${c}명</h3>` +
            (c
              ? names.map(n => `<span class="name-chip">${escapeHtml(n)}</span>`).join("")
              : "이 날짜에 가능한 사람이 없습니다.");
          detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      };
    }));
  }
  grid.querySelectorAll("td.clickable").forEach(td => {
    const daynum = td.querySelector(".daynum");
    const pill = td.querySelector(".count-pill");
    if (!pill) return;
    const c = parseInt(pill.textContent, 10);
    td.style.background = heatColor(c, total);
    if (c / total > 0.45) {
      td.style.color = "#fff";
      if (daynum) daynum.style.color = "#fff";
    }
  });
  app.appendChild(grid);
  app.appendChild(detail);

  // 가능한 날짜 목록 (모든 경우의 수)
  const listCard = document.createElement("div");
  listCard.className = "card";
  listCard.innerHTML = `<h3 style="margin-top:0">✅ ${sc.threshold}인 이상 가능한 날짜 (모든 경우)</h3>`;
  const okDates = Object.keys(counts)
    .filter(d => counts[d].length >= sc.threshold)
    .sort();
  const maxCount = okDates.reduce((m, d) => Math.max(m, counts[d].length), 0);

  const ul = document.createElement("ul");
  ul.className = "result-list";
  if (!okDates.length) {
    const li = document.createElement("li");
    li.textContent = `아직 ${sc.threshold}인 이상 가능한 날짜가 없습니다.`;
    ul.appendChild(li);
  } else {
    for (const d of okDates) {
      const names = counts[d];
      const li = document.createElement("li");
      if (names.length === maxCount) li.classList.add("best");
      li.innerHTML = `<span class="date-label">${dateLabel(d)}</span> — 가능인원 ${names.length}명${names.length === maxCount ? " 🏆" : ""}<br>` +
        names.map(n => `<span class="name-chip">${escapeHtml(n)}</span>`).join("");
      ul.appendChild(li);
    }
  }
  listCard.appendChild(ul);
  app.appendChild(listCard);
}

// ----- 공유/설정 탭 -----
function renderShareTab(sc) {
  // 실시간 공유 (중앙 서버)
  const syncCard = document.createElement("div");
  syncCard.className = "card";
  syncCard.innerHTML = `<h3 style="margin-top:0">🌐 실시간 공유 (중앙 서버)</h3>`;
  if (sc.syncId) {
    syncCard.insertAdjacentHTML("beforeend",
      `<p class="hint">이 일정은 서버와 동기화 중입니다. 체크/월 추가/조회 중단이 모두에게 반영됩니다. 아래 공유 코드를 다른 참가자에게 알려주세요.</p>`);
    const row = document.createElement("div");
    row.className = "settings-row";
    const codeBox = document.createElement("input");
    codeBox.type = "text";
    codeBox.readOnly = true;
    codeBox.value = sc.syncId;
    codeBox.className = "text-input";
    const copyBtn = document.createElement("button");
    copyBtn.className = "btn btn-small";
    copyBtn.textContent = "📋 복사";
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(sc.syncId);
        copyBtn.textContent = "✅ 복사됨";
        setTimeout(() => { copyBtn.textContent = "📋 복사"; }, 1500);
      } catch {
        codeBox.select();
        document.execCommand("copy");
      }
    });
    const syncNowBtn = document.createElement("button");
    syncNowBtn.className = "btn btn-small";
    syncNowBtn.textContent = "☁️ 지금 동기화";
    syncNowBtn.addEventListener("click", async () => {
      syncNowBtn.disabled = true;
      syncNowBtn.textContent = "동기화 중...";
      try {
        await syncSchedule(sc);
        render();
      } catch (e) {
        alert("동기화 실패: " + e.message);
        syncNowBtn.disabled = false;
        syncNowBtn.textContent = "☁️ 지금 동기화";
      }
    });
    row.appendChild(codeBox);
    row.appendChild(copyBtn);
    row.appendChild(syncNowBtn);
    syncCard.appendChild(row);
  } else {
    syncCard.insertAdjacentHTML("beforeend",
      `<p class="hint">공유 코드를 만들면 모든 참가자가 같은 데이터를 실시간으로 공유합니다. 누가 월을 추가/삭제해도 모두에게 반영됩니다.</p>`);
    const makeBtn = document.createElement("button");
    makeBtn.className = "btn btn-primary";
    makeBtn.textContent = "🌐 공유 코드 만들기";
    makeBtn.addEventListener("click", async () => {
      makeBtn.disabled = true;
      makeBtn.textContent = "만드는 중...";
      try {
        const id = await apiCreate(exportable(sc));
        sc.syncId = id;
        saveStore();
        registerCode(id, sc.id);
        render();
      } catch (e) {
        alert("공유 코드 생성 실패: " + e.message);
        makeBtn.disabled = false;
        makeBtn.textContent = "🌐 공유 코드 만들기";
      }
    });
    syncCard.appendChild(makeBtn);
  }
  app.appendChild(syncCard);

  // 파일 공유
  const shareCard = document.createElement("div");
  shareCard.className = "card";
  shareCard.innerHTML = `<h3 style="margin-top:0">📤 파일로 공유 (보조 수단)</h3>
    <p class="hint">서버 없이 JSON 파일로 주고받아 병합할 수도 있습니다.</p>`;
  const row1 = document.createElement("div");
  row1.className = "settings-row";
  const expBtn = document.createElement("button");
  expBtn.className = "btn";
  expBtn.textContent = "📤 JSON 내보내기";
  expBtn.addEventListener("click", () => exportSchedule(sc));
  const impBtn = document.createElement("button");
  impBtn.className = "btn";
  impBtn.textContent = "📥 JSON 가져오기 (병합)";
  impBtn.addEventListener("click", () => startImport(sc.id));
  row1.appendChild(expBtn);
  row1.appendChild(impBtn);
  shareCard.appendChild(row1);
  app.appendChild(shareCard);

  // 설정
  const setCard = document.createElement("div");
  setCard.className = "card";
  setCard.innerHTML = `<h3 style="margin-top:0">⚙️ 설정</h3>
    <p class="hint">현재 조사 기간: <strong>${monthRangeLabel(sc.months)}</strong> (${sc.months.map(ymLabel).join(", ")})</p>`;

  // 월 추가
  const rowMonth = document.createElement("div");
  rowMonth.className = "settings-row";
  const addBtn = document.createElement("button");
  addBtn.className = "btn";
  const nm = nextMonth(sc.months[sc.months.length - 1]);
  addBtn.textContent = `➕ ${ymLabel(nm)} 추가하기`;
  addBtn.addEventListener("click", () => {
    sc.months.push(nm);
    sc.months.sort();
    sc.monthOps[nm] = { op: "add", ts: Date.now() };
    saveStore();
    markDirty(sc);
    render();
  });
  rowMonth.appendChild(addBtn);
  const monthHint = document.createElement("span");
  monthHint.className = "hint";
  monthHint.textContent = "기존에 체크한 기록은 그대로 유지됩니다.";
  rowMonth.appendChild(monthHint);
  setCard.appendChild(rowMonth);

  // 조회 중단(월 줄이기): 범위 선택
  setCard.insertAdjacentHTML("beforeend", `<hr class="divider">
    <h4 style="margin:0 0 4px">🚫 일정 조회 중단하기 (기간 줄이기)</h4>
    <p class="hint" style="margin-top:0">실수로 추가한 달을 없앨 수 있습니다. 여러 달을 한 번에 중단할 수 있으며, <strong>해당 기간에 기입된 체크 데이터는 모두 삭제되고 복구할 수 없습니다.</strong></p>`);
  const rowDel = document.createElement("div");
  rowDel.className = "settings-row";
  const fromSel = document.createElement("select");
  const toSel = document.createElement("select");
  for (const s of [fromSel, toSel]) {
    s.className = "month-select";
    sc.months.forEach(ym => {
      const o = document.createElement("option");
      o.value = ym;
      o.textContent = ymLabel(ym);
      s.appendChild(o);
    });
  }
  toSel.value = sc.months[sc.months.length - 1];
  const delLabel1 = document.createElement("span");
  delLabel1.textContent = "부터";
  const delLabel2 = document.createElement("span");
  delLabel2.textContent = "까지";
  const delBtn = document.createElement("button");
  delBtn.className = "btn btn-danger btn-small";
  delBtn.textContent = "조회 중단하기";
  delBtn.addEventListener("click", () => {
    const from = fromSel.value, to = toSel.value;
    if (from > to) { alert("시작 월이 끝 월보다 늦습니다. 다시 선택해 주세요."); return; }
    const target = sc.months.filter(ym => ym >= from && ym <= to);
    if (target.length >= sc.months.length) {
      alert("조사 기간은 최소 한 달은 남아 있어야 합니다.");
      return;
    }
    const label = from === to ? ymLabel(from) : `${ymLabel(from)}부터 ${ymLabel(to)}까지`;
    const ans = prompt(
      `⚠️ 지우면 데이터 복구가 불가능합니다.\n${label} 조사받기를 지우시겠습니까?\n\n(해당 기간에 기입된 모든 체크가 삭제됩니다)\n계속하려면 아래에 "지우겠습니다"를 정확히 입력하세요.`
    );
    if (ans !== "지우겠습니다") {
      if (ans !== null) alert("입력이 일치하지 않아 취소되었습니다.");
      return;
    }
    const now = Date.now();
    for (const ym of target) sc.monthOps[ym] = { op: "del", ts: now };
    sc.months = sc.months.filter(ym => !target.includes(ym));
    purgeRemovedMonths(sc);
    saveStore();
    markDirty(sc);
    alert(`${label} 조사받기를 중단하고 해당 기간의 데이터를 모두 삭제했습니다.`);
    render();
  });
  rowDel.appendChild(fromSel);
  rowDel.appendChild(delLabel1);
  rowDel.appendChild(toSel);
  rowDel.appendChild(delLabel2);
  rowDel.appendChild(delBtn);
  setCard.appendChild(rowDel);

  // 기준 인원
  setCard.insertAdjacentHTML("beforeend", `<hr class="divider">`);
  const rowTh = document.createElement("div");
  rowTh.className = "settings-row";
  const thLabel = document.createElement("label");
  thLabel.textContent = "가능한 날짜 기준 인원:";
  const thInput = document.createElement("input");
  thInput.type = "number";
  thInput.min = "1";
  thInput.max = String(sc.participants.length);
  thInput.value = sc.threshold;
  const thBtn = document.createElement("button");
  thBtn.className = "btn btn-small";
  thBtn.textContent = "저장";
  thBtn.addEventListener("click", () => {
    const v = Math.max(1, Math.min(sc.participants.length, +thInput.value || sc.threshold));
    sc.threshold = v;
    sc.settingsTs = Date.now();
    saveStore();
    markDirty(sc);
    alert(`기준 인원이 ${v}명으로 변경되었습니다.`);
    render();
  });
  rowTh.appendChild(thLabel);
  rowTh.appendChild(thInput);
  rowTh.appendChild(thBtn);
  setCard.appendChild(rowTh);
  app.appendChild(setCard);

  // 삭제 (만든 사람만)
  if (sc.creatorId === store.deviceId) {
    const dz = document.createElement("div");
    dz.className = "card danger-zone";
    dz.innerHTML = `<h3>🗑️ 일정 삭제</h3>
      <p class="hint">이 일정은 내가 만든 일정입니다. 삭제하면 되돌릴 수 없습니다.</p>`;
    const delBtn2 = document.createElement("button");
    delBtn2.className = "btn btn-danger";
    delBtn2.textContent = "이 일정 삭제하기";
    delBtn2.addEventListener("click", () => {
      if (confirm(`"${sc.title}" 일정을 정말 삭제할까요? 되돌릴 수 없습니다.`) &&
          confirm("모든 참가자의 체크 기록도 함께 삭제됩니다. 계속할까요?")) {
        store.schedules = store.schedules.filter(s => s.id !== sc.id);
        saveStore();
        state = { ...state, view: "home" };
        render();
      }
    });
    dz.appendChild(delBtn2);
    app.appendChild(dz);
  } else {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "이 일정은 다른 사람이 만든 일정이라 삭제 버튼이 표시되지 않습니다. (만든 사람만 삭제할 수 있습니다)";
    app.appendChild(p);
  }
}

// ===== 내보내기 / 가져오기 (파일) =====
function exportSchedule(sc) {
  const payload = { type: "moim-schedule", version: 2, schedule: sc };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safeTitle = sc.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 30);
  a.download = `${safeTitle}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

const fileImport = document.getElementById("file-import");
let importTargetId = null;

function startImport(targetId = null) {
  importTargetId = targetId;
  fileImport.value = "";
  fileImport.click();
}

fileImport.addEventListener("change", () => {
  const file = fileImport.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const payload = JSON.parse(reader.result);
      const inc = payload && payload.schedule ? payload.schedule : payload;
      if (!inc || !Array.isArray(inc.participants)) throw new Error("일정 데이터 형식이 아닙니다.");
      normalizeSchedule(inc);

      const existing = getSchedule(inc.id) || (importTargetId ? getSchedule(importTargetId) : null);
      if (existing) {
        mergeSchedule(existing, inc);
        if (!existing.syncId && inc.syncId) existing.syncId = inc.syncId;
        alert(`"${existing.title}" 일정에 데이터를 병합했습니다.`);
        markDirty(existing);
        state = { view: "detail", scheduleId: existing.id, tab: "result", pIdx: 0 };
      } else {
        if (!inc.id) inc.id = uid();
        store.schedules.push(inc);
        alert(`"${inc.title || "새 일정"}"을(를) 가져왔습니다.`);
        state = { view: "detail", scheduleId: inc.id, tab: "result", pIdx: 0 };
      }
      saveStore();
      render();
    } catch (e) {
      alert("JSON 파일을 읽을 수 없습니다: " + e.message);
    }
  };
  reader.readAsText(file);
});

// ===== 초기화 =====
// 이전에 저장되지 않은 변경 사항 복원
store.schedules.forEach(sc => { if (sc.dirty && sc.syncId) dirtySchedules.add(sc.id); });
updateSaveBtn();
applyTheme();
render();
autoConnectDefaults(); // 공용 일정은 코드 입력 없이 자동 연결
