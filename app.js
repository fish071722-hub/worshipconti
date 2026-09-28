"use strict";

/* ================= 상수 ================= */

const MARKER_TYPES = [
  { key: "intro",     label: "전주", color: "#6366f1" },
  { key: "a",         label: "A",   color: "#10b981" },
  { key: "b",         label: "B",   color: "#0ea5e9" },
  { key: "c",         label: "C",   color: "#ef4444" },
  { key: "d",         label: "D",   color: "#f59e0b" },
  { key: "e",         label: "E",   color: "#8b5cf6" },
  { key: "f",         label: "F",   color: "#ec4899" },
  { key: "g",         label: "G",   color: "#14b8a6" },
  { key: "interlude", label: "간주", color: "#64748b" },
  { key: "outro",     label: "후주", color: "#92400e" },
  { key: "star",      label: "★",   color: "#eab308" },
];
const TEMPO_LABELS = { slow: "Slow", medium: "Medium", fast: "Fast" };

const MARKER_FONT_BASE = { sm: 11, md: 13, lg: 17 };
const VERSE_TYPES = ["a", "b", "c", "d", "e", "f", "g"]; // 절 번호(1A, 2A ...)를 붙일 수 있는 마커 타입
const SERVICE_TYPES = ["주일 2부예배", "금요심야기도회", "부흥사경회", "수련회", "기타"];

const DB_NAME = "WorshipSongPlannerDB";
const DB_VERSION = 4;
const STORE_LIBRARY = "songLibrary";
const STORE_PROJECTS = "projects";
const STORE_HANDLES = "handles";

const ZOOM_MIN = 0.5, ZOOM_MAX = 2.5, ZOOM_STEP = 0.1;

// A4 비율(1 : 1.4142)의 기준 프레임 크기(px, zoom=1 기준)
const FRAME_WIDTH = 850;
const FRAME_HEIGHT = Math.round(FRAME_WIDTH * Math.SQRT2);
const SNAP_PX = 10;
const MIN_IMAGE_PX = 60;
const MAX_IMAGE_W = FRAME_WIDTH * 4;
const MAX_IMAGE_H = FRAME_HEIGHT * 4;

const EXPORT_DPI = 150;
const A4_MM = { w: 210, h: 297 };
function getExportPx(orientation) {
  const wMM = orientation === "landscape" ? A4_MM.h : A4_MM.w;
  const hMM = orientation === "landscape" ? A4_MM.w : A4_MM.h;
  return { w: Math.round((wMM * EXPORT_DPI) / 25.4), h: Math.round((hMM * EXPORT_DPI) / 25.4) };
}
const EXPORT_PX = getExportPx("portrait");

const SCREEN_IDS = { home: "screenHome", workspace: "screenWorkspace", print: "screenPrint" };

