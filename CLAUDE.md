# 콘티 내게 도와줄께!! (Worship Song Planner)

바닐라 HTML/CSS/JS로 만든 싱글 페이지 웹앱. 빌드 도구 없음, 프레임워크 없음.
찬양팀이 악보 이미지에 송폼(진행 순서) 마커를 찍고, 여러 곡을 묶어 "콘티"(세트리스트)로
만들고, 메트로놈을 쓰고, 인쇄용 PDF/PNG로 출력할 수 있게 해주는 도구.

## 파일 구성

- `index.html` — 화면 3개(`#screenHome`, `#screenWorkspace`, `#screenPrint`)를 가진 SPA 뼈대.
  GitHub Pages 배포용 "정본"이며, PWA(홈 화면 추가)용 매니페스트/아이콘 링크가 걸려 있음.
- `style.css` — 전체 레이아웃/스타일
- `app.js` (~2400줄) — 모든 로직. 빌드 없이 `<script src="app.js">`로 그대로 로드됨
- `manifest.json` — 스마트폰 홈 화면 추가(PWA) 설정. `start_url`/`scope`/아이콘 경로가 전부
  **상대경로**(`./`, `icons/...`)임 — GitHub Pages는 `유저명.github.io/저장소명/` 처럼 루트가 아닌
  하위 경로에 배포되므로 절대경로(`/...`)로 바꾸면 깨짐. 건드릴 때 주의.
- `icons/` — PNG 아이콘 세트(모두 파이썬 Pillow로 생성한 남색 배경 + 흰색 8분음표 디자인):
  `favicon-16.png`/`favicon-32.png`(브라우저 탭), `apple-touch-icon-180.png`(iOS 홈 화면 —
  iOS가 자체적으로 모서리를 둥글리므로 원본은 각진 정사각형), `icon-192.png`/`icon-512.png`
  (매니페스트 기본 아이콘, 모서리가 둥근 배경), `icon-512-maskable.png`(안드로이드 적응형
  아이콘용 — 원형/스퀴클로 잘려도 안전하게 그림을 중앙에 작게 배치). 재생성하려면
  `python3`+Pillow로 `/System/Library/Fonts/Apple Symbols.ttf`에서 `♪`(8분음표) 글리프를
  그려서 저장하면 됨(이 저장소 대화 이력 참고).
- `.nojekyll` — GitHub Pages가 Jekyll로 파일을 건드리지 않도록 막는 빈 파일.
- `콘티_단일파일.html` — index.html+style.css+app.js를 통째로 합친 **완전 독립형** 단일 파일.
  `file://`로 서버 없이 바로 열려서 USB/메신저 등으로 옮겨 아무 기기에서나 실행하기 위한 용도.
  **PWA 매니페스트/아이콘은 일부러 안 넣음** — 별도 파일(`manifest.json`, `icons/*`)에 의존하면
  "파일 하나만 복사하면 끝"이라는 이 파일의 존재 이유가 깨지기 때문. index.html을 고칠 때마다
  이 파일도 동일한 방식(3개 파일을 읽어 `<link rel="stylesheet">`/`<script src="app.js">`
  자리에 내용을 그대로 인라인)으로 다시 만들어줘야 최신 상태로 유지됨.
- jsPDF는 CDN(`cdnjs.cloudflare.com/.../jspdf.umd.min.js`)에서 로드

git 저장소 아님. 로컬 실행은 정적 파일 서버로(`python3 -m http.server`) 열거나 `file://`로 직접
열면 됨. GitHub Pages로 공유하려면: 이 폴더를 GitHub 저장소로 만들고 push한 뒤, 저장소
Settings → Pages에서 배포 브랜치를 지정하면 `index.html`이 메인 페이지로 서빙됨(단, git init/커밋/
원격 push는 사용자 동의 없이 대신 실행하지 않았음 — 직접 하거나 다시 요청해야 함).

## 화면 구조 (4단계 워크플로우가 3개 섹션에 매핑됨)

1. **`#screenHome`** — 초기 화면. 좌우 2열(`.home-columns`):
   - `.home-left`: 날짜/예배종류/곡 수 입력 + 새 곡 목록(`#cpSongList`) + "콘티 작업 시작"
   - `.home-right`: 기존 곡 라이브러리(필터: 제목/키/속도/가사 첫줄) + 기존 콘티 검색·불러오기.
     기존 곡을 드래그해서 왼쪽 `#cpSongList`에 놓으면 새 프로젝트에 추가됨(HTML5 DnD).
