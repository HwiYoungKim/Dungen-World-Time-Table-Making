"use strict";

// ===== 상수 =====
const NUM_PARTICIPANTS = 16;
const DAYS = ["월", "화", "수", "목", "금", "토", "일"];
const START_HOUR = 9;   // 09:00
const END_HOUR = 24;    // 24:00 (마지막 슬롯: 23:00~24:00)
const SLOTS_PER_DAY = END_HOUR - START_HOUR;
const STORAGE_KEY = "dungeon-schedule-v1";

// ===== 상태 =====
// data = { participants: [{ name, slots: { "day-hour": true } }] }
let data = loadData();
let currentIdx = 0;

// 드래그 상태
let dragging = false;
let dragValue = null; // true=칠하기, false=지우기

// ===== 저장/로드 =====
function defaultData() {
  return {
    participants: Array.from({ length: NUM_PARTICIPANTS }, (_, i) => ({
      name: `참가자 ${i + 1}`,
      slots: {}
    }))
  };
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultData();
    const parsed = JSON.parse(raw);
    return normalizeData(parsed);
  } catch (e) {
    console.warn("저장 데이터를 불러오지 못했습니다.", e);
    return defaultData();
  }
}

function normalizeData(parsed) {
  const base = defaultData();
  if (parsed && Array.isArray(parsed.participants)) {
    for (let i = 0; i < NUM_PARTICIPANTS; i++) {
      const p = parsed.participants[i];
      if (p) {
        if (typeof p.name === "string" && p.name.trim()) base.participants[i].name = p.name.trim();
        if (p.slots && typeof p.slots === "object") {
          for (const key of Object.keys(p.slots)) {
            if (p.slots[key] && isValidKey(key)) base.participants[i].slots[key] = true;
          }
        }
      }
    }
  }
  return base;
}