/* ================= 유틸 ================= */

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 9); }
function debounce(fn, wait) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}
function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function sanitizeFilename(name) { return (name || "song").replace(/[\\/:*?"<>|]/g, "_").trim() || "song"; }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ================= IndexedDB ================= */

let dbPromise = new Promise((resolve, reject) => {
  const req = indexedDB.open(DB_NAME, DB_VERSION);
  req.onupgradeneeded = (e) => {
    const idb = e.target.result;
    if (!idb.objectStoreNames.contains(STORE_LIBRARY)) idb.createObjectStore(STORE_LIBRARY, { keyPath: "id" });
    if (!idb.objectStoreNames.contains(STORE_PROJECTS)) idb.createObjectStore(STORE_PROJECTS, { keyPath: "id" });
    if (!idb.objectStoreNames.contains(STORE_HANDLES)) idb.createObjectStore(STORE_HANDLES, { keyPath: "id" });
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function idbStore(storeName, mode) {
  const idb = await dbPromise;
  return idb.transaction(storeName, mode).objectStore(storeName);
}
async function dbGetAll(storeName) {
  const store = await idbStore(storeName, "readonly");
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
async function dbGet(storeName, id) {
  const store = await idbStore(storeName, "readonly");
  return new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
async function dbPut(storeName, obj) {
  const store = await idbStore(storeName, "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.put(obj);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
async function dbDelete(storeName, id) {
  const store = await idbStore(storeName, "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

const dbGetAllLibrarySongs = () => dbGetAll(STORE_LIBRARY);
const dbGetLibrarySong = (id) => dbGet(STORE_LIBRARY, id);
const dbPutLibrarySong = (song) => dbPut(STORE_LIBRARY, song);
const dbDeleteLibrarySong = (id) => dbDelete(STORE_LIBRARY, id);

const dbGetAllProjects = () => dbGetAll(STORE_PROJECTS);
const dbGetProject = (id) => dbGet(STORE_PROJECTS, id);
const dbPutProject = (project) => dbPut(STORE_PROJECTS, project);
const dbDeleteProject = (id) => dbDelete(STORE_PROJECTS, id);

const dbGetHandle = (id) => dbGet(STORE_HANDLES, id);
const dbPutHandle = (id, handle) => dbPut(STORE_HANDLES, { id, handle });

/* ================= 상태 ================= */

let screen = "home";
let projectsMeta = [];
let currentProject = null;
let libraryCache = new Map();   // libraryId -> song {id,title,key,pages[]}
let activeSlotId = null;
let uiState = new Map();        // slotId -> {currentPageId, zoom, practice:{stepIndex,repeatIter}}

let placingType = null;
let placingSize = "md";
let placingVerse = 0;
let pageObjectUrls = new Map();
let pageRatios = new Map();
let ghostEl = null;
let suppressNextPlacementClick = false;
let pendingMarkerDelete = null; // { markerId, timer } - 더블클릭(수정)과 구분하기 위해 삭제를 잠깐 지연시킨다.
const MARKER_DELETE_DELAY_MS = 280;

let createDraft = null;
let builtCanvases = [];
let homeLibrarySongsAll = [];
let placingTextMode = false;
let placingTextSize = 16;
let placingTextBg = "white";

/* ================= DOM 참조 ================= */

const el = {};

function cacheEls() {
  const ids = [
    "screenHome", "screenWorkspace", "screenPrint",
    "cpDate", "cpType", "cpCustomWrap", "cpCustom", "cpSongCount",
    "cpSongList", "cpAddSongBtn", "cpConfirmBtn", "cpSearchProject", "cpExistingProjectList",
    "homeLibraryList", "libFilterTitle", "libFilterKey", "libFilterTempo", "libFilterLyrics",
    "wsHomeBtn", "wsProjectName", "wsPrintBtn", "wsBackupExportBtn", "wsImportInput", "wsResetSongBtn", "wsSaveToScoreBtn", "saveStatus",
    "slotTabs", "songTitleInput", "songKeyInput", "songTempoInput", "songLyricsInput",
    "pageList", "addImageInput", "pasteImageBtn",
    "markerPalette", "markerSizeControl", "markerVerseInput",
    "imageScaleXRange", "imageScaleYRange", "imageFitBtn", "imageResetPosBtn",
    "zoomOutBtn", "zoomInBtn", "zoomLabel",
    "textModeBtn", "textSizeRange", "textBgSelect",
    "canvasScroll", "canvasSizer", "canvasWrap", "sheetImage", "markerLayer", "textBoxLayer", "guideX", "guideY",
    "resizeHandleLayer", "emptyHint",
    "songformPool", "prevStepBtn", "nextStepBtn", "currentStepLabel", "songFormList",
    "tapTempoBtn", "bpmRange", "bpmInput", "beatsPerMeasure", "beatIndicator", "metronomeToggleBtn", "tempoPrintToggle",
    "songNotesInput", "notesPrintToggle",
    "printBackBtn", "printPerPage", "printOrientation", "printFontSize", "printFontSizeLabel",
    "printMarkerScale", "printMarkerScaleLabel", "printImageScale", "printImageScaleLabel", "printBuildBtn", "printDownloadBtn",
    "printProgress", "printPreviewArea",
    "modalOverlay", "modalBox",
  ];
  ids.forEach((id) => { el[id] = document.getElementById(id); });
}

/* ================= 화면 전환 ================= */

function showScreen(name) {
  screen = name;
  Object.values(SCREEN_IDS).forEach((id) => el[id].classList.add("hidden"));
  el[SCREEN_IDS[name]].classList.remove("hidden");
}

async function goHome() {
  stopMetronome();
  resetCreateDraft();
  projectsMeta = await dbGetAllProjects();
  homeLibrarySongsAll = await dbGetAllLibrarySongs();
  renderCreateForm();
  renderCreateExistingList("");
  renderHomeLibraryList();
  showScreen("home");
}

async function goPrint() {
  const settings = currentProject.exportSettings || { perPage: 1, fontSize: 18, markerScale: 100, imageScale: 100, orientation: "portrait" };
  el.printPerPage.value = settings.perPage;
  el.printOrientation.value = settings.orientation || "portrait";
  el.printFontSize.value = settings.fontSize;
  el.printFontSizeLabel.textContent = settings.fontSize + "px";
  el.printMarkerScale.value = settings.markerScale || 100;
  el.printMarkerScaleLabel.textContent = (settings.markerScale || 100) + "%";
  el.printImageScale.value = settings.imageScale || 100;
  el.printImageScaleLabel.textContent = (settings.imageScale || 100) + "%";
  el.printPreviewArea.innerHTML = '<p class="hint">"미리보기 생성"을 눌러 출력될 페이지를 확인하세요.</p>';
  el.printDownloadBtn.disabled = true;
  el.printProgress.textContent = "";
  builtCanvases = [];
  showScreen("print");
}

/* ================= 초기화 ================= */

init();

async function init() {
  cacheEls();
  buildMarkerPalette();
  buildMarkerSizeControl();
  buildBeatDots(4);
  bindGlobalEvents();
  bindMetronomeEvents();
  bindViewerEvents();
  bindTextToolEvents();
  bindModalEvents();
  bindCreateEvents();
  bindWorkspaceEvents();
  bindPrintEvents();

  projectsMeta = await dbGetAllProjects();
  homeLibrarySongsAll = await dbGetAllLibrarySongs();
  resetCreateDraft();
  renderCreateForm();
  renderCreateExistingList("");
  renderHomeLibraryList();
  showScreen("home");
}

/* ================= 1. 홈 화면(프로젝트 생성 + 기존 곡/콘티) ================= */

async function openProjectById(id) {
  const project = await dbGetProject(id);
  if (!project) return;
  await enterWorkspace(project);
}

function filterLibrarySongs(songs, f) {
  const title = (f.title || "").trim().toLowerCase();
  const key = (f.key || "").trim().toLowerCase();
  const tempo = f.tempo || "";
  const lyrics = (f.lyrics || "").trim().toLowerCase();
  return songs.filter((s) => {
    if (title && !(s.title || "").toLowerCase().includes(title)) return false;
    if (key && !(s.key || "").toLowerCase().includes(key)) return false;
    if (tempo && s.tempo !== tempo) return false;
    if (lyrics && !(s.lyricsFirstLine || "").toLowerCase().includes(lyrics)) return false;
    return true;
  });
}

function currentLibraryFilters() {
  return {
    title: el.libFilterTitle.value, key: el.libFilterKey.value,
    tempo: el.libFilterTempo.value, lyrics: el.libFilterLyrics.value,
  };
}

function renderHomeLibraryList() {
  const filtered = filterLibrarySongs(homeLibrarySongsAll, currentLibraryFilters())
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  el.homeLibraryList.innerHTML = "";
  if (!filtered.length) {
    el.homeLibraryList.innerHTML = '<li class="hint">검색 결과가 없습니다.</li>';
    return;
  }
  filtered.forEach((s) => {
    const li = document.createElement("li");
    li.className = "entity-row";
    li.draggable = true;
    const subParts = [];
    if (s.key) subParts.push("Key: " + s.key);
    if (s.tempo) subParts.push(TEMPO_LABELS[s.tempo] || s.tempo);
    if (s.lyricsFirstLine) subParts.push(s.lyricsFirstLine);
    li.innerHTML = `
      <div class="entity-main">
        <div class="entity-title">${escapeHtml(s.title || "(제목 없음)")}</div>
        <div class="entity-sub">${escapeHtml(subParts.join(" · ") || "정보 없음")}</div>
      </div>
      <button class="btn btn-icon-text" data-act="add">＋ 추가</button>
      <button class="mini-btn danger" data-act="delete" title="라이브러리에서 삭제">×</button>
    `;
    li.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", s.id);
      e.dataTransfer.effectAllowed = "copy";
    });
    li.querySelector('[data-act="add"]').addEventListener("click", () => addLibrarySongToDraft(s));
    li.querySelector('[data-act="delete"]').addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(`"${s.title || "(제목 없음)"}" 곡을 라이브러리에서 삭제할까요? 이 곡을 사용 중인 콘티에는 영향을 주지 않습니다.`)) return;
      await dbDeleteLibrarySong(s.id);
      homeLibrarySongsAll = homeLibrarySongsAll.filter((x) => x.id !== s.id);
      renderHomeLibraryList();
    });
    el.homeLibraryList.appendChild(li);
  });
}

function addLibrarySongToDraft(song) {
  const slots = createDraft.songSlots;
  if (slots.length === 1 && slots[0].mode === "new" && !slots[0].title && !slots[0].key) {
    slots[0] = { tempId: uid(), mode: "library", libraryId: song.id, title: song.title, key: song.key };
  } else {
    slots.push({ tempId: uid(), mode: "library", libraryId: song.id, title: song.title, key: song.key });
  }
  el.cpSongCount.value = slots.length;
  renderCpSongList();
}

/* ================= 2. 프로젝트 생성 화면 ================= */

function resetCreateDraft() {
  const today = new Date().toISOString().slice(0, 10);
  createDraft = {
    date: today,
    type: SERVICE_TYPES[0],
    custom: "",
    songSlots: [{ tempId: uid(), mode: "new", libraryId: null, title: "", key: "" }],
  };
}

function renderCreateForm() {
  el.cpDate.value = createDraft.date;
  if (!el.cpType.options.length) {
    el.cpType.innerHTML = SERVICE_TYPES.map((t) => `<option value="${t}">${t}</option>`).join("");
  }
  el.cpType.value = createDraft.type;
  el.cpCustomWrap.classList.toggle("hidden", createDraft.type !== "기타");
  el.cpCustom.value = createDraft.custom;
  el.cpSongCount.value = createDraft.songSlots.length;
  renderCpSongList();
}

function renderCpSongList() {
  el.cpSongList.innerHTML = "";
  createDraft.songSlots.forEach((slot, idx) => {
    const li = document.createElement("li");
    li.className = "cp-song-row";
    const label = slot.mode === "library"
      ? `${escapeHtml(slot.title || "(제목 없음)")}${slot.key ? " · " + escapeHtml(slot.key) : ""}`
      : "(새 곡)";
    li.innerHTML = `
      <span class="cp-song-idx">${idx + 1}.</span>
      <span class="cp-song-label${slot.mode === "new" ? " placeholder" : ""}">${label}</span>
      <button class="btn btn-icon-text" data-act="pick">기존 곡에서 선택</button>
      <button class="btn btn-icon-text" data-act="clear">새 곡으로</button>
      <button class="mini-btn" data-act="up">▲</button>
      <button class="mini-btn" data-act="down">▼</button>
      <button class="mini-btn danger" data-act="remove">×</button>
    `;
    li.querySelector('[data-act="pick"]').addEventListener("click", () => {
      openLibrarySearchModal((song) => {
        slot.mode = "library"; slot.libraryId = song.id; slot.title = song.title; slot.key = song.key;
        renderCpSongList();
      });
    });
    li.querySelector('[data-act="clear"]').addEventListener("click", () => {
      slot.mode = "new"; slot.libraryId = null; slot.title = ""; slot.key = "";
      renderCpSongList();
    });
    li.querySelector('[data-act="up"]').addEventListener("click", () => {
      if (idx === 0) return;
      [createDraft.songSlots[idx - 1], createDraft.songSlots[idx]] = [createDraft.songSlots[idx], createDraft.songSlots[idx - 1]];
      renderCpSongList();
    });
    li.querySelector('[data-act="down"]').addEventListener("click", () => {
      if (idx === createDraft.songSlots.length - 1) return;
      [createDraft.songSlots[idx + 1], createDraft.songSlots[idx]] = [createDraft.songSlots[idx], createDraft.songSlots[idx + 1]];
      renderCpSongList();
    });
    li.querySelector('[data-act="remove"]').addEventListener("click", () => {
      createDraft.songSlots.splice(idx, 1);
      if (createDraft.songSlots.length === 0) {
        createDraft.songSlots.push({ tempId: uid(), mode: "new", libraryId: null, title: "", key: "" });
      }
      el.cpSongCount.value = createDraft.songSlots.length;
      renderCpSongList();
    });
    el.cpSongList.appendChild(li);
  });
}

function renderCreateExistingList(query) {
  const q = query.trim().toLowerCase();
  const filtered = projectsMeta
    .filter((p) => !q || p.name.toLowerCase().includes(q))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 30);
  el.cpExistingProjectList.innerHTML = "";
  if (!filtered.length) {
    el.cpExistingProjectList.innerHTML = '<li class="hint">검색 결과가 없습니다.</li>';
    return;
  }
  filtered.forEach((p) => {
    const li = document.createElement("li");
    li.className = "entity-row";
    li.innerHTML = `
      <div class="entity-main">
        <div class="entity-title">${escapeHtml(p.name)}</div>
        <div class="entity-sub">곡 ${p.songSlots.length}개</div>
      </div>
      <button class="btn" data-act="open">불러오기</button>
      <button class="mini-btn danger" data-act="delete" title="콘티 삭제">×</button>
    `;
    li.querySelector('[data-act="open"]').addEventListener("click", () => openProjectById(p.id));
    li.querySelector('[data-act="delete"]').addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(`"${p.name}" 콘티를 삭제할까요? (곡 라이브러리에는 영향을 주지 않습니다)`)) return;
      await dbDeleteProject(p.id);
      projectsMeta = projectsMeta.filter((x) => x.id !== p.id);
      renderCreateExistingList(el.cpSearchProject.value);
    });
    el.cpExistingProjectList.appendChild(li);
  });
}

function bindCreateEvents() {
  el.cpDate.addEventListener("change", () => { createDraft.date = el.cpDate.value; });
  el.cpType.addEventListener("change", () => {
    createDraft.type = el.cpType.value;
    el.cpCustomWrap.classList.toggle("hidden", createDraft.type !== "기타");
  });
  el.cpCustom.addEventListener("input", () => { createDraft.custom = el.cpCustom.value; });
  el.cpSongCount.addEventListener("input", () => {
    const n = clamp(parseInt(el.cpSongCount.value, 10) || 1, 1, 20);
    while (createDraft.songSlots.length < n) createDraft.songSlots.push({ tempId: uid(), mode: "new", libraryId: null, title: "", key: "" });
    while (createDraft.songSlots.length > n) createDraft.songSlots.pop();
    renderCpSongList();
  });
  el.cpAddSongBtn.addEventListener("click", () => {
    createDraft.songSlots.push({ tempId: uid(), mode: "new", libraryId: null, title: "", key: "" });
    el.cpSongCount.value = createDraft.songSlots.length;
    renderCpSongList();
  });
  el.cpSearchProject.addEventListener("input", () => renderCreateExistingList(el.cpSearchProject.value));

  ["libFilterTitle", "libFilterKey", "libFilterTempo", "libFilterLyrics"].forEach((id) => {
    el[id].addEventListener("input", renderHomeLibraryList);
  });

  el.cpSongList.addEventListener("dragover", (e) => { e.preventDefault(); el.cpSongList.classList.add("drag-over"); });
  el.cpSongList.addEventListener("dragleave", () => el.cpSongList.classList.remove("drag-over"));
  el.cpSongList.addEventListener("drop", (e) => {
    e.preventDefault();
    el.cpSongList.classList.remove("drag-over");
    const songId = e.dataTransfer.getData("text/plain");
    const song = homeLibrarySongsAll.find((s) => s.id === songId);
    if (song) addLibrarySongToDraft(song);
  });

  el.cpConfirmBtn.addEventListener("click", async () => {
    const dateFmt = createDraft.date.replace(/-/g, ".");
    const serviceName = createDraft.type === "기타" ? (createDraft.custom.trim() || "기타") : createDraft.type;
    const name = `${dateFmt} ${serviceName}`;

    const songSlots = [];
    for (let i = 0; i < createDraft.songSlots.length; i++) {
      const d = createDraft.songSlots[i];
      let libraryId;
      if (d.mode === "library" && d.libraryId) {
        libraryId = d.libraryId;
        if (!libraryCache.has(libraryId)) {
          const song = await dbGetLibrarySong(libraryId);
          if (song) libraryCache.set(libraryId, song);
        }
      } else {
        const song = { id: uid(), title: "", key: "", tempo: "", lyricsFirstLine: "", pages: [], updatedAt: Date.now() };
        await dbPutLibrarySong(song);
        libraryCache.set(song.id, song);
        libraryId = song.id;
      }
      songSlots.push({
        slotId: uid(), libraryId, songForm: [], metronome: { bpm: 90, beats: 4 }, order: i,
        notes: "", showTempoInPrint: true, showNotesInPrint: true,
      });
    }

    const project = {
      id: uid(), name, date: createDraft.date, serviceType: serviceName,
      songSlots, exportSettings: { perPage: 1, fontSize: 18, markerScale: 100, imageScale: 100, orientation: "portrait" }, updatedAt: Date.now(),
    };
    await dbPutProject(project);
    projectsMeta.push(project);
    await enterWorkspace(project);
  });
}

/* ================= 곡 라이브러리 검색 모달 ================= */

function openLibrarySearchModal(onPick) {
  openModal(`
    <h3>기존 곡에서 선택</h3>
    <div class="lib-filters">
      <input type="text" id="libSearchTitle" placeholder="제목">
      <input type="text" id="libSearchKey" placeholder="키">
      <select id="libSearchTempo">
        <option value="">속도(전체)</option>
        <option value="slow">Slow</option>
        <option value="medium">Medium</option>
        <option value="fast">Fast</option>
      </select>
      <input type="text" id="libSearchLyrics" placeholder="가사 첫줄">
    </div>
    <ul class="modal-search-list" id="libSearchList"></ul>
    <div class="modal-actions"><button id="libSearchCancel" class="btn">취소</button></div>
  `);
  document.getElementById("libSearchCancel").addEventListener("click", closeModal);
  const listEl = document.getElementById("libSearchList");
  const fTitle = document.getElementById("libSearchTitle");
  const fKey = document.getElementById("libSearchKey");
  const fTempo = document.getElementById("libSearchTempo");
  const fLyrics = document.getElementById("libSearchLyrics");

  let allSongs = [];
  dbGetAllLibrarySongs().then((songs) => { allSongs = songs; renderList(); });

  function renderList() {
    const filtered = filterLibrarySongs(allSongs, {
      title: fTitle.value, key: fKey.value, tempo: fTempo.value, lyrics: fLyrics.value,
    });
    listEl.innerHTML = "";
    if (!filtered.length) { listEl.innerHTML = '<li class="hint">곡이 없습니다.</li>'; return; }
    filtered.forEach((s) => {
      const li = document.createElement("li");
      li.className = "entity-row";
      const subParts = [];
      if (s.key) subParts.push("Key: " + s.key);
      if (s.tempo) subParts.push(TEMPO_LABELS[s.tempo] || s.tempo);
      if (s.lyricsFirstLine) subParts.push(s.lyricsFirstLine);
      subParts.push(`페이지 ${s.pages.length}장`);
      li.innerHTML = `
        <div class="entity-main">
          <div class="entity-title">${escapeHtml(s.title || "(제목 없음)")}</div>
          <div class="entity-sub">${escapeHtml(subParts.join(" · "))}</div>
        </div>
        <button class="btn" data-act="pick">선택</button>
      `;
      li.querySelector('[data-act="pick"]').addEventListener("click", () => { onPick(s); closeModal(); });
      listEl.appendChild(li);
    });
  }
  [fTitle, fKey, fTempo, fLyrics].forEach((elm) => elm.addEventListener("input", renderList));
}

/* ================= 워크스페이스 진입/상태 헬퍼 ================= */

async function enterWorkspace(project) {
  currentProject = project;
  if (!currentProject.exportSettings) currentProject.exportSettings = { perPage: 1, fontSize: 18, markerScale: 100, imageScale: 100, orientation: "portrait" };

  libraryCache.clear();
  for (const slot of currentProject.songSlots) {
    if (!libraryCache.has(slot.libraryId)) {
      const song = await dbGetLibrarySong(slot.libraryId);
      if (song) libraryCache.set(slot.libraryId, song);
    }
  }

  uiState.clear();
  currentProject.songSlots.forEach((slot) => {
    const song = libraryCache.get(slot.libraryId);
    uiState.set(slot.slotId, {
      currentPageId: song && song.pages[0] ? song.pages[0].id : null,
      zoom: 1,
      practice: { stepIndex: 0, repeatIter: 1 },
    });
  });

  activeSlotId = currentProject.songSlots[0] ? currentProject.songSlots[0].slotId : null;
  placingType = null;
  updatePaletteActiveState();
  clearPageUrlCache();
  showScreen("workspace");
  renderWorkspace();
}

function activeSlot() {
  if (!currentProject) return null;
  return currentProject.songSlots.find((s) => s.slotId === activeSlotId) || null;
}
function activeLibrarySong() {
  const slot = activeSlot();
  return slot ? libraryCache.get(slot.libraryId) : null;
}
function getUi() {
  if (!uiState.has(activeSlotId)) uiState.set(activeSlotId, { currentPageId: null, zoom: 1, practice: { stepIndex: 0, repeatIter: 1 } });
  return uiState.get(activeSlotId);
}

function setActiveSlot(slotId) {
  stopMetronome();
  activeSlotId = slotId;
  placingType = null;
  hideGhost(); hideGuides();
  renderWorkspace();
}

/* ================= 저장 ================= */

const saveLibrarySongDebounced = debounce(async (libraryId) => {
  const song = libraryCache.get(libraryId);
  if (!song) return;
  song.updatedAt = Date.now();
  await dbPutLibrarySong(song);
  flashSaveStatus();
}, 300);

const saveProjectDebounced = debounce(async () => {
  if (!currentProject) return;
  currentProject.updatedAt = Date.now();
  await dbPutProject(currentProject);
  const meta = projectsMeta.find((p) => p.id === currentProject.id);
  if (!meta) projectsMeta.push(currentProject);
  flashSaveStatus();
}, 300);

function flashSaveStatus() {
  el.saveStatus.textContent = "저장됨";
  clearTimeout(flashSaveStatus._t);
  flashSaveStatus._t = setTimeout(() => (el.saveStatus.textContent = ""), 1200);
}

/* ================= 3. 워크스페이스 렌더 ================= */

function bindWorkspaceEvents() {
  el.wsHomeBtn.addEventListener("click", goHome);
  el.wsPrintBtn.addEventListener("click", goPrint);

  el.songTitleInput.addEventListener("input", () => {
    const song = activeLibrarySong();
    if (!song) return;
    song.title = el.songTitleInput.value;
    saveLibrarySongDebounced(song.id);
    renderSlotTabs();
  });
  el.songTitleInput.addEventListener("blur", checkDuplicateActiveSong);
  el.songKeyInput.addEventListener("input", () => {
    const song = activeLibrarySong();
    if (!song) return;
    song.key = el.songKeyInput.value;
    saveLibrarySongDebounced(song.id);
  });
  el.songKeyInput.addEventListener("blur", checkDuplicateActiveSong);
  el.songTempoInput.addEventListener("change", () => {
    const song = activeLibrarySong();
    if (!song) return;
    song.tempo = el.songTempoInput.value;
    saveLibrarySongDebounced(song.id);
  });
  el.songLyricsInput.addEventListener("input", () => {
    const song = activeLibrarySong();
    if (!song) return;
    song.lyricsFirstLine = el.songLyricsInput.value;
    saveLibrarySongDebounced(song.id);
  });

  el.addImageInput.addEventListener("change", (e) => {
    [...e.target.files].forEach((f) => addPageFromBlob(f));
    e.target.value = "";
  });

  el.pasteImageBtn.addEventListener("click", async () => {
    try {
      const items = await navigator.clipboard.read();
      let found = false;
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (type) { const blob = await item.getType(type); addPageFromBlob(blob); found = true; break; }
      }
      if (!found) alert("클립보드에서 이미지를 찾지 못했습니다.");
    } catch (err) {
      alert("클립보드 접근이 차단되었습니다. 이미지를 복사한 뒤 작업창에서 Ctrl+V로 붙여넣어보세요.");
    }
  });

  document.addEventListener("paste", (e) => {
    if (screen !== "workspace") return;
    const items = [...((e.clipboardData && e.clipboardData.items) || [])];
    const imgItem = items.find((it) => it.type && it.type.startsWith("image/"));
    if (!imgItem) return;
    e.preventDefault();
    const blob = imgItem.getAsFile();
    if (blob) addPageFromBlob(blob);
  });

  el.wsBackupExportBtn.addEventListener("click", exportProjectBackup);
  el.wsImportInput.addEventListener("change", importProjectBackup);
  el.wsResetSongBtn.addEventListener("click", resetActiveSong);
  el.wsSaveToScoreBtn.addEventListener("click", saveCurrentSongToScoreFolder);

  el.songNotesInput.addEventListener("input", () => {
    const slot = activeSlot();
    if (!slot) return;
    slot.notes = el.songNotesInput.value;
    saveProjectDebounced();
  });
  el.notesPrintToggle.addEventListener("change", () => {
    const slot = activeSlot();
    if (!slot) return;
    slot.showNotesInPrint = el.notesPrintToggle.checked;
    saveProjectDebounced();
  });
}

function renderWorkspace() {
  el.wsProjectName.textContent = currentProject.name;
  renderSlotTabs();

  const song = activeLibrarySong();
  el.songTitleInput.value = song ? (song.title || "") : "";
  el.songKeyInput.value = song ? (song.key || "") : "";
  el.songTempoInput.value = song ? (song.tempo || "") : "";
  el.songLyricsInput.value = song ? (song.lyricsFirstLine || "") : "";

  renderPageList();
  renderViewer();
  renderSongformPool();
  renderSongForm();
  updatePaletteActiveState();

  const slot = activeSlot();
  const m = slot ? slot.metronome : { bpm: 90, beats: 4 };
  el.bpmInput.value = m.bpm;
  el.bpmRange.value = m.bpm;
  el.beatsPerMeasure.value = String(m.beats);
  buildBeatDots(m.beats);
  el.tempoPrintToggle.checked = slot ? slot.showTempoInPrint !== false : true;
  el.songNotesInput.value = slot ? slot.notes || "" : "";
  el.notesPrintToggle.checked = slot ? slot.showNotesInPrint !== false : true;
}

function renderSlotTabs() {
  el.slotTabs.innerHTML = "";
  currentProject.songSlots.forEach((slot, idx) => {
    const song = libraryCache.get(slot.libraryId);
    const tab = document.createElement("div");
    tab.className = "slot-tab" + (slot.slotId === activeSlotId ? " active" : "");
    tab.innerHTML = `<span>${idx + 1}. ${escapeHtml(song && song.title ? song.title : "(제목 없음)")}</span><button class="tab-close" title="곡 제거">×</button>`;
    tab.addEventListener("click", (e) => {
      if (e.target.classList.contains("tab-close")) return;
      setActiveSlot(slot.slotId);
    });
    tab.querySelector(".tab-close").addEventListener("click", (e) => {
      e.stopPropagation();
      if (currentProject.songSlots.length <= 1) { alert("최소 한 곡은 있어야 합니다."); return; }
      if (!confirm("이 곡을 프로젝트에서 제거할까요? (곡 라이브러리에는 그대로 남습니다)")) return;
      currentProject.songSlots = currentProject.songSlots.filter((s) => s.slotId !== slot.slotId);
      uiState.delete(slot.slotId);
      if (activeSlotId === slot.slotId) activeSlotId = currentProject.songSlots[0].slotId;
      saveProjectDebounced();
      renderWorkspace();
    });
    el.slotTabs.appendChild(tab);
  });
  const addBtn = document.createElement("button");
  addBtn.className = "slot-tab-add";
  addBtn.textContent = "＋ 곡 추가";
  addBtn.addEventListener("click", openAddSongChoiceModal);
  el.slotTabs.appendChild(addBtn);
}

function openAddSongChoiceModal() {
  openModal(`
    <h3>곡 추가</h3>
    <div class="modal-actions" style="justify-content:center;gap:12px;margin-top:4px;">
      <button id="addNewSongBtn" class="btn btn-primary">새 곡</button>
      <button id="addLibSongBtn" class="btn">기존 곡에서 선택</button>
    </div>
  `);
  document.getElementById("addNewSongBtn").addEventListener("click", async () => {
    closeModal();
    const song = { id: uid(), title: "", key: "", tempo: "", lyricsFirstLine: "", pages: [], updatedAt: Date.now() };
    await dbPutLibrarySong(song);
    libraryCache.set(song.id, song);
    addSlotForLibraryId(song.id);
  });
  document.getElementById("addLibSongBtn").addEventListener("click", () => {
    closeModal();
    openLibrarySearchModal((song) => {
      libraryCache.set(song.id, song);
      addSlotForLibraryId(song.id);
    });
  });
}

function addSlotForLibraryId(libraryId) {
  const slot = {
    slotId: uid(), libraryId, songForm: [], metronome: { bpm: 90, beats: 4 }, order: currentProject.songSlots.length,
    notes: "", showTempoInPrint: true, showNotesInPrint: true,
  };
  currentProject.songSlots.push(slot);
  const song = libraryCache.get(libraryId);
  uiState.set(slot.slotId, { currentPageId: song && song.pages[0] ? song.pages[0].id : null, zoom: 1, practice: { stepIndex: 0, repeatIter: 1 } });
  activeSlotId = slot.slotId;
  saveProjectDebounced();
  renderWorkspace();
}

/* ================= 마커 팔레트 / 크기 ================= */

function buildMarkerPalette() {
  el.markerPalette.innerHTML = "";
  MARKER_TYPES.forEach((t) => {
    const btn = document.createElement("button");
    btn.className = "marker-type-btn";
    btn.textContent = t.label;
    btn.style.background = t.color;
    btn.dataset.key = t.key;
    btn.addEventListener("click", () => {
      placingType = placingType === t.key ? null : t.key;
      placingTextMode = false;
      updateTextModeState();
      hideGhost(); hideGuides();
      updatePaletteActiveState();
    });
    el.markerPalette.appendChild(btn);
  });
}

function updatePaletteActiveState() {
  [...el.markerPalette.children].forEach((btn) => btn.classList.toggle("active", btn.dataset.key === placingType));
  el.markerLayer.classList.toggle("placing", !!placingType || placingTextMode);
  el.markerLayer.classList.toggle("panning", !placingType && !placingTextMode);
  if (el.resizeHandleLayer) renderResizeHandles();
}

function updateTextModeState() {
  el.textModeBtn.classList.toggle("active", placingTextMode);
  updatePaletteActiveState();
}

function bindTextToolEvents() {
  el.textModeBtn.addEventListener("click", () => {
    placingTextMode = !placingTextMode;
    if (placingTextMode) { placingType = null; hideGhost(); hideGuides(); updatePaletteActiveState(); }
    updateTextModeState();
  });
  el.textSizeRange.addEventListener("input", () => {
    placingTextSize = clamp(parseInt(el.textSizeRange.value, 10) || 16, 10, 48);
  });
  el.textBgSelect.addEventListener("change", () => { placingTextBg = el.textBgSelect.value; });
}

function buildMarkerSizeControl() {
  [...el.markerSizeControl.querySelectorAll(".size-btn")].forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.size === placingSize);
    btn.addEventListener("click", () => {
      placingSize = btn.dataset.size;
      [...el.markerSizeControl.querySelectorAll(".size-btn")].forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });
  el.markerVerseInput.addEventListener("input", () => {
    const v = parseInt(el.markerVerseInput.value, 10);
    placingVerse = clamp(isNaN(v) ? 0 : v, 0, 9);
  });
  el.markerVerseInput.addEventListener("focus", () => el.markerVerseInput.select());
}

function composeMarkerLabel(typeKey) {
  const typeCfg = MARKER_TYPES.find((t) => t.key === typeKey);
  if (!typeCfg) return "";
  if (!VERSE_TYPES.includes(typeKey)) return typeCfg.label;
  return placingVerse === 0 ? typeCfg.label : `${placingVerse}${typeCfg.label}`;
}

/* ================= 페이지(이미지) ================= */

function renderPageList() {
  el.pageList.innerHTML = "";
  const song = activeLibrarySong();
  if (!song) return;
  song.pages.forEach((page, idx) => {
    const url = getPageUrl(page);
    const thumb = document.createElement("div");
    thumb.className = "page-thumb" + (page.id === getUi().currentPageId ? " active" : "");
    thumb.innerHTML = `
      <img src="${url}" alt="page ${idx + 1}">
      <span class="page-num">${idx + 1}</span>
      <button class="page-del" title="페이지 삭제">×</button>
    `;
    thumb.addEventListener("click", (e) => {
      if (e.target.classList.contains("page-del")) return;
      getUi().currentPageId = page.id;
      renderPageList();
      renderViewer();
    });
    thumb.querySelector(".page-del").addEventListener("click", (e) => {
      e.stopPropagation();
      deletePage(page.id);
    });
    el.pageList.appendChild(thumb);
  });
}

function getPageUrl(page) {
  if (!pageObjectUrls.has(page.id)) pageObjectUrls.set(page.id, URL.createObjectURL(page.blob));
  return pageObjectUrls.get(page.id);
}

function deletePage(pageId) {
  if (!confirm("이 페이지와 페이지 위의 마커를 모두 삭제할까요?")) return;
  const song = activeLibrarySong();
  const slot = activeSlot();
  if (!song || !slot) return;
  const removedMarkerIds = new Set((song.pages.find((p) => p.id === pageId)?.markers || []).map((m) => m.id));
  song.pages = song.pages.filter((p) => p.id !== pageId);
  slot.songForm = slot.songForm.filter((f) => !removedMarkerIds.has(f.markerId));

  if (pageObjectUrls.has(pageId)) { URL.revokeObjectURL(pageObjectUrls.get(pageId)); pageObjectUrls.delete(pageId); }
  pageRatios.delete(pageId);

  const ui = getUi();
  if (ui.currentPageId === pageId) ui.currentPageId = song.pages[0] ? song.pages[0].id : null;
  resetPracticePointer();
  renderWorkspace();
  saveLibrarySongDebounced(song.id);
  saveProjectDebounced();
}

function addPageFromBlob(blob) {
  const song = activeLibrarySong();
  if (!song) return;
  const page = { id: uid(), blob, markers: [], texts: [], imageScaleX: null, imageScaleY: null, offsetX: null, offsetY: null };
  song.pages.push(page);
  const ui = getUi();
  if (!ui.currentPageId) ui.currentPageId = page.id;
  renderPageList();
  renderViewer();
  saveLibrarySongDebounced(song.id);
}

/* ================= Score 폴더 저장 ================= */

function buildScoreFilenameBase(song) {
  const parts = [
    song.title || "제목없음",
    song.key || "",
    TEMPO_LABELS[song.tempo] || "",
    song.lyricsFirstLine || "",
  ].filter((s) => s && s.trim());
  return sanitizeFilename(parts.join("_"));
}

async function getScoreDirHandle({ forcePick = false } = {}) {
  if (!window.showDirectoryPicker) {
    alert("이 브라우저는 폴더 저장 기능(File System Access API)을 지원하지 않습니다. 최신 Chrome/Edge에서 이용해주세요.");
    return null;
  }
  if (!forcePick) {
    try {
      const saved = await dbGetHandle("scoreDir");
      if (saved && saved.handle) {
        let perm = await saved.handle.queryPermission({ mode: "readwrite" });
        if (perm !== "granted") perm = await saved.handle.requestPermission({ mode: "readwrite" });
        if (perm === "granted") return saved.handle;
      }
    } catch (err) {
      // 저장된 핸들을 못 쓰면 아래에서 새로 선택하도록 진행한다.
    }
  }
  let handle;
  try {
    handle = await window.showDirectoryPicker({ id: "worshipScoreFolder", mode: "readwrite" });
  } catch (err) {
    if (err.name !== "AbortError") console.error(err);
    return null;
  }
  try {
    await dbPutHandle("scoreDir", handle);
  } catch (err) {
    // 다음에 다시 물어보게 되더라도, 지금 막 고른 폴더는 그대로 사용한다.
    console.error("폴더 핸들 저장 실패:", err);
  }
  return handle;
}

async function saveCurrentSongToScoreFolder() {
  const song = activeLibrarySong();
  if (!song || !song.pages.length) { alert("저장할 악보 이미지가 없습니다."); return; }

  const dirHandle = await getScoreDirHandle();
  if (!dirHandle) return;

  el.wsSaveToScoreBtn.disabled = true;
  el.wsSaveToScoreBtn.textContent = "저장 중...";
  try {
    const base = buildScoreFilenameBase(song);
    const multi = song.pages.length > 1;
    for (let i = 0; i < song.pages.length; i++) {
      const page = song.pages[i];
      const ext = (page.blob.type && page.blob.type.split("/")[1]) || "png";
      const filename = `${base}${multi ? "_" + (i + 1) : ""}.${ext}`;
      const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(page.blob);
      await writable.close();
    }
    el.wsSaveToScoreBtn.textContent = "✓ 저장됨";
  } catch (err) {
    console.error(err);
    alert("폴더 저장 중 오류가 발생했습니다: " + err.message);
    el.wsSaveToScoreBtn.textContent = "💾 Score 폴더에 저장";
  } finally {
    el.wsSaveToScoreBtn.disabled = false;
    setTimeout(() => { el.wsSaveToScoreBtn.textContent = "💾 Score 폴더에 저장"; }, 1800);
  }
}

/* ================= 곡 초기화 / 중복 확인 ================= */

function resetActiveSong() {
  const song = activeLibrarySong();
  const slot = activeSlot();
  if (!song || !slot) return;
  if (!confirm("현재 곡의 마커·텍스트·진행순서·메트로놈·이미지 크기/위치를 모두 초기화할까요? (악보 이미지 자체는 유지됩니다)")) return;

  song.pages.forEach((p) => {
    p.markers = [];
    p.texts = [];
    const ratio = pageRatios.get(p.id) || Math.SQRT2;
    const fit = computeFitScales(ratio);
    p.imageScaleX = fit.scaleX;
    p.imageScaleY = fit.scaleY;
    p.offsetX = null;
    p.offsetY = null;
  });
  slot.songForm = [];
  slot.metronome = { bpm: 90, beats: 4 };
  resetPracticePointer();
  renderWorkspace();
  saveLibrarySongDebounced(song.id);
  saveProjectDebounced();
}

async function checkDuplicateActiveSong() {
  const song = activeLibrarySong();
  if (!song || !song.title || !song.title.trim()) return;
  const all = await dbGetAllLibrarySongs();
  const dup = all.find((s) => s.id !== song.id
    && (s.title || "").trim() === song.title.trim()
    && (s.key || "").trim() === (song.key || "").trim());
  if (dup) openDuplicateSongModal(song, dup);
}

function openDuplicateSongModal(song, dup) {
  openModal(`
    <h3>같은 제목·키의 곡이 있어요</h3>
    <p class="hint">라이브러리에 "${escapeHtml(dup.title)}" (Key: ${escapeHtml(dup.key || "-")}) 곡이 이미 있습니다. 어떻게 할까요?</p>
    <div class="modal-actions" style="justify-content:flex-start;flex-direction:column;gap:8px;align-items:stretch;">
      <button id="dupReplace" class="btn">기존 곡을 지금 작업 내용으로 대체</button>
      <button id="dupRename" class="btn">다른 곡으로 보고 번호 붙여 저장</button>
      <button id="dupCancel" class="btn">그냥 둘 다 유지</button>
    </div>
  `);
  document.getElementById("dupCancel").addEventListener("click", closeModal);

  document.getElementById("dupReplace").addEventListener("click", async () => {
    dup.pages = song.pages;
    dup.tempo = song.tempo;
    dup.lyricsFirstLine = song.lyricsFirstLine;
    dup.updatedAt = Date.now();
    await dbPutLibrarySong(dup);
    await dbDeleteLibrarySong(song.id);
    const slot = activeSlot();
    if (slot) { slot.libraryId = dup.id; saveProjectDebounced(); }
    libraryCache.set(dup.id, dup);
    libraryCache.delete(song.id);
    renderWorkspace();
    closeModal();
  });

  document.getElementById("dupRename").addEventListener("click", () => {
    let n = 2;
    const base = song.title.trim();
    const titles = new Set(homeLibrarySongsAll.concat([dup]).map((s) => (s.title || "").trim()));
    while (titles.has(`${base} (${n})`)) n++;
    song.title = `${base} (${n})`;
    el.songTitleInput.value = song.title;
    saveLibrarySongDebounced(song.id);
    renderSlotTabs();
    closeModal();
  });
}

/* ================= 뷰어 지오메트리 ================= */

function currentPage() {
  const song = activeLibrarySong();
  if (!song) return null;
  return song.pages.find((p) => p.id === getUi().currentPageId) || null;
}

function getPageRatio(page) { return pageRatios.get(page.id) || Math.SQRT2; }

function computeFitScales(ratio) {
  const scale = Math.min(1, FRAME_HEIGHT / (FRAME_WIDTH * ratio));
  const width = FRAME_WIDTH * scale, height = width * ratio;
  return { scaleX: Math.round(scale * 100), scaleY: Math.round((height / FRAME_HEIGHT) * 100) };
}

function imageBoxForPage(page) {
  const scaleX = (page.imageScaleX ?? 100) / 100;
  const scaleY = (page.imageScaleY ?? 100) / 100;
  const width = FRAME_WIDTH * scaleX;
  const height = FRAME_HEIGHT * scaleY;
  const left = page.offsetX != null ? page.offsetX : (FRAME_WIDTH - width) / 2;
  const top = page.offsetY != null ? page.offsetY : (FRAME_HEIGHT - height) / 2;
  return { left, top, width, height };
}

function markerFramePos(marker, page) {
  const box = imageBoxForPage(page);
  return { fx: box.left + (marker.x / 100) * box.width, fy: box.top + (marker.y / 100) * box.height };
}
function frameToImagePercent(fx, fy, page) {
  const box = imageBoxForPage(page);
  return { x: ((fx - box.left) / box.width) * 100, y: ((fy - box.top) / box.height) * 100 };
}
function clientToFrame(clientX, clientY) {
  const rect = el.canvasWrap.getBoundingClientRect();
  return { fx: ((clientX - rect.left) / rect.width) * FRAME_WIDTH, fy: ((clientY - rect.top) / rect.height) * FRAME_HEIGHT };
}
function snapPos(fx, fy, page, excludeId) {
  let sx = fx, sy = fy, gx = null, gy = null;
  page.markers.forEach((m) => {
    if (m.id === excludeId) return;
    const p = markerFramePos(m, page);
    if (Math.abs(fx - p.fx) <= SNAP_PX) { sx = p.fx; gx = p.fx; }
    if (Math.abs(fy - p.fy) <= SNAP_PX) { sy = p.fy; gy = p.fy; }
  });
  return { fx: sx, fy: sy, gx, gy };
}

/* ================= 뷰어 렌더 ================= */

function renderViewer() {
  const page = currentPage();
  if (!page) {
    el.sheetImage.removeAttribute("src");
    renderMarkers();
    renderTextBoxes();
    el.emptyHint.style.display = "flex";
    el.canvasSizer.style.width = "0px";
    el.canvasSizer.style.height = "0px";
    return;
  }
  el.emptyHint.style.display = "none";
  const url = getPageUrl(page);
  const needsLoad = el.sheetImage.getAttribute("src") !== url;
  if (needsLoad) {
    el.sheetImage.onload = () => {
      if (!pageRatios.has(page.id)) pageRatios.set(page.id, el.sheetImage.naturalHeight / el.sheetImage.naturalWidth);
      if (page.imageScaleX == null || page.imageScaleY == null) {
        const fit = computeFitScales(pageRatios.get(page.id));
        page.imageScaleX = fit.scaleX;
        page.imageScaleY = fit.scaleY;
        const song = activeLibrarySong();
        if (song) saveLibrarySongDebounced(song.id);
      }
      layoutCanvas();
    };
    el.sheetImage.src = url;
  } else {
    layoutCanvas();
  }
}

function layoutCanvas() {
  const zoom = getUi().zoom;
  el.canvasWrap.style.width = FRAME_WIDTH + "px";
  el.canvasWrap.style.height = FRAME_HEIGHT + "px";
  el.canvasWrap.style.transform = `scale(${zoom})`;
  el.canvasSizer.style.width = Math.round(FRAME_WIDTH * zoom) + "px";
  el.canvasSizer.style.height = Math.round(FRAME_HEIGHT * zoom) + "px";
  el.zoomLabel.textContent = Math.round(zoom * 100) + "%";

  // 리사이즈 핸들 레이어는 canvasWrap의 overflow:hidden에 걸리지 않도록 별도 형제
  // 요소로 두되, 같은 프레임 크기/배율을 그대로 적용해 좌표가 일치하도록 맞춘다.
  el.resizeHandleLayer.style.width = FRAME_WIDTH + "px";
  el.resizeHandleLayer.style.height = FRAME_HEIGHT + "px";
  el.resizeHandleLayer.style.transform = `scale(${zoom})`;

  const page = currentPage();
  if (page) {
    const box = imageBoxForPage(page);
    el.sheetImage.style.left = box.left + "px";
    el.sheetImage.style.top = box.top + "px";
    el.sheetImage.style.width = box.width + "px";
    el.sheetImage.style.height = box.height + "px";
    el.imageScaleXRange.value = page.imageScaleX || 100;
    el.imageScaleYRange.value = page.imageScaleY || 100;
  }
  renderMarkers();
  renderTextBoxes();
  renderResizeHandles();
}

const RESIZE_HANDLE_DEFS = [
  { key: "nw", cursor: "nwse-resize" }, { key: "n", cursor: "ns-resize" }, { key: "ne", cursor: "nesw-resize" },
  { key: "e", cursor: "ew-resize" }, { key: "se", cursor: "nwse-resize" }, { key: "s", cursor: "ns-resize" },
  { key: "sw", cursor: "nesw-resize" }, { key: "w", cursor: "ew-resize" },
];

function renderResizeHandles() {
  el.resizeHandleLayer.innerHTML = "";
  const page = currentPage();
  if (!page || placingType) return; // 배치 모드에서는 마커 배치를 방해하지 않도록 숨김
  const box = imageBoxForPage(page);
  const pts = {
    nw: [box.left, box.top],
    n: [box.left + box.width / 2, box.top],
    ne: [box.left + box.width, box.top],
    e: [box.left + box.width, box.top + box.height / 2],
    se: [box.left + box.width, box.top + box.height],
    s: [box.left + box.width / 2, box.top + box.height],
    sw: [box.left, box.top + box.height],
    w: [box.left, box.top + box.height / 2],
  };
  RESIZE_HANDLE_DEFS.forEach(({ key, cursor }) => {
    const [x, y] = pts[key];
    const div = document.createElement("div");
    div.className = "resize-handle";
    div.style.left = x + "px";
    div.style.top = y + "px";
    div.style.cursor = cursor;
    attachResizeHandleDrag(div, key, page);
    el.resizeHandleLayer.appendChild(div);
  });
}

function attachResizeHandleDrag(div, handleKey, page) {
  div.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    e.preventDefault();
    const box0 = imageBoxForPage(page);
    const right0 = box0.left + box0.width, bottom0 = box0.top + box0.height;

    const onMove = (ev) => {
      const cur = clientToFrame(ev.clientX, ev.clientY);
      let { left, top, width, height } = box0;
      if (handleKey.includes("e")) width = clamp(cur.fx - box0.left, MIN_IMAGE_PX, MAX_IMAGE_W);
      if (handleKey.includes("w")) { width = clamp(right0 - cur.fx, MIN_IMAGE_PX, MAX_IMAGE_W); left = right0 - width; }
      if (handleKey.includes("s")) height = clamp(cur.fy - box0.top, MIN_IMAGE_PX, MAX_IMAGE_H);
      if (handleKey.includes("n")) { height = clamp(bottom0 - cur.fy, MIN_IMAGE_PX, MAX_IMAGE_H); top = bottom0 - height; }
      page.imageScaleX = (width / FRAME_WIDTH) * 100;
      page.imageScaleY = (height / FRAME_HEIGHT) * 100;
      page.offsetX = left;
      page.offsetY = top;
      layoutCanvas();
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      const song = activeLibrarySong();
      if (song) saveLibrarySongDebounced(song.id);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  });
}