2. **`#screenWorkspace`** — 곡별 탭(`#slotTabs`)으로 전환하는 작업 화면. 80/20 분할:
   - `.workspace-left` (80%): 페이지 목록 + 악보 뷰어(마커 팔레트, 이미지 크기 조절, 텍스트 메모 도구, 캔버스)
   - `.workspace-right` (20%): 송폼(진행순서) 패널, 메트로놈 패널, 전달사항(notes) 패널
3. **`#screenPrint`** — 인쇄 미리보기: 페이지당 곡 수, 용지 방향, 진행순서 글자 크기, 마커 크기(인쇄용),
   악보 크기(인쇄용) 슬라이더 → 미리보기 생성 → PDF+PNG 다운로드.

## 데이터 모델 (IndexedDB)

- DB: `WorshipSongPlannerDB` (버전 4, `app.js`의 `DB_VERSION`)
- 스토어 3개:
  - `songLibrary` (keyPath `id`) — 재사용 가능한 곡 원본: 악보 이미지, 마커, 텍스트 메모, 제목/키/템포/가사 첫줄
  - `projects` (keyPath `id`) — 콘티 프로젝트. `songSlots` 배열이 각각 `libraryId`를 참조하고,
    프로젝트별 정보(`songForm`, `metronome`, `notes`, `showTempoInPrint`, `showNotesInPrint`, `exportSettings`)를 따로 가짐
  - `handles` (keyPath `id`) — `FileSystemDirectoryHandle` 캐시. 키 `"scoreDir"`는 Score 폴더 저장(수동) 기능,
  키 `"backupDir"`는 자동 백업 폴더(저장할 때마다 JSON+악보를 자동 기록) 기능이 각각 독립적으로 사용함
  — 두 기능은 서로 다른 폴더를 가리킬 수 있고 서로 영향을 주지 않는다.
- **자동 저장 위치는 브라우저 로컬(IndexedDB)이다 — 디스크의 일반 파일이 아니다.** 브라우저 종류 + 접속
  origin(포트/`file://` 여부)에 종속되므로, 다른 브라우저나 시크릿 모드, 다른 포트로 열면 안 보임.
  실제 파일로 남기려면 워크스페이스 상단의 "백업 내보내기"(JSON, 이미지 포함) 또는 아래 Score 폴더
  저장 기능을 사용해야 함.
