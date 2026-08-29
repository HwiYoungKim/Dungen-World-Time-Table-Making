"use strict";

// ===== 저장소 =====
const STORAGE_KEY = "moim-scheduler-v2";
const DUNGEON_NAMES = [
  "김휘영(GM)", "강신욱", "강태웅", "김다영", "김현진", "박승한", "박현민", "배소윤",
  "서종혁", "손승미", "신재훈", "이듀태", "이형우", "조우성", "차윤석", "황수현"
];
const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

let store = loadStore();
let state = { view: "home", scheduleId: null, tab: "input", pIdx: 0 };

function uid() {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
}

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
  return s;
}

function normalizeSchedule(sc) {
  if (!Array.isArray(sc.months) || !sc.months.length) sc.months = ["2026-09"];
  if (!Array.isArray(sc.participants)) sc.participants = [];
  if (!sc.availability || typeof sc.availability !== "object") sc.availability = {};
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

// 날짜별 가능 인원: { "2026-09-02": ["이름", ...] }
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

// ===== 새로고침 (수동 reload) =====
document.getElementById("btn-reload").addEventListener("click", () => {
  store = loadStore();
  applyTheme();
  render();
});

// ===== 캘린더 빌더 =====
// cellFn(iso) -> { classes: [], html: "", onClick: fn } | null
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
  const light = 90 - ratio * 55; // 90% → 35%
  return `hsl(243, 70%, ${light}%)`;
}

// ===== 렌더링 =====
const app = document.getElementById("app");