function renderMarkers() {
  el.markerLayer.querySelectorAll(".marker:not(.ghost)").forEach((n) => n.remove());
  const page = currentPage();
  if (!page) return;
  page.markers.forEach((m) => {
    const pos = markerFramePos(m, page);
    const div = document.createElement("div");
    const isStar = m.type === "star";
    div.className = `marker size-${m.size || "md"}${isStar ? " star-marker" : ""}`;
    div.style.left = pos.fx + "px";
    div.style.top = pos.fy + "px";
    if (isStar) div.style.color = m.color;
    else div.style.background = m.color;
    div.textContent = m.label;
    div.dataset.id = m.id;
    div.title = "클릭: 삭제 · 더블클릭: 이름변경 · 드래그: 이동";
    attachMarkerEvents(div, m, page);
    el.markerLayer.appendChild(div);
  });
}

function attachMarkerEvents(div, marker, page) {
  div.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    e.preventDefault();
    const startClient = { x: e.clientX, y: e.clientY };
    let dragging = false;

    const onMove = (ev) => {
      const dx = ev.clientX - startClient.x, dy = ev.clientY - startClient.y;
      if (!dragging && Math.hypot(dx, dy) > 4) dragging = true;
      if (!dragging) return;
      const { fx, fy } = clientToFrame(ev.clientX, ev.clientY);
      const snapped = snapPos(fx, fy, page, marker.id);
      const pct = frameToImagePercent(snapped.fx, snapped.fy, page);
      marker.x = pct.x; marker.y = pct.y;
      div.style.left = snapped.fx + "px";
      div.style.top = snapped.fy + "px";
      showGuides(snapped.gx, snapped.gy);
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      hideGuides();
      const song = activeLibrarySong();
      if (dragging) {
        if (song) saveLibrarySongDebounced(song.id);
        return;
      }
      // 더블클릭(절 번호/이름 수정)의 첫 클릭일 수도 있으므로, 곧바로 지우지 않고
      // 잠깐 기다렸다가 두 번째 클릭이 오지 않으면(=단일 클릭) 그때 삭제한다.
      if (pendingMarkerDelete) clearTimeout(pendingMarkerDelete.timer);
      pendingMarkerDelete = {
        markerId: marker.id,
        timer: setTimeout(() => {
          pendingMarkerDelete = null;
          page.markers = page.markers.filter((mk) => mk.id !== marker.id);
          const slot = activeSlot();
          if (slot) slot.songForm = slot.songForm.filter((f) => f.markerId !== marker.id);
          if (placingType) {
            // 배치 모드가 켜진 상태에서 기존 마커를 삭제하면, 같은 클릭이 레이어까지
            // 전파되어 그 자리에 새 마커가 즉시 재생성될 수 있다(브라우저가 삭제로
            // 사라진 엘리먼트 대신 레이어를 클릭 대상으로 재계산하는 경우). 다음 한 번의
            // 배치 클릭을 무시해 "삭제했는데 그대로"인 현상을 막는다.
            suppressNextPlacementClick = true;
            setTimeout(() => { suppressNextPlacementClick = false; }, 400);
          }
          renderMarkers();
          renderSongformPool();
          renderSongForm();
          if (song) saveLibrarySongDebounced(song.id);
          saveProjectDebounced();
        }, MARKER_DELETE_DELAY_MS),
      };
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  });

  div.addEventListener("click", (e) => e.stopPropagation());

  div.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    if (pendingMarkerDelete && pendingMarkerDelete.markerId === marker.id) {
      clearTimeout(pendingMarkerDelete.timer);
      pendingMarkerDelete = null;
    }
    if (VERSE_TYPES.includes(marker.type)) {
      const typeCfg = MARKER_TYPES.find((t) => t.key === marker.type);
      const parsedVerse = parseInt(marker.label, 10);
      const currentVerse = isNaN(parsedVerse) ? 0 : parsedVerse;
      const input = prompt(`절 번호를 입력하세요 (0~9, 0이면 번호 없이 표시) — 현재: ${marker.label}`, String(currentVerse));
      if (input === null) return;
      const parsedInput = parseInt(input, 10);
      const verse = clamp(isNaN(parsedInput) ? 0 : parsedInput, 0, 9);
      marker.label = verse === 0 ? typeCfg.label : `${verse}${typeCfg.label}`;
    } else {
      const input = prompt("이름 변경", marker.label);
      if (input === null) return;
      marker.label = input.trim() || marker.label;
    }
    renderMarkers();
    renderSongformPool();
    renderSongForm();
    const song = activeLibrarySong();
    if (song) saveLibrarySongDebounced(song.id);
  });
}