- **Score 폴더 저장**(`saveCurrentSongToScoreFolder`, 워크스페이스 `.song-meta-row`의 "💾 Score 폴더에
  저장" 버튼): File System Access API(`window.showDirectoryPicker`)로 로컬 폴더를 선택해 악보 이미지를
  실제 파일로 저장한다. 파일명은 `제목_키_속도_가사첫줄`(빈 값은 생략, `sanitizeFilename`으로 정리)
  + 페이지가 여러 장이면 `_2`, `_3`... 순번을 붙인다. 폴더 핸들은 `getScoreDirHandle()`이 `handles`
  스토어에 캐싱해 재사용하고, 매번 새로 물어보지 않도록 `queryPermission`/`requestPermission`으로 권한만
  재확인한다. **한 번 완전히 제거되었다가(라운드 5) 사용자 요청으로 다시 추가된(현재 라운드) 기능이므로,
  또다시 이유 없이 제거하지 말 것** — 대신 IndexedDB 자동 저장과는 별개의, 사용자가 명시적으로 누르는
  "진짜 파일로 내보내기" 기능이라는 점을 유지할 것.

## 핵심 기술 개념

- **프레임 좌표계**: `FRAME_WIDTH=850`, `FRAME_HEIGHT=Math.round(FRAME_WIDTH*Math.SQRT2)` (A4 비율).
  마커/텍스트박스 위치는 모두 이 가상 프레임 기준 퍼센트로 저장(`markerFramePos`, `frameToImagePercent`,
  `clientToFrame`, `snapPos`) → 확대/축소·인쇄 크기와 무관하게 일관된 위치 재현.
- **줌**: `#canvasWrap`에 CSS `transform: scale(zoom)` 적용, `#canvasSizer`가 스크롤 영역 크기 담당.
- **마커/텍스트박스 공통 상호작용 패턴**: `pointerdown`+`pointermove`+`pointerup`(마우스·터치·펜 공용,
  과거엔 mousedown 계열이었으나 모바일 지원을 위해 Pointer Events로 전환함), 이동거리 4px 초과 여부로
  "클릭(삭제 대기)"과 "드래그(위치 이동)"를 구분. `suppressNextPlacementClick`(400ms)로 삭제 클릭이
  바로 새 마커 배치로 오인되는 것을 방지. 드래그 대상 요소(`.marker`, `.text-box`, `.resize-handle`,
  `.text-resize-handle`, `#markerLayer`)는 CSS `touch-action:none`을 줘서 터치 스크롤/줌 제스처가
  드래그를 가로채지 못하게 함.
- **마커 클릭=삭제 vs 더블클릭=수정 충돌 주의**: 클릭 즉시 삭제해버리면 더블클릭의 첫 클릭에서
  이미 지워져서 두 번째 클릭이 절대 "더블클릭"으로 인식될 수 없다. 그래서 마커 삭제는 즉시 실행하지
  않고 `pendingMarkerDelete`(id+timer)로 `MARKER_DELETE_DELAY_MS`(280ms)만큼 지연시키고, 그 사이
  실제 `dblclick` 이벤트가 오면 타이머를 취소하고 대신 수정 동작을 수행한다. 새로운 마커/오브젝트에
  "클릭 삭제 + 더블클릭 수정"을 같이 넣을 때는 반드시 이 지연-취소 패턴을 재사용할 것.
- **마커 종류 / 라벨 체계** (`MARKER_SCHEME_DEFS`): 프로젝트(`currentProject.markerScheme`, 기본 `"kr"`)마다
  두 스킴 중 하나를 고름 — `kr`(전주/A~G/간주/후주/★, 절 번호는 prefix "1A")과
  `en`(Intro/Verse/Pre-Chorus/Chorus/Interlude/Bridge/Outro/★, 절 번호는 suffix "Verse 1"). 워크스페이스
  툴바의 `#markerSchemeSelect`로 전환하며, **스킴을 바꿔도 이미 찍힌 마커는 자신의 라벨/색을 그대로
  들고 있으므로 소급 변경되지 않는다** — 새로 배치하는 마커부터 새 스킴이 적용됨. `currentMarkerScheme()`가
  현재 프로젝트의 스킴을 반환하고, `buildMarkerPalette()`가 그 스킴의 타입으로 팔레트를 다시 그림(스킴
  전환 시·`enterWorkspace()` 시 반드시 재호출해야 함). 이미 찍힌 마커를 더블클릭으로 수정할 때는 현재
  스킴이 아니라 **그 마커 자신이 속한 스킴**을 알아야 하므로, 두 스킴을 합친 `ALL_MARKER_TYPES_MAP`
  (key→타입 설정)과 `ALL_VERSE_TYPE_KEYS`(절 번호를 지원하는 모든 key의 집합)를 별도로 두고 조회함.
  `verseFormatForType()`으로 prefix/suffix 여부를, `extractVerseNumber()`로 라벨 앞/뒤 어느 쪽에 있든
  기존 절 번호를 읽어옴. **절 번호 0은 "접두어/접미어 없음"을 의미**(0이면 그냥 "A", "Verse"로 표시) —
  `placingVerse` 기본값도 0. 배치 전 절 번호는 툴바의 `#markerVerseInput`(범위 0~9, 포커스 시 자동
  select되어 바로 덮어쓰기 가능)으로 바꾸고, 이미 찍힌 마커의 절 번호만 따로 고치고 싶으면 더블클릭 →
  "절 번호를 입력하세요(0~9)" 프롬프트에 숫자만 입력하면 됨(0을 입력하면 번호가 사라짐; 전체 라벨
  자유 편집은 절 마커가 아닌 타입에서만 뜸). **새 마커 타입/라벨 관련 기능을 추가할 때는 옛 `MARKER_TYPES`/
  `VERSE_TYPES` 전역 상수가 아니라 반드시 `MARKER_SCHEME_DEFS`/`ALL_MARKER_TYPES_MAP`/`ALL_VERSE_TYPE_KEYS`를
  거칠 것 — 두 상수는 스킴 도입과 함께 완전히 제거됨.**
- **이미지 리사이즈 "비율 유지" 옵션** (`imageAspectLock`, 툴바의 `#imageAspectLockToggle`): 켜져 있으면
  `attachResizeHandleDrag()`가 드래그 시작 시점의 박스 비율(`ratio0 = box0.height / box0.width`)을 기준으로,
  가로 방향이 섞인 핸들(모서리 포함)은 가로 변화량을, 세로만 있는 핸들(n/s)은 세로 변화량을 "기준 축"으로
  삼아 반대쪽 축을 그 비율에 맞게 다시 계산함. 앵커(고정되는 모서리/변)는 기존 로직과 동일하게 핸들
  방향으로만 결정(예: `se` 핸들은 항상 top-left 고정) — 비율 계산과 앵커 계산을 반드시 분리된 단계로
  둘 것(비율 계산 이후에 width/height가 바뀌므로, 앵커용 left/top은 그 최종 width/height로 다시 계산해야
  하고, 중간에 계산한 값을 재사용하면 앵커가 튀는 버그가 생김 — 실제로 초기 구현에서 이 순서 문제로
  버그가 났다가 수정됨).
- **이미지 리사이즈 핸들**(`#resizeHandleLayer`, 8방향)과 **텍스트박스 리사이즈 핸들**(우하단 1개, `.text-resize-handle`)은
  반드시 `#canvasWrap` **밖**(형제 요소)에 둘 것 — `#canvasWrap`은 `overflow:hidden`이라 안에 두면
  가장자리 핸들이 클리핑되어 클릭이 안 먹힘. `layoutCanvas()`에서 크기/transform을 `#canvasWrap`과
  동기화함.
- **z-index 스태킹 주의**: `#markerLayer`는 배경 클릭(마커 배치/패닝)을 받아야 해서 자기 자신에는
  `pointer-events:none`을 안 줌. 따라서 `#textBoxLayer`가 DOM/스택 순서상 `#markerLayer`보다
  아래에 있으면 텍스트박스 클릭/드래그/삭제가 전부 markerLayer에 먹혀버림. 반드시
  `#textBoxLayer { z-index: 6; }`로 위에 오도록 유지(컨테이너는 `pointer-events:none`,
  `.text-box` 자식은 `pointer-events:auto`).
- **인쇄 파이프라인**: `buildFlatPrintUnits()`가 전체 곡의 모든 페이지를 평탄화해서 곡 단위가 아니라
  "페이지당 개수" 기준으로 여러 곡을 한 물리 페이지에 묶음 → `buildPrintCanvases()` → 셀별
  `drawPageIntoCell()`(악보 이미지 + 마커 + 텍스트박스) → jsPDF로 조립 / `canvas.toBlob`으로 PNG.
  - 세로(portrait) 용지: 셀을 위→아래로 쌓음(`cols=1, rows=perPage`)
  - 가로(landscape) 용지: 셀을 좌→우로 배치(`cols=perPage, rows=1`)
  - 헤더(제목/키/날짜/예배종류) 폰트는 `PT_TO_PX_150DPI` 기반 고정 px(약 10.5pt/9pt)로, 진행순서
    글자 크기 슬라이더나 용지 방향과 무관하게 항상 같은 크기 유지.
  - 진행순서 글자 크기를 키워도 악보 셀 공간은 줄지 않도록 캡션 높이 계산에 고정
    `BASELINE_BODY_FONT_PX` 기준값을 따로 씀(실제 렌더링 폰트와 분리).
  - "악보 크기"(`#printImageScale`, 50~150%) 슬라이더는 셀 경계 안에서만 잘리게 클리핑해서
    키워도 옆 칸을 침범하지 않음.
- **워크스페이스 곡 순서 변경**: `#slotTabs`의 각 탭(`.slot-tab`)이 `draggable=true`이고, HTML5 DnD로
  `currentProject.songSlots` 배열 순서를 직접 바꿈(`renderSlotTabs()` 안의 dragstart/dragover/drop —
  초기 화면 `#cpSongList`의 곡 목록 드래그, 진행순서 리스트 드래그와 같은 패턴). 드롭 대상 탭의 `slotId`를
  기준으로 배열에서 스플라이스하는 방식이라, 탭을 다시 그릴 때(`renderSlotTabs()`)마다 이벤트를 새로
  붙여야 함(다른 리스트들과 동일).
- **악보 위 진행순서 캡션 바** (`#songformCaptionBar`, 캔버스 바로 위): 인쇄 미리보기와 같은 문구
  (`computeAutoSongFormText()`가 마커 라벨들을 "→"로 이어 자동 생성)를 작업 화면에서도 바로 보여주고,
  `#captionBodyText`(contenteditable)로 직접 고칠 수 있게 함. 사용자가 고친 문구는
  `slot.songFormTextOverride`에 저장되고, **`buildSongFormTextFor()`가 override를 최우선으로 반환하므로
  인쇄물에도 그대로 반영됨**(워크스페이스 캡션과 인쇄물이 항상 같은 함수를 거쳐 동기화됨 — 새로 인쇄
  캡션 관련 기능을 추가할 때 이 함수를 우회하지 말 것). blur 시 입력값이 자동 생성 문구와 같으면
  override를 지워 다시 "자동" 상태로 되돌리고, `#captionResetBtn`(override가 있을 때만 보임)으로도
  수동 초기화 가능. `renderCaptionBar()`는 `renderSongForm()` 안에서 항상 같이 호출되므로 진행순서가
  바뀔 때마다 자동 갱신됨 — 단, 사용자가 지금 그 영역에 포커스 중이면(`document.activeElement`로 체크)
  덮어쓰지 않아 타이핑 중 커서가 튀지 않게 함.
- **인쇄 미리보기 버튼 3종 분리**: 기존에 "PDF+PNG 다운로드" 버튼 하나였던 것을 `#printDirectBtn`(🖨
  `window.print()` 호출 — 실제 프린터로 바로 출력), `#printDownloadPngBtn`(PNG만), `#printDownloadPdfBtn`
  (PDF만)로 나눔. 셋 다 `builtCanvases`가 채워진 뒤(`printBuildBtn` 클릭 → 미리보기 생성 성공)에만
  활성화됨. `window.print()`가 실제로 미리보기 페이지만 찍히도록 `style.css`에 `@media print` 블록을
  둬서 `.print-preview-area` 이외의 모든 UI를 `visibility:hidden` 처리하고, `.print-page-preview`에
  `page-break-after: always`를 줌 — 이 블록을 건드릴 땐 반드시 실제 브라우저 인쇄 미리보기(Cmd+P)로
  확인할 것(헤드리스 테스트로는 인쇄 레이아웃을 검증할 수 없음).
- **저장 폴더 자동 백업**(초기화면 상단 `#backupFolderSetBtn`, `handles` 스토어의 `"backupDir"` 키):
  Score 폴더 저장과 같은 File System Access API 패턴이지만 독립적인 별도 기능 — 폴더를 한 번 지정해두면
  `saveProjectDebounced()`/`saveLibrarySongDebounced()`가 IndexedDB 저장을 마칠 때마다
  `autoBackupDebounced()`(1.5초 debounce, 두 저장 경로가 하나로 합쳐져 과도한 디스크 쓰기를 피함)를 통해
  `autoBackupProjectToDisk()`가 프로젝트 JSON(`exportProjectBackup()`과 같은 포맷)을 폴더 루트에,
  모든 곡의 악보 이미지를 그 안의 `Score` 하위 폴더에 통째로 다시 써넣음. **자동 저장 시점
  (`getBackupDirHandle({forcePick:false})`)은 사용자 제스처가 없을 수 있어 권한 팝업을 띄우지 않고
  `queryPermission`이 이미 `"granted"`가 아니면 조용히 건너뜀** — 브라우저가 권한을 잃으면(세션 종료 등)
  사용자가 "📁 저장 폴더 설정" 버튼을 다시 눌러야 자동 저장이 재개됨. 절대 alert 등으로 자동 저장
  실패를 매번 사용자에게 알리지 말 것(타이핑할 때마다 팝업이 뜨는 참사가 됨) — 대신 `saveStatus` 영역에
  "⚠ 자동 저장 실패" 같은 짧은 텍스트만 잠깐 표시함.
- **인쇄 미리보기 화면(`.print-preview-area`)은 반드시 `.print-page-preview`/`.print-page-label`에
  `flex-shrink: 0`을 유지할 것.** `.print-preview-area`는 `overflow-y:auto`가 걸린 flex column
  컨테이너인데, CSS flexbox 스펙상 overflow가 걸린 컨테이너의 자식은 `min-height:auto`가 `0`으로
  취급되어 기본적으로 무한정 찌그러들 수 있다. `flex-shrink:0`이 없으면 페이지 미리보기 여러 장의
  총 높이가 브라우저 창보다 클 때 스크롤되는 대신 각 미리보기가 억지로 눌려 찌그러지고, `<img>`는
  자신의 실제 비율(naturalWidth/Height)대로 그리려다 눌린 wrap 박스보다 커져 아래쪽이 잘려 보인다
  (세로 A4일수록 미리보기가 훨씬 길어서 이 현상이 두드러짐). 실제 캔버스/PNG 데이터 자체는 멀쩡하고
  이 CSS 속성 하나가 화면 표시만 망가뜨리는 것이므로, 비슷한 "미리보기가 잘려 보인다"는 제보가 다시
  오면 먼저 이 flex-shrink 설정부터 의심할 것.

## 테스트 방법

- git 저장소가 아니고 자동 테스트 스위트 없음. 기능 검증은 Playwright(`playwright-core` +
  수동 설치한 Chromium)로 로컬 `python3 -m http.server` 인스턴스를 직접 조작해서 확인.
- 코드 수정 후에는 항상 `node --check app.js`로 문법 검사 먼저.
- 스크린샷을 찍어 Read 도구로 실제로 눈으로 확인하는 것이 중요(단순히 콘솔 에러 없음만으론
  레이아웃/클릭 문제를 못 잡음).
- 요소가 "보이는데 클릭이 안 되는" 류의 버그는 `document.elementFromPoint(x,y)` +
  `page.addInitScript`로 몽키패치한 `EventTarget.prototype.addEventListener`로 실제 이벤트를
  받는 요소를 추적해서 원인을 찾을 것(리사이즈 핸들 클리핑, 텍스트박스 스태킹 순서 버그를 이
  방법으로 찾음).

## 지금까지 반영된 사용자 요청 (요약, 시간순)

1. 악보 이미지 업로드 + 마커 배치 + 송폼 순서 표시 + 메트로놈 (최초 버전)
2. A4 비율 표시 영역, 이미지 핸들 리사이즈, 마커 정렬 스냅, 클릭 삭제, 마커 크기(S/M/L),
   마커 종류를 전주/A~G/간주/후주로 변경, 송폼 순서 박스, PDF/PNG 인쇄, 날짜+예배종류로
   프로젝트 생성
3. 프로젝트당 여러 곡(탭 방식), 곡별 제목/키, 80/20 분할, 이미지 가로세로 개별 비율,
   클립보드 붙여넣기, 인쇄 여백 수정, 진행순서 폰트 크기 조절, 인쇄 미리보기, 곡 라이브러리
   (DB) 재사용, 4단계 화면 구조(초기→생성→작업→인쇄)
4. 드래그 핸들 리사이즈, 마커 인쇄 크기 조절, 절 번호 접두어(1A/2A), 인쇄 가로/세로 방향,
   템포 인쇄 표시 토글, 전달사항 텍스트 + 인쇄 토글, (이후 제거된) score 폴더 저장, 헤더
   폰트 크기 고정
5. 다중 페이지를 한 장에 묶는 인쇄 버그 수정, 곡에 속도(Slow/Medium/Fast)+가사 첫줄 필드
   추가, 인쇄 헤더 폰트 10~11pt로 축소, 기존 곡 검색 필터(제목/키/속도/가사), 초기 화면
   좌(생성)/우(기존 곡·콘티) 재배치 + 드래그로 곡 추가, score 폴더 저장 기능 완전 제거 후
   제목+키+속도+가사 기반 자동 저장 + 중복(동일 제목+키) 시 대체/번호추가 선택, 작업 화면
   초기화 버튼(악보는 유지, 마커/크기/템포/진행순서만 초기화), 강조용 별 마커, 자유 텍스트
   메모(크기·배경 흰색/투명 조절)
6. 텍스트 메모 드래그 이동/리사이즈/재클릭 삭제(구현 중 `#markerLayer`가 `#textBoxLayer`를
   가리는 z-index 버그 발견 및 수정), 인쇄 다중 페이지 배치 방향(세로 용지=위아래, 가로
   용지=좌우), 앱 이름을 "콘티 내게 도와줄께!!"로 변경, 인쇄 미리보기에 악보 크기 조절
   슬라이더 추가
7. 기존 곡/기존 콘티 목록에 삭제(×) 버튼 추가, 전체 디자인을 토스 스타일(넓은 여백,
   미니멀, 남색 메인 컬러, 둥근 모서리, Pretendard 폰트)로 리뉴얼, 화면 확대/축소·모바일
   대응 반응형 작업(레이아웃 겹침 방지, 브레이크포인트, 마우스 전용 이벤트를 Pointer
   Events로 전환해 터치 드래그 지원)
8. 절 번호(1A/2A) 입력 UX 개선(포커스 시 자동 select, 더블클릭으로 절 번호만 수정 —
   클릭=삭제와 충돌하지 않도록 삭제를 280ms 지연시키는 패턴 도입), 인쇄 미리보기 세로(A4
   portrait) 화면에서 미리보기가 잘려 보이던 CSS flexbox 버그 수정(`flex-shrink:0` 누락),
   Score 폴더 저장 기능 재도입(제목·키·속도·가사첫줄로 파일명 생성, 폴더 핸들은 IndexedDB
   `handles` 스토어에 캐싱해 재사용)
9. 절 번호 기본값을 0으로 변경 — 0이면 숫자 접두어 없이 그냥 "A", "B"로 표시(`placingVerse`
   기본값 0, 입력 범위 0~9, 더블클릭 수정 프롬프트도 0 입력 시 접두어 제거)
10. "어떤 디바이스에서도 실행" 가능한 완전 독립형 단일 파일(`콘티_단일파일.html`) 생성 —
    3개 파일을 그대로 인라인 병합, `file://`로 서버 없이 바로 실행되는 것까지 확인
11. GitHub Pages 공유를 위한 PWA 아이콘/매니페스트 준비 — `manifest.json`, Pillow로 생성한
    남색 배경+흰색 8분음표 아이콘 세트(`icons/`, 파비콘·apple-touch-icon·매니페스트 아이콘·
    안드로이드 maskable 아이콘), index.html에 관련 `<link>`/`<meta>` 태그 추가, Jekyll 처리
    방지용 `.nojekyll` 추가. git init/커밋/원격 push는 사용자 동의 없이 대신 하지 않음.
12. "다른 사람 폰에 저장되는 데이터를 서로 공유하려면?" 질문에 두 가지 방향 제시 후 사용자가
    **가벼운 쪽(옵션 1)을 선택**: 실시간 동기화(클라우드 DB, Firebase/Supabase 등, 계정·보안
    설정 필요)가 아니라, 기존 JSON 백업을 무료 클라우드에 업로드하고 링크/QR코드를 생성해
    상대방이 그 링크를 열면 자동으로 콘티를 불러오는 "공유 링크" 기능. **아직 미구현** —
    바로 아래 "다음 작업" 항목 참고.
13. 7가지 기능 일괄 요청 및 구현 완료: (1) 워크스페이스 곡 탭 드래그로 순서 변경, (2) 악보 위에
    인쇄 미리보기와 같은 진행순서 캡션을 보여주고 직접 수정 가능(`slot.songFormTextOverride`,
    인쇄물과 동일한 `buildSongFormTextFor()`를 공유), (3) 마커 라벨 체계를 한글(전주/A~G/간주/후주)
    ↔ 영어(Intro/Verse/Pre-Chorus/Chorus/Interlude/Bridge/Outro) 중 프로젝트 단위로 선택
    (`MARKER_SCHEME_DEFS`, 기존 마커는 소급 변경 안 됨), (4) 이미지 리사이즈 핸들에 "비율 유지"
    체크박스 추가, (5) 인쇄 미리보기에 실제 프린터로 출력하는 버튼(`window.print()` +
    `@media print`) 추가, (6) PDF+PNG 통합 다운로드 버튼을 PNG/PDF 개별 버튼으로 분리, (7) 초기
    화면에서 저장 폴더를 지정하면 콘티 저장 시마다 악보 이미지+JSON 백업이 그 폴더에 자동
    기록되는 기능 추가(Score 폴더 저장과는 독립된 `"backupDir"` 핸들 사용). Playwright 헤드리스
    테스트로 7개 기능 전부(마커 스킴 전환, 마커 배치, 캡션 자동/수동 텍스트, 탭 드래그 순서변경,
    인쇄 버튼 3종 활성화)를 실제 클릭·드래그로 검증했고 콘솔 에러 없음 확인, `콘티_단일파일.html`도
    최신 구조로 재생성 후 `file://`로 재확인함.

## 다음 작업 (아직 미구현 — 사용자가 방향만 정하고 실제 요청 전에 중단함)

- **공유 링크 기능**(옵션 1로 확정, 착수 전): 워크스페이스의 기존 "백업 내보내기"(JSON, 이미지
  포함) 데이터를 무료 클라우드 저장소(Firebase Storage 등 계정 가입이 필요한 서비스)에 업로드하고,
  그 결과로 받은 링크나 QR코드를 보여준다. 다른 사람이 그 링크로 접속하면 자동으로
  `importProjectBackup`에 해당하는 로직이 실행되어 콘티가 그 사람 브라우저에 저장되는 흐름.
  실시간 동기화는 아니고 "한 번 보내기"에 가까움(현재 방식보다 훨씬 편해지는 정도).
  - 구현 시 필요한 것: 무료 클라우드 서비스 계정 생성(사용자 동의 필요), 클라이언트 SDK 키를
    index.html/app.js에 추가, 업로드/다운로드 UI, 링크의 URL 파라미터로 프로젝트 ID를 받아
    자동 import하는 로직.
  - 시작하기 전에 어떤 서비스(Firebase vs 다른 대안)를 쓸지, 무료 한도로 충분한지 등을 다시
    확인하고 진행할 것 — 사용자가 "1번으로 할게"라고 말한 직후 메시지를 바꿔 CLAUDE.md 갱신을
    먼저 요청했으므로, 실제 착수는 다음 세션에서 다시 확인 후 시작.

## 주의할 점 / 하지 말아야 할 것

- Score 폴더 저장 기능(`saveCurrentSongToScoreFolder`)은 라운드 5에서 한 번 제거되었다가
  라운드 8에서 사용자 요청으로 다시 추가된 것이므로, 이유 없이 다시 제거하지 말 것.
- 새 레이어를 추가할 때는 `#markerLayer`와의 z-index/포인터 이벤트 관계를 항상 확인할 것.
- 리사이즈 핸들류 요소는 `overflow:hidden`인 컨테이너 밖에 배치할 것.
- 인쇄 헤더(제목/키/날짜/예배종류) 폰트 크기는 어떤 슬라이더로도 변하면 안 됨(고정 pt 기준).
- 인쇄 미리보기 관련 `.print-page-preview`/`.print-page-label`의 `flex-shrink:0`을 실수로
  지우지 말 것(위 "핵심 기술 개념"의 인쇄 파이프라인 항목 참고).
- 클릭으로 삭제되는 오브젝트에 더블클릭 수정 기능을 추가할 때는 `pendingMarkerDelete` 같은
  지연-취소 패턴 없이는 더블클릭이 절대 발동하지 않는다는 점을 기억할 것.
- 마커 타입/라벨 관련 코드에서 `MARKER_TYPES`나 `VERSE_TYPES`라는 이름의 전역 상수를 다시 만들지
  말 것 — 라운드 13에서 `MARKER_SCHEME_DEFS`(스킴별 타입 목록) + `ALL_MARKER_TYPES_MAP`/
  `ALL_VERSE_TYPE_KEYS`(스킴 무관 조회용)로 완전히 대체됨.
- Score 폴더 저장(`"scoreDir"`)과 자동 백업 폴더(`"backupDir"`)는 서로 다른 `handles` 키를 쓰는
  완전히 독립된 기능이다 — 하나를 고친다고 다른 하나의 핸들/권한까지 건드리지 말 것.
- 인쇄물의 진행순서 문구(캡션)를 손보는 기능을 추가할 때는 `computeAutoSongFormText()`(자동 생성)와
  `buildSongFormTextFor()`(override 우선 처리) 두 함수를 반드시 거칠 것 — 워크스페이스 캡션 바와
  인쇄 파이프라인이 이 함수들을 공유하고 있어서, 우회해서 직접 문자열을 만들면 워크스페이스와 인쇄물
  문구가 서로 어긋나게 된다.