function render() {
  app.innerHTML = "";
  if (state.view === "home") renderHome();
  else if (state.view === "new") renderNewForm();
  else if (state.view === "detail") renderDetail();
  window.scrollTo(0, 0);
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
        <span class="badge">${sc.participants.length}명</span>
        <span class="badge">${sc.threshold}인 이상 기준</span><br>
        기간: ${monthRangeLabel(sc.months)} · 가능 날짜 ${okDays}일 발견
      </div>`;
    card.addEventListener("click", () => {
      state = { view: "detail", scheduleId: sc.id, tab: "input", pIdx: 0 };
      render();
    });
    app.appendChild(card);
  }

  // 홈에서 JSON 가져오기 (다른 사람이 만든 일정 받기)
  const importCard = document.createElement("div");
  importCard.className = "card";
  importCard.innerHTML = `<div class="schedule-meta">다른 사람에게 받은 일정 파일이 있나요?</div>`;
  const impBtn = document.createElement("button");
  impBtn.className = "btn btn-small";
  impBtn.style.marginTop = "8px";
  impBtn.textContent = "📥 일정 JSON 가져오기";
  impBtn.addEventListener("click", () => startImport());
  importCard.appendChild(impBtn);
  app.appendChild(importCard);
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
      <textarea id="f-names" placeholder="김휘영(GM), 강신욱, 강태웅, ..."></textarea>
      <div class="form-hint">입력한 이름 수만큼 인원이 등록됩니다.</div>
    </div>
    <div class="form-field">
      <label for="f-start">일정을 물어볼 기간 — 시작 월</label>
      <input id="f-start" type="month" value="2026-09" min="2020-01" max="2099-12">
    </div>
    <div class="form-field">
      <label for="f-months">기간 (개월 수)</label>
      <input id="f-months" type="number" value="1" min="1" max="12">
      <div class="form-hint">예: 시작 월 2026-09 + 2개월 → 9월, 10월 두 달을 조사합니다. 나중에 설정에서 달을 더 추가할 수도 있습니다.</div>
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
    const names = card.querySelector("#f-names").value
      .split(/[\n,]/).map(s => s.trim()).filter(Boolean);
    const startYm = card.querySelector("#f-start").value;
    const monthCount = Math.max(1, Math.min(12, +card.querySelector("#f-months").value || 1));
    const threshold = Math.max(1, +card.querySelector("#f-threshold").value || 3);

    if (!title) { alert("일정 이름을 입력해 주세요."); return; }
    if (names.length < 2) { alert("참가자를 2명 이상 입력해 주세요."); return; }
    if (new Set(names).size !== names.length) { alert("중복된 이름이 있습니다. 이름은 서로 달라야 합니다."); return; }
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
      availability: {}
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
  app.appendChild(head);

  const tabs = document.createElement("div");
  tabs.className = "tabs";
  const tabDefs = [
    ["input", "✏️ 날짜 체크"],
    ["result", "🗓️ 가능한 날짜 보기"],
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
      saveStore();
      render();
    }
  });
  bar.appendChild(label);
  bar.appendChild(sel);
  bar.appendChild(clearBtn);
  app.appendChild(bar);

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "캘린더에서 시간을 낼 수 있는 날짜를 눌러 체크하세요. 다시 누르면 해제됩니다.";
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
          saveStore();
          const td = e.currentTarget;
          td.classList.toggle("checked");
        }
      };
    }));
  }
  app.appendChild(grid);
}

// ----- 결과 탭 -----
function renderResultTab(sc) {
  const counts = dateCounts(sc);
  const total = sc.participants.length;

  const reloadHint = document.createElement("p");
  reloadHint.className = "hint";
  reloadHint.textContent = "다른 사람이 업데이트한 데이터를 가져왔다면 상단의 🔄 새로고침을 눌러 최신 결과를 확인하세요.";
  app.appendChild(reloadHint);

  // 가능한 날짜 목록
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

  // 캘린더 시각화
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
  // 히트맵 색상 적용 (buildCalendar 이후 인라인 스타일)
  grid.querySelectorAll("td.clickable").forEach(td => {
    const daynum = td.querySelector(".daynum");
    const pill = td.querySelector(".count-pill");
    if (!pill) return;
    const c = parseInt(pill.textContent, 10);
    td.style.background = heatColor(c, total);
    if (c / total > 0.45) {
      td.style.color = "#fff";
      if (daynum) daynum.style.color = "#fff";
    } else {
      td.style.color = "";
    }
  });
  app.appendChild(grid);
  app.appendChild(detail);
}

// ----- 공유/설정 탭 -----
function renderShareTab(sc) {
  const shareCard = document.createElement("div");
  shareCard.className = "card";
  shareCard.innerHTML = `<h3 style="margin-top:0">📤 데이터 공유</h3>
    <p class="hint">각자 체크한 뒤 JSON을 내보내 한 사람에게 모으고, 그 사람이 가져오기로 병합하면 전체 결과를 볼 수 있습니다.</p>`;
  const row1 = document.createElement("div");
  row1.className = "settings-row";
  const expBtn = document.createElement("button");
  expBtn.className = "btn";
  expBtn.textContent = "📤 이 일정 JSON 내보내기";
  expBtn.addEventListener("click", () => exportSchedule(sc));
  const impBtn = document.createElement("button");
  impBtn.className = "btn";
  impBtn.textContent = "📥 JSON 가져오기 (병합)";
  impBtn.addEventListener("click", () => startImport(sc.id));
  row1.appendChild(expBtn);
  row1.appendChild(impBtn);
  shareCard.appendChild(row1);
  app.appendChild(shareCard);

  const setCard = document.createElement("div");
  setCard.className = "card";
  setCard.innerHTML = `<h3 style="margin-top:0">⚙️ 설정</h3>
    <p class="hint">현재 조사 기간: <strong>${monthRangeLabel(sc.months)}</strong></p>`;

  const rowMonth = document.createElement("div");
  rowMonth.className = "settings-row";
  const addBtn = document.createElement("button");
  addBtn.className = "btn";
  const nm = nextMonth(sc.months[sc.months.length - 1]);
  addBtn.textContent = `➕ ${ymLabel(nm)} 추가하기`;
  addBtn.addEventListener("click", () => {
    sc.months.push(nm);
    sc.months.sort();
    saveStore();
    render();
  });
  rowMonth.appendChild(addBtn);
  const monthHint = document.createElement("span");
  monthHint.className = "hint";
  monthHint.textContent = "기존에 체크한 기록은 그대로 유지됩니다.";
  rowMonth.appendChild(monthHint);
  setCard.appendChild(rowMonth);

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
    saveStore();
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
    const delBtn = document.createElement("button");
    delBtn.className = "btn btn-danger";
    delBtn.textContent = "이 일정 삭제하기";
    delBtn.addEventListener("click", () => {
      if (confirm(`"${sc.title}" 일정을 정말 삭제할까요? 되돌릴 수 없습니다.`) &&
          confirm("모든 참가자의 체크 기록도 함께 삭제됩니다. 계속할까요?")) {
        store.schedules = store.schedules.filter(s => s.id !== sc.id);
        saveStore();
        state = { ...state, view: "home" };
        render();
      }
    });
    dz.appendChild(delBtn);
    app.appendChild(dz);
  } else {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "이 일정은 다른 사람이 만든 일정이라 삭제 버튼이 표시되지 않습니다. (만든 사람만 삭제할 수 있습니다)";
    app.appendChild(p);
  }
}

// ===== 내보내기 / 가져오기 =====
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
        // 병합: 참가자 이름 기준으로 체크 날짜 합치기, 조사 기간(월)도 합치기
        for (const ym of inc.months) {
          if (!existing.months.includes(ym)) existing.months.push(ym);
        }
        existing.months.sort();
        for (const name of Object.keys(inc.availability)) {
          if (!existing.participants.includes(name)) continue;
          const dst = existing.availability[name] || (existing.availability[name] = {});
          Object.assign(dst, inc.availability[name]);
        }
        alert(`"${existing.title}" 일정에 데이터를 병합했습니다.`);
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
applyTheme();
render();