/* ---- 자유 텍스트 메모 ---- */

function renderTextBoxes() {
  el.textBoxLayer.innerHTML = "";
  const page = currentPage();
  if (!page || !page.texts) return;
  page.texts.forEach((t) => {
    const pos = markerFramePos(t, page);
    const div = document.createElement("div");
    div.className = `text-box bg-${t.bg || "white"}`;
    div.style.left = pos.fx + "px";
    div.style.top = pos.fy + "px";
    div.style.fontSize = (t.fontSize || 16) + "px";
    div.textContent = t.text;
    div.dataset.id = t.id;
    div.title = "클릭: 삭제 · 더블클릭: 편집 · 드래그: 이동 · 모서리 드래그: 크기 조절";
    attachTextBoxEvents(div, t, page);

    const handle = document.createElement("div");
    handle.className = "text-resize-handle";
    attachTextResizeDrag(handle, t, div);
    div.appendChild(handle);

    el.textBoxLayer.appendChild(div);
  });
}

function attachTextResizeDrag(handle, t, div) {
  handle.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    e.preventDefault();
    const startY = e.clientY;
    const startSize = t.fontSize || 16;
    const onMove = (ev) => {
      const dy = ev.clientY - startY;
      t.fontSize = clamp(Math.round(startSize + dy * 0.5), 10, 80);
      div.style.fontSize = t.fontSize + "px";
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      const song = activeLibrarySong();
      if (song) saveLibrarySongDebounced(song.id);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  });
  handle.addEventListener("click", (e) => e.stopPropagation());
}