function isValidKey(key) {
  const m = /^(\d+)-(\d+)$/.exec(key);
  if (!m) return false;
  const day = +m[1], hour = +m[2];
  return day >= 0 && day < DAYS.length && hour >= START_HOUR && hour < END_HOUR;
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// ===== 그리드 생성 =====
function buildGrid(table, cellFactory) {
  table.innerHTML = "";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const corner = document.createElement("th");
  corner.textContent = "시간";
  headRow.appendChild(corner);
  DAYS.forEach(d => {
    const th = document.createElement("th");
    th.textContent = d;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (let h = START_HOUR; h < END_HOUR; h++) {
    const tr = document.createElement("tr");
    const label = document.createElement("td");
    label.className = "time-label";
    label.textContent = `${String(h).padStart(2, "0")}:00`;
    tr.appendChild(label);
    for (let d = 0; d < DAYS.length; d++) {
      tr.appendChild(cellFactory(d, h));
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
}

// ===== 입력 뷰 =====
const editGrid = document.getElementById("edit-grid");
const participantSelect = document.getElementById("participant-select");

function renderParticipantSelect() {
  participantSelect.innerHTML = "";
  data.participants.forEach((p, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = p.name;
    participantSelect.appendChild(opt);
  });
  participantSelect.value = currentIdx;
}

function renderEditGrid() {
  buildGrid(editGrid, (d, h) => {
    const td = document.createElement("td");
    td.dataset.key = `${d}-${h}`;
    if (data.participants[currentIdx].slots[`${d}-${h}`]) td.classList.add("on");
    return td;
  });
}

function setSlot(key, value) {
  const slots = data.participants[currentIdx].slots;
  if (value) slots[key] = true;
  else delete slots[key];
  const td = editGrid.querySelector(`td[data-key="${key}"]`);
  if (td) td.classList.toggle("on", value);
}

// 클릭 + 드래그 (마우스/터치 공용: Pointer Events)
editGrid.addEventListener("pointerdown", e => {
  const td = e.target.closest("td[data-key]");
  if (!td) return;
  e.preventDefault();
  dragging = true;
  const key = td.dataset.key;
  dragValue = !data.participants[currentIdx].slots[key];
  setSlot(key, dragValue);
});

editGrid.addEventListener("pointermove", e => {
  if (!dragging) return;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const td = el && el.closest ? el.closest("td[data-key]") : null;
  if (td) setSlot(td.dataset.key, dragValue);
});

window.addEventListener("pointerup", () => {
  if (dragging) {
    dragging = false;
    saveData();
    renderHeatmap();
  }
});
window.addEventListener("pointercancel", () => {
  if (dragging) {
    dragging = false;
    saveData();
    renderHeatmap();
  }
});

participantSelect.addEventListener("change", () => {
  currentIdx = +participantSelect.value;
  renderEditGrid();
});

document.getElementById("btn-rename").addEventListener("click", () => {
  const cur = data.participants[currentIdx].name;
  const name = prompt("새 이름을 입력하세요:", cur);
  if (name && name.trim()) {
    data.participants[currentIdx].name = name.trim();
    saveData();
    renderParticipantSelect();
    renderHeatmap();
  }
});

document.getElementById("btn-clear-one").addEventListener("click", () => {
  const p = data.participants[currentIdx];
  if (confirm(`"${p.name}"의 체크된 시간을 모두 지울까요?`)) {
    p.slots = {};
    saveData();
    renderEditGrid();
    renderHeatmap();
  }
});

// ===== 히트맵 뷰 =====
const heatmapGrid = document.getElementById("heatmap-grid");
const cellDetail = document.getElementById("cell-detail");

function countFor(key) {
  return data.participants.filter(p => p.slots[key]).length;
}

function namesFor(key) {
  return data.participants.filter(p => p.slots[key]).map(p => p.name);
}

function heatColor(count) {
  if (count === 0) return "#ffffff";
  const ratio = count / NUM_PARTICIPANTS;
  // 연한 파랑 → 진한 남색
  const light = 95 - ratio * 65; // 95% → 30%
  return `hsl(243, 75%, ${light}%)`;
}

function renderHeatmap() {
  buildGrid(heatmapGrid, (d, h) => {
    const td = document.createElement("td");
    const key = `${d}-${h}`;
    td.dataset.key = key;
    const count = countFor(key);
    td.style.background = heatColor(count);
    if (count > 0) {
      td.textContent = count;
      td.style.color = count / NUM_PARTICIPANTS > 0.5 ? "#fff" : "#1e1b4b";
      td.style.fontWeight = "600";
    }
    return td;
  });
  renderLegend();
  renderBestTimes();
  cellDetail.hidden = true;
}

function renderLegend() {
  const legend = document.getElementById("heatmap-legend");
  legend.innerHTML = "<span>0명</span>";
  for (const c of [0, 4, 8, 12, 16]) {
    const sw = document.createElement("span");
    sw.className = "swatch";
    sw.style.background = heatColor(c);
    sw.title = `${c}명`;
    legend.appendChild(sw);
  }
  legend.insertAdjacentHTML("beforeend", `<span>${NUM_PARTICIPANTS}명</span>`);
}

heatmapGrid.addEventListener("click", e => {
  const td = e.target.closest("td[data-key]");
  if (!td) return;
  const key = td.dataset.key;
  const [d, h] = key.split("-").map(Number);
  const names = namesFor(key);
  cellDetail.hidden = false;
  cellDetail.innerHTML = `
    <h3>${DAYS[d]}요일 ${String(h).padStart(2, "0")}:00 ~ ${String(h + 1).padStart(2, "0")}:00 — ${names.length}명 가능</h3>
    <div class="names">${
      names.length
        ? names.map(n => `<span class="name-chip">${escapeHtml(n)}</span>`).join("")
        : "가능한 사람이 없습니다."
    }</div>`;
});

function renderBestTimes() {
  const list = document.getElementById("best-times-list");
  const entries = [];
  for (let d = 0; d < DAYS.length; d++) {
    for (let h = START_HOUR; h < END_HOUR; h++) {
      const key = `${d}-${h}`;
      const count = countFor(key);
      if (count > 0) entries.push({ key, d, h, count });
    }
  }
  entries.sort((a, b) => b.count - a.count || a.d - b.d || a.h - b.h);
  list.innerHTML = entries.length
    ? entries.slice(0, 5).map(e =>
        `<li>${DAYS[e.d]}요일 ${String(e.h).padStart(2, "0")}:00 — <strong>${e.count}명</strong> 가능</li>`
      ).join("")
    : "<li>아직 입력된 시간이 없습니다.</li>";
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// ===== 뷰 전환 =====
const tabEdit = document.getElementById("tab-edit");
const tabHeatmap = document.getElementById("tab-heatmap");
const viewEdit = document.getElementById("view-edit");
const viewHeatmap = document.getElementById("view-heatmap");

function switchView(view) {
  const isEdit = view === "edit";
  tabEdit.classList.toggle("active", isEdit);
  tabHeatmap.classList.toggle("active", !isEdit);
  viewEdit.hidden = !isEdit;
  viewHeatmap.hidden = isEdit;
  if (!isEdit) renderHeatmap();
}

tabEdit.addEventListener("click", () => switchView("edit"));
tabHeatmap.addEventListener("click", () => switchView("heatmap"));

// ===== 내보내기 / 가져오기 =====
document.getElementById("btn-export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `schedule-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

const fileImport = document.getElementById("file-import");
document.getElementById("btn-import").addEventListener("click", () => fileImport.click());

fileImport.addEventListener("change", () => {
  const file = fileImport.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const mode = confirm(
        "확인: 기존 데이터와 병합합니다 (같은 참가자 번호의 시간을 합침).\n취소: 기존 데이터를 완전히 교체합니다."
      );
      if (mode) {
        // 병합: 같은 인덱스 참가자의 슬롯 합치기, 이름은 가져온 쪽 우선
        const incoming = normalizeData(parsed);
        incoming.participants.forEach((p, i) => {
          if (p.name !== `참가자 ${i + 1}`) data.participants[i].name = p.name;
          Object.assign(data.participants[i].slots, p.slots);
        });
      } else {
        data = normalizeData(parsed);
      }
      saveData();
      renderParticipantSelect();
      renderEditGrid();
      renderHeatmap();
      alert("가져오기가 완료되었습니다.");
    } catch (e) {
      alert("JSON 파일을 읽을 수 없습니다: " + e.message);
    }
    fileImport.value = "";
  };
  reader.readAsText(file);
});

document.getElementById("btn-clear").addEventListener("click", () => {
  if (confirm("모든 참가자의 이름과 시간을 초기화할까요? 되돌릴 수 없습니다.")) {
    data = defaultData();
    currentIdx = 0;
    saveData();
    renderParticipantSelect();
    renderEditGrid();
    renderHeatmap();
  }
});

// ===== 초기 렌더 =====
renderParticipantSelect();
renderEditGrid();
renderHeatmap();