function attachTextBoxEvents(div, t, page) {
  div.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    e.preventDefault();
    const startClient = { x: e.clientX, y: e.clientY };
    let dragging = false;

    const onMove = (ev) => {
      const dx = ev.clientX - startClient.x, dy = ev.clientY - startClient.y;
      if (!dragging && Math.hypot(dx, dy) > 4) dragging = true;
      if (!dragging) return;
      const { fx, fy } = clientToFrame(ev.clientX, ev.clientY);
      const pct = frameToImagePercent(fx, fy, page);
      t.x = pct.x; t.y = pct.y;
      div.style.left = fx + "px";
      div.style.top = fy + "px";
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      const song = activeLibrarySong();
      if (dragging) {
        if (song) saveLibrarySongDebounced(song.id);
      } else {
        page.texts = page.texts.filter((x) => x.id !== t.id);
        renderTextBoxes();
        if (song) saveLibrarySongDebounced(song.id);
      }
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  });

  div.addEventListener("click", (e) => e.stopPropagation());
  div.addEventListener("dblclick", (e) => { e.stopPropagation(); openTextEditModal(t, page); });
}

function openTextEditModal(t, page) {
  openModal(`
    <h3>텍스트 편집</h3>
    <label>내용 <textarea id="txtEditText" rows="3" style="width:100%;margin-top:5px;border:1px solid var(--border);border-radius:8px;padding:8px;font-family:inherit;">${escapeHtml(t.text)}</textarea></label>
    <label>글자 크기 (px)
      <input type="number" id="txtEditSize" min="10" max="80" value="${t.fontSize || 16}">
    </label>
    <label>배경
      <select id="txtEditBg">
        <option value="white" ${t.bg !== "transparent" ? "selected" : ""}>흰색</option>
        <option value="transparent" ${t.bg === "transparent" ? "selected" : ""}>투명</option>
      </select>
    </label>
    <div class="modal-actions">
      <button id="txtEditDelete" class="btn btn-danger">삭제</button>
      <button id="txtEditCancel" class="btn">취소</button>
      <button id="txtEditSave" class="btn btn-primary">저장</button>
    </div>
  `);
  document.getElementById("txtEditCancel").addEventListener("click", closeModal);
  document.getElementById("txtEditDelete").addEventListener("click", () => {
    page.texts = page.texts.filter((x) => x.id !== t.id);
    renderTextBoxes();
    const song = activeLibrarySong();
    if (song) saveLibrarySongDebounced(song.id);
    closeModal();
  });
  document.getElementById("txtEditSave").addEventListener("click", () => {
    const newText = document.getElementById("txtEditText").value.trim();
    if (!newText) { alert("내용을 입력해주세요."); return; }
    t.text = newText;
    t.fontSize = clamp(parseInt(document.getElementById("txtEditSize").value, 10) || 16, 10, 80);
    t.bg = document.getElementById("txtEditBg").value;
    renderTextBoxes();
    const song = activeLibrarySong();
    if (song) saveLibrarySongDebounced(song.id);
    closeModal();
  });
}

/* ---- 배치 미리보기(고스트) & 정렬 가이드 ---- */

function showGhost(fx, fy) {
  if (!ghostEl) { ghostEl = document.createElement("div"); el.markerLayer.appendChild(ghostEl); }
  const typeCfg = MARKER_TYPES.find((t) => t.key === placingType);
  if (!typeCfg) return;
  const isStar = placingType === "star";
  ghostEl.className = `marker ghost size-${placingSize}${isStar ? " star-marker" : ""}`;
  ghostEl.style.left = fx + "px";
  ghostEl.style.top = fy + "px";
  if (isStar) { ghostEl.style.color = typeCfg.color; ghostEl.style.background = ""; }
  else { ghostEl.style.background = typeCfg.color; ghostEl.style.color = ""; }
  ghostEl.textContent = composeMarkerLabel(placingType);
}
function hideGhost() { if (ghostEl) { ghostEl.remove(); ghostEl = null; } }
function showGuides(gx, gy) {
  if (gx != null) { el.guideX.style.left = gx + "px"; el.guideX.classList.remove("hidden"); }
  else el.guideX.classList.add("hidden");
  if (gy != null) { el.guideY.style.top = gy + "px"; el.guideY.classList.remove("hidden"); }
  else el.guideY.classList.add("hidden");
}
function hideGuides() { el.guideX.classList.add("hidden"); el.guideY.classList.add("hidden"); }

/* ---- 뷰어 이벤트: 배치 / 이미지 이동 / 확대 ---- */

function bindViewerEvents() {
  el.markerLayer.addEventListener("click", (e) => {
    if (suppressNextPlacementClick) { suppressNextPlacementClick = false; return; }
    const page = currentPage();
    if (!page) return;
    if (placingTextMode) {
      const text = prompt("텍스트를 입력하세요");
      if (text === null || !text.trim()) return;
      const { fx, fy } = clientToFrame(e.clientX, e.clientY);
      const pct = frameToImagePercent(fx, fy, page);
      if (!page.texts) page.texts = [];
      page.texts.push({ id: uid(), x: pct.x, y: pct.y, text: text.trim(), fontSize: placingTextSize, bg: placingTextBg });
      renderTextBoxes();
      const song = activeLibrarySong();
      if (song) saveLibrarySongDebounced(song.id);
      return;
    }
    if (!placingType) return;
    const { fx, fy } = clientToFrame(e.clientX, e.clientY);
    const snapped = snapPos(fx, fy, page, null);
    const pct = frameToImagePercent(snapped.fx, snapped.fy, page);
    const typeCfg = MARKER_TYPES.find((t) => t.key === placingType);
    const marker = { id: uid(), x: pct.x, y: pct.y, type: placingType, label: composeMarkerLabel(placingType), color: typeCfg.color, size: placingSize };
    page.markers.push(marker);
    renderMarkers();
    renderSongformPool();
    hideGuides();
    const song = activeLibrarySong();
    if (song) saveLibrarySongDebounced(song.id);
  });

  el.markerLayer.addEventListener("pointermove", (e) => {
    if (!placingType) { hideGhost(); hideGuides(); return; }
    const page = currentPage();
    if (!page) return;
    const { fx, fy } = clientToFrame(e.clientX, e.clientY);
    const snapped = snapPos(fx, fy, page, null);
    showGhost(snapped.fx, snapped.fy);
    showGuides(snapped.gx, snapped.gy);
  });
  el.markerLayer.addEventListener("pointerleave", () => { hideGhost(); hideGuides(); });

  el.markerLayer.addEventListener("pointerdown", (e) => {
    if (placingType || placingTextMode) return;
    const page = currentPage();
    if (!page) return;
    const startFrame = clientToFrame(e.clientX, e.clientY);
    const box0 = imageBoxForPage(page);
    let dragging = false;
    el.markerLayer.classList.add("panning");

    const onMove = (ev) => {
      const cur = clientToFrame(ev.clientX, ev.clientY);
      const dx = cur.fx - startFrame.fx, dy = cur.fy - startFrame.fy;
      if (!dragging && Math.hypot(dx, dy) > 3) dragging = true;
      if (!dragging) return;
      page.offsetX = box0.left + dx;
      page.offsetY = box0.top + dy;
      layoutCanvas();
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      el.markerLayer.classList.remove("panning");
      if (dragging) {
        const song = activeLibrarySong();
        if (song) saveLibrarySongDebounced(song.id);
      }
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  });

  el.imageScaleXRange.addEventListener("input", () => {
    const page = currentPage(); if (!page) return;
    page.imageScaleX = clamp(parseInt(el.imageScaleXRange.value, 10) || 100, 10, 400);
    layoutCanvas();
    const song = activeLibrarySong(); if (song) saveLibrarySongDebounced(song.id);
  });
  el.imageScaleYRange.addEventListener("input", () => {
    const page = currentPage(); if (!page) return;
    page.imageScaleY = clamp(parseInt(el.imageScaleYRange.value, 10) || 100, 10, 400);
    layoutCanvas();
    const song = activeLibrarySong(); if (song) saveLibrarySongDebounced(song.id);
  });
  el.imageFitBtn.addEventListener("click", () => {
    const page = currentPage(); if (!page) return;
    const fit = computeFitScales(getPageRatio(page));
    page.imageScaleX = fit.scaleX; page.imageScaleY = fit.scaleY;
    page.offsetX = null; page.offsetY = null;
    layoutCanvas();
    const song = activeLibrarySong(); if (song) saveLibrarySongDebounced(song.id);
  });
  el.imageResetPosBtn.addEventListener("click", () => {
    const page = currentPage(); if (!page) return;
    page.offsetX = null; page.offsetY = null;
    layoutCanvas();
    const song = activeLibrarySong(); if (song) saveLibrarySongDebounced(song.id);
  });

  el.zoomInBtn.addEventListener("click", () => {
    const ui = getUi();
    ui.zoom = clamp(+(ui.zoom + ZOOM_STEP).toFixed(2), ZOOM_MIN, ZOOM_MAX);
    layoutCanvas();
  });
  el.zoomOutBtn.addEventListener("click", () => {
    const ui = getUi();
    ui.zoom = clamp(+(ui.zoom - ZOOM_STEP).toFixed(2), ZOOM_MIN, ZOOM_MAX);
    layoutCanvas();
  });
}

function findMarkerById(markerId) {
  const song = activeLibrarySong();
  if (!song) return null;
  for (const p of song.pages) {
    const m = p.markers.find((mk) => mk.id === markerId);
    if (m) return { marker: m, page: p };
  }
  return null;
}

/* ================= 송폼 순서 ================= */

function renderSongformPool() {
  el.songformPool.innerHTML = "";
  const song = activeLibrarySong();
  let any = false;
  if (song) {
    song.pages.forEach((page, pIdx) => {
      page.markers.forEach((m) => {
        any = true;
        const chip = document.createElement("button");
        chip.className = "pool-chip";
        chip.style.background = m.color;
        chip.innerHTML = `${escapeHtml(m.label)} <span class="page-tag">p${pIdx + 1}</span>`;
        chip.title = "클릭하면 진행 순서에 추가됩니다";
        chip.addEventListener("click", () => {
          const slot = activeSlot();
          if (!slot) return;
          slot.songForm.push({ id: uid(), markerId: m.id, repeat: 1 });
          renderSongForm();
          saveProjectDebounced();
        });
        el.songformPool.appendChild(chip);
      });
    });
  }
  if (!any) el.songformPool.innerHTML = '<span class="pool-empty">악보에 마커를 찍으면 여기에 표시됩니다.</span>';
}

function renderSongForm() {
  el.songFormList.innerHTML = "";
  const slot = activeSlot();
  const songForm = slot ? slot.songForm : [];
  if (songForm.length === 0) {
    el.songFormList.innerHTML = '<span class="songform-empty">위 마커 목록을 클릭해 진행 순서를 추가하세요.</span>';
    updateCurrentStepDisplay();
    return;
  }

  const practice = getUi().practice;
  const song = activeLibrarySong();

  songForm.forEach((item, idx) => {
    const found = findMarkerById(item.markerId);
    const li = document.createElement("li");
    li.className = "songform-item" + (idx === practice.stepIndex ? " current" : "");
    li.draggable = true;

    const label = found ? found.marker.label : "(삭제됨)";
    const color = found ? found.marker.color : "#999";
    const pageIdx = found && song ? song.pages.findIndex((p) => p.id === found.page.id) + 1 : "-";

    li.innerHTML = `
      <span class="dot" style="background:${color}"></span>
      <span class="label">${idx + 1}. ${escapeHtml(label)}</span>
      <span class="page-tag">p${pageIdx}</span>
      <span style="font-size:11px;color:var(--text-dim)">×</span>
      <input type="number" min="1" max="99" value="${item.repeat}">
      <button class="mini-btn" data-act="up" title="위로">▲</button>
      <button class="mini-btn" data-act="down" title="아래로">▼</button>
      <button class="mini-btn danger" data-act="remove" title="제거">×</button>
    `;

    li.querySelector("input").addEventListener("input", (e) => {
      const v = clamp(parseInt(e.target.value || "1", 10) || 1, 1, 99);
      item.repeat = v;
      if (idx === practice.stepIndex && practice.repeatIter > v) practice.repeatIter = v;
      updateCurrentStepDisplay();
      saveProjectDebounced();
    });
    li.querySelector('[data-act="up"]').addEventListener("click", (e) => {
      e.stopPropagation();
      if (idx === 0) return;
      [songForm[idx - 1], songForm[idx]] = [songForm[idx], songForm[idx - 1]];
      resetPracticePointer(); renderSongForm(); saveProjectDebounced();
    });
    li.querySelector('[data-act="down"]').addEventListener("click", (e) => {
      e.stopPropagation();
      if (idx === songForm.length - 1) return;
      [songForm[idx + 1], songForm[idx]] = [songForm[idx], songForm[idx + 1]];
      resetPracticePointer(); renderSongForm(); saveProjectDebounced();
    });
    li.querySelector('[data-act="remove"]').addEventListener("click", (e) => {
      e.stopPropagation();
      songForm.splice(idx, 1);
      resetPracticePointer(); renderSongForm(); saveProjectDebounced();
    });

    li.addEventListener("click", (e) => {
      if (e.target.tagName === "INPUT" || e.target.classList.contains("mini-btn")) return;
      practice.stepIndex = idx; practice.repeatIter = 1;
      jumpToStep();
    });

    li.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", String(idx)); e.dataTransfer.effectAllowed = "move"; });
    li.addEventListener("dragover", (e) => { e.preventDefault(); li.classList.add("drag-over"); });
    li.addEventListener("dragleave", () => li.classList.remove("drag-over"));
    li.addEventListener("drop", (e) => {
      e.preventDefault();
      li.classList.remove("drag-over");
      const from = parseInt(e.dataTransfer.getData("text/plain"), 10);
      if (Number.isNaN(from) || from === idx) return;
      const [moved] = songForm.splice(from, 1);
      songForm.splice(idx, 0, moved);
      resetPracticePointer(); renderSongForm(); saveProjectDebounced();
    });

    el.songFormList.appendChild(li);
  });

  updateCurrentStepDisplay();
}

function resetPracticePointer() { const p = getUi().practice; p.stepIndex = 0; p.repeatIter = 1; }

function jumpToStep() {
  const slot = activeSlot();
  const practice = getUi().practice;
  const item = slot ? slot.songForm[practice.stepIndex] : null;
  if (!item) { updateCurrentStepDisplay(); return; }
  const found = findMarkerById(item.markerId);
  if (found) {
    const ui = getUi();
    if (ui.currentPageId !== found.page.id) {
      ui.currentPageId = found.page.id;
      renderPageList();
      renderViewer();
    }
    pulseMarker(found.marker.id);
  }
  updateCurrentStepDisplay();
  renderSongForm();
}

function pulseMarker(markerId) {
  const div = [...el.markerLayer.children].find((c) => c.dataset && c.dataset.id === markerId);
  if (!div) return;
  div.classList.remove("pulse");
  void div.offsetWidth;
  div.classList.add("pulse");
}

function updateCurrentStepDisplay() {
  const slot = activeSlot();
  const practice = getUi().practice;
  const item = slot ? slot.songForm[practice.stepIndex] : null;
  if (!item) { el.currentStepLabel.textContent = "-"; return; }
  const found = findMarkerById(item.markerId);
  const label = found ? found.marker.label : "(삭제됨)";
  el.currentStepLabel.textContent = `${practice.stepIndex + 1}/${slot.songForm.length} · ${label} (${practice.repeatIter}/${item.repeat})`;
}

function nextStep() {
  const slot = activeSlot();
  if (!slot || slot.songForm.length === 0) return;
  const practice = getUi().practice;
  const item = slot.songForm[practice.stepIndex];
  if (practice.repeatIter < item.repeat) practice.repeatIter++;
  else if (practice.stepIndex < slot.songForm.length - 1) { practice.stepIndex++; practice.repeatIter = 1; }
  jumpToStep();
}
function prevStep() {
  const slot = activeSlot();
  if (!slot || slot.songForm.length === 0) return;
  const practice = getUi().practice;
  if (practice.repeatIter > 1) practice.repeatIter--;
  else if (practice.stepIndex > 0) { practice.stepIndex--; practice.repeatIter = slot.songForm[practice.stepIndex].repeat; }
  jumpToStep();
}

function clearPageUrlCache() {
  pageObjectUrls.forEach((u) => URL.revokeObjectURL(u));
  pageObjectUrls.clear();
}

/* ---- 프로젝트 백업 내보내기 / 가져오기 ---- */

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function exportProjectBackup() {
  const songs = [];
  for (const slot of currentProject.songSlots) {
    const song = libraryCache.get(slot.libraryId);
    if (!song) continue;
    const pages = await Promise.all(song.pages.map(async (p) => ({
      markers: p.markers, texts: p.texts || [], imageScaleX: p.imageScaleX, imageScaleY: p.imageScaleY, offsetX: p.offsetX, offsetY: p.offsetY,
      image: await blobToDataURL(p.blob),
    })));
    songs.push({
      libraryId: song.id, title: song.title, key: song.key,
      tempo: song.tempo || "", lyricsFirstLine: song.lyricsFirstLine || "", pages,
    });
  }
  const exportObj = {
    name: currentProject.name, date: currentProject.date, serviceType: currentProject.serviceType,
    exportSettings: currentProject.exportSettings,
    songSlots: currentProject.songSlots.map((s) => ({
      libraryId: s.libraryId, songForm: s.songForm, metronome: s.metronome,
      notes: s.notes || "", showTempoInPrint: s.showTempoInPrint !== false, showNotesInPrint: s.showNotesInPrint !== false,
    })),
    songs,
  };
  const blob = new Blob([JSON.stringify(exportObj)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${sanitizeFilename(currentProject.name)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importProjectBackup(e) {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const libIdMap = new Map(); // old libraryId -> { song, markerIdMap }

    for (const s of data.songs) {
      const markerIdMap = new Map();
      const pages = [];
      for (const p of s.pages || []) {
        const newMarkers = (p.markers || []).map((m) => {
          const newId = uid();
          markerIdMap.set(m.id, newId);
          return { ...m, id: newId };
        });
        pages.push({
          id: uid(), markers: newMarkers, texts: (p.texts || []).map((t) => ({ ...t, id: uid() })),
          imageScaleX: p.imageScaleX ?? null, imageScaleY: p.imageScaleY ?? null,
          offsetX: p.offsetX ?? null, offsetY: p.offsetY ?? null,
          blob: await (await fetch(p.image)).blob(),
        });
      }
      const newSong = {
        id: uid(), title: s.title || "", key: s.key || "",
        tempo: s.tempo || "", lyricsFirstLine: s.lyricsFirstLine || "", pages, updatedAt: Date.now(),
      };
      await dbPutLibrarySong(newSong);
      libIdMap.set(s.libraryId, { song: newSong, markerIdMap });
    }

    const songSlots = (data.songSlots || []).map((slot) => {
      const mapping = libIdMap.get(slot.libraryId);
      if (!mapping) return null;
      const songForm = (slot.songForm || [])
        .map((f) => ({ id: uid(), markerId: mapping.markerIdMap.get(f.markerId), repeat: f.repeat || 1 }))
        .filter((f) => f.markerId);
      return {
        slotId: uid(), libraryId: mapping.song.id, songForm, metronome: slot.metronome || { bpm: 90, beats: 4 },
        notes: slot.notes || "", showTempoInPrint: slot.showTempoInPrint !== false, showNotesInPrint: slot.showNotesInPrint !== false,
      };
    }).filter(Boolean);

    const project = {
      id: uid(), name: (data.name || "가져온 프로젝트") + " (가져옴)",
      date: data.date || new Date().toISOString().slice(0, 10),
      serviceType: data.serviceType || "",
      songSlots, exportSettings: data.exportSettings || { perPage: 1, fontSize: 18, markerScale: 100, imageScale: 100, orientation: "portrait" },
      updatedAt: Date.now(),
    };
    await dbPutProject(project);
    projectsMeta.push(project);
    await enterWorkspace(project);
  } catch (err) {
    alert("가져오기에 실패했습니다. 올바른 백업 파일인지 확인해주세요.");
    console.error(err);
  }
}

/* ================= 모달 ================= */

function bindModalEvents() {
  el.modalOverlay.addEventListener("click", (e) => { if (e.target === el.modalOverlay) closeModal(); });
}
function openModal(html) { el.modalBox.innerHTML = html; el.modalOverlay.classList.remove("hidden"); }
function closeModal() { el.modalOverlay.classList.add("hidden"); el.modalBox.innerHTML = ""; }

/* ================= 4. 인쇄 미리보기 / 내보내기 ================= */

function bindPrintEvents() {
  el.printBackBtn.addEventListener("click", () => showScreen("workspace"));
  el.printFontSize.addEventListener("input", () => { el.printFontSizeLabel.textContent = el.printFontSize.value + "px"; });
  el.printMarkerScale.addEventListener("input", () => { el.printMarkerScaleLabel.textContent = el.printMarkerScale.value + "%"; });
  el.printImageScale.addEventListener("input", () => { el.printImageScaleLabel.textContent = el.printImageScale.value + "%"; });

  el.printBuildBtn.addEventListener("click", async () => {
    const perPage = clamp(parseInt(el.printPerPage.value, 10) || 1, 1, 12);
    const fontSizePx = clamp(parseInt(el.printFontSize.value, 10) || 18, 12, 32);
    const markerScalePct = clamp(parseInt(el.printMarkerScale.value, 10) || 100, 50, 200);
    const imageScalePct = clamp(parseInt(el.printImageScale.value, 10) || 100, 50, 150);
    const orientation = el.printOrientation.value === "landscape" ? "landscape" : "portrait";
    currentProject.exportSettings = { perPage, fontSize: fontSizePx, markerScale: markerScalePct, imageScale: imageScalePct, orientation };
    saveProjectDebounced();

    el.printBuildBtn.disabled = true;
    el.printDownloadBtn.disabled = true;
    el.printProgress.textContent = "이미지를 불러오는 중...";
    try {
      const canvases = await buildPrintCanvases(perPage, fontSizePx, markerScalePct, orientation, imageScalePct, (msg) => { el.printProgress.textContent = msg; });
      renderPrintPreview(canvases);
      el.printProgress.textContent = canvases.length ? `완료! 총 ${canvases.length}페이지` : "인쇄할 악보 페이지가 없습니다.";
      el.printDownloadBtn.disabled = canvases.length === 0;
    } catch (err) {
      console.error(err);
      el.printProgress.textContent = "오류가 발생했습니다: " + err.message;
    } finally {
      el.printBuildBtn.disabled = false;
    }
  });

  el.printDownloadBtn.addEventListener("click", async () => {
    if (!builtCanvases.length) return;
    el.printDownloadBtn.disabled = true;
    const safeName = sanitizeFilename(currentProject.name);
    const orientation = (currentProject.exportSettings && currentProject.exportSettings.orientation) || "portrait";
    try {
      el.printProgress.textContent = "PNG 다운로드 중...";
      for (let i = 0; i < builtCanvases.length; i++) {
        await downloadCanvasPng(builtCanvases[i], `${safeName}_${i + 1}.png`);
        await sleep(200);
      }
      el.printProgress.textContent = "PDF 생성 중...";
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: "pt", format: "a4", orientation });
      const pw = doc.internal.pageSize.getWidth(), ph = doc.internal.pageSize.getHeight();
      builtCanvases.forEach((canvas, i) => {
        if (i > 0) doc.addPage();
        doc.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, pw, ph);
      });
      doc.save(`${safeName}.pdf`);
      el.printProgress.textContent = "완료! 다운로드를 확인하세요.";
    } catch (err) {
      console.error(err);
      el.printProgress.textContent = "오류가 발생했습니다: " + err.message;
    } finally {
      el.printDownloadBtn.disabled = false;
    }
  });
}

function renderPrintPreview(canvases) {
  el.printPreviewArea.innerHTML = "";
  if (!canvases.length) {
    el.printPreviewArea.innerHTML = '<p class="hint">악보 이미지가 있는 곡이 없습니다.</p>';
    return;
  }
  canvases.forEach((c, i) => {
    const wrap = document.createElement("div");
    wrap.className = "print-page-preview";
    const img = document.createElement("img");
    img.src = c.toDataURL("image/png");
    wrap.appendChild(img);
    el.printPreviewArea.appendChild(wrap);
    const label = document.createElement("div");
    label.className = "print-page-label";
    label.textContent = `페이지 ${i + 1} / ${canvases.length}`;
    el.printPreviewArea.appendChild(label);
  });
}

function buildSongFormTextFor(slot, song) {
  if (!slot.songForm.length) return "(진행 순서가 비어 있습니다)";
  const allMarkers = song.pages.flatMap((p) => p.markers);
  return slot.songForm.map((item) => {
    const m = allMarkers.find((mk) => mk.id === item.markerId);
    const label = m ? m.label : "?";
    return item.repeat > 1 ? `${label}×${item.repeat}` : label;
  }).join("  →  ");
}

function wrapTextLines(ctx, text, maxWidth, fontPx, weight) {
  ctx.font = `${weight || 600} ${fontPx}px sans-serif`;
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function roundRectPath(ctx, x, y, w, h, r) {
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

const STAR_FONT_BASE = { sm: 22, md: 30, lg: 40 };

function drawMarkerOnCanvas(ctx, x, y, marker, scale, markerScalePct) {
  if (marker.type === "star") {
    const base = STAR_FONT_BASE[marker.size || "md"];
    const fontPx = Math.max(6, base * scale * ((markerScalePct || 100) / 100));
    ctx.font = `900 ${fontPx}px sans-serif`;
    ctx.fillStyle = marker.color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(marker.label, x, y);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    return;
  }
  const base = MARKER_FONT_BASE[marker.size || "md"];
  const fontPx = Math.max(6, base * scale * ((markerScalePct || 100) / 100));
  ctx.font = `700 ${fontPx}px sans-serif`;
  const padX = fontPx * 0.6, padY = fontPx * 0.35;
  const textW = ctx.measureText(marker.label).width;
  const boxW = textW + padX * 2, boxH = fontPx + padY * 2;
  roundRectPath(ctx, x - boxW / 2, y - boxH / 2, boxW, boxH, boxH / 2);
  ctx.fillStyle = marker.color;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.85)";
  ctx.lineWidth = Math.max(1, fontPx * 0.12);
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(marker.label, x, y + fontPx * 0.05);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function drawTextBoxOnCanvas(ctx, x, y, t, scale) {
  const fontPx = Math.max(6, (t.fontSize || 16) * scale);
  ctx.font = `600 ${fontPx}px sans-serif`;
  const padX = fontPx * 0.35, padY = fontPx * 0.25;
  const textW = ctx.measureText(t.text).width;
  const boxW = textW + padX * 2, boxH = fontPx + padY * 2;
  if (t.bg !== "transparent") {
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.strokeStyle = "rgba(0,0,0,0.15)";
    ctx.lineWidth = 1;
    roundRectPath(ctx, x - boxW / 2, y - boxH / 2, boxW, boxH, 4);
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = "#1f2430";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(t.text, x, y + fontPx * 0.05);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function drawPageIntoCell(ctx, page, bitmap, cellX, cellY, cellW, cellH, markerScalePct, imageScalePct) {
  const pad = Math.round(cellW * 0.02);
  const availW = cellW - pad * 2, availH = cellH - pad * 2;
  const scale = Math.min(availW / FRAME_WIDTH, availH / FRAME_HEIGHT) * ((imageScalePct || 100) / 100);
  const renderW = FRAME_WIDTH * scale, renderH = FRAME_HEIGHT * scale;
  const renderX = cellX + pad + (availW - renderW) / 2;
  const renderY = cellY + pad + (availH - renderH) / 2;

  ctx.save();
  ctx.strokeStyle = "#d8dce8";
  ctx.lineWidth = 1;
  ctx.strokeRect(cellX + pad, cellY + pad, availW, availH);
  // 악보 크기를 키워도 옆 칸을 침범하지 않도록 셀 영역 기준으로 클리핑한다.
  ctx.beginPath();
  ctx.rect(cellX + pad, cellY + pad, availW, availH);
  ctx.clip();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(renderX, renderY, renderW, renderH);

  const box = imageBoxForPage(page);
  ctx.drawImage(bitmap, renderX + box.left * scale, renderY + box.top * scale, box.width * scale, box.height * scale);

  page.markers.forEach((m) => {
    const pos = markerFramePos(m, page);
    drawMarkerOnCanvas(ctx, renderX + pos.fx * scale, renderY + pos.fy * scale, m, scale, markerScalePct);
  });
  (page.texts || []).forEach((t) => {
    const pos = markerFramePos(t, page);
    drawTextBoxOnCanvas(ctx, renderX + pos.fx * scale, renderY + pos.fy * scale, t, scale);
  });
  ctx.restore();
}

function downloadCanvasPng(canvas, filename) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); resolve(); }, 100);
    }, "image/png");
  });
}

// 진행순서 글자 크기 슬라이더는 캡션 안에서의 "표시 크기"만 바꾸고, 실제로 악보에
// 배정되는 셀 안 공간은 이 기준값(BASELINE)으로 계산해 고정한다. 그래야 슬라이더를
// 올려도 악보 이미지 크기가 줄어들지 않는다.
const BASELINE_BODY_FONT_PX = 18;

// 곡 제목·키·날짜·예배종류 등 "헤더" 성격의 텍스트는 진행순서 슬라이더와 무관하게
// 항상 10~11pt 정도의 작은 고정 크기로 인쇄한다(150dpi 기준 픽셀로 환산).
const PT_TO_PX_150DPI = 150 / 72;
const TITLE_FONT_PX = Math.round(10.5 * PT_TO_PX_150DPI);
const SMALL_FONT_PX = Math.round(9 * PT_TO_PX_150DPI);

function buildFlatPrintUnits() {
  const units = [];
  let slotIdx = 0;
  for (const slot of currentProject.songSlots) {
    slotIdx++;
    const song = libraryCache.get(slot.libraryId);
    if (!song || !song.pages.length) continue;
    song.pages.forEach((page, pageIdx) => {
      units.push({ slotIdx, slot, song, page, isFirst: pageIdx === 0 });
    });
  }
  return units;
}

function measureCellCaption(measureCtx, unit, maxWidth, bodyFontPx) {
  const song = unit.song, slot = unit.slot;
  const showTempo = slot.showTempoInPrint !== false;
  let captionLine = `${unit.slotIdx}곡. ${song.title || "(제목 없음)"}${song.key ? " [" + song.key + "]" : ""}`;
  if (showTempo) captionLine += ` ♩=${slot.metronome.bpm}·${slot.metronome.beats}박`;

  const showNotes = unit.isFirst && slot.showNotesInPrint !== false && slot.notes && slot.notes.trim();
  const songFormText = unit.isFirst ? buildSongFormTextFor(slot, song) : "";
  const notesText = showNotes ? `전달사항: ${slot.notes.trim()}` : "";

  const bodyLineHeight = Math.round(bodyFontPx * 1.35);
  const smallLineHeight = Math.round(SMALL_FONT_PX * 1.4);
  const baselineBodyLineHeight = Math.round(BASELINE_BODY_FONT_PX * 1.35);

  const baselineBodyLines = unit.isFirst ? wrapTextLines(measureCtx, songFormText, maxWidth, BASELINE_BODY_FONT_PX, 600) : [];
  const baselineNotesLines = showNotes ? wrapTextLines(measureCtx, notesText, maxWidth, SMALL_FONT_PX, 500) : [];

  const heightPx = Math.round(
    TITLE_FONT_PX * 1.3 +
    (baselineBodyLines.length ? baselineBodyLines.length * baselineBodyLineHeight + 4 : 0) +
    (baselineNotesLines.length ? baselineNotesLines.length * smallLineHeight + 4 : 0)
  );

  return { captionLine, songFormText, notesText, showNotes, heightPx, bodyLineHeight, smallLineHeight };
}

function drawCellCaption(ctx, cap, x, y, maxWidth, bodyFontPx) {
  ctx.fillStyle = "#1f2430";
  ctx.textBaseline = "top";
  ctx.font = `700 ${TITLE_FONT_PX}px sans-serif`;
  ctx.fillText(cap.captionLine, x, y);
  let ly = y + Math.round(TITLE_FONT_PX * 1.3);

  if (cap.songFormText) {
    ctx.fillStyle = "#2563eb";
    ctx.font = `600 ${bodyFontPx}px sans-serif`;
    const lines = wrapTextLines(ctx, cap.songFormText, maxWidth, bodyFontPx, 600);
    lines.forEach((line) => { ctx.fillText(line, x, ly); ly += cap.bodyLineHeight; });
    ly += 4;
  }
  if (cap.showNotes) {
    ctx.fillStyle = "#92400e";
    ctx.font = `500 ${SMALL_FONT_PX}px sans-serif`;
    const lines = wrapTextLines(ctx, cap.notesText, maxWidth, SMALL_FONT_PX, 500);
    lines.forEach((line) => { ctx.fillText(line, x, ly); ly += cap.smallLineHeight; });
  }
}

async function buildPrintCanvases(perPage, fontSizePx, markerScalePct, orientation, imageScalePct, onProgress) {
  builtCanvases = [];
  const bitmaps = new Map();
  const EXPORT_PX = getExportPx(orientation);
  const measureCtx = document.createElement("canvas").getContext("2d");

  const units = buildFlatPrintUnits();
  for (const u of units) {
    if (!bitmaps.has(u.page.id)) {
      const bmp = await createImageBitmap(u.page.blob);
      bitmaps.set(u.page.id, bmp);
      if (!pageRatios.has(u.page.id)) pageRatios.set(u.page.id, bmp.height / bmp.width);
    }
  }
  if (!units.length) return builtCanvases;

  const margin = Math.round(EXPORT_PX.w * 0.018);
  // 세로 용지: 위아래로 쌓기(1열), 가로 용지: 좌우로 나열하기(1행)
  let cols, rows;
  if (orientation === "landscape") { cols = perPage; rows = 1; }
  else { cols = 1; rows = perPage; }
  const gridW = EXPORT_PX.w - margin * 2;
  const gridH = EXPORT_PX.h - margin * 2;
  const cellW = gridW / cols, cellH = gridH / rows;
  const cellPad = Math.round(cellW * 0.02);
  const cellInnerWidth = cellW - cellPad * 2;

  const totalOutputPages = Math.ceil(units.length / perPage);

  for (let out = 0; out < totalOutputPages; out++) {
    onProgress(`페이지 렌더링 중... (${out + 1}/${totalOutputPages})`);
    const canvas = document.createElement("canvas");
    canvas.width = EXPORT_PX.w;
    canvas.height = EXPORT_PX.h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#6b7180";
    ctx.font = `500 ${SMALL_FONT_PX}px sans-serif`;
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText(`${currentProject.name} · ${out + 1}/${totalOutputPages}`, EXPORT_PX.w - margin, margin * 0.4);
    ctx.textAlign = "left";

    const slice = units.slice(out * perPage, out * perPage + perPage);
    slice.forEach((unit, i) => {
      const r = Math.floor(i / cols), c = i % cols;
      const cellX = margin + c * cellW;
      const cellY = margin + r * cellH;

      const cap = measureCellCaption(measureCtx, unit, cellInnerWidth, fontSizePx);
      const captionH = cap.heightPx + cellPad;
      drawCellCaption(ctx, cap, cellX + cellPad, cellY + cellPad, cellInnerWidth, fontSizePx);

      drawPageIntoCell(ctx, unit.page, bitmaps.get(unit.page.id), cellX, cellY + captionH, cellW, cellH - captionH, markerScalePct, imageScalePct);
    });

    builtCanvases.push(canvas);
  }

  bitmaps.forEach((b) => { if (b.close) b.close(); });
  return builtCanvases;
}

/* ================= 메트로놈 ================= */

let audioCtx = null;
let isPlaying = false;
let currentBeat = 0;
let nextNoteTime = 0;
let schedulerTimer = null;
let rafId = null;
let notesInQueue = [];

const SCHEDULE_AHEAD = 0.12;
const LOOKAHEAD_MS = 25;
const NOTE_LENGTH = 0.06;

function getBPM() { return clamp(parseInt(el.bpmInput.value, 10) || 90, 40, 240); }
function getBeats() { return parseInt(el.beatsPerMeasure.value, 10) || 4; }

function buildBeatDots(n) {
  el.beatIndicator.innerHTML = "";
  for (let i = 0; i < n; i++) {
    const d = document.createElement("div");
    d.className = "beat-dot" + (i === 0 ? " accent" : "");
    el.beatIndicator.appendChild(d);
  }
}

function scheduleNote(beatNumber, time) {
  notesInQueue.push({ beat: beatNumber, time });
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.frequency.value = beatNumber === 0 ? 1050 : 720;
  gain.gain.setValueAtTime(0.001, time);
  gain.gain.exponentialRampToValueAtTime(1, time + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.001, time + NOTE_LENGTH);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(time);
  osc.stop(time + NOTE_LENGTH + 0.02);
}

function schedulerLoop() {
  const beatsPerMeasure = getBeats();
  while (nextNoteTime < audioCtx.currentTime + SCHEDULE_AHEAD) {
    scheduleNote(currentBeat, nextNoteTime);
    nextNoteTime += 60.0 / getBPM();
    currentBeat = (currentBeat + 1) % beatsPerMeasure;
  }
  schedulerTimer = setTimeout(schedulerLoop, LOOKAHEAD_MS);
}

function drawLoop() {
  const dots = [...el.beatIndicator.children];
  let lastShown = null;
  while (notesInQueue.length && notesInQueue[0].time < audioCtx.currentTime) lastShown = notesInQueue.shift();
  if (lastShown !== null) {
    dots.forEach((d) => d.classList.remove("on"));
    if (dots[lastShown.beat]) dots[lastShown.beat].classList.add("on");
  }
  rafId = requestAnimationFrame(drawLoop);
}

function startMetronome() {
  if (isPlaying) return;
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
  isPlaying = true;
  currentBeat = 0;
  notesInQueue = [];
  nextNoteTime = audioCtx.currentTime + 0.05;
  schedulerLoop();
  drawLoop();
  el.metronomeToggleBtn.textContent = "정지 ■";
  el.metronomeToggleBtn.classList.add("playing");
}
function stopMetronome() {
  if (!isPlaying) return;
  isPlaying = false;
  clearTimeout(schedulerTimer);
  cancelAnimationFrame(rafId);
  [...el.beatIndicator.children].forEach((d) => d.classList.remove("on"));
  el.metronomeToggleBtn.textContent = "시작 ▶";
  el.metronomeToggleBtn.classList.remove("playing");
}

function bindMetronomeEvents() {
  el.bpmRange.addEventListener("input", () => {
    el.bpmInput.value = el.bpmRange.value;
    const slot = activeSlot(); if (slot) slot.metronome.bpm = getBPM();
    saveProjectDebounced();
  });
  el.bpmInput.addEventListener("input", () => {
    const v = clamp(parseInt(el.bpmInput.value, 10) || 90, 40, 240);
    el.bpmRange.value = v;
    const slot = activeSlot(); if (slot) slot.metronome.bpm = v;
    saveProjectDebounced();
  });
  el.beatsPerMeasure.addEventListener("change", () => {
    buildBeatDots(getBeats());
    const slot = activeSlot(); if (slot) slot.metronome.beats = getBeats();
    saveProjectDebounced();
  });
  el.metronomeToggleBtn.addEventListener("click", () => (isPlaying ? stopMetronome() : startMetronome()));
  el.tempoPrintToggle.addEventListener("change", () => {
    const slot = activeSlot();
    if (!slot) return;
    slot.showTempoInPrint = el.tempoPrintToggle.checked;
    saveProjectDebounced();
  });

  let tapTimes = [];
  el.tapTempoBtn.addEventListener("click", () => {
    const now = performance.now();
    if (tapTimes.length && now - tapTimes[tapTimes.length - 1] > 2000) tapTimes = [];
    tapTimes.push(now);
    if (tapTimes.length > 6) tapTimes.shift();
    if (tapTimes.length >= 2) {
      const intervals = [];
      for (let i = 1; i < tapTimes.length; i++) intervals.push(tapTimes[i] - tapTimes[i - 1]);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const bpm = clamp(Math.round(60000 / avg), 40, 240);
      el.bpmInput.value = bpm;
      el.bpmRange.value = bpm;
      const slot = activeSlot(); if (slot) slot.metronome.bpm = bpm;
      saveProjectDebounced();
    }
  });
}

/* ================= 전역 이벤트 ================= */

function bindGlobalEvents() {
  document.addEventListener("keydown", (e) => {
    const tag = document.activeElement.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (screen !== "workspace") return;

    if (e.key === "Escape") {
      placingType = null;
      updatePaletteActiveState();
      hideGhost(); hideGuides();
    } else if (e.key === "ArrowRight") {
      nextStep();
    } else if (e.key === "ArrowLeft") {
      prevStep();
    } else if (e.code === "Space") {
      e.preventDefault();
      isPlaying ? stopMetronome() : startMetronome();
    }
  });

  window.addEventListener("resize", () => { if (screen === "workspace" && currentPage()) layoutCanvas(); });
}
