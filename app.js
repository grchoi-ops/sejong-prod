// ══════════════════════════════════════════
//  앱 상태
// ══════════════════════════════════════════
const DIVISIONS = {
  '제관': { label: '제관사', cls: 'div-제관' },
  '용접': { label: '용접사', cls: 'div-용접' },
  '보조': { label: '보조사', cls: 'div-보조' },
  '가공': { label: '가공반', cls: 'div-가공' },
  '구동': { label: '구동부', cls: 'div-구동' },
  '공사': { label: '공사부', cls: 'div-공사' },
  '관리': { label: '생산관리', cls: 'div-관리' }
};

const MANPOWER_CATS = ['제관사','용접사','보조사','가공','구동부'];

// 직원 div → 맨파워 카테고리 매핑
const DIV_TO_MP = {
  '제관': '제관사',
  '용접': '용접사',
  '보조': '보조사',
  '가공': '가공',
  '구동': '구동부',
  '공사': '보조사',  // 공사부 → 보조사로 집계
  '관리': null        // 집계 제외
};
const DAYS_KO = ['일','월','화','수','목','금','토'];

// ──────────────────────────────────────────────
//  한국 법정 공휴일 목록 (매년 1월에 해당 연도 추가)
//  토·일은 이미 isWeekend 로 처리되므로 포함해도 무방
// ──────────────────────────────────────────────
const KR_HOLIDAYS = new Set([
  // 2025
  '2025-01-01',                                     // 신정
  '2025-01-28','2025-01-29','2025-01-30',           // 설날 연휴
  '2025-03-01','2025-03-03',                        // 삼일절 + 대체
  '2025-05-05','2025-05-06',                        // 어린이날·부처님오신날 + 대체
  '2025-06-06',                                     // 현충일
  '2025-08-15',                                     // 광복절
  '2025-10-03',                                     // 개천절
  '2025-10-05','2025-10-06','2025-10-07','2025-10-08', // 추석 연휴 + 대체
  '2025-10-09',                                     // 한글날
  '2025-12-25',                                     // 성탄절

  // 2026
  '2026-01-01',                                     // 신정
  '2026-02-16','2026-02-17','2026-02-18',           // 설날 연휴
  '2026-03-01','2026-03-02',                        // 삼일절 + 대체
  '2026-05-05',                                     // 어린이날
  '2026-05-24','2026-05-25',                        // 부처님오신날 + 대체
  '2026-06-06','2026-06-08',                        // 현충일 + 대체
  '2026-08-15','2026-08-17',                        // 광복절 + 대체
  '2026-09-24','2026-09-25','2026-09-26','2026-09-28', // 추석 연휴 + 대체
  '2026-10-03','2026-10-05',                        // 개천절 + 대체
  '2026-10-09',                                     // 한글날
  '2026-12-25',                                     // 성탄절
]);

/** 해당 날짜가 법정 공휴일인지 확인 */
function isHoliday(dateStr) { return KR_HOLIDAYS.has(dateStr); }

let state = {
  employees: [],
  projects: [],
  dailyData: {},  // { 'YYYY-MM-DD': { emp: {...}, proj: {...} } }
  purchaseDB: [],
  mdEntries: [],
  _lastSyncTime: null,
  _statsYear: new Date().getFullYear(),
  _statsMonth: new Date().getMonth() + 1
};

let currentUser = null;

// ══════════════════════════════════════════
//  초기화
// ══════════════════════════════════════════
//  초기화
// ══════════════════════════════════════════
async function init() {
  loadLocal();

  // 세션 복원 시도
  const saved = sessionStorage.getItem('md_session');
  if (saved) {
    try { currentUser = JSON.parse(saved); } catch {}
  }

  if (!currentUser) {
    // 앱 숨기고 로그인 화면 표시
    document.getElementById('md-login-overlay').style.display = 'flex';
    md_renderLogin();
    // 서버 데이터 로드 후 드롭다운 갱신
    loadFromSheet().then(ok => { if (ok) md_renderLogin(); });
    return;
  }

  await _finishInit();
}

function _showApp() {
  document.querySelector('.app-header').style.display = '';
  document.querySelector('.app-body').style.display = '';
}

function _updateHeaderUser() {
  const badge = document.getElementById('app-user-badge');
  if (badge && currentUser) {
    const roleColor = currentUser.mdRole === '관리자' ? 'var(--accent)' : 'var(--accent2)';
    badge.innerHTML =
      `🧑 <strong>${md_esc(currentUser.name)}</strong>` +
      `<span style="font-size:11px;color:${roleColor};margin-left:6px;">[${md_esc(currentUser.mdRole)}]</span>`;
    badge.style.display = '';
  }
  const btn = document.getElementById('app-logout-btn');
  if (btn) btn.style.display = '';
}

function _applyRoleUI() {
  const role = currentUser?.mdRole || '일반';
  const allRestrictedTabs = ['settings', 'wo', 'daily', 'report', 'purchase', 'dashboard', 'stats'];
  const inspectorHiddenTabs = ['settings', 'wo', 'report', 'purchase'];
  const viewerHiddenTabs = ['settings', 'purchase', 'manday'];

  // 저장 버튼 표시 여부
  const isViewer = role === '열람용';
  const saveBtns = [document.getElementById('daily-save-btn'), document.querySelector('.server-save-btn'), document.getElementById('load-btn')];
  saveBtns.forEach(el => { if (el) el.style.display = isViewer ? 'none' : ''; });

  if (role === '관리자') {
    allRestrictedTabs.forEach(tab => {
      const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
      if (btn) btn.style.display = '';
    });
  } else if (role === '검사관') {
    // 대시보드·일일입력·월간통계·M/D만 표시
    inspectorHiddenTabs.forEach(tab => {
      const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
      if (btn) btn.style.display = 'none';
    });
    const activeBtn = document.querySelector('.tab-btn.active');
    if (activeBtn && inspectorHiddenTabs.includes(activeBtn.dataset.tab)) {
      switchToTab('dashboard');
    }
  } else if (role === '열람용') {
    // 설정·워크오더·구매요청 숨김, 나머지 열람 가능
    viewerHiddenTabs.forEach(tab => {
      const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
      if (btn) btn.style.display = 'none';
    });
    const activeBtn = document.querySelector('.tab-btn.active');
    if (activeBtn && viewerHiddenTabs.includes(activeBtn.dataset.tab)) {
      switchToTab('dashboard');
    }
  } else {
    // 일반: M/D 탭만 표시
    allRestrictedTabs.forEach(tab => {
      const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
      if (btn) btn.style.display = 'none';
    });
    switchToTab('manday');
  }
}

async function _finishInit() {
  _showApp();
  document.getElementById('md-login-overlay').style.display = 'none';
  _updateHeaderUser();
  _applyRoleUI();

  // 로그인 사용자 이름을 modifiedBy에 반영
  localStorage.setItem('sejong_user_name', currentUser.name);
  const userNameEl = document.getElementById('user-name');
  if (userNameEl) userNameEl.value = currentUser.name;

  setupTabs();

  const today = todayStr();
  document.getElementById('daily-date').value = today;
  document.getElementById('report-date').value = today;
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate()+1);
  document.getElementById('wo-date').value = tomorrow.toISOString().slice(0,10);
  initReportMonth();

  restoreSettingsSections();

  renderEmployees();
  renderProjects();
  loadDailyData();
  renderMonthDisplay();
  renderStats();
  renderDashboard();
  checkAlerts();

  const fromSheet = await loadFromSheet();
  if (fromSheet) {
    renderEmployees();
    renderProjects();
    loadDailyData();
    renderStats();
    renderDashboard();
    checkAlerts();
  } else {
    setSyncStatus('idle', '☁️ 서버 저장');
  }
}

function todayStr() {
  return new Date().toISOString().slice(0,10);
}

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-'+tab).classList.add('active');
      if (tab === 'dashboard') renderDashboard();
      if (tab === 'report')    renderReport();
      if (tab === 'stats')     renderStats();
      if (tab === 'wo')        loadWoData();
      if (tab === 'purchase')  pr_init();
      if (tab === 'manday')    md_initTab();
      if (tab === 'overtime')  ot_init();
      checkAlerts();
    });
  });
}

/**
 * 특정 탭으로 프로그래매틱 이동
 * @param {string} tabId - data-tab 값
 */
function switchToTab(tabId) {
  const btn = document.querySelector('.tab-btn[data-tab="' + tabId + '"]');
  if (btn) btn.click();
}

// ══════════════════════════════════════════
//  Vercel + Supabase 연동
// ══════════════════════════════════════════
// ⚠️ Vercel 배포 후 아래 URL을 실제 Vercel URL로 교체
const API_BASE = 'https://sejong-prod.vercel.app';

let _isSyncing = false;
let _pendingSync = false;

function setSyncStatus(status, msg) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  const map = {
    syncing: { icon:'🔄', color:'var(--text2)',  bg:'var(--surface3)' },
    ok:      { icon:'☁️✅', color:'var(--green)', bg:'rgba(46,213,115,0.12)' },
    offline: { icon:'⚠️', color:'var(--yellow)', bg:'rgba(255,211,42,0.12)' },
    error:   { icon:'❌', color:'var(--red)',     bg:'rgba(255,71,87,0.12)' },
    idle:    { icon:'☁️', color:'var(--text3)',  bg:'var(--surface3)' },
  };
  const s = map[status] || map.idle;
  el.style.color = s.color;
  el.style.background = s.bg;
  el.textContent = s.icon + ' ' + msg;
  if (status === 'ok') {
    setTimeout(() => {
      el.style.color = 'var(--text3)';
      el.style.background = 'var(--surface3)';
      el.textContent = '☁️ 서버 저장';
    }, 3000);
  }
}

// LocalStorage 저장
function saveLocal() {
  localStorage.setItem('sejong_prod_v1', JSON.stringify({
    employees:  state.employees,
    projects:   state.projects,
    dailyData:  state.dailyData,
    purchaseDB: state.purchaseDB || [],
    mdEntries:  state.mdEntries  || []
  }));
}

// LocalStorage 불러오기
function loadLocal() {
  const raw = localStorage.getItem('sejong_prod_v1');
  if (raw) {
    const d = JSON.parse(raw);
    state.employees  = d.employees  || [];
    state.projects   = d.projects   || [];
    state.dailyData  = d.dailyData  || {};
    state.purchaseDB = d.purchaseDB || [];
    state.mdEntries  = d.mdEntries  || [];
    migrateStateFields();
    return true;
  }
  return false;
}

// 하위호환: 기존 데이터에 없는 필드 초기화 + 구매관리 localStorage 마이그레이션 (F3)
function migrateStateFields() {
  if (!Array.isArray(state.purchaseDB)) state.purchaseDB = [];

  // [단계2] 직원 신규 필드 기본값 주입
  state.employees.forEach(e => {
    if (e.longTermTrip === undefined) e.longTermTrip = false;
    if (e.position     === undefined) e.position     = '';
    if (e.phone        === undefined) e.phone        = '';
    if (e.pin          === undefined) e.pin          = '0000';
    if (e.pinChanged   === undefined) e.pinChanged   = false;
    if (e.mdRole       === undefined) e.mdRole       = '관리자';
  });

  if (!Array.isArray(state.mdEntries)) state.mdEntries = [];

  state.projects.forEach(p => {
    if (p.site        === undefined) p.site        = '';
    if (p.manager     === undefined) p.manager     = '';
    if (p.phone       === undefined) p.phone       = '';
    if (p.claimPrefix === undefined) p.claimPrefix = '';
    // [단계3] 프로젝트 완료 필드 기본값 주입
    if (p.completed      === undefined) p.completed      = false;
    if (p.completedYear  === undefined) p.completedYear  = null;
  });

  // [단계1] 기존 dailyData status:'휴가' → '휴무' 일괄 치환
  Object.values(state.dailyData).forEach(dayData => {
    const empData = dayData.emp || {};
    Object.values(empData).forEach(ed => {
      if (ed.status === '휴가') ed.status = '휴무';
    });
  });

  // [F3] 구버전 구매관리 localStorage 키 → state 통합 (1회 실행)
  _migratePurchaseDB();
  _migratePurchaseProjects();
}

/**
 * 구버전 'purchase_db' localStorage → state.purchaseDB 이관 (F3)
 */
function _migratePurchaseDB() {
  const raw = localStorage.getItem('purchase_db');
  if (!raw) return;
  try {
    const oldDB = JSON.parse(raw);
    if (Array.isArray(oldDB) && oldDB.length > 0) {
      // 기존 항목 중복 없이 병합 (claim + itemName 기준)
      const existingKeys = new Set(
        state.purchaseDB.map(r => (r.claim || '') + '|' + (r.itemName || ''))
      );
      oldDB.forEach(row => {
        const key = (row.claim || '') + '|' + (row.itemName || '');
        if (!existingKeys.has(key)) {
          // projName → projId 매핑 시도
          const proj = state.projects.find(p =>
            p.client === row.projName || p.code === row.projCode
          );
          state.purchaseDB.push(Object.assign({}, row, {
            projId: proj ? proj.id : (row.projId || ''),
            projName: row.projName || (proj ? proj.client : '')
          }));
          existingKeys.add(key);
        }
      });
    }
    localStorage.removeItem('purchase_db');
  } catch (e) {
    console.warn('[migration] purchase_db 파싱 오류:', e.message);
    localStorage.removeItem('purchase_db');
  }
}

/**
 * 구버전 'purchase_projects' localStorage → state.projects 이관 (F3)
 */
function _migratePurchaseProjects() {
  const raw = localStorage.getItem('purchase_projects');
  if (!raw) return;
  try {
    const oldProjs = JSON.parse(raw);
    if (Array.isArray(oldProjs)) {
      let nextId = Math.max(0, ...state.projects.map(p => p.id || 0)) + 1;
      oldProjs.forEach(oldProj => {
        const existing = state.projects.find(p =>
          p.code === oldProj.code || p.client === oldProj.name
        );
        if (existing) {
          // 기존 프로젝트에 필드 보완
          if (oldProj.site   && !existing.site)        existing.site        = oldProj.site;
          if (oldProj.manager && !existing.manager)    existing.manager     = oldProj.manager;
          if (oldProj.phone  && !existing.phone)       existing.phone       = oldProj.phone;
          if (oldProj.prefix && !existing.claimPrefix) existing.claimPrefix = oldProj.prefix;
        } else {
          // 신규 프로젝트 추가
          state.projects.push({
            id:          nextId++,
            code:        oldProj.code    || '',
            client:      oldProj.name    || '',
            title:       '',
            site:        oldProj.site    || '',
            manager:     oldProj.manager || '',
            phone:       oldProj.phone   || '',
            claimPrefix: oldProj.prefix  || ''
          });
        }
      });
    }
    localStorage.removeItem('purchase_projects');
  } catch (e) {
    console.warn('[migration] purchase_projects 파싱 오류:', e.message);
    localStorage.removeItem('purchase_projects');
  }
}

// ── 서버에서 불러오기 ──
async function loadFromSheet() {
  setSyncStatus('syncing', '서버 연결 중...');
  try {
    const res = await fetch(API_BASE + '/api/load');
    const json = await res.json();
    if (json.success && json.data) {
      const d = json.data;
      state.employees  = d.employees  || [];
      state.projects   = d.projects   || [];
      state.dailyData  = d.dailyData  || {};
      state.purchaseDB = d.purchaseDB || [];
      state.mdEntries  = d.mdEntries  || [];
      state._lastSyncTime = d.lastModified || new Date().toISOString();
      migrateStateFields();
      saveLocal();
      setSyncStatus('ok', '서버 연결됨');
      return true;
    }
    setSyncStatus('idle', '서버 비어있음');
    return false;
  } catch(e) {
    setSyncStatus('offline', '오프라인 (로컬 사용 중)');
    return false;
  }
}

// ── 서버로 저장 ──
// [R2] 서버 저장 충돌 감지
async function checkConflict() {
  try {
    const res  = await fetch(API_BASE + '/api/load');
    const json = await res.json();
    const serverTime = json.data?.lastModified;
    const localTime  = state._lastSyncTime;
    if (serverTime && localTime && serverTime > localTime) {
      return { conflict: true, serverTime, modifiedBy: json.data?.modifiedBy || '알 수 없음' };
    }
  } catch { /* 오프라인 → 충돌 없음 처리 */ }
  return { conflict: false };
}

async function saveToSheet() {
  if (_isSyncing) { _pendingSync = true; return; }
  _isSyncing = true;
  setSyncStatus('syncing', '저장 중...');
  try {
    // [R2] 충돌 감지
    const conflict = await checkConflict();
    if (conflict.conflict) {
      const sTime = new Date(conflict.serverTime).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
      const ok = confirm(
        '⚠️ 서버에 더 최근 데이터가 있습니다.\n' +
        '서버 저장 시각: ' + sTime + '\n' +
        '수정자: ' + conflict.modifiedBy + '\n\n' +
        '현재 데이터로 덮어쓰시겠습니까?\n' +
        '(취소하면 서버 데이터를 먼저 불러올 수 있습니다)'
      );
      if (!ok) { _isSyncing = false; setSyncStatus('idle', '저장 취소됨'); return; }
    }
    const res = await fetch(API_BASE + '/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employees:    state.employees,
        projects:     state.projects,
        dailyData:    state.dailyData,
        purchaseDB:   state.purchaseDB || [],
        mdEntries:    state.mdEntries  || [],
        lastModified: new Date().toISOString(),
        modifiedBy:   localStorage.getItem('sejong_user_name') || '알 수 없음'
      })
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || '저장 실패');
    state._lastSyncTime = new Date().toISOString();
    setSyncStatus('ok', '서버 저장됨');
  } catch(e) {
    setSyncStatus('error', '저장 실패: ' + e.message);
  } finally {
    _isSyncing = false;
    if (_pendingSync) { _pendingSync = false; saveToSheet(); }
  }
}
// 통합 saveState: 로컬만 즉시 저장 (서버는 버튼으로만)
function saveState() {
  saveLocal();
  setSyncStatus('idle', '로컬 저장됨 (미동기화)');
}

// 수동 서버 동기화 (버튼 클릭)
async function manualSync() {
  await saveToSheet();
}

// 현재 로컬 데이터를 서버로 강제 이전
async function migrateToSheet() {
  if (!confirm('현재 브라우저에 저장된 데이터를 서버로 업로드합니다.\n서버의 기존 데이터는 덮어씌워집니다. 계속하시겠습니까?')) return;
  const btn = document.getElementById('migrate-btn');
  btn.textContent = '⏳ 업로드 중...';
  btn.disabled = true;
  await saveToSheet();
  btn.textContent = '☁️ 이전 완료!';
  setTimeout(() => {
    btn.textContent = '☁️ 현재 데이터 → 서버로 이전';
    btn.disabled = false;
  }, 3000);
  showToast('서버로 이전 완료!', 'success');
}

// 서버에서 강제 재로드
async function forceSyncFromSheet() {
  const ok = await loadFromSheet();
  if (ok) {
    renderEmployees();
    renderProjects();
    loadDailyData();
    renderStats();
    showToast('서버에서 불러오기 완료', 'success');
  } else {
    showToast('서버 연결 실패. 로컬 데이터를 사용합니다.', 'error');
  }
}

// [B2] 수동 불러오기 (헤더 버튼)
async function manualLoad() {
  if (!confirm('서버 데이터로 현재 로컬을 덮어씁니다.\n저장되지 않은 내용은 사라집니다. 계속하시겠습니까?')) return;
  await forceSyncFromSheet();
}

// ══════════════════════════════════════════
//  기본 직원 데이터
// ══════════════════════════════════════════
const DEFAULT_EMPLOYEES = [
  {id:1, name:'권양구', div:'관리', home:'', longTermTrip:false, position:'', phone:''},
  {id:2, name:'김광수', div:'공사', home:'정원화학', longTermTrip:false, position:'', phone:''},
  {id:3, name:'권오근', div:'공사', home:'정원화학', longTermTrip:false, position:'', phone:''},
  {id:4, name:'민영길', div:'공사', home:'리뉴시스템', longTermTrip:false, position:'', phone:''},
  {id:5, name:'강민재', div:'가공', home:'DFC', longTermTrip:false, position:'', phone:''},
  {id:6, name:'강용구', div:'제관', home:'', longTermTrip:false, position:'', phone:''},
  {id:7, name:'송기남', div:'관리', home:'', longTermTrip:false, position:'', phone:''},
  {id:8, name:'신동범', div:'보조', home:'ASK', longTermTrip:false, position:'', phone:''},
  {id:9, name:'최병유', div:'용접', home:'리뉴시스템', longTermTrip:false, position:'', phone:''},
  {id:10,name:'서석현', div:'공사', home:'인도네시아', longTermTrip:false, position:'', phone:''},
  {id:11,name:'김두용', div:'가공', home:'DFC', longTermTrip:false, position:'', phone:''},
  {id:12,name:'석병찬', div:'보조', home:'정원화학', longTermTrip:false, position:'', phone:''},
  {id:13,name:'신동진', div:'가공', home:'DFC', longTermTrip:false, position:'', phone:''},
  {id:14,name:'차재영', div:'가공', home:'DFC', longTermTrip:false, position:'', phone:''},
  {id:15,name:'최가람', div:'관리', home:'', longTermTrip:false, position:'', phone:''},
  {id:16,name:'강희석', div:'보조', home:'ASK', longTermTrip:false, position:'', phone:''},
  {id:17,name:'구은서', div:'공사', home:'ASK', longTermTrip:false, position:'', phone:''},
  {id:18,name:'김경호', div:'제관', home:'정원화학', longTermTrip:false, position:'', phone:''},
  {id:19,name:'김기동', div:'용접', home:'리뉴시스템', longTermTrip:false, position:'', phone:''},
  {id:20,name:'이상근', div:'용접', home:'리뉴시스템', longTermTrip:false, position:'', phone:''},
  {id:21,name:'홍성준', div:'용접', home:'정원화학', longTermTrip:false, position:'', phone:''},
  {id:22,name:'김성기', div:'제관', home:'', longTermTrip:false, position:'', phone:''},
  {id:23,name:'민영도', div:'보조', home:'리뉴시스템', longTermTrip:false, position:'', phone:''},
  {id:24,name:'김익탁', div:'공사', home:'인도네시아', longTermTrip:false, position:'', phone:''},
  {id:25,name:'하동윤', div:'제관', home:'정원화학', longTermTrip:false, position:'', phone:''},
  {id:26,name:'임혁종', div:'가공', home:'DFC', longTermTrip:false, position:'', phone:''}
];

function loadDefaultEmployees() {
  if (state.employees.length > 0 && !confirm('기존 직원 데이터를 기본값으로 초기화하시겠습니까?')) return;
  state.employees = DEFAULT_EMPLOYEES.map(e => ({...e}));
  saveState();
  renderEmployees();
  showToast('기본 직원 26명이 로드되었습니다.', 'success');
}

// ══════════════════════════════════════════
//  탭1: 직원 관리
// ══════════════════════════════════════════
function renderEmployees() {
  const grid = document.getElementById('emp-grid');
  grid.innerHTML = '';
  // [M1] 설정 섹션 카운트 업데이트
  const countEl = document.getElementById('section-emp-count');
  if (countEl) countEl.textContent = state.employees.length + '명';

  state.employees.forEach(emp => {
    const d = DIVISIONS[emp.div] || { label: emp.div, cls: '' };
    const card = document.createElement('div');
    card.className = 'emp-card';
    card.innerHTML =
      '<span class="emp-num">' + emp.id + '</span>' +
      '<span style="display:flex;align-items:center;gap:3px;flex-shrink:0;">' +
        '<span class="emp-name emp-name-clickable" style="width:auto;" onclick="showEmpDetail(' + emp.id + ')" title="클릭하면 상세 정보를 볼 수 있습니다">' + emp.name + '</span>' +
        '<span class="div-badge ' + d.cls + '" style="font-size:10px;padding:1px 4px;">' + d.label + '</span>' +
      '</span>' +
      '<div class="emp-division">' +
        '<select onchange="updateEmpDiv(' + emp.id + ', this.value)">' +
          Object.entries(DIVISIONS).map(([k,v]) =>
            '<option value="' + k + '"' + (emp.div===k?' selected':'') + '>' + v.label + '</option>'
          ).join('') +
        '</select>' +
      '</div>' +
      '<select style="font-size:11px;flex-shrink:0;" onchange="updateEmpField(' + emp.id + ',\'mdRole\',this.value)">' +
        ['관리자','검사관','열람용','일반'].map(r =>
          '<option value="' + r + '"' + (emp.mdRole === r ? ' selected' : '') + '>' + r + '</option>'
        ).join('') +
      '</select>' +
      // 장기출장 체크박스 + 고정 출장지
      '<label style="font-size:10px;color:var(--accent4);display:flex;align-items:center;gap:2px;cursor:pointer;white-space:nowrap;flex-shrink:0;" title="체크 시 일일 입력·집계에서 제외">' +
        '<input type="checkbox"' + (emp.longTermTrip?' checked':'') + ' style="accent-color:var(--accent4);width:12px;height:12px;" onchange="updateEmpField(' + emp.id + ',\'longTermTrip\',this.checked)">' +
        '✈장기출장' +
      '</label>' +
      '<input type="text" placeholder="출장지" value="' + (emp.tripLocation||'') + '" style="font-size:10px;width:72px;padding:1px 4px;border:1px solid rgba(255,179,71,0.4);border-radius:4px;background:rgba(255,179,71,0.08);color:var(--accent4);flex-shrink:0;" onchange="updateEmpField(' + emp.id + ',\'tripLocation\',this.value)">' +
      '<button class="btn btn-danger btn-sm" style="padding:2px 5px;font-size:10px;flex-shrink:0;" onclick="removeEmployee(' + emp.id + ')">✕</button>';
    grid.appendChild(card);
  });
}

function addEmployee() {
  const name   = document.getElementById('new-emp-name').value.trim();
  const div    = document.getElementById('new-emp-div').value;
  const mdRole = document.getElementById('new-emp-role')?.value || '일반';
  if (!name) { showToast('이름을 입력하세요.', 'error'); return; }
  const maxId = state.employees.reduce((m, e) => Math.max(m, e.id), 0);
  state.employees.push({
    id: maxId + 1, name, div, mdRole,
    home: '', longTermTrip: false, position: '', phone: '',
    pin: '0000', pinChanged: false
  });
  saveState();
  renderEmployees();
  document.getElementById('new-emp-name').value = '';
  showToast(`${name} 추가 완료`, 'success');
}

function removeEmployee(id) {
  const emp = state.employees.find(e => e.id === id);
  if (!confirm(`${emp.name}을(를) 삭제하시겠습니까?`)) return;
  state.employees = state.employees.filter(e => e.id !== id);
  saveState();
  renderEmployees();
}

function updateEmpDiv(id, div) {
  const emp = state.employees.find(e => e.id === id);
  if (emp) { emp.div = div; saveState(); renderEmployees(); }
}

function updateEmpHome(id, home) {
  const emp = state.employees.find(e => e.id === id);
  if (emp) { emp.home = home; saveState(); }
}

/**
 * [단계15] 직원 단일 필드 업데이트 (position, phone, longTermTrip 등)
 * @param {number} id
 * @param {string} field
 * @param {*} val
 */
function updateEmpField(id, field, val) {
  const emp = state.employees.find(e => e.id === id);
  if (!emp) return;
  // [EVAL_HINT 수정] boolean 필드는 typeof 방어 처리
  if (field === 'longTermTrip') {
    emp[field] = (val === true || val === 'true');
  } else {
    emp[field] = val;
  }
  saveState();
  // longTermTrip 변경 시 일일 입력 그리드 즉시 갱신
  if (field === 'longTermTrip') loadDailyData();
}

// ══════════════════════════════════════════
//  탭2: 프로젝트 관리
// ══════════════════════════════════════════
function renderProjects() {
  const tbody = document.getElementById('proj-tbody');
  tbody.innerHTML = '';
  // [M1] 설정 섹션 카운트 업데이트
  const countEl = document.getElementById('section-proj-count');
  if (countEl) countEl.textContent = state.projects.length + '개';

  state.projects.forEach((p,i) => {
    const tr = document.createElement('tr');
    // [M1] 신규 필드 포함 프로젝트 행 렌더 (data attribute 방식으로 따옴표 충돌 방지)
    const pId = p.id;
    const mkInput = (val, w, field) => {
      const inp = document.createElement('input');
      inp.value = val || '';
      inp.style.width = w;
      if (field === 'claimPrefix') { inp.style.fontFamily = 'var(--mono)'; inp.style.fontSize = '11px'; }
      inp.addEventListener('change', function() { updateProj(pId, field, this.value); });
      return inp.outerHTML.replace('</input>', '');
    };
    tr.innerHTML =
      '<td style="color:var(--text3);font-family:var(--mono)">' + (i+1) + '</td>' +
      '<td class="_proj-inp" data-f="code"></td>' +
      '<td class="_proj-inp" data-f="client"></td>' +
      '<td class="_proj-inp" data-f="title" style="min-width:140px;"></td>' +
      '<td class="_proj-inp" data-f="site"></td>' +
      '<td class="_proj-inp" data-f="manager"></td>' +
      '<td class="_proj-inp" data-f="claimPrefix"></td>' +
      '<td style="text-align:center;">' +
        '<button class="btn btn-sm ' + (p.completed ? 'btn-success' : 'btn-ghost') + '" ' +
          'style="font-size:10px;padding:2px 7px;" ' +
          'onclick="toggleProjectCompleted(' + pId + ')" ' +
          'title="' + (p.completed ? '완료됨' : '클릭하여 완료 처리') + '">' +
          (p.completed ? '✅완료' : '진행중') +
        '</button>' +
      '</td>' +
      '<td><button class="btn btn-danger btn-sm" onclick="removeProject(' + pId + ')">✕</button></td>';
    // 인풋을 DOM으로 직접 추가 (따옴표 충돌 방지)
    const fieldConfig = [
      { f:'code',        w:'120px' },
      { f:'client',      w:'140px' },
      { f:'title',       w:'100%'  },
      { f:'site',        w:'80px'  },
      { f:'manager',     w:'70px'  },
      { f:'claimPrefix', w:'100px' }
    ];
    tr.querySelectorAll('td._proj-inp').forEach((td) => {
      const field = td.dataset.f;
      const cfg   = fieldConfig.find(c => c.f === field);
      const inp   = document.createElement('input');
      inp.value   = p[field] || '';
      inp.style.width = cfg ? cfg.w : '100%';
      if (field === 'claimPrefix') { inp.style.fontFamily = 'var(--mono)'; inp.style.fontSize = '11px'; }
      inp.addEventListener('change', (function(fld) {
        return function() { updateProj(pId, fld, this.value); };
      })(field));
      td.innerHTML = '';
      td.appendChild(inp);
    });
        tbody.appendChild(tr);
  });
}

function addProject() {
  const code    = document.getElementById('new-proj-code').value.trim();
  const client  = document.getElementById('new-proj-client').value.trim();
  const title   = document.getElementById('new-proj-title').value.trim();
  const site    = document.getElementById('new-proj-site')?.value.trim()    || '';
  const manager = document.getElementById('new-proj-manager')?.value.trim() || '';
  const claimPrefix = document.getElementById('new-proj-prefix')?.value.trim() || '';
  if (!client) { showToast('클라이언트명을 입력하세요.', 'error'); return; }
  const maxId = state.projects.reduce((m,p) => Math.max(m,p.id), 0);
  // [I4] 구매관리 통합용 필드 포함하여 생성 + 완료 필드 초기값
  state.projects.push({ id: maxId+1, code, client, title, site, manager, phone:'', claimPrefix, completed: false, completedYear: null });
  saveState();
  renderProjects();
  ['new-proj-code','new-proj-client','new-proj-title','new-proj-site','new-proj-manager','new-proj-prefix'].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
  loadDailyData(); // 프로젝트 패널 갱신
  showToast(`${client} 프로젝트 추가 완료`, 'success');
}

function removeProject(id) {
  const p = state.projects.find(p => p.id === id);
  if (!confirm(`"${p.client}" 프로젝트를 삭제하시겠습니까?\n과거 투입 데이터는 유지됩니다.`)) return;
  state.projects = state.projects.filter(p => p.id !== id);
  saveState();
  renderProjects();
  showToast('삭제 완료', 'success');
}

function updateProj(id, field, val) {
  const p = state.projects.find(p => p.id === id);
  if (p) { p[field] = val; saveState(); }
}

/**
 * [단계9] 프로젝트 완료 상태 토글
 * @param {number} projId
 */
function toggleProjectCompleted(projId) {
  const proj = state.projects.find(p => p.id === projId);
  if (!proj) return;
  proj.completed = !proj.completed;
  proj.completedYear = proj.completed ? new Date().getFullYear() : null;
  saveState();
  renderProjects();
  showToast(proj.completed ? `"${proj.client}" 완료 처리됨` : `"${proj.client}" 완료 해제됨`, 'success');
}

/**
 * [단계9] 프로젝트 드롭다운 옵션 HTML 생성 (공통 유틸)
 * @param {boolean} includeCompleted - 완료 프로젝트 포함 여부
 * @param {string|number} selectedId - 현재 선택값
 * @returns {string} <option> + <optgroup> HTML
 */
function buildProjectOptions(includeCompleted, selectedId) {
  const active = state.projects.filter(p => !p.completed);
  const completed = state.projects.filter(p => p.completed);

  let html = '<option value="">-- 미배정 --</option>';
  active.forEach(p => {
    const sel = String(p.id) === String(selectedId) ? ' selected' : '';
    html += '<option value="' + p.id + '"' + sel + '>' + p.client + (p.code ? ' (' + p.code + ')' : '') + '</option>';
  });

  if (includeCompleted && completed.length > 0) {
    // 연도별 그룹핑
    const byYear = {};
    completed.forEach(p => {
      const y = p.completedYear || '기타';
      if (!byYear[y]) byYear[y] = [];
      byYear[y].push(p);
    });
    Object.entries(byYear).sort((a, b) => String(b[0]).localeCompare(String(a[0]))).forEach(([year, projs]) => {
      html += '<optgroup label="완료 - ' + year + '">';
      projs.forEach(p => {
        const sel = String(p.id) === String(selectedId) ? ' selected' : '';
        html += '<option value="' + p.id + '"' + sel + '>' + p.client + (p.code ? ' (' + p.code + ')' : '') + '</option>';
      });
      html += '</optgroup>';
    });
  }
  return html;
}

// ══════════════════════════════════════════
//  탭3: 일일 입력
// ══════════════════════════════════════════
function getDateStr() {
  return document.getElementById('daily-date').value;
}

/**
 * [단계5] 일괄 휴무 처리 — 현재 날짜의 장기출장 제외 전 직원을 '휴무'로 전환
 */
function setBulkAbsence() {
  const date = getDateStr();
  if (!state.dailyData[date]) state.dailyData[date] = { emp: {}, proj: {} };
  state.employees.forEach(emp => {
    if (emp.longTermTrip) return;
    if (!state.dailyData[date].emp[emp.id]) {
      state.dailyData[date].emp[emp.id] = { status: '휴무', overtimeHours: 0, projId: '', onTrip: false, work: '', halfDayHours: 0 };
    } else {
      state.dailyData[date].emp[emp.id].status = '휴무';
    }
  });
  saveState();
  loadDailyData();
  showToast('전원 휴무 처리되었습니다.', 'success');
}

function changeDate(delta) {
  const d = new Date(getDateStr());
  d.setDate(d.getDate() + delta);
  document.getElementById('daily-date').value = d.toISOString().slice(0,10);
  loadDailyData();
}

function loadDailyData() {
  const date = getDateStr();
  const d = new Date(date + 'T00:00:00');
  const dow = d.getDay(); // 0=일, 6=토
  const isWeekend = (dow === 0 || dow === 6);
  const dowLabel = DAYS_KO[dow];
  document.getElementById('day-of-week').textContent = `(${dowLabel}요일)`;

  // [단계5] 주말 최초 진입 시 전 직원(장기출장 제외)을 '휴무'로 자동 세팅 (미저장)
  if (isWeekend) {
    if (!state.dailyData[date]) state.dailyData[date] = { emp: {}, proj: {} };
    const empSection = state.dailyData[date].emp;
    if (Object.keys(empSection).length === 0) {
      state.employees.forEach(emp => {
        if (!emp.longTermTrip) {
          empSection[emp.id] = { status: '휴무', overtimeHours: 0, projId: '', onTrip: false, work: '', halfDayHours: 0 };
        }
      });
    }
  }

  const data = state.dailyData[date] || {};
  renderEmpInputGrid(data.emp || {});
  renderProjEntries(data.proj || {});
  updateStats();
}

function renderEmpInputGrid(empData) {
  const grid = document.getElementById('emp-input-grid');
  grid.innerHTML = '';

  // 직종별 정렬 순서 (생산관리 맨 뒤)
  const DIV_ORDER = ['제관','용접','보조','가공','구동','공사','관리'];
  const sorted = [...state.employees].sort((a, b) => {
    const ai = DIV_ORDER.indexOf(a.div);
    const bi = DIV_ORDER.indexOf(b.div);
    const ao = ai === -1 ? 99 : ai;
    const bo = bi === -1 ? 99 : bi;
    if (ao !== bo) return ao - bo;
    return a.id - b.id; // 같은 직종 내에서는 번호 순
  });

  let lastDiv = null;

  sorted.forEach(emp => {
    const ed = empData[emp.id] || { status:'출근', overtimeHours:0, projId:'', onTrip:false, work:'' };
    const d = DIVISIONS[emp.div] || { label:emp.div, cls:'' };
    // [단계4] 장기출장자는 메인 그리드에서 제외하고 별도 섹션에 표시
    if (emp.longTermTrip) return;
    const isAbsent = ed.status === '휴무' || ed.status === '연차';

    // 직종 구분선
    if (emp.div !== lastDiv) {
      lastDiv = emp.div;
      const divider = document.createElement('div');
      divider.style.cssText = 'grid-column:1/-1;font-size:11px;font-weight:700;color:var(--text3);letter-spacing:1px;padding:6px 2px 2px;border-bottom:1px solid var(--border);margin-bottom:2px;';
      divider.innerHTML = '<span class="div-badge ' + d.cls + '" style="font-size:11px;">' + d.label + '</span>';
      grid.appendChild(divider);
    }

    const row = document.createElement('div');
    row.className = 'emp-row' + (isAbsent ? ' is-absent' : '');
    row.id = 'emp-row-' + emp.id;

    const statusBtns = ['출근','반차','연차','휴무'].map(s =>
      '<button class="status-btn ' + (ed.status===s?'active-'+s:'') + '" onclick="setEmpStatus(' + emp.id + ',\'' + s + '\',this)">' + (s==='휴무'?'休':s) + '</button>'
    ).join('');

    // [단계9] 투입 프로젝트 옵션 — 완료 프로젝트 제외
    const projOpts = buildProjectOptions(false, ed.projId);

    const otHours = ed.overtimeHours || '';
    const isOnTrip = ed.onTrip || false;
    // [M4] 반차 시간: 없으면 기본 4시간, 반차 상태일 때만 UI 표시
    const hdHours  = ed.halfDayHours || 4;
    const hdDisplay = (ed.status === '반차') ? 'flex' : 'none';

    row.innerHTML =
      '<div class="emp-row-top">' +
        '<span class="emp-row-num">' + emp.id + '</span>' +
        '<span class="emp-row-name emp-name-clickable" onclick="showEmpDetail(' + emp.id + ')" title="상세 정보">' + emp.name + '</span>' +
        '<span class="emp-row-div"><span class="div-badge ' + d.cls + '">' + d.label + '</span></span>' +
      '</div>' +
      '<div class="emp-row-controls">' +
        '<div class="status-group">' + statusBtns + '</div>' +
        // [M4] 반차 선택 시 나타나는 시간 입력 UI
        '<div id="halfday-input-' + emp.id + '" style="display:' + hdDisplay + ';align-items:center;gap:5px;margin-top:5px;padding:3px 6px;background:rgba(255,211,42,0.07);border-radius:5px;border:1px solid rgba(255,211,42,0.25);">' +
          '<span style="font-size:11px;color:var(--yellow);">반차</span>' +
          '<input type="number" min="0.5" max="7" step="0.5" value="' + hdHours + '"' +
            ' style="width:48px;text-align:center;font-family:var(--mono);font-size:12px;font-weight:600;padding:3px 4px;color:var(--yellow);border-color:rgba(255,211,42,0.5);"' +
            ' onchange="setHalfDayHours(' + emp.id + ',this.value)">' +
          '<span style="font-size:11px;color:var(--yellow);">시간</span>' +
        '</div>' +
        '<div class="emp-row-bottom" style="margin-top:6px;">' +
          '<select onchange="setEmpProj(' + emp.id + ',this.value)" style="flex:1;min-width:80px;">' +
            '<option value="">-- 미배정 --</option>' +
            projOpts +
          '</select>' +
          '<label class="overtime-input" style="cursor:pointer;gap:5px;">' +
            '<input type="checkbox" ' + (isOnTrip?'checked':'') + ' style="width:14px;height:14px;accent-color:var(--accent4);padding:0;cursor:pointer;" onchange="setEmpOnTrip(' + emp.id + ',this.checked)">' +
            '<span style="color:var(--accent4);font-weight:700;">출장</span>' +
          '</label>' +
          '<div class="overtime-input">' +
            '<span>잔업</span>' +
            '<input type="number" min="0" max="12" step="0.5" value="' + otHours + '" placeholder="0" onchange="setEmpOvertime(' + emp.id + ',this.value)">' +
            '<span>h</span>' +
          '</div>' +
        '</div>' +
        '<div class="emp-work-input">' +
          '<input type="text" value="' + (ed.work||'').replace(/"/g,'&quot;') + '" placeholder="작업 내용 / 사유 (연차, 공상, 산재, 경조사, 기타...)" onchange="setEmpWork(' + emp.id + ',this.value)">' +
        '</div>' +
      '</div>';

    grid.appendChild(row);
  });

  // [단계6] 장기출장자 별도 접이식 섹션
  const longTripEmps = state.employees.filter(emp => emp.longTermTrip);
  if (longTripEmps.length > 0) {
    const sectionId = 'longtrip-section';
    const header = document.createElement('div');
    header.style.cssText = 'grid-column:1/-1;margin-top:12px;cursor:pointer;user-select:none;';
    header.innerHTML =
      '<div style="font-size:11px;font-weight:700;color:var(--accent4);letter-spacing:1px;padding:6px 8px;background:rgba(255,179,71,0.08);border:1px solid rgba(255,179,71,0.25);border-radius:6px;display:flex;align-items:center;gap:8px;" onclick="document.getElementById(\'' + sectionId + '\').classList.toggle(\'hidden\')">' +
      '✈ 장기출장 인원 (' + longTripEmps.length + '명) — 집계 제외 <span style="font-size:10px;color:var(--text3);">(클릭하여 펼치기/접기)</span>' +
      '</div>';
    grid.appendChild(header);

    const sectionDiv = document.createElement('div');
    sectionDiv.id = sectionId;
    sectionDiv.className = 'hidden';
    sectionDiv.style.cssText = 'grid-column:1/-1;';

    longTripEmps.forEach(emp => {
      const d2 = DIVISIONS[emp.div] || { label: emp.div, cls: '' };
      const badge = document.createElement('div');
      badge.style.cssText = 'padding:6px 10px;margin:4px 0;background:rgba(255,179,71,0.06);border:1px solid rgba(255,179,71,0.2);border-radius:6px;font-size:12px;color:var(--text3);display:flex;align-items:center;gap:8px;';
      badge.innerHTML =
        '<span style="color:var(--text3);">' + emp.id + '</span>' +
        '<span style="font-weight:700;color:var(--text2);">' + emp.name + '</span>' +
        '<span class="div-badge ' + d2.cls + '" style="font-size:10px;">' + d2.label + '</span>' +
        '<span style="font-size:11px;color:var(--accent4);">✈ 장기출장 중' + (emp.tripLocation ? ' · ' + emp.tripLocation : '') + ' (집계 제외)</span>';
      sectionDiv.appendChild(badge);
    });
    grid.appendChild(sectionDiv);
  }
}

function setEmpStatus(id, status, btn) {
  const date = getDateStr();
  if (!state.dailyData[date]) state.dailyData[date] = { emp: {}, proj: {} };
  if (!state.dailyData[date].emp[id]) state.dailyData[date].emp[id] = { status:'출근', overtimeHours:0, projId:'', onTrip:false, work:'', halfDayHours:0 };
  state.dailyData[date].emp[id].status = status;

  // [M4] 반차 선택 시 halfDayHours 기본값 설정 (이전 입력값 유지, 없을 때만 4 설정)
  if (status === '반차' && !state.dailyData[date].emp[id].halfDayHours) {
    state.dailyData[date].emp[id].halfDayHours = 4;
  }
  saveState();

  // UI 업데이트
  const row = document.getElementById(`emp-row-${id}`);
  row.querySelectorAll('.status-btn').forEach(b => {
    b.className = 'status-btn';
    const s = b.textContent === '休' ? '휴무' : b.textContent;
    if (s === status) b.classList.add('active-'+status);
  });
  row.classList.toggle('is-absent', status === '휴무' || status === '연차');

  // [M4] 반차 시간 입력 UI 표시/숨김 토글
  const hdInput = document.getElementById('halfday-input-' + id);
  if (hdInput) hdInput.style.display = (status === '반차') ? 'flex' : 'none';

  updateStats();
}

// [M4] 반차 시간 저장
function setHalfDayHours(id, val) {
  const date = getDateStr();
  if (!state.dailyData[date]) state.dailyData[date] = { emp:{}, proj:{} };
  if (!state.dailyData[date].emp[id]) state.dailyData[date].emp[id] = { status:'반차', halfDayHours:4 };
  state.dailyData[date].emp[id].halfDayHours = parseFloat(val) || 4;
  saveState();
}

function setEmpProj(id, projId) {
  const date = getDateStr();
  if (!state.dailyData[date]) state.dailyData[date] = { emp:{}, proj:{} };
  if (!state.dailyData[date].emp[id]) state.dailyData[date].emp[id] = { status:'출근', overtimeHours:0, projId:'', onTrip:false, work:'' };
  state.dailyData[date].emp[id].projId = projId;
  saveState();
  updateStats();
}

function setEmpOnTrip(id, val) {
  const date = getDateStr();
  if (!state.dailyData[date]) state.dailyData[date] = { emp:{}, proj:{} };
  if (!state.dailyData[date].emp[id]) state.dailyData[date].emp[id] = { status:'출근', overtimeHours:0, projId:'', onTrip:false, work:'' };
  state.dailyData[date].emp[id].onTrip = val;
  saveState();
  updateStats();
}

function setEmpOvertime(id, val) {
  const date = getDateStr();
  if (!state.dailyData[date]) state.dailyData[date] = { emp:{}, proj:{} };
  if (!state.dailyData[date].emp[id]) state.dailyData[date].emp[id] = { status:'출근', overtimeHours:0, projId:'', onTrip:false, work:'' };
  state.dailyData[date].emp[id].overtimeHours = parseFloat(val) || 0;
  saveState();
  updateStats();
}

function setEmpWork(id, val) {
  const date = getDateStr();
  if (!state.dailyData[date]) state.dailyData[date] = { emp:{}, proj:{} };
  if (!state.dailyData[date].emp[id]) state.dailyData[date].emp[id] = { status:'출근', overtimeHours:0, projId:'', onTrip:false, work:'' };
  state.dailyData[date].emp[id].work = val;
  saveState();
}

function renderProjEntries(projData) {
  const container = document.getElementById('proj-entries');
  container.innerHTML = '';
  
  if (state.projects.length === 0) {
    container.innerHTML = '<p style="color:var(--text3);font-size:12px;text-align:center;padding:20px;">② 프로젝트 탭에서 프로젝트를 먼저 추가하세요.</p>';
    return;
  }

  const date = getDateStr();

  // 전일 누계 계산
  function getPrevCumulative(projId, cat) {
    let total = 0;
    Object.entries(state.dailyData).forEach(([d, data]) => {
      if (d >= date) return;
      total += ((data.proj || {})[projId] || {})[cat] || 0;
    });
    return total;
  }

  // 해당 프로젝트에 배정된 직원의 직종별 자동 카운트
  function calcAutoMP(projId) {
    const empData = (state.dailyData[date] || {}).emp || {};
    const counts = {};
    MANPOWER_CATS.forEach(c => counts[c] = 0);
    state.employees.forEach(emp => {
      const ed = empData[emp.id] || { status:'출근', projId:'' };
      const isAbsent = ed.status === '휴무' || ed.status === '연차';
      if (isAbsent) return;
      if (String(ed.projId) !== String(projId)) return;
      const mpCat = DIV_TO_MP[emp.div];
      if (mpCat) counts[mpCat]++;
    });
    return counts;
  }

  state.projects.forEach(proj => {
    const pd = projData[proj.id] || {};
    const auto = calcAutoMP(proj.id);   // 자동 집계값

    const tableRows = MANPOWER_CATS.map(cat => {
      const prev = getPrevCumulative(proj.id, cat);
      const autoVal = auto[cat];
      // 수동으로 수정한 값이 있으면 사용, 없으면 자동값
      const manualKey = '_m_' + cat;
      const today = (pd[manualKey] !== undefined) ? pd[manualKey] : autoVal;
      const total = prev + today;
      const isManual = pd[manualKey] !== undefined;
      return `
        <tr>
          <td>${cat}</td>
          <td class="td-prev">${prev || ''}</td>
          <td class="td-today">
            <input type="number" min="0" value="${today}"
              title="${isManual ? '수동입력' : '자동: '+autoVal+'명'}"
              style="width:44px;text-align:center;font-family:var(--mono);font-size:12px;font-weight:700;padding:2px 3px;color:${isManual ? 'var(--accent4)' : 'var(--accent2)'};"
              onchange="setProjMP(${proj.id},'${cat}',this.value);rerenderProjTotals(${proj.id})">
            ${isManual ? '<span style="font-size:9px;color:var(--accent4);margin-left:2px;" title="자동: '+autoVal+'명">✎</span>' : '<span style="font-size:9px;color:var(--text3);margin-left:2px;">↑'+autoVal+'</span>'}
          </td>
          <td class="td-total" id="mp-total-${proj.id}-${cat.replace(/[()]/g,'')}">${total || ''}</td>
        </tr>
      `;
    }).join('');

    const prevSum = MANPOWER_CATS.reduce((s,c) => s + getPrevCumulative(proj.id,c), 0);
    const todaySum = MANPOWER_CATS.reduce((s,c) => {
      const manualKey = '_m_' + c;
      const v = (pd[manualKey] !== undefined) ? pd[manualKey] : auto[c];
      return s + (v || 0);
    }, 0);
    const totalSum = prevSum + todaySum;

    const entry = document.createElement('div');
    entry.className = 'proj-entry';
    entry.id = `proj-entry-${proj.id}`;
    entry.innerHTML = `
      <div class="proj-entry-header">
        <div>
          <div class="proj-entry-name">${proj.client}</div>
          <div class="proj-entry-code">${proj.code||'코드 미입력'}</div>
        </div>
        <button class="btn btn-ghost btn-sm" style="font-size:10px;padding:3px 7px;"
          onclick="resetToAuto(${proj.id})" title="자동집계값으로 초기화">↺ 자동</button>
      </div>
      <table class="mp-table">
        <thead>
          <tr>
            <th style="text-align:left;">직종</th>
            <th>전일누계</th>
            <th style="color:var(--accent2);">금 일</th>
            <th style="color:var(--accent);">누 계</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
          <tr>
            <td style="font-weight:700;">합 계</td>
            <td class="td-prev" style="font-weight:700;">${prevSum||''}</td>
            <td class="td-today" id="mp-todaysum-${proj.id}" style="font-weight:700;">${todaySum||''}</td>
            <td class="td-total" id="mp-totalsum-${proj.id}" style="font-weight:700;">${totalSum||''}</td>
          </tr>
        </tbody>
      </table>
    `;
    container.appendChild(entry);
  });
}

// 특정 프로젝트 합계만 재계산 (입력 시 실시간)
function rerenderProjTotals(projId) {
  const date = getDateStr();
  const pd = ((state.dailyData[date]||{}).proj||{})[projId] || {};
  const empData = (state.dailyData[date]||{}).emp || {};

  // 자동집계 재계산
  const auto = {};
  MANPOWER_CATS.forEach(c => auto[c] = 0);
  state.employees.forEach(emp => {
    const ed = empData[emp.id] || { status:'출근', projId:'' };
    if (ed.status === '휴무' || ed.status === '연차') return;
    if (String(ed.projId) !== String(projId)) return;
    const mpCat = DIV_TO_MP[emp.div];
    if (mpCat) auto[mpCat]++;
  });

  function getPrev(cat) {
    let total = 0;
    Object.entries(state.dailyData).forEach(([d, data]) => {
      if (d >= date) return;
      // 누계 계산 시엔 수동값 우선, 없으면 자동값(당시 저장 없으므로 0)
      const ppd = ((data.proj||{})[projId]||{});
      total += (ppd['_m_'+cat] !== undefined) ? ppd['_m_'+cat] : (ppd[cat] || 0);
    });
    return total;
  }

  let todaySum = 0, totalSum = 0;
  MANPOWER_CATS.forEach(cat => {
    const prev = getPrev(cat);
    const today = (pd['_m_'+cat] !== undefined) ? pd['_m_'+cat] : auto[cat];
    const total = prev + today;
    todaySum += today;
    totalSum += total;
    const totalEl = document.getElementById(`mp-total-${projId}-${cat.replace(/[()]/g,'')}`);
    if (totalEl) totalEl.textContent = total || '';
  });

  const todaySumEl = document.getElementById(`mp-todaysum-${projId}`);
  const totalSumEl = document.getElementById(`mp-totalsum-${projId}`);
  if (todaySumEl) todaySumEl.textContent = todaySum || '';
  if (totalSumEl) totalSumEl.textContent = totalSum || '';
}

// 자동집계값으로 초기화
function resetToAuto(projId) {
  const date = getDateStr();
  const empData = (state.dailyData[date] || {}).emp || {};
  const counts = {};
  MANPOWER_CATS.forEach(c => counts[c] = 0);
  state.employees.forEach(emp => {
    const ed = empData[emp.id] || { status:'출근', projId:'' };
    const isAbsent = ed.status === '휴무' || ed.status === '연차';
    if (isAbsent) return;
    if (String(ed.projId) !== String(projId)) return;
    const mpCat = DIV_TO_MP[emp.div];
    if (mpCat) counts[mpCat]++;
  });
  if (!state.dailyData[date]) state.dailyData[date] = { emp:{}, proj:{} };
  if (!state.dailyData[date].proj[projId]) state.dailyData[date].proj[projId] = {};
  // 수동 수정 키(_m_) 삭제 → 자동값으로 복원
  MANPOWER_CATS.forEach(cat => {
    delete state.dailyData[date].proj[projId]['_m_' + cat];
  });
  saveState();
  renderProjEntries((state.dailyData[date] || {}).proj || {});
}

function setProjMP(projId, cat, val) {
  const date = getDateStr();
  if (!state.dailyData[date]) state.dailyData[date] = { emp: {}, proj: {} };
  if (!state.dailyData[date].proj[projId]) state.dailyData[date].proj[projId] = {};
  // 수동 수정값은 _m_ 접두사로 별도 저장
  state.dailyData[date].proj[projId]['_m_' + cat] = parseInt(val) || 0;
  saveState();
}

function setProjNote(projId, val) {
  const date = getDateStr();
  if (!state.dailyData[date]) state.dailyData[date] = { emp: {}, proj: {} };
  if (!state.dailyData[date].proj[projId]) state.dailyData[date].proj[projId] = {};
  state.dailyData[date].proj[projId]._note = val;
  saveState();
}

function updateStats() {
  const date = getDateStr();
  const data = (state.dailyData[date] || {}).emp || {};
  
  let present=0, absent=0, overtime=0, trip=0;
  const divCount = { 제관:0, 용접:0, 보조:0, 가공:0, 구동:0, 공사:0 };

  state.employees.forEach(emp => {
    const ed = data[emp.id] || { status:'출근', overtimeHours:0, onTrip:false };
    const isAbsent = ed.status === '휴무' || ed.status === '연차';
    if (!isAbsent) {
      present++;
      const otH = ed.overtimeHours || (ed.overtime ? 2.5 : 0);
      if (otH > 0) overtime++;
      if (ed.onTrip || ed.trip) trip++;
      if (divCount[emp.div] !== undefined) divCount[emp.div]++;
    } else {
      absent++;
    }
  });

  document.getElementById('s-total').textContent = state.employees.length;
  document.getElementById('s-present').textContent = present;
  document.getElementById('s-absent').textContent = absent;
  document.getElementById('s-overtime').textContent = overtime;
  document.getElementById('s-trip').textContent = trip;
  document.getElementById('s-제관').textContent = divCount.제관;
  document.getElementById('s-용접').textContent = divCount.용접;
  document.getElementById('s-보조').textContent = divCount.보조;
  document.getElementById('s-가공').textContent = divCount.가공;
  document.getElementById('s-구동').textContent = divCount.구동;
  document.getElementById('s-공사').textContent = divCount.공사;
}

// ── 날짜 선택 복사 ──
let _copyDateTarget = 'daily'; // 'daily' or 'wo'

function showCopyDatePicker(target) {
  _copyDateTarget = target;
  // 데이터 있는 날짜 중 가장 최근 날짜를 기본값으로
  const dates = Object.keys(state.dailyData).sort();
  const modal = document.getElementById('copy-date-modal');
  const input = document.getElementById('copy-date-input');
  input.value = dates.length > 0 ? dates[dates.length - 1] : '';
  modal.style.display = 'flex';
}

function closeCopyDatePicker() {
  document.getElementById('copy-date-modal').style.display = 'none';
}

function executeCopyDate() {
  const fromDate = document.getElementById('copy-date-input').value;
  if (!fromDate) { showToast('날짜를 선택하세요.', 'error'); return; }
  if (!state.dailyData[fromDate]) { showToast(fromDate + ' 데이터가 없습니다.', 'error'); return; }

  const toDate = _copyDateTarget === 'daily' ? getDateStr() : getWoDateStr();
  if (fromDate === toDate) { showToast('같은 날짜입니다.', 'error'); return; }

  if (!confirm(fromDate + ' 데이터를 ' + toDate + '(으)로 복사하시겠습니까?')) return;

  if (_copyDateTarget === 'daily') {
    state.dailyData[toDate] = JSON.parse(JSON.stringify(state.dailyData[fromDate]));
    saveState();
    loadDailyData();
    showToast(fromDate + ' → ' + toDate + ' 복사 완료', 'success');
  } else {
    const fromData = state.dailyData[fromDate] || {};
    if (!state.dailyData[toDate]) state.dailyData[toDate] = { emp:{}, proj:{}, wo:{}, woMeta:{} };
    if (fromData.wo) state.dailyData[toDate].wo = JSON.parse(JSON.stringify(fromData.wo));
    if (fromData.woMeta) state.dailyData[toDate].woMeta = JSON.parse(JSON.stringify(fromData.woMeta));
    saveState();
    loadWoData();
    showToast(fromDate + ' → ' + toDate + ' 복사 완료', 'success');
  }
  closeCopyDatePicker();
}

async function saveDailyData() {
  saveState(); // 1차 로컬 즉시 저장

  // [N4] 저장 전 데이터 검증 (저장 차단 없음, 경고만 표시)
  const _n4date = getDateStr();
  const _n4warnings = validateDailyData(_n4date);
  highlightWarnings(_n4warnings);

  const btn = document.querySelector('button[onclick="saveDailyData()"]');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 저장 중...'; }
  showToast('서버에 저장 중...', '');
  try {
    await saveToSheet();
    showToast('저장 완료', 'success');
  } catch(e) {
    showToast('서버 저장 실패 (로컬엔 저장됨)', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✓ 저장'; }
    // [N3] 저장 후 알림 재체크
    checkAlerts();
  }
}

function copyFromPrevDay() {
  const date = getDateStr();
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  const prev = d.getFullYear() + '-' +
               String(d.getMonth() + 1).padStart(2, '0') + '-' +
               String(d.getDate()).padStart(2, '0');
  if (!state.dailyData[prev]) { showToast(prev + ' 데이터가 없습니다.', 'error'); return; }
  if (!confirm('전날(' + prev + ') 데이터를 오늘로 복사하시겠습니까? 현재 입력된 내용은 덮어씌워집니다.')) return;
  state.dailyData[date] = JSON.parse(JSON.stringify(state.dailyData[prev]));
  saveState();
  loadDailyData();
  showToast('전날 데이터 복사 완료', 'success');
}

// ══════════════════════════════════════════
//  탭4: 업무일지 출력
// ══════════════════════════════════════════

function initReportMonth() {
  const today = todayStr();
  document.getElementById('report-month').value = today.slice(0,7);
}

// 단일 날짜 업무일지 HTML 생성 (공통)
function buildReportHTML(date) {
  const d = new Date(date+'T00:00:00');
  const dow = DAYS_KO[d.getDay()];
  const yy = d.getFullYear(), mm = String(d.getMonth()+1).padStart(2,'0'), dd = String(d.getDate()).padStart(2,'0');

  const data = state.dailyData[date] || { emp:{}, proj:{} };
  const empData = data.emp || {};

  let presentCount = 0, overtimeEmps = [];
  const tripByProj = {};
  const tripNoProjEmps = [];

  state.employees.forEach(emp => {
    const ed = empData[emp.id] || { status:'출근', overtimeHours:0, projId:'', onTrip:false, work:'' };
    if (ed.status === '휴무') {}
    else if (ed.status === '연차') {}
    else if (ed.status === '반차') { presentCount++; }
    else { presentCount++; }
    const otH = ed.overtimeHours || (ed.overtime ? 2.5 : 0);
    if (otH > 0 && ed.status !== '휴무') overtimeEmps.push({ name: emp.name, hours: otH });
    const isOnTrip = ed.onTrip || ed.trip;
    if (isOnTrip && ed.status !== '휴무') {
      const pId = ed.projId || ed.trip || '';
      if (pId && !isNaN(pId)) {
        if (!tripByProj[pId]) tripByProj[pId] = [];
        tripByProj[pId].push(emp.name);
      } else {
        tripNoProjEmps.push(emp.name);
      }
    }
  });

  const empRows = state.employees.map(emp => {
    // 장기출장자 별도 표시
    if (emp.longTermTrip) {
      const locLabel = (emp.tripLocation ? emp.tripLocation + ' ' : '') + '장기출장';
      return '<tr style="background:#fff8ee;">' +
        '<td class="rp-name-cell">' + emp.id + '. ' + emp.name + '</td>' +
        '<td></td>' +
        '<td></td>' +
        '<td></td>' +
        '<td style="text-align:center;">✈</td>' +
        '<td style="text-align:left;padding-left:6px;font-size:10px;color:#c07000;font-weight:600;">' + locLabel + '</td>' +
        '</tr>';
    }
    const ed = empData[emp.id] || { status:'출근', overtimeHours:0, projId:'', onTrip:false, work:'' };
    const isAbsent = ed.status === '휴무';
    const otH = ed.overtimeHours || (ed.overtime ? 2.5 : 0);
    const proj = state.projects.find(p => String(p.id) === String(ed.projId));
    const isOnTrip = ed.onTrip || ed.trip;
    const workParts = [];
    if (proj) workParts.push('[' + proj.client + ']');
    if (ed.work) workParts.push(ed.work);
    const workLabel = workParts.join(' ');
    return '<tr>' +
      '<td class="rp-name-cell ' + (isAbsent?'rp-absent':'') + '">' + emp.id + '. ' + emp.name + (isAbsent?' (休)':'') + '</td>' +
      '<td>' + (ed.status==='반차' ? ((ed.halfDayHours || 4) + 'h') : '') + '</td>' +
      '<td>' + (ed.status==='연차'?'연차':'') + '</td>' +
      '<td>' + (otH > 0 ? otH+'h' : '') + '</td>' +
      '<td style="text-align:center;">' + (isOnTrip ? '✈' : '') + '</td>' +
      '<td style="text-align:left;padding-left:6px;font-size:10px;color:#444;">' + (isAbsent ? (ed.work||'') : workLabel) + '</td>' +
      '</tr>';
  }).join('');

  const projData = data.proj || {};

  function getPrevCum(projId, cat) {
    let total = 0;
    Object.entries(state.dailyData).forEach(([dt, dd]) => {
      if (dt >= date) return;
      const ppd = ((dd.proj||{})[projId]||{});
      // 수동값 우선, 없으면 구버전 cat 키 사용
      total += (ppd['_m_'+cat] !== undefined) ? ppd['_m_'+cat] : (ppd[cat] || 0);
    });
    return total;
  }

  // 자동집계 (해당 날짜의 직원 투입 기준)
  function calcAutoForDate(projId) {
    const counts = {};
    MANPOWER_CATS.forEach(c => counts[c] = 0);
    state.employees.forEach(emp => {
      const ed = empData[emp.id] || { status:'출근', projId:'' };
      if (ed.status === '휴무' || ed.status === '연차') return;
      if (String(ed.projId) !== String(projId)) return;
      const mpCat = DIV_TO_MP[emp.div];
      if (mpCat) counts[mpCat]++;
    });
    return counts;
  }

  const projMpRows = state.projects.map(proj => {
    const pd = projData[proj.id] || {};
    const note = pd._note || '';
    const auto = calcAutoForDate(proj.id);
    const catRows = MANPOWER_CATS.map(cat => {
      const prev = getPrevCum(proj.id, cat);
      // 수동값 우선, 없으면 자동값
      const today = (pd['_m_'+cat] !== undefined) ? pd['_m_'+cat] : auto[cat];
      const total = prev + today;
      if (prev === 0 && today === 0) return '';
      return '<tr>' +
        '<td style="background:#f8f8f8;font-size:10px;">' + cat + '</td>' +
        '<td style="font-family:monospace;font-size:10px;color:#666;">' + (prev||'-') + '</td>' +
        '<td style="font-family:monospace;font-size:10px;font-weight:700;color:#006600;">' + (today||'-') + '</td>' +
        '<td style="font-family:monospace;font-size:10px;font-weight:700;color:#000033;">' + (total||'-') + '</td>' +
        '</tr>';
    }).filter(Boolean).join('');
    if (!catRows && !note) return '';
    const prevSum = MANPOWER_CATS.reduce((s,c) => s + getPrevCum(proj.id,c), 0);
    const todaySum = MANPOWER_CATS.reduce((s,c) => {
      const v = (pd['_m_'+c] !== undefined) ? pd['_m_'+c] : auto[c];
      return s + v;
    }, 0);
    const tripNames = (tripByProj[proj.id] || []).join(', ');
    return '<tr style="background:#e8e8e8;"><td colspan="4" style="font-weight:700;font-size:11px;padding:5px 8px;">' +
      proj.client + (proj.code ? ' ('+proj.code+')' : '') +
      (tripNames ? ' — 출장: ' + tripNames : '') +
      (note ? ' / ' + note : '') +
      '</td></tr>' + catRows +
      (todaySum > 0 ? '<tr style="background:#f0f0f0;"><td style="font-weight:700;">합 계</td>' +
        '<td style="font-family:monospace;font-weight:700;">' + (prevSum||'-') + '</td>' +
        '<td style="font-family:monospace;font-weight:700;color:#006600;">' + (todaySum||'-') + '</td>' +
        '<td style="font-family:monospace;font-weight:700;">' + (prevSum+todaySum||'-') + '</td></tr>' : '');
  }).filter(Boolean).join('');

  // 장기출장자 그룹화 (출장지별)
  const longTripGroups = {};
  state.employees.filter(e => e.longTermTrip).forEach(e => {
    const loc = e.tripLocation || '미정';
    if (!longTripGroups[loc]) longTripGroups[loc] = [];
    longTripGroups[loc].push(e.name);
  });

  const tripRows = [
    ...Object.entries(tripByProj).map(([pId, names]) => {
      const proj = state.projects.find(p => String(p.id) === String(pId));
      const place = proj ? proj.client : pId;
      return '<div style="margin-bottom:3px;">출장 : ' + place + ' (' + names.length + '명) — ' + names.join(', ') + '</div>';
    }),
    ...(tripNoProjEmps.length ? ['<div style="margin-bottom:3px;">출장 : 기타 (' + tripNoProjEmps.length + '명) — ' + tripNoProjEmps.join(', ') + '</div>'] : []),
    ...Object.entries(longTripGroups).map(([loc, names]) =>
      '<div style="margin-bottom:3px;">장기출장 : ' + loc + ' (' + names.length + '명) — ' + names.join(', ') + '</div>'
    )
  ].join('');

  const otStr = overtimeEmps.length > 0 ? overtimeEmps.map(e => e.name+'('+e.hours+'h)').join(', ') : '';
  const otTimeStr = overtimeEmps.length > 0 ? '17:30 ~ 20:00' : '';

  return `
    <div class="rp-title-row">
      <div class="rp-title">업 무 일 지</div>
      <div class="rp-dept">&lt;생산부&gt;</div>
    </div>
    <div class="rp-info-row">
      <div class="rp-info-cell">▣ 날 짜 : ${yy}. ${mm}. ${dd} &nbsp;&nbsp; (${dow})</div>
      <div class="rp-info-cell">▣ 작성자 : 최 가 람</div>
      <div class="rp-info-cell">인원 현황 : 출근 ${presentCount} / ${state.employees.length} 명</div>
    </div>
    <table class="rp-table">
      <thead>
        <tr>
          <th style="width:100px;">이 름</th>
          <th style="width:40px;">반차</th>
          <th style="width:40px;">연차</th>
          <th style="width:45px;">잔업</th>
          <th style="width:40px;">출장</th>
          <th>금일 작업 내용</th>
        </tr>
      </thead>
      <tbody>${empRows}</tbody>
    </table>
    ${projMpRows ? `
    <div style="margin-top:8px;">
      <table class="rp-table">
        <thead>
          <tr>
            <th style="width:100px;">현장 / 직종</th>
            <th style="width:70px;">전일누계</th>
            <th style="width:70px;">금 일</th>
            <th style="width:70px;">누 계</th>
          </tr>
        </thead>
        <tbody>${projMpRows}</tbody>
      </table>
    </div>` : ''}
    <div class="rp-footer" style="margin-top:8px;">
      <div class="rp-footer-row">
        <div class="rp-footer-cell">작업시간</div>
        <div class="rp-footer-val">08:00 ~ 17:00</div>
        <div class="rp-footer-cell">잔업시간</div>
        <div class="rp-footer-val">${otTimeStr}${otStr ? ' (' + otStr + ')' : ''}</div>
      </div>
      <div class="rp-footer-row">
        <div class="rp-footer-cell">안전교육</div>
        <div class="rp-footer-val">07:50~08:00 전사원</div>
      </div>
      <div class="rp-footer-row">
        <div class="rp-footer-cell">특이사항</div>
        <div class="rp-footer-val ${tripRows?'red':''}">${tripRows||'—'}</div>
      </div>
    </div>
  `;
}

function renderReport() {
  const date = document.getElementById('report-date').value;
  if (!date) return;
  document.getElementById('report-preview').innerHTML = buildReportHTML(date);
}

function printMonthly() {
  const monthVal = document.getElementById('report-month').value;
  if (!monthVal) { showToast('월을 선택하세요.', 'error'); return; }

  const [year, month] = monthVal.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();

  // 해당 월의 데이터가 있는 날짜 수집
  const dates = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    if (state.dailyData[date]) dates.push(date);
  }

  if (dates.length === 0) {
    showToast(`${year}년 ${month}월 데이터가 없습니다.`, 'error');
    return;
  }

  // 날짜별 페이지 HTML 조합
  const pagesHTML = dates.map(date =>
    `<div class="report-page">${buildReportHTML(date)}</div>`
  ).join('');

  // 새 창에서 인쇄
  const monthStr = String(month).padStart(2,'0');
  const title = '㈜세종기술 생산부 업무일지 ' + year + '년 ' + monthStr + '월';
  const css = [
    '* { margin:0; padding:0; box-sizing:border-box; }',
    "body { font-family:'맑은 고딕','Malgun Gothic',sans-serif; font-size:11px; background:#fff; color:#000; }",
    '.report-page { padding:14px 18px; page-break-after:always; }',
    '.report-page:last-child { page-break-after:avoid; }',
    '.rp-title-row { display:grid; grid-template-columns:1fr auto; margin-bottom:4px; }',
    '.rp-title { font-size:24px; font-weight:900; letter-spacing:10px; text-align:center; padding:6px 0; border:2px solid #000; border-right:none; }',
    '.rp-dept { font-size:18px; font-weight:900; border:2px solid #000; padding:6px 12px; display:flex; align-items:center; }',
    '.rp-info-row { display:flex; border:2px solid #000; border-top:none; margin-bottom:4px; }',
    '.rp-info-cell { padding:5px 10px; border-right:1px solid #000; flex:1; font-weight:700; font-size:12px; }',
    '.rp-info-cell:last-child { border-right:none; }',
    '.rp-table { width:100%; border-collapse:collapse; border:2px solid #000; margin-bottom:4px; }',
    '.rp-table th, .rp-table td { border:1px solid #000; padding:3px 5px; text-align:center; font-size:10px; vertical-align:middle; }',
    '.rp-table th { background:#f0f0f0; font-weight:700; }',
    '.rp-name-cell { text-align:left; padding-left:6px; }',
    '.rp-absent { color:#c00; font-weight:700; }',
    '.rp-footer { border:2px solid #000; border-top:none; }',
    '.rp-footer-row { display:flex; border-bottom:1px solid #000; }',
    '.rp-footer-row:last-child { border-bottom:none; }',
    '.rp-footer-cell { padding:4px 8px; border-right:1px solid #000; flex:0 0 72px; font-weight:700; background:#f0f0f0; font-size:10px; }',
    '.rp-footer-val { padding:4px 8px; flex:1; font-size:10px; }',
    '.rp-footer-val.red { color:#c00; }',
    '@page { margin:10mm; size:A4 portrait; }',
    '@media print { body { -webkit-print-color-adjust:exact; print-color-adjust:exact; } }'
  ].join('\n');

  const html = '<!DOCTYPE html>\n<html lang="ko"><head>\n' +
    '<meta charset="UTF-8">\n' +
    '<title>' + title + '</title>\n' +
    '<style>\n' + css + '\n</style>\n' +
    '</head><body>\n' +
    pagesHTML + '\n' +
    '<script>window.onload = function(){ window.print(); }<\/script>\n' +
    '</body></html>';

  const win = window.open('', '_blank', 'width=900,height=800');
  win.document.write(html);
  win.document.close();
  showToast(year + '년 ' + month + '월 ' + dates.length + '일치 출력 준비 완료', 'success');
}
// ══════════════════════════════════════════
//  탭5: 월간 통계
// ══════════════════════════════════════════
function renderMonthDisplay() {
  document.getElementById('month-display').textContent =
    `${state._statsYear}년 ${String(state._statsMonth).padStart(2,'0')}월`;
}

function changeMonth(delta) {
  state._statsMonth += delta;
  if (state._statsMonth > 12) { state._statsMonth = 1; state._statsYear++; }
  if (state._statsMonth < 1) { state._statsMonth = 12; state._statsYear--; }
  renderMonthDisplay();
  renderStats();
}

/**
 * 월간 통계 탭 전체 렌더 (F1+F2 강화)
 * 서브섹션: 출근현황 / 잔업·특근 / 맨파워 배분 / 출장 현황
 */
function renderStats() {
  const year  = state._statsYear;
  const month = state._statsMonth;
  const daysInMonth = new Date(year, month, 0).getDate();

  // ── 전체 집계 변수 ──
  let dayCount      = 0;
  let totalPresent  = 0;
  let totalAbsent   = 0;  // 연차만
  let totalHoliday  = 0;  // 휴무(비근무일)
  let totalHalfDay  = 0;
  let totalHalfDayH = 0;  // 반차 시간 합계

  // 잔업
  const otByEmp = {};  // empId → { days, hours }

  // 특근
  const specialWorkDates = [];  // { date, dow, presentNames[] }

  // 출장
  const tripSummary = {};  // place → Set<name>

  // 맨파워용: empId → { workDays, projects: {projId: days}, unassigned }
  const mpByEmp = {};

  // ── 일별 순회 ──
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = year + '-' + String(month).padStart(2,'0') + '-' + String(d).padStart(2,'0');
    const data = state.dailyData[dateStr];
    if (!data) continue;

    const empData = data.emp || {};
    let dayPresent = 0, dayAbsent = 0;
    dayCount++;

    const dow = new Date(dateStr + 'T00:00:00').getDay(); // 0=일, 6=토
    const isWeekend = (dow === 0 || dow === 6);
    const isSpecialDay = isWeekend || isHoliday(dateStr); // 토·일 + 공휴일
    const specialPresentNames = [];

    state.employees.forEach(emp => {
      // [단계8] 장기출장자 집계 제외
      if (emp.longTermTrip) return;

      const ed = empData[emp.id] || { status: '출근', overtimeHours: 0, onTrip: false };

      // [단계8] 휴무(비근무일)는 집계에서 제외
      if (ed.status === '휴무') {
        totalHoliday++;
        return;
      }

      const isAbsent = ed.status === '연차';  // 연차만 결근 집계

      if (isAbsent) {
        dayAbsent++;
      } else {
        dayPresent++;
        if (ed.status === '반차') {
          totalHalfDay++;
          totalHalfDayH += (ed.halfDayHours || 4);
        }

        // 잔업 집계
        const otH = ed.overtimeHours || (ed.overtime ? 2.5 : 0);
        if (otH > 0) {
          if (!otByEmp[emp.id]) otByEmp[emp.id] = { emp, days: 0, hours: 0 };
          otByEmp[emp.id].days++;
          otByEmp[emp.id].hours += otH;
        }

        // 특근 (토·일·공휴일)
        if (isSpecialDay) specialPresentNames.push(emp.name);

        // 출장
        const isOnTrip = ed.onTrip || ed.trip;
        if (isOnTrip) {
          const proj = state.projects.find(p => String(p.id) === String(ed.projId));
          const place = proj ? proj.client : (ed.trip || '출장');
          if (!tripSummary[place]) tripSummary[place] = { empDays: {}, totalDays: 0 };
          tripSummary[place].empDays[emp.name] = (tripSummary[place].empDays[emp.name] || 0) + 1;
          tripSummary[place].totalDays++;
        }

        // 맨파워 집계
        if (!mpByEmp[emp.id]) mpByEmp[emp.id] = { emp, workDays: 0, projects: {}, unassigned: 0 };
        const workUnit = ed.status === '반차' ? 0.5 : 1;
        mpByEmp[emp.id].workDays += workUnit;
        const pId = String(ed.projId || '');
        if (pId && state.projects.find(p => String(p.id) === pId)) {
          mpByEmp[emp.id].projects[pId] = (mpByEmp[emp.id].projects[pId] || 0) + workUnit;
        } else {
          mpByEmp[emp.id].unassigned += workUnit;
        }
      }
    });

    totalPresent += dayPresent;
    totalAbsent  += dayAbsent;

    if (isSpecialDay && specialPresentNames.length > 0) {
      specialWorkDates.push({ date: dateStr, dow, names: specialPresentNames });
    }
  }

  const avgPresent    = dayCount > 0 ? (totalPresent / dayCount).toFixed(1) : 0;
  const totalOtDays   = Object.values(otByEmp).reduce((s, v) => s + v.days, 0);
  const totalOtHours  = Object.values(otByEmp).reduce((s, v) => s + v.hours, 0);
  const specialDays   = specialWorkDates.length;
  const specialManDay = specialWorkDates.reduce((s, r) => s + r.names.length, 0);

  // ── 요약 KPI 카드 ──
  const summaryEl = document.getElementById('stats-summary');
  if (summaryEl) {
    summaryEl.innerHTML =
      '<div class="stats-card"><div class="s-val" style="color:var(--accent)">' + dayCount + '</div><div class="s-lbl">입력된 일수</div></div>' +
      '<div class="stats-card"><div class="s-val" style="color:var(--green)">' + avgPresent + '</div><div class="s-lbl">평균 출근 인원</div></div>' +
      '<div class="stats-card"><div class="s-val" style="color:var(--yellow)">' + totalOtHours.toFixed(1) + 'h</div><div class="s-lbl">잔업 시간 합계</div></div>' +
      '<div class="stats-card"><div class="s-val" style="color:var(--accent4)">' + specialDays + '</div><div class="s-lbl">특근일 수</div></div>' +
      // [단계8] 연차(인·일) — 휴무와 분리
      '<div class="stats-card"><div class="s-val" style="color:var(--red)">' + totalAbsent + '</div><div class="s-lbl">연차 (인·일)</div></div>' +
      (totalHoliday > 0
        ? '<div class="stats-card"><div class="s-val" style="color:var(--text3)">' + totalHoliday + '</div><div class="s-lbl">휴무 (인·일)</div></div>'
        : '') +
      (totalHalfDay > 0
        ? '<div class="stats-card"><div class="s-val" style="color:var(--accent2)">' + totalHalfDay + '회</div><div class="s-lbl">반차 (' + totalHalfDayH + 'h)</div></div>'
        : '') +
      '<div class="stats-card"><div class="s-val" style="color:#c490ff">' + Object.keys(tripSummary).length + '</div><div class="s-lbl">출장 현장 수</div></div>';
  }

  // ── 달력 렌더 ──
  renderCalendar(year, month);

  // ── 잔업/특근 렌더 ──
  _renderOvertimeSection(otByEmp, totalOtDays, totalOtHours, specialWorkDates, specialManDay);

  // ── 맨파워 배분 렌더 ──
  _renderManpowerSection(mpByEmp);

  // ── 출장 현황 렌더 ──
  _renderTripSection(tripSummary);
}

// ── 섹션 접이식 토글 ──
/**
 * 월간 통계 서브섹션 토글
 * @param {string} sectionId - 'attendance'|'overtime'|'manpower'|'trip'
 */
function toggleStatsSection(sectionId) {
  const bodyId = 'stats-sec-' + sectionId + '-body';
  const iconId = 'stats-sec-' + sectionId + '-icon';
  const body = document.getElementById(bodyId);
  const icon = document.getElementById(iconId);
  if (!body) return;

  const isCollapsed = body.classList.contains('stats-sec-collapsed');
  if (isCollapsed) {
    body.classList.remove('stats-sec-collapsed');
    body.style.maxHeight = body.scrollHeight + 'px';
    if (icon) icon.classList.remove('collapsed');
    setTimeout(() => { body.style.maxHeight = ''; }, 300);
  } else {
    body.style.maxHeight = body.scrollHeight + 'px';
    body.offsetHeight; // eslint-disable-line
    body.classList.add('stats-sec-collapsed');
    body.style.maxHeight = '0';
    if (icon) icon.classList.add('collapsed');
  }
}

/**
 * 잔업/특근 섹션 DOM 렌더
 * @param {Object} otByEmp - empId → {emp, days, hours}
 * @param {number} totalOtDays
 * @param {number} totalOtHours
 * @param {Array}  specialWorkDates - [{date, dow, names[]}]
 * @param {number} specialManDay
 */
function _renderOvertimeSection(otByEmp, totalOtDays, totalOtHours, specialWorkDates, specialManDay) {
  // 잔업 요약 카드
  const summaryEl = document.getElementById('stats-ot-summary');
  if (summaryEl) {
    summaryEl.innerHTML =
      '<div class="stats-card"><div class="s-val" style="color:var(--yellow)">' + totalOtDays + '</div><div class="s-lbl">잔업 인·일</div></div>' +
      '<div class="stats-card"><div class="s-val" style="color:var(--yellow)">' + totalOtHours.toFixed(1) + 'h</div><div class="s-lbl">잔업 시간 합계</div></div>' +
      '<div class="stats-card"><div class="s-val" style="color:var(--accent4)">' + specialWorkDates.length + '</div><div class="s-lbl">특근일 수</div></div>' +
      '<div class="stats-card"><div class="s-val" style="color:var(--accent4)">' + specialManDay + '</div><div class="s-lbl">특근 인·일</div></div>';
  }

  // 잔업 상세 테이블
  const otTbody = document.getElementById('overtime-tbody');
  if (otTbody) {
    const rows = Object.values(otByEmp).sort((a, b) => b.hours - a.hours);
    if (rows.length === 0) {
      otTbody.innerHTML = '<tr><td colspan="4" style="color:var(--text3);text-align:center;padding:16px;">잔업 데이터 없음</td></tr>';
    } else {
      otTbody.innerHTML = rows.map(r => {
        const divInfo = DIVISIONS[r.emp.div] || { label: r.emp.div };
        return '<tr>' +
          '<td><span class="emp-name-clickable" onclick="showEmployeeDetail(' + r.emp.id + ')">' + r.emp.name + '</span></td>' +
          '<td style="color:var(--text2)">' + divInfo.label + '</td>' +
          '<td style="font-family:var(--mono);color:var(--accent4);text-align:center;">' + r.days + '일</td>' +
          '<td style="font-family:var(--mono);color:var(--yellow);text-align:center;font-weight:700;">' + r.hours.toFixed(1) + 'h</td>' +
          '</tr>';
      }).join('');
    }
  }

  // 특근 상세 테이블
  const swTbody = document.getElementById('special-work-tbody');
  if (swTbody) {
    if (specialWorkDates.length === 0) {
      swTbody.innerHTML = '<tr><td colspan="3" style="color:var(--text3);text-align:center;padding:16px;">특근 데이터 없음</td></tr>';
    } else {
      swTbody.innerHTML = specialWorkDates.map(r => {
        const d = new Date(r.date + 'T00:00:00');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const dowLabel = DAYS_KO[r.dow];
        const dowColor = r.dow === 0 ? 'var(--red)' : 'var(--accent)';
        return '<tr>' +
          '<td style="font-family:var(--mono);">' + mm + '.' + dd + '</td>' +
          '<td style="color:' + dowColor + ';font-weight:700;">' + dowLabel + '</td>' +
          '<td style="color:var(--text2);">' + r.names.join(', ') + ' <span style="color:var(--accent4);font-family:var(--mono);">(' + r.names.length + '명)</span></td>' +
          '</tr>';
      }).join('');
    }
  }
}

/**
 * 맨파워 배분 섹션 DOM 렌더 (F1)
 * @param {Object} mpByEmp - empId → {emp, workDays, projects, unassigned}
 */
function _renderManpowerSection(mpByEmp) {
  // 사용된 프로젝트 목록 (투입 있는 것만)
  const usedProjIds = new Set();
  Object.values(mpByEmp).forEach(d => {
    Object.keys(d.projects).forEach(pid => usedProjIds.add(pid));
  });
  const usedProjs = state.projects.filter(p => usedProjIds.has(String(p.id)));

  // ── 인원별 맨파워 배분 테이블 ──
  const thead = document.getElementById('manpower-emp-thead');
  const tbody = document.getElementById('manpower-emp-tbody');
  if (!thead || !tbody) return;

  // 헤더 행
  let hRow = '<tr><th>이름</th><th>직종</th><th>출근일수</th>';
  usedProjs.forEach(p => { hRow += '<th style="max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + p.client + '">' + p.client + '</th>'; });
  hRow += '<th>미배정</th></tr>';
  thead.innerHTML = hRow;

  if (Object.keys(mpByEmp).length === 0) {
    tbody.innerHTML = '<tr><td colspan="' + (4 + usedProjs.length) + '" style="color:var(--text3);text-align:center;padding:20px;">이 달의 데이터가 없습니다.</td></tr>';
  } else {
    tbody.innerHTML = Object.values(mpByEmp)
      .sort((a, b) => a.emp.div.localeCompare(b.emp.div) || a.emp.name.localeCompare(b.emp.name))
      .map(d => {
        const divInfo = DIVISIONS[d.emp.div] || { label: d.emp.div, cls: '' };
        const wd = d.workDays;
        let row = '<tr>' +
          '<td><span class="emp-name-clickable" onclick="showEmployeeDetail(' + d.emp.id + ')">' + d.emp.name + '</span></td>' +
          '<td><span class="div-badge ' + divInfo.cls + '" style="font-size:10px;">' + divInfo.label + '</span></td>' +
          '<td style="font-family:var(--mono);font-weight:700;text-align:center;">' + wd + '</td>';

        usedProjs.forEach(p => {
          const days = d.projects[String(p.id)] || 0;
          const pct  = wd > 0 ? Math.round(days / wd * 100) : 0;
          row += '<td style="text-align:center;">' +
            (days > 0
              ? '<span style="font-family:var(--mono);color:var(--accent4);">' + days + 'd</span>' +
                '<span style="font-size:10px;color:var(--text3);"> (' + pct + '%)</span>'
              : '<span style="color:var(--text3);">—</span>') +
            '</td>';
        });

        const uPct = wd > 0 ? Math.round(d.unassigned / wd * 100) : 0;
        row += '<td style="text-align:center;">' +
          (d.unassigned > 0
            ? '<span style="font-family:var(--mono);color:var(--text3);">' + d.unassigned + 'd (' + uPct + '%)</span>'
            : '<span style="color:var(--text3);">—</span>') +
          '</td></tr>';
        return row;
      }).join('');
  }

  // ── 프로젝트별 직종 투입 요약 테이블 ──
  const pThead = document.getElementById('manpower-proj-thead');
  const pTbody = document.getElementById('manpower-proj-tbody');
  if (!pThead || !pTbody) return;

  const mpCats = ['제관사', '용접사', '보조사', '가공', '구동부'];
  let phRow = '<tr><th>프로젝트</th>';
  mpCats.forEach(cat => { phRow += '<th>' + cat + '</th>'; });
  phRow += '<th>합계(인·일)</th></tr>';
  pThead.innerHTML = phRow;

  if (usedProjs.length === 0) {
    pTbody.innerHTML = '<tr><td colspan="' + (2 + mpCats.length) + '" style="color:var(--text3);text-align:center;padding:20px;">데이터 없음</td></tr>';
  } else {
    pTbody.innerHTML = usedProjs.map(proj => {
      const catDays = {};
      mpCats.forEach(cat => { catDays[cat] = 0; });
      let totalDays = 0;

      Object.values(mpByEmp).forEach(d => {
        const days = d.projects[String(proj.id)] || 0;
        if (days === 0) return;
        const cat = DIV_TO_MP[d.emp.div];
        if (cat && catDays[cat] !== undefined) catDays[cat] += days;
        totalDays += days;
      });

      let row = '<tr><td style="font-weight:700;">' + proj.client + (proj.code ? ' <span style="font-size:10px;color:var(--text3);">(' + proj.code + ')</span>' : '') + '</td>';
      mpCats.forEach(cat => {
        row += '<td style="font-family:var(--mono);text-align:center;color:var(--accent4);">' +
          (catDays[cat] > 0 ? catDays[cat] : '—') + '</td>';
      });
      row += '<td style="font-family:var(--mono);font-weight:700;text-align:center;color:var(--green);">' + totalDays + '</td></tr>';
      return row;
    }).join('');
  }
}

/**
 * 출장 현황 섹션 DOM 렌더
 * @param {Object} tripSummary - place → Set<name>
 */
function _renderTripSection(tripSummary) {
  const tripTbody = document.getElementById('trip-tbody');
  if (!tripTbody) return;

  if (Object.keys(tripSummary).length === 0) {
    tripTbody.innerHTML = '<tr><td colspan="3" style="color:var(--text3);text-align:center;padding:20px;">이 달의 출장 데이터가 없습니다.</td></tr>';
    return;
  }

  tripTbody.innerHTML = Object.entries(tripSummary)
    .sort((a, b) => b[1].totalDays - a[1].totalDays)
    .map(([place, { empDays, totalDays }]) =>
      '<tr>' +
      '<td><strong>' + place + '</strong></td>' +
      '<td style="color:var(--accent);font-family:var(--mono);font-weight:700;text-align:center;">' + Object.keys(empDays).length + '명</td>' +
      '<td style="color:var(--yellow);font-family:var(--mono);font-weight:700;text-align:center;">' + totalDays + '일</td>' +
      '<td style="color:var(--text2)">' + Object.entries(empDays).map(([n, d]) => n + '(' + d + '일)').join(', ') + '</td>' +
      '</tr>'
    ).join('');
}

/**
 * 월간 통계 PDF 출력 (4개 섹션 포함)
 */
function printMonthlyStats() {
  const year  = state._statsYear;
  const month = state._statsMonth;
  const daysInMonth = new Date(year, month, 0).getDate();
  const ym = year + '년 ' + String(month).padStart(2, '0') + '월';

  // ── 데이터 재계산 (renderStats와 동일 로직) ──
  let dayCount = 0, totalPresent = 0, totalAbsent = 0, totalHalfDay = 0, totalHalfDayH = 0;
  const otByEmp = {};
  const specialWorkDates = [];
  const tripSummary = {};
  const mpByEmp = {};

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = year + '-' + String(month).padStart(2,'0') + '-' + String(d).padStart(2,'0');
    const data = state.dailyData[dateStr];
    if (!data) continue;
    const empData = data.emp || {};
    let dayPresent = 0;
    dayCount++;
    const dow = new Date(dateStr + 'T00:00:00').getDay();
    const isWeekend = (dow === 0 || dow === 6);
    const isSpecialDay = isWeekend || isHoliday(dateStr); // 토·일 + 공휴일
    const specialNames = [];

    state.employees.forEach(emp => {
      // [단계8] 장기출장자 집계 제외
      if (emp.longTermTrip) return;
      const ed = empData[emp.id] || { status: '출근', overtimeHours: 0 };
      // [단계8] 휴무는 비근무일 — 집계 미포함
      if (ed.status === '휴무') return;
      if (ed.status === '연차') { totalAbsent++; return; }
      dayPresent++;
      if (ed.status === '반차') { totalHalfDay++; totalHalfDayH += (ed.halfDayHours || 4); }

      const otH = ed.overtimeHours || (ed.overtime ? 2.5 : 0);
      if (otH > 0) {
        if (!otByEmp[emp.id]) otByEmp[emp.id] = { emp, days: 0, hours: 0 };
        otByEmp[emp.id].days++;
        otByEmp[emp.id].hours += otH;
      }
      if (isSpecialDay) specialNames.push(emp.name);

      const isOnTrip = ed.onTrip || ed.trip;
      if (isOnTrip) {
        const proj = state.projects.find(p => String(p.id) === String(ed.projId));
        const place = proj ? proj.client : (ed.trip || '출장');
        if (!tripSummary[place]) tripSummary[place] = { empDays: {}, totalDays: 0 };
        tripSummary[place].empDays[emp.name] = (tripSummary[place].empDays[emp.name] || 0) + 1;
        tripSummary[place].totalDays++;
      }

      if (!mpByEmp[emp.id]) mpByEmp[emp.id] = { emp, workDays: 0, projects: {}, unassigned: 0 };
      const workUnit = ed.status === '반차' ? 0.5 : 1;
      mpByEmp[emp.id].workDays += workUnit;
      const pId = String(ed.projId || '');
      if (pId && state.projects.find(p => String(p.id) === pId)) {
        mpByEmp[emp.id].projects[pId] = (mpByEmp[emp.id].projects[pId] || 0) + workUnit;
      } else {
        mpByEmp[emp.id].unassigned += workUnit;
      }
    });

    totalPresent += dayPresent;
    if (isSpecialDay && specialNames.length > 0) {
      specialWorkDates.push({ date: dateStr, dow, names: specialNames });
    }
  }

  const avgPresent   = dayCount > 0 ? (totalPresent / dayCount).toFixed(1) : 0;
  const totalOtHours = Object.values(otByEmp).reduce((s, v) => s + v.hours, 0);
  const totalOtDays  = Object.values(otByEmp).reduce((s, v) => s + v.days, 0);
  const usedProjIds  = new Set();
  Object.values(mpByEmp).forEach(d => Object.keys(d.projects).forEach(id => usedProjIds.add(id)));
  const usedProjs    = state.projects.filter(p => usedProjIds.has(String(p.id)));

  // ── 잔업 HTML ──
  const otRows = Object.values(otByEmp).sort((a, b) => b.hours - a.hours).map(r => {
    const divInfo = DIVISIONS[r.emp.div] || { label: r.emp.div };
    return '<tr><td>' + r.emp.name + '</td><td>' + divInfo.label + '</td>' +
      '<td style="text-align:center;">' + r.days + '일</td>' +
      '<td style="text-align:center;font-weight:700;">' + r.hours.toFixed(1) + 'h</td></tr>';
  }).join('') || '<tr><td colspan="4" style="text-align:center;color:#999;">잔업 데이터 없음</td></tr>';

  // ── 특근 HTML ──
  const swRows = specialWorkDates.map(r => {
    const d = new Date(r.date + 'T00:00:00');
    const mmdd = String(d.getMonth()+1).padStart(2,'0') + '.' + String(d.getDate()).padStart(2,'0');
    return '<tr><td style="text-align:center;">' + mmdd + '</td>' +
      '<td style="text-align:center;">' + DAYS_KO[r.dow] + '</td>' +
      '<td>' + r.names.join(', ') + ' (' + r.names.length + '명)</td></tr>';
  }).join('') || '<tr><td colspan="3" style="text-align:center;color:#999;">특근 데이터 없음</td></tr>';

  // ── 맨파워 HTML ──
  const mpCats = ['제관사', '용접사', '보조사', '가공', '구동부'];
  const mpHeader = '<tr><th>이름</th><th>직종</th><th>출근일수</th>' +
    usedProjs.map(p => '<th>' + p.client + '</th>').join('') + '<th>미배정</th></tr>';
  const mpRows = Object.values(mpByEmp).map(d => {
    const divInfo = DIVISIONS[d.emp.div] || { label: d.emp.div };
    let row = '<tr><td>' + d.emp.name + '</td><td>' + divInfo.label + '</td>' +
      '<td style="text-align:center;">' + d.workDays + '</td>';
    usedProjs.forEach(p => {
      const days = d.projects[String(p.id)] || 0;
      const pct  = d.workDays > 0 ? Math.round(days / d.workDays * 100) : 0;
      row += '<td style="text-align:center;">' + (days > 0 ? days + 'd (' + pct + '%)' : '—') + '</td>';
    });
    const uPct = d.workDays > 0 ? Math.round(d.unassigned / d.workDays * 100) : 0;
    row += '<td style="text-align:center;">' + (d.unassigned > 0 ? d.unassigned + 'd (' + uPct + '%)' : '—') + '</td></tr>';
    return row;
  }).join('') || '<tr><td colspan="' + (4 + usedProjs.length) + '">데이터 없음</td></tr>';

  // ── 프로젝트별 직종 투입 요약 HTML ──
  const mpCats2 = ['제관사', '용접사', '보조사', '가공', '구동부'];
  const CHART_COLORS = ['#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f','#edc948','#b07aa1','#ff9da7','#9c755f','#bab0ac'];

  const projChartData = usedProjs.map((proj, i) => {
    const catDays = {};
    mpCats2.forEach(cat => { catDays[cat] = 0; });
    let totalDays = 0;
    Object.values(mpByEmp).forEach(d => {
      const days = d.projects[String(proj.id)] || 0;
      if (days === 0) return;
      const cat = DIV_TO_MP[d.emp.div];
      if (cat && catDays[cat] !== undefined) catDays[cat] += days;
      totalDays += days;
    });
    return { name: proj.client, code: proj.code, totalDays, catDays, color: CHART_COLORS[i % CHART_COLORS.length] };
  });

  const grandTotal = projChartData.reduce((s, p) => s + p.totalDays, 0);

  const projSumHeader = '<tr><th>프로젝트</th>' + mpCats2.map(c => '<th>' + c + '</th>').join('') + '<th>합계(일)</th></tr>';
  const projSumRows = projChartData.length === 0
    ? '<tr><td colspan="' + (2 + mpCats2.length) + '" style="text-align:center;color:#999;">데이터 없음</td></tr>'
    : projChartData.map(({ name, code, totalDays, catDays, color }) => {
        const pct = grandTotal > 0 ? Math.round(totalDays / grandTotal * 100) : 0;
        let row = '<tr><td style="font-weight:700;"><span style="display:inline-block;width:10px;height:10px;background:' + color + ';border-radius:2px;margin-right:5px;vertical-align:middle;"></span>' + name + (code ? ' (' + code + ')' : '') + '</td>';
        mpCats2.forEach(cat => {
          row += '<td style="text-align:center;">' + (catDays[cat] > 0 ? catDays[cat] : '—') + '</td>';
        });
        row += '<td style="text-align:center;font-weight:700;">' + totalDays + (grandTotal > 0 ? ' (' + pct + '%)' : '') + '</td></tr>';
        return row;
      }).join('');

  // ── 파이 차트 SVG ──
  let pieSVG = '';
  let pieLegend = '';
  if (grandTotal > 0) {
    const cx = 180, cy = 180, r = 160;
    let angle = -Math.PI / 2;
    let svgPaths = '';
    projChartData.forEach(item => {
      if (item.totalDays === 0) return;
      const pct = item.totalDays / grandTotal;
      const sa = angle;
      angle += pct * 2 * Math.PI;
      const ea = angle;
      const x1 = (cx + r * Math.cos(sa)).toFixed(2);
      const y1 = (cy + r * Math.sin(sa)).toFixed(2);
      const x2 = (cx + r * Math.cos(ea)).toFixed(2);
      const y2 = (cy + r * Math.sin(ea)).toFixed(2);
      const large = pct > 0.5 ? 1 : 0;
      svgPaths += '<path d="M' + cx + ',' + cy + ' L' + x1 + ',' + y1 + ' A' + r + ',' + r + ' 0 ' + large + ',1 ' + x2 + ',' + y2 + ' Z" fill="' + item.color + '" stroke="white" stroke-width="2"/>';
      if (pct > 0.05) {
        const ma = sa + pct * Math.PI;
        const lx = (cx + r * 0.65 * Math.cos(ma)).toFixed(1);
        const ly = parseFloat((cy + r * 0.65 * Math.sin(ma)).toFixed(1));
        const shortName = item.name.length > 7 ? item.name.slice(0, 6) + '…' : item.name;
        svgPaths += '<text text-anchor="middle" fill="white" font-weight="bold">' +
          '<tspan x="' + lx + '" y="' + (ly - 8) + '" font-size="11">' + shortName + '</tspan>' +
          '<tspan x="' + lx + '" dy="16" font-size="13">' + Math.round(pct * 100) + '%</tspan>' +
          '</text>';
      }
      pieLegend += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">' +
        '<span style="width:12px;height:12px;background:' + item.color + ';display:inline-block;border-radius:2px;flex-shrink:0;"></span>' +
        '<span style="font-size:8.5pt;">' + item.name + (item.code ? ' (' + item.code + ')' : '') + ': <strong>' + item.totalDays + '일</strong> (' + Math.round(pct * 100) + '%)</span>' +
        '</div>';
    });
    pieSVG = '<svg width="360" height="360" xmlns="http://www.w3.org/2000/svg">' + svgPaths + '</svg>';
  } else {
    pieSVG = '<p style="color:#999;text-align:center;padding:60px 0;">데이터 없음</p>';
  }

  const pieChartHtml =
    '<div style="display:flex;align-items:center;gap:28px;flex-wrap:wrap;margin-bottom:12px;">' +
    pieSVG +
    '<div>' + pieLegend + '<div style="margin-top:10px;padding-top:8px;border-top:1px solid #ddd;font-size:9pt;color:#333;">전체 합계: <strong>' + grandTotal + '일</strong></div></div>' +
    '</div>';

  // ── 출장 HTML ──
  const tripRows = Object.entries(tripSummary).sort((a, b) => b[1].totalDays - a[1].totalDays)
    .map(([place, { empDays, totalDays }]) =>
      '<tr><td><strong>' + place + '</strong></td>' +
      '<td style="text-align:center;">' + Object.keys(empDays).length + '명</td>' +
      '<td style="text-align:center;font-weight:700;">' + totalDays + '일</td>' +
      '<td>' + Object.entries(empDays).map(([n, d]) => n + '(' + d + '일)').join(', ') + '</td></tr>'
    ).join('') || '<tr><td colspan="4" style="text-align:center;color:#999;">출장 데이터 없음</td></tr>';

  const css = [
    '* { margin:0; padding:0; box-sizing:border-box; }',
    "body { font-family:'맑은 고딕','Malgun Gothic','나눔고딕',sans-serif; font-size:10pt; color:#111; background:#fff; padding:15px 20px; }",
    'h1 { font-size:18pt; font-weight:900; text-align:center; margin-bottom:4px; }',
    '.subtitle { text-align:center; color:#555; margin-bottom:16px; font-size:10pt; }',
    'h2 { font-size:12pt; font-weight:700; margin:18px 0 8px; padding:4px 8px; background:#f0f0f0; border-left:4px solid #333; }',
    '.summary-grid { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:12px; }',
    '.s-card { border:1px solid #ddd; border-radius:4px; padding:8px 14px; text-align:center; }',
    '.s-val { font-size:18pt; font-weight:900; }',
    '.s-lbl { font-size:8pt; color:#555; }',
    'table { width:100%; border-collapse:collapse; margin-bottom:12px; font-size:9pt; }',
    'th { background:#333; color:#fff; padding:5px 8px; text-align:center; }',
    'td { padding:4px 8px; border:1px solid #ccc; vertical-align:middle; }',
    'tr { break-inside:avoid; page-break-inside:avoid; }',
    'tr:nth-child(even) td { background:#f8f8f8; }',
    '.section { break-inside:avoid; page-break-inside:avoid; }',
    '.pie-wrap { break-inside:avoid; page-break-inside:avoid; }',
    'h2 { break-after:avoid; page-break-after:avoid; }',
    '@page { margin:12mm; size:A4 portrait; }',
    '@media print { body { -webkit-print-color-adjust:exact; print-color-adjust:exact; } }'
  ].join('\n');

  const html = '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">' +
    '<title>월간 통계 ' + ym + '</title>' +
    '<style>' + css + '</style></head><body>' +
    '<h1>월간 통계 보고서</h1>' +
    '<div class="subtitle">㈜세종기술 생산부 · ' + ym + ' · 작성: ' + new Date().toLocaleDateString('ko-KR') + '</div>' +
    '<div class="summary-grid">' +
      '<div class="s-card"><div class="s-val">' + dayCount + '</div><div class="s-lbl">입력일수</div></div>' +
      '<div class="s-card"><div class="s-val">' + avgPresent + '</div><div class="s-lbl">평균출근</div></div>' +
      '<div class="s-card"><div class="s-val">' + totalOtHours.toFixed(1) + 'h</div><div class="s-lbl">잔업합계</div></div>' +
      '<div class="s-card"><div class="s-val">' + specialWorkDates.length + '</div><div class="s-lbl">특근일수</div></div>' +
      '<div class="s-card"><div class="s-val">' + totalAbsent + '</div><div class="s-lbl">결근·연차</div></div>' +
      (totalHalfDay > 0 ? '<div class="s-card"><div class="s-val">' + totalHalfDay + '회</div><div class="s-lbl">반차(' + totalHalfDayH + 'h)</div></div>' : '') +
    '</div>' +
    '<div class="section pie-wrap"><h2>프로젝트별 투입 비율</h2>' +
    pieChartHtml + '</div>' +
    '<div class="section"><h2>프로젝트별 직종 투입 요약</h2>' +
    '<table><thead>' + projSumHeader + '</thead><tbody>' + projSumRows + '</tbody></table></div>' +
    '<div class="section"><h2>잔업 현황</h2>' +
    '<table><thead><tr><th>이름</th><th>직종</th><th>일수</th><th>시간</th></tr></thead><tbody>' + otRows + '</tbody></table></div>' +
    '<div class="section"><h2>특근 현황 (토·일)</h2>' +
    '<table><thead><tr><th>날짜</th><th>요일</th><th>출근 인원</th></tr></thead><tbody>' + swRows + '</tbody></table></div>' +
    '<div class="section"><h2>출장 현황</h2>' +
    '<table><thead><tr><th>현장</th><th>인원</th><th>맨데이</th><th>직원명</th></tr></thead><tbody>' + tripRows + '</tbody></table></div>' +
    '<script>window.onload=function(){window.print();}<\/script>' +
    '</body></html>';

  const win = window.open('', '_blank', 'width=900,height=800');
  if (!win) { showToast('팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요.', 'error'); return; }
  win.document.write(html);
  win.document.close();
}

/**
 * 월간 통계 엑셀(.xlsx) 내보내기 (N5)
 * 4개 시트: 출근현황, 잔업_특근, 맨파워배분, 출장현황
 */
function exportMonthlyExcel() {
  if (typeof XLSX === 'undefined') {
    showToast('엑셀 기능을 사용할 수 없습니다. SheetJS 라이브러리를 확인하세요.', 'error');
    return;
  }

  const year  = state._statsYear;
  const month = state._statsMonth;
  const daysInMonth = new Date(year, month, 0).getDate();
  const ym    = year + '년' + String(month).padStart(2,'0') + '월';

  // ── 데이터 재계산 ──
  const otByEmp          = {};
  const specialWorkDates = [];
  const tripSummary      = {};
  const mpByEmp          = {};
  const attendanceRows   = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = year + '-' + String(month).padStart(2,'0') + '-' + String(d).padStart(2,'0');
    const data = state.dailyData[dateStr];
    const dow  = new Date(dateStr + 'T00:00:00').getDay();
    const isWeekend = (dow === 0 || dow === 6);
    const isSpecialDay = isWeekend || isHoliday(dateStr); // 토·일 + 공휴일
    const specialNames = [];

    if (!data) {
      // 빈 날은 헤더 행만 추가 안 함
    } else {
      const empData = data.emp || {};
      state.employees.forEach(emp => {
        // [단계8] 장기출장자 집계 제외
        if (emp.longTermTrip) return;
        const ed = empData[emp.id] || { status: '출근', overtimeHours: 0 };
        const divInfo = DIVISIONS[emp.div] || { label: emp.div };
        attendanceRows.push({
          날짜: dateStr,
          요일: DAYS_KO[dow],
          이름: emp.name,
          직종: divInfo.label,
          출근상태: ed.status || '출근',
          반차시간: ed.status === '반차' ? (ed.halfDayHours || 4) : '',
          잔업시간: ed.overtimeHours || '',
          출장여부: ed.onTrip ? 'Y' : '',
          프로젝트: (state.projects.find(p => String(p.id) === String(ed.projId || '')) || {}).client || ''
        });

        // [단계8] 휴무는 집계 미포함
        if (ed.status === '휴무' || ed.status === '연차') return;

        const otH = ed.overtimeHours || (ed.overtime ? 2.5 : 0);
        if (otH > 0) {
          if (!otByEmp[emp.id]) otByEmp[emp.id] = { emp, days: 0, hours: 0 };
          otByEmp[emp.id].days++;
          otByEmp[emp.id].hours += otH;
        }
        if (isSpecialDay) specialNames.push(emp.name);

        const isOnTrip = ed.onTrip || ed.trip;
        if (isOnTrip) {
          const proj = state.projects.find(p => String(p.id) === String(ed.projId));
          const place = proj ? proj.client : (ed.trip || '출장');
          if (!tripSummary[place]) tripSummary[place] = { empDays: {}, totalDays: 0 };
          tripSummary[place].empDays[emp.name] = (tripSummary[place].empDays[emp.name] || 0) + 1;
          tripSummary[place].totalDays++;
        }

        if (!mpByEmp[emp.id]) mpByEmp[emp.id] = { emp, workDays: 0, projects: {}, unassigned: 0 };
        const wu = ed.status === '반차' ? 0.5 : 1;
        mpByEmp[emp.id].workDays += wu;
        const pId = String(ed.projId || '');
        if (pId && state.projects.find(p => String(p.id) === pId)) {
          mpByEmp[emp.id].projects[pId] = (mpByEmp[emp.id].projects[pId] || 0) + wu;
        } else {
          mpByEmp[emp.id].unassigned += wu;
        }
      });
      if (isSpecialDay && specialNames.length > 0) {
        specialWorkDates.push({ date: dateStr, dow, names: specialNames });
      }
    }
  }

  const usedProjIds = new Set();
  Object.values(mpByEmp).forEach(d => Object.keys(d.projects).forEach(id => usedProjIds.add(id)));
  const usedProjs = state.projects.filter(p => usedProjIds.has(String(p.id)));

  try {
    const wb = XLSX.utils.book_new();

    // ── 시트1: 출근현황 ──
    const ws1 = XLSX.utils.json_to_sheet(attendanceRows);
    XLSX.utils.book_append_sheet(wb, ws1, '출근현황');

    // ── 시트2: 잔업_특근 ──
    const otRows2 = Object.values(otByEmp).sort((a, b) => b.hours - a.hours).map(r => {
      const divInfo = DIVISIONS[r.emp.div] || { label: r.emp.div };
      return { 이름: r.emp.name, 직종: divInfo.label, 잔업일수: r.days, '잔업시간(h)': r.hours };
    });
    const swRows2 = specialWorkDates.map(r => {
      const d = new Date(r.date + 'T00:00:00');
      return {
        날짜: r.date,
        요일: DAYS_KO[r.dow],
        출근인원수: r.names.length,
        출근자명단: r.names.join(', ')
      };
    });

    if (otRows2.length === 0) otRows2.push({ 이름: '데이터 없음', 직종: '', 잔업일수: '', '잔업시간(h)': '' });
    if (swRows2.length === 0) swRows2.push({ 날짜: '데이터 없음', 요일: '', 출근인원수: '', 출근자명단: '' });

    const otSheet = XLSX.utils.aoa_to_sheet([['[잔업 현황]']]);
    XLSX.utils.sheet_add_json(otSheet, otRows2, { origin: 'A2' });
    const swStart = otRows2.length + 4;
    XLSX.utils.sheet_add_aoa(otSheet, [['[특근 현황 (토·일)]']], { origin: 'A' + swStart });
    XLSX.utils.sheet_add_json(otSheet, swRows2, { origin: 'A' + (swStart + 1) });
    XLSX.utils.book_append_sheet(wb, otSheet, '잔업_특근');

    // ── 시트3: 맨파워배분 ──
    const mpHeaderRow = ['이름', '직종', '출근일수', ...usedProjs.map(p => p.client), '미배정'];
    const mpDataRows = Object.values(mpByEmp).map(d => {
      const divInfo = DIVISIONS[d.emp.div] || { label: d.emp.div };
      const row = [d.emp.name, divInfo.label, d.workDays];
      usedProjs.forEach(p => {
        const days = d.projects[String(p.id)] || 0;
        const pct  = d.workDays > 0 ? Math.round(days / d.workDays * 100) : 0;
        row.push(days > 0 ? days + 'd (' + pct + '%)' : '');
      });
      const uPct = d.workDays > 0 ? Math.round(d.unassigned / d.workDays * 100) : 0;
      row.push(d.unassigned > 0 ? d.unassigned + 'd (' + uPct + '%)' : '');
      return row;
    });
    const ws3 = XLSX.utils.aoa_to_sheet([mpHeaderRow, ...mpDataRows]);
    XLSX.utils.book_append_sheet(wb, ws3, '맨파워배분');

    // ── 시트4: 출장현황 ──
    const tripRows2 = Object.entries(tripSummary).sort((a, b) => b[1].totalDays - a[1].totalDays).map(([place, { empDays, totalDays }]) => ({
      현장: place,
      인원수: Object.keys(empDays).length,
      맨데이: totalDays,
      직원명단: Object.entries(empDays).map(([n, d]) => n + '(' + d + '일)').join(', ')
    }));
    if (tripRows2.length === 0) tripRows2.push({ 현장: '데이터 없음', 인원수: '', 직원명단: '' });
    const ws4 = XLSX.utils.json_to_sheet(tripRows2);
    XLSX.utils.book_append_sheet(wb, ws4, '출장현황');

    XLSX.writeFile(wb, '세종기술_월간통계_' + year + '년' + String(month).padStart(2,'0') + '월.xlsx');
    showToast('엑셀 다운로드 완료', 'success');

  } catch (err) {
    showToast('엑셀 내보내기 오류: ' + err.message, 'error');
    // CSV 폴백 제공
    if (attendanceRows.length > 0) {
      const headers = Object.keys(attendanceRows[0]).join(',');
      const rows    = attendanceRows.map(r => Object.values(r).map(v => '"' + String(v).replace(/"/g,'""') + '"').join(','));
      const csv     = [headers, ...rows].join('\n');
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = '세종기술_출근현황_' + ym + '.csv'; a.click();
      showToast('CSV로 대체 다운로드했습니다.', 'warn');
    }
  }
}

function renderCalendar(year, month) {
  const grid = document.getElementById('cal-grid');
  grid.innerHTML = '';
  
  // 헤더
  ['일','월','화','수','목','금','토'].forEach((d,i) => {
    const h = document.createElement('div');
    h.className = 'cal-header' + (i===0?' sun': i===6?' sat':'');
    h.textContent = d;
    grid.appendChild(h);
  });
  
  const firstDay = new Date(year, month-1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const today = todayStr();
  
  // 빈 칸
  for (let i=0; i<firstDay; i++) {
    const cell = document.createElement('div');
    cell.className = 'cal-cell empty';
    grid.appendChild(cell);
  }
  
  for (let d=1; d<=daysInMonth; d++) {
    const date = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const data = state.dailyData[date];
    const dow = new Date(date+'T00:00:00').getDay();
    
    let present = 0, absent = 0;
    if (data) {
      const empData = data.emp || {};
      state.employees.forEach(emp => {
        const ed = empData[emp.id] || { status:'출근' };
        if (ed.status === '휴무' || ed.status === '연차') absent++;
        else present++;
      });
    }
    
    const cell = document.createElement('div');
    cell.className = 'cal-cell' + (data?' has-data':'') + (date===today?' today':'');
    cell.onclick = () => {
      document.getElementById('daily-date').value = date;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      document.querySelector('[data-tab=daily]').classList.add('active');
      document.getElementById('tab-daily').classList.add('active');
      loadDailyData();
    };
    cell.innerHTML = `
      <div class="cal-day ${dow===0?'sun':dow===6?'sat':''}">${d}</div>
      ${data ? `<div class="cal-count">${present}명 출근</div>` : ''}
      ${absent > 0 ? `<div class="cal-absent">휴${absent}</div>` : ''}
    `;
    grid.appendChild(cell);
  }
}

// ══════════════════════════════════════════
//  워크오더
// ══════════════════════════════════════════
function getWoDateStr() {
  return document.getElementById('wo-date').value;
}

function changeWoDate(delta) {
  const d = new Date(getWoDateStr()+'T00:00:00');
  d.setDate(d.getDate() + delta);
  document.getElementById('wo-date').value = d.toISOString().slice(0,10);
  loadWoData();
}

function saveWoSupervisor(val) {
  localStorage.setItem('wo_supervisor', val);
}

// 워크오더 자동 제외 직종
const WO_EXCLUDE_DIV = ['관리', '가공', '구동'];

function isWoExcluded(emp, woData, date) {
  const wd = woData[emp.id] || {};
  // [B1 FIX] 수동 해제 오버라이드 최우선: 체크 해제한 경우 자동제외보다 우선
  if (wd.manualOverride === true && wd.excluded === false) return false;
  // 직종 자동 제외
  if (WO_EXCLUDE_DIV.includes(emp.div)) return true;
  // 출장자 제외 (일일 입력 데이터 기준)
  const empData = (state.dailyData[date] || {}).emp || {};
  const ed = empData[emp.id] || {};
  if (ed.onTrip || ed.trip) return true;
  // 개인별 수동 제외 체크
  if (wd.excluded) return true;
  return false;
}

function loadWoData() {
  const date = getWoDateStr();
  const d = new Date(date+'T00:00:00');
  const dow = DAYS_KO[d.getDay()];
  const yy = d.getFullYear(), mm = String(d.getMonth()+1).padStart(2,'0'), dd = String(d.getDate()).padStart(2,'0');
  document.getElementById('wo-day-label').textContent = yy+'.'+mm+'.'+dd+' ('+dow+'요일) 작업 지시';

  const supervisor = localStorage.getItem('wo_supervisor') || '권오근 부장';
  document.getElementById('wo-supervisor').value = supervisor;

  const woData = (state.dailyData[date] || {}).wo || {};
  const container = document.getElementById('wo-proj-blocks');
  container.innerHTML = '';

  // 프로젝트별로 직원 묶기 (제외 대상 제거)
  const projGroups = {};
  const unassigned = []; // 제외 안된 + 프로젝트 미배정

  state.employees.forEach(emp => {
    const wd = woData[emp.id] || {};
    const pId = String(wd.projId || '');
    const excluded = isWoExcluded(emp, woData, date);
    // 제외된 직원은 미배정 블록에만 표시 (제외 해제 가능하도록)
    if (excluded) { unassigned.push({ emp, excluded: true }); return; }
    if (pId && state.projects.find(p => String(p.id) === pId)) {
      if (!projGroups[pId]) projGroups[pId] = [];
      projGroups[pId].push(emp);
    } else {
      unassigned.push({ emp, excluded: false });
    }
  });

  // 프로젝트 블록 렌더
  state.projects.forEach(proj => {
    const emps = projGroups[String(proj.id)] || [];
    renderWoProjBlock(container, proj, emps, woData, date, false);
  });

  // 미배정/제외 블록
  renderWoUnassignedBlock(container, unassigned, woData, date);
}

function renderWoProjBlock(container, proj, emps, woData, date) {
  const woMeta = (state.dailyData[date] || {}).woMeta || {};
  const location = (woMeta[proj.id] || {}).location || '';

  const block = document.createElement('div');
  block.className = 'wo-proj-block';

  const hdr = document.createElement('div');
  hdr.className = 'wo-proj-header';
  hdr.innerHTML =
    '<span class="wo-proj-title">' + proj.client + '</span>' +
    (proj.code ? '<span class="wo-proj-code">' + proj.code + '</span>' : '') +
    '<label style="font-size:11px;color:var(--text3);white-space:nowrap;">작업 위치</label>' +
    '<input type="text" class="wo-location-input" placeholder="작업 위치 / 현장"' +
    ' value="' + location.replace(/"/g,'&quot;') + '"' +
    ' onchange="setWoMeta(\'' + proj.id + '\',\'location\',this.value)">';
  block.appendChild(hdr);

  const rows = document.createElement('div');
  rows.className = 'wo-emp-rows';

  if (emps.length === 0) {
    rows.innerHTML = '<div style="color:var(--text3);font-size:12px;padding:6px 0;">배정된 직원 없음</div>';
  } else {
    emps.forEach(emp => {
      const wd = woData[emp.id] || { projId: proj.id, task:'', note:'', team:'' };
      const divInfo = DIVISIONS[emp.div] || { label: emp.div, cls: '' };
      const card = document.createElement('div');
      card.className = 'wo-card';

      const teamOpts = ['','A','B','C','D','E','F'].map(t =>
        '<option value="' + t + '"' + (wd.team===t?' selected':'') + '>' + (t||'-- 조 없음') + '</option>'
      ).join('');

      // [단계9] 완료 프로젝트 제외
      const projOpts = buildProjectOptions(false, proj.id);

      card.innerHTML =
        '<div class="wo-card-top">' +
          '<span class="wo-emp-num">' + emp.id + '</span>' +
          '<span class="wo-emp-name">' + emp.name + '</span>' +
          '<span class="wo-emp-div"><span class="div-badge ' + divInfo.cls + '">' + divInfo.label + '</span></span>' +
          '<label style="font-size:11px;color:var(--text3);white-space:nowrap;">조</label>' +
          '<select style="font-size:12px;font-weight:700;padding:2px 6px;width:72px;color:var(--accent2);border-color:rgba(0,212,160,0.4);"' +
            ' onchange="setWo(' + emp.id + ',\'' + proj.id + '\',\'team\',this.value)">' +
            teamOpts +
          '</select>' +
          '<label style="margin-left:6px;display:flex;align-items:center;gap:4px;font-size:11px;color:var(--red);cursor:pointer;">' +
            '<input type="checkbox" ' + (wd.excluded?'checked':'') + ' style="accent-color:var(--red);" onchange="setWoExclude(' + emp.id + ',this.checked)"> 제외' +
          '</label>' +
        '</div>' +
        // 프로젝트 변경 드롭다운
        '<div style="display:flex;gap:6px;align-items:center;margin-bottom:5px;">' +
          '<label style="font-size:10px;color:var(--text3);white-space:nowrap;flex-shrink:0;">프로젝트</label>' +
          '<select style="flex:1;font-size:11px;padding:3px 6px;color:var(--accent4);border-color:rgba(255,179,71,0.4);" onchange="setWoProjAndReload(' + emp.id + ',this.value)">' +
            '<option value="">-- 미배정 --</option>' +
            projOpts +
          '</select>' +
        '</div>' +
        '<textarea class="wo-task-input" placeholder="작업 내용을 입력하세요..."' +
          ' onchange="setWo(' + emp.id + ',\'' + proj.id + '\',\'task\',this.value)">' + (wd.task||'') + '</textarea>' +
        '<input type="text" class="wo-note-input"' +
          ' placeholder="특이사항 (선택)"' +
          ' value="' + (wd.note||'').replace(/"/g,'&quot;') + '"' +
          ' onchange="setWo(' + emp.id + ',\'' + proj.id + '\',\'note\',this.value)">';
      rows.appendChild(card);
    });
  }
  block.appendChild(rows);
  container.appendChild(block);
}

function renderWoUnassignedBlock(container, unassignedList, woData, date) {
  if (unassignedList.length === 0) return;

  const block = document.createElement('div');
  block.className = 'wo-proj-block';
  block.style.borderColor = 'var(--border)';
  block.style.opacity = '0.85';

  const hdr = document.createElement('div');
  hdr.className = 'wo-proj-header';
  hdr.style.background = 'var(--surface3)';
  hdr.innerHTML = '<span class="wo-proj-title" style="color:var(--text2);">미배정 / 제외 인원</span>' +
    '<span style="font-size:11px;color:var(--text3);margin-left:8px;">출력에 포함되지 않습니다</span>';
  block.appendChild(hdr);

  // [단계9] 완료 프로젝트 제외
  const projOpts = buildProjectOptions(false, '');

  const rows = document.createElement('div');
  rows.className = 'wo-emp-rows';

  // 직종 정렬 순서
  const DIV_ORDER = ['제관','용접','보조','가공','구동','공사','관리'];

  // 1) 작업내용 있거나 체크되지 않은 일반 미배정 → 직종별 정렬
  // 2) 제외 체크된 인원 (고정 제외) → 맨 아래
  const active = unassignedList.filter(({ emp, excluded }) => {
    const wd = woData[emp.id] || {};
    return !(wd.excluded || excluded);
  }).sort((a, b) => {
    const ai = DIV_ORDER.indexOf(a.emp.div);
    const bi = DIV_ORDER.indexOf(b.emp.div);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const excluded = unassignedList.filter(({ emp, excluded: ex }) => {
    const wd = woData[emp.id] || {};
    return wd.excluded || ex;
  }).sort((a, b) => {
    const ai = DIV_ORDER.indexOf(a.emp.div);
    const bi = DIV_ORDER.indexOf(b.emp.div);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const sorted = [...active, ...excluded];

  // 구분선: active → excluded 경계
  let dividerAdded = false;

  sorted.forEach(({ emp, excluded: ex }, idx) => {
    const wd = woData[emp.id] || { projId:'', task:'', note:'', excluded: false };
    const divInfo = DIVISIONS[emp.div] || { label: emp.div, cls: '' };
    const isExcluded = wd.excluded || ex;

    // 제외 인원 구역 시작 전 구분선
    if (isExcluded && !dividerAdded && active.length > 0) {
      dividerAdded = true;
      const sep = document.createElement('div');
      sep.style.cssText = 'border-top:1px dashed var(--border);margin:6px 0;padding-top:4px;font-size:11px;color:var(--text3);text-align:center;';
      sep.textContent = '▼ 고정 제외 인원';
      rows.appendChild(sep);
    }

    const card = document.createElement('div');
    card.className = 'wo-card';
    if (isExcluded) card.style.opacity = '0.45';

    // [B1 FIX] manualOverride된 직원은 직종제외 대신 수동포함 뱃지 표시
    const isManualOverride = wd.manualOverride === true && wd.excluded === false;
    const excludeReason =
      (WO_EXCLUDE_DIV.includes(emp.div) && !isManualOverride) ? '<span style="font-size:10px;color:var(--text3);margin-left:4px;">직종제외</span>' :
      ((state.dailyData[date]||{}).emp||{})[emp.id]?.onTrip ? '<span style="font-size:10px;color:var(--accent4);margin-left:4px;">✈출장</span>' : '';
    const overrideBadge = isManualOverride
      ? '<span style="font-size:10px;color:var(--accent2);background:rgba(0,212,160,0.15);border:1px solid rgba(0,212,160,0.3);border-radius:3px;padding:1px 5px;margin-left:4px;">⚡ 수동 포함</span>'
      : '';

    card.innerHTML =
      '<div class="wo-card-top">' +
        '<span class="wo-emp-num">' + emp.id + '</span>' +
        '<span class="wo-emp-name">' + emp.name + '</span>' +
        '<span class="wo-emp-div"><span class="div-badge ' + divInfo.cls + '">' + divInfo.label + '</span></span>' +
        excludeReason + overrideBadge +
        '<label class="wo-exclude-label" style="margin-left:auto;display:flex;align-items:center;gap:4px;font-size:11px;color:var(--red);cursor:pointer;"></label>' +
      '</div>' +
      (isExcluded ? '' :
        '<select style="width:100%;font-size:12px;padding:4px 8px;margin-bottom:6px;" onchange="setWoProjAndReload(' + emp.id + ',this.value)">' +
          '<option value="">-- 프로젝트 배정 --</option>' +
          projOpts.replace('value="' + (wd.projId||'') + '"', 'value="' + (wd.projId||'') + '" selected') +
        '</select>' +
        '<textarea class="wo-task-input" placeholder="작업 내용을 입력하세요..."' +
          ' onchange="setWo(' + emp.id + ',\'\',\'task\',this.value)">' + (wd.task||'') + '</textarea>' +
        '<input type="text" class="wo-note-input"' +
          ' placeholder="특이사항 (선택)"' +
          ' value="' + (wd.note||'').replace(/"/g,'&quot;') + '"' +
          ' onchange="setWo(' + emp.id + ',\'\',\'note\',this.value)">'
      );

    // 체크박스를 DOM으로 직접 생성 - pointer-events 완전 보장
    const cbLabel = card.querySelector('.wo-exclude-label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = isExcluded;
    cb.style.cssText = 'accent-color:var(--red);width:16px;height:16px;cursor:pointer;';
    cb.addEventListener('change', function() { setWoExclude(emp.id, this.checked); });
    cbLabel.appendChild(cb);
    cbLabel.appendChild(document.createTextNode(' 제외'));
    rows.appendChild(card);
  });

  block.appendChild(rows);
  container.appendChild(block);
}

function setWo(empId, projId, field, val) {
  const date = getWoDateStr();
  if (!state.dailyData[date]) state.dailyData[date] = { emp:{}, proj:{}, wo:{} };
  if (!state.dailyData[date].wo) state.dailyData[date].wo = {};
  if (!state.dailyData[date].wo[empId]) state.dailyData[date].wo[empId] = { projId:'', task:'', note:'' };
  if (projId !== '') state.dailyData[date].wo[empId].projId = projId;
  state.dailyData[date].wo[empId][field] = val;
  saveState();
}

function setWoExclude(empId, val) {
  const date = getWoDateStr();
  if (!state.dailyData[date]) state.dailyData[date] = { emp:{}, proj:{}, wo:{} };
  if (!state.dailyData[date].wo) state.dailyData[date].wo = {};
  if (!state.dailyData[date].wo[empId]) state.dailyData[date].wo[empId] = { projId:'', task:'', note:'', excluded:false };
  state.dailyData[date].wo[empId].excluded = val;
  // [B1 FIX] 수동 해제(false)면 manualOverride=true 기록 → isWoExcluded에서 자동제외보다 우선
  state.dailyData[date].wo[empId].manualOverride = (val === false);
  saveState();
  loadWoData();
}

function setWoProjAndReload(empId, projId) {
  const date = getWoDateStr();
  if (!state.dailyData[date]) state.dailyData[date] = { emp:{}, proj:{}, wo:{} };
  if (!state.dailyData[date].wo) state.dailyData[date].wo = {};
  if (!state.dailyData[date].wo[empId]) state.dailyData[date].wo[empId] = { projId:'', task:'', note:'' };
  state.dailyData[date].wo[empId].projId = projId;
  saveState();
  loadWoData();
}

function setWoMeta(projId, field, val) {
  const date = getWoDateStr();
  if (!state.dailyData[date]) state.dailyData[date] = { emp:{}, proj:{}, wo:{}, woMeta:{} };
  if (!state.dailyData[date].woMeta) state.dailyData[date].woMeta = {};
  if (!state.dailyData[date].woMeta[projId]) state.dailyData[date].woMeta[projId] = {};
  state.dailyData[date].woMeta[projId][field] = val;
  saveState();
}

function copyWoFromYesterday() {
  const date = getWoDateStr();
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  const prev = d.getFullYear() + '-' +
               String(d.getMonth() + 1).padStart(2, '0') + '-' +
               String(d.getDate()).padStart(2, '0');
  const prevData = state.dailyData[prev] || {};
  if (!prevData.wo && !prevData.woMeta) { showToast(prev + ' 워크오더 데이터가 없습니다.', 'error'); return; }
  if (!confirm('전날(' + prev + ') 워크오더를 복사하시겠습니까?')) return;
  if (!state.dailyData[date]) state.dailyData[date] = { emp:{}, proj:{}, wo:{}, woMeta:{} };
  if (prevData.wo) state.dailyData[date].wo = JSON.parse(JSON.stringify(prevData.wo));
  if (prevData.woMeta) state.dailyData[date].woMeta = JSON.parse(JSON.stringify(prevData.woMeta));
  saveState();
  loadWoData();
  showToast('복사 완료', 'success');
}

async function saveWoData() {
  saveState();
  const btn = document.getElementById('wo-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 저장 중...'; }
  try {
    await saveToSheet();
    showToast('저장 완료', 'success');
  } catch(e) {
    showToast('서버 저장 실패 (로컬엔 저장됨)', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✓ 저장'; }
  }
}

function printWorkOrder() {
  const signTableHTML = ''; // 워크오더 출력에는 결재란 없음
  const date = getWoDateStr();
  const d = new Date(date+'T00:00:00');
  const dow = DAYS_KO[d.getDay()];
  const yy = d.getFullYear(), mm = String(d.getMonth()+1).padStart(2,'0'), dd = String(d.getDate()).padStart(2,'0');
  const woData = (state.dailyData[date] || {}).wo || {};
  const woMeta = (state.dailyData[date] || {}).woMeta || {};
  const supervisor = document.getElementById('wo-supervisor').value || '권오근 부장';

  // 출력 대상 수집 (제외 아닌 + 프로젝트 배정된)
  const projGroups = {};
  state.employees.forEach(emp => {
    const wd = woData[emp.id] || {};
    if (isWoExcluded(emp, woData, date)) return;
    if (wd.excluded) return;
    const pId = String(wd.projId || '');
    const proj = state.projects.find(p => String(p.id) === pId);
    if (!proj) return;
    if (!projGroups[pId]) projGroups[pId] = [];
    projGroups[pId].push({ emp, wd });
  });

  const renderBlock = (proj, members) => {
    if (members.length === 0) return '';
    const location = (woMeta[proj.id] || {}).location || '';

    // 조별로 그룹핑 (조 없는 사람은 개인 단위)
    const teamMap = {}; // { 'A': [{emp,wd},...], ... }
    const soloList = []; // 조 없는 개인

    members.forEach(item => {
      const team = (item.wd.team || '').trim();
      if (team) {
        if (!teamMap[team]) teamMap[team] = [];
        teamMap[team].push(item);
      } else {
        soloList.push(item);
      }
    });

    // 행 순서: 조 순(A→F) → 개인
    const orderedGroups = [];
    ['A','B','C','D','E','F'].forEach(t => {
      if (teamMap[t]) orderedGroups.push({ team: t, items: teamMap[t] });
    });
    soloList.forEach(item => orderedGroups.push({ team:'', items:[item] }));

    const rows = orderedGroups.map((g, i) => {
      const bgStyle = i % 2 === 1 ? 'background:#f0f0f0;' : '';
      // 이름 셀: 같은 조면 "홍성준, 하동윤" 한 칸에
      const nameText = g.items.map(it => it.emp.name).join(',  ');
      const teamLabel = '';
      // 작업내용: 조장(첫번째)의 내용 또는 가장 긴 것
      const task = g.items.reduce((best, it) => (it.wd.task||'').length > best.length ? (it.wd.task||'') : best, '');
      const note = g.items.reduce((best, it) => (it.wd.note||'').length > best.length ? (it.wd.note||'') : best, '');

      return '<tr style="' + bgStyle + '">' +
        '<td class="nm">' + teamLabel + '<span class="name-text">' + nameText + '</span></td>' +
        '<td class="task">' + task.replace(/\n/g,'<br>') + '</td>' +
        '<td class="note">' + note.replace(/\n/g,'<br>') + '</td>' +
        '</tr>';
    }).join('');

    return '<div class="proj-block">' +
      '<div class="proj-hdr">' +
        '<span class="proj-name">' + proj.client + '</span>' +
        (proj.code ? '<span class="proj-code">&nbsp;(' + proj.code + ')</span>' : '') +
        (location ? '<span class="proj-loc">📍 ' + location + '</span>' : '') +
      '</div>' +
      '<table><thead><tr>' +
        '<th class="nm">작업자</th>' +
        '<th class="task">작 업 내 용</th>' +
        '<th class="note">특 이 사 항</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '</div>';
  };

  let blocksHTML = '';
  state.projects.forEach(proj => {
    blocksHTML += renderBlock(proj, projGroups[String(proj.id)] || []);
  });

  if (!blocksHTML.trim().replace(/<div class="proj-block"><\/div>/g,'')) {
    showToast('출력할 작업 지시 내용이 없습니다.', 'error'); return;
  }

  const css = [
    '* { margin:0; padding:0; box-sizing:border-box; }',
    "body { font-family:'맑은 고딕','Malgun Gothic','나눔고딕',sans-serif; color:#000; background:#fff; }",
    '.wrap { padding:12px 15px; }',
    '.doc-hdr { display:flex; justify-content:space-between; align-items:center; border-bottom:5px solid #000; padding-bottom:10px; margin-bottom:14px; }',
    '.doc-title { font-size:30px; font-weight:900; letter-spacing:10px; }',
    '.doc-meta { text-align:right; line-height:1.9; }',
    '.doc-meta .date { font-size:20px; font-weight:900; }',
    '.doc-meta .supervisor { font-size:16px; font-weight:700; }',
    '.doc-meta .company { font-size:13px; color:#555; }',
    '.proj-block { margin-bottom:13px; border:2px solid #000; border-radius:4px; overflow:hidden; page-break-inside:avoid; }',
    '.proj-hdr { background:#111; color:#fff; padding:9px 13px; display:flex; align-items:center; gap:10px; }',
    '.proj-name { font-size:20px; font-weight:900; letter-spacing:2px; }',
    '.proj-code { font-size:12px; color:#bbb; font-family:monospace; }',
    '.proj-loc { font-size:16px; color:#ffd700; font-weight:700; margin-left:auto; }',
    'table { width:100%; border-collapse:collapse; }',
    'th { background:#333; color:#fff; padding:8px 9px; font-size:15px; font-weight:700; text-align:center; border:1px solid #666; letter-spacing:2px; }',
    'td { padding:11px 12px; border:1px solid #aaa; vertical-align:middle; }',
    /* 작업자 셀 */
    'td.nm { width:160px; border-right:2px solid #777; vertical-align:middle; }',
    'th.nm { width:160px; }',
    '.team-tag { display:inline-block; background:#1a3a7a; color:#fff; font-size:13px; font-weight:900; padding:2px 9px; border-radius:3px; margin-bottom:4px; letter-spacing:2px; }',
    '.name-text { display:block; font-size:19px; font-weight:900; line-height:1.6; word-break:keep-all; }',
    /* 작업내용 */
    'td.task { font-size:17px; line-height:1.75; font-weight:500; }',
    'th.task { }',
    /* 특이사항 */
    'td.note { font-size:15px; color:#7a4400; width:130px; line-height:1.6; }',
    'th.note { width:130px; }',
    'tr:nth-child(even) td { background:#f0f0f0; }',
    '.doc-footer { margin-top:10px; display:flex; justify-content:space-between; border-top:1px solid #bbb; padding-top:7px; font-size:13px; color:#666; }',
    '@page { margin:9mm; size:A4 portrait; }',
    '@media print { body { -webkit-print-color-adjust:exact; print-color-adjust:exact; } }'
  ].join('\n');

  const html = '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">' +
    '<title>작업지시서 ' + yy + '.' + mm + '.' + dd + '</title>' +
    '<style>' + css + '</style></head><body>' +
    '<div class="wrap">' +
    '<div class="doc-hdr">' +
      '<div class="doc-title">작 업 지 시 서</div>' +
      '<div class="doc-meta">' +
        '<div class="company">㈜세종기술 생산부</div>' +
        '<div class="date">' + yy + '. ' + mm + '. ' + dd + ' (' + dow + ')</div>' +
        '<div class="supervisor">작업 지시자 : ' + supervisor + '</div>' +
      '</div>' +
    '</div>' +
    blocksHTML +
    '<div class="doc-footer">' +
      '<span>※ 작업 중 안전수칙을 반드시 준수하시기 바랍니다.</span>' +
    '</div>' +
    '</div>' +
    signTableHTML +
    '<script>window.onload=function(){window.print();}<\/script>' +
    '</body></html>';

  const win = window.open('', '_blank', 'width=900,height=800');
  win.document.write(html);
  win.document.close();
  showToast(yy+'년 '+mm+'월 '+dd+'일 작업지시서 출력', 'success');
}

// ══════════════════════════════════════════
//  데이터 내보내기/불러오기
// ══════════════════════════════════════════
function exportData() {
  const data = {
    version: 1,
    exported: new Date().toISOString(),
    employees: state.employees,
    projects: state.projects,
    dailyData: state.dailyData
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `세종기술_생산부_${todayStr()}.json`;
  a.click();
  showToast('데이터 내보내기 완료', 'success');
}

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!confirm(`${file.name}을 불러옵니다.\n기존 데이터를 덮어씁니다. 계속하시겠습니까?`)) return;
      state.employees = data.employees || [];
      state.projects = data.projects || [];
      state.dailyData = data.dailyData || {};
      saveState();
      renderEmployees();
      renderProjects();
      loadDailyData();
      showToast('데이터 불러오기 완료', 'success');
    } catch {
      showToast('파일 형식이 올바르지 않습니다.', 'error');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

// ══════════════════════════════════════════
//  토스트
// ══════════════════════════════════════════
function showToast(msg, type='') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ══════════════════════════════════════════
//  [M1] 설정 탭 접이식 섹션
// ══════════════════════════════════════════

/** 접이식 상태를 localStorage에 저장하는 키 */
const SETTINGS_SECTIONS_KEY = 'sejong_settings_sections';

/**
 * 설정 탭의 특정 섹션 접기/펼치기 토글
 * @param {string} sectionId - 'emp' 또는 'proj'
 */
function toggleSettingsSection(sectionId) {
  const body = document.getElementById('section-' + sectionId + '-body');
  const icon = document.getElementById('section-' + sectionId + '-icon');
  if (!body) return;

  const isCollapsed = body.classList.contains('collapsed');

  if (isCollapsed) {
    // 펼치기: max-height를 실제 높이로 설정 후 CSS transition
    body.classList.remove('collapsed');
    body.style.maxHeight = body.scrollHeight + 'px';
    icon.classList.remove('collapsed');
    setTimeout(() => { body.style.maxHeight = ''; }, 250); // transition 완료 후 제거
  } else {
    // 접기: 현재 높이 고정 후 0으로 전환
    body.style.maxHeight = body.scrollHeight + 'px';
    // 강제 reflow
    body.offsetHeight; // eslint-disable-line
    body.classList.add('collapsed');
    body.style.maxHeight = '0';
    icon.classList.add('collapsed');
  }

  // 상태 저장
  saveSettingsSections();
}

/**
 * 접이식 섹션 상태를 localStorage에 저장
 */
function saveSettingsSections() {
  const state_s = {};
  ['emp', 'proj'].forEach(id => {
    const body = document.getElementById('section-' + id + '-body');
    state_s[id] = body ? !body.classList.contains('collapsed') : true;
  });
  localStorage.setItem(SETTINGS_SECTIONS_KEY, JSON.stringify(state_s));
}

/**
 * 앱 초기화 시 접이식 섹션 상태 복원
 */
function restoreSettingsSections() {
  const raw = localStorage.getItem(SETTINGS_SECTIONS_KEY);
  // 기본값: 직원 펼침, 프로젝트 펼침
  const saved = raw ? JSON.parse(raw) : { emp: true, proj: true };
  ['emp', 'proj'].forEach(id => {
    const body = document.getElementById('section-' + id + '-body');
    const icon = document.getElementById('section-' + id + '-icon');
    if (!body) return;
    if (saved[id] === false) {
      body.classList.add('collapsed');
      body.style.maxHeight = '0';
      if (icon) icon.classList.add('collapsed');
    }
    // true(펼침)이면 기본 상태이므로 아무것도 안 함
  });
}

// ══════════════════════════════════════════
//  [N1] 대시보드
// ══════════════════════════════════════════

/** 이번 주 월요일 날짜 문자열 반환 */
function getWeekStart() {
  const today = new Date();
  const dow = today.getDay(); // 0=일, 1=월
  const diff = (dow === 0) ? -6 : 1 - dow; // 월요일로
  const mon = new Date(today);
  mon.setDate(today.getDate() + diff);
  return mon;
}

/**
 * 대시보드 탭 전체 렌더
 */
function renderDashboard() {
  const root = document.getElementById('dashboard-root');
  if (!root) return;

  const today = todayStr();
  const d = new Date(today + 'T00:00:00');
  const dow = DAYS_KO[d.getDay()];
  const yy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');

  const dayData = state.dailyData[today] || null;
  const empData = dayData ? (dayData.emp || {}) : null;

  // ── KPI 계산 ──
  let presentCount = 0, absentCount = 0, overtimeCount = 0, tripCount = 0;
  const projCounts = {}; // projId → count
  let unassignedCount = 0;

  if (empData) {
    state.employees.forEach(emp => {
      const ed = empData[emp.id] || { status: '출근', overtimeHours: 0, onTrip: false, projId: '' };
      const isAbsent = ed.status === '휴무' || ed.status === '연차';
      if (isAbsent) {
        absentCount++;
      } else {
        presentCount++;
        const otH = ed.overtimeHours || 0;
        if (otH > 0) overtimeCount++;
        if (ed.onTrip) tripCount++;
        const pId = String(ed.projId || '');
        if (pId && state.projects.find(p => String(p.id) === pId)) {
          projCounts[pId] = (projCounts[pId] || 0) + 1;
        } else {
          unassignedCount++;
        }
      }
    });
  }

  // 미처리 구매 건수 (최근 7일 이내 저장된 항목 — Phase 3 구현 전 간단 카운트)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const pendingPR = (state.purchaseDB || []).filter(item => {
    if (!item.ts) return false;
    const itemDate = new Date(item.ts.replace(' ', 'T'));
    return itemDate >= sevenDaysAgo;
  }).length;

  // ── KPI 카드 HTML ──
  const kpiHTML =
    '<div class="dashboard-kpi-card" onclick="switchToTab(\'daily\')" title="④ 일일 입력으로 이동">' +
      '<div class="dashboard-kpi-val" style="color:var(--green)">' + (empData ? presentCount : '—') + '</div>' +
      '<div class="dashboard-kpi-lbl">오늘 출근</div>' +
    '</div>' +
    '<div class="dashboard-kpi-card" onclick="switchToTab(\'daily\')" title="④ 일일 입력으로 이동">' +
      '<div class="dashboard-kpi-val" style="color:var(--red)">' + (empData ? absentCount : '—') + '</div>' +
      '<div class="dashboard-kpi-lbl">결근·연차</div>' +
    '</div>' +
    '<div class="dashboard-kpi-card" onclick="switchToTab(\'daily\')" title="④ 일일 입력으로 이동">' +
      '<div class="dashboard-kpi-val" style="color:var(--yellow)">' + (empData ? overtimeCount : '—') + '</div>' +
      '<div class="dashboard-kpi-lbl">잔업 인원</div>' +
    '</div>' +
    '<div class="dashboard-kpi-card" onclick="switchToTab(\'daily\')" title="④ 일일 입력으로 이동">' +
      '<div class="dashboard-kpi-val" style="color:var(--accent4)">' + (empData ? tripCount : '—') + '</div>' +
      '<div class="dashboard-kpi-lbl">출장 인원</div>' +
    '</div>' +
    '<div class="dashboard-kpi-card" onclick="switchToTab(\'purchase\')" title="⑦ 구매요청으로 이동">' +
      '<div class="dashboard-kpi-val" style="color:#c490ff">' + pendingPR + '</div>' +
      '<div class="dashboard-kpi-lbl">구매 (7일)</div>' +
    '</div>';

  // ── 프로젝트 투입 바 차트 ──
  let projBarHTML = '';
  if (!empData || presentCount === 0) {
    projBarHTML = '<div class="dashboard-no-data"><div class="no-data-icon">📋</div>오늘 일일 입력 데이터가 없습니다.<br><small style="color:var(--text3)">④ 일일 입력 탭에서 입력을 시작하세요</small></div>';
  } else {
    const rows = [];
    // 투입된 프로젝트 (인원 많은 순)
    Object.entries(projCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([pId, cnt]) => {
        const proj = state.projects.find(p => String(p.id) === pId);
        const label = proj ? proj.client : '프로젝트';
        const pct = presentCount > 0 ? Math.round(cnt / presentCount * 100) : 0;
        rows.push(
          '<div class="proj-bar-row">' +
            '<div class="proj-bar-label" title="' + label + '">' + label + '</div>' +
            '<div class="proj-bar-track"><div class="proj-bar-fill" style="width:' + pct + '%"></div></div>' +
            '<div class="proj-bar-count">' + cnt + '명</div>' +
          '</div>'
        );
      });
    if (unassignedCount > 0) {
      const pct = presentCount > 0 ? Math.round(unassignedCount / presentCount * 100) : 0;
      rows.push(
        '<div class="proj-bar-row">' +
          '<div class="proj-bar-label" style="color:var(--text3)">미배정</div>' +
          '<div class="proj-bar-track"><div class="proj-bar-fill" style="width:' + pct + '%;background:var(--surface3);"></div></div>' +
          '<div class="proj-bar-count" style="color:var(--text3)">' + unassignedCount + '명</div>' +
        '</div>'
      );
    }
    projBarHTML = '<div class="dashboard-proj-bar">' + rows.join('') + '</div>';
  }

  // ── 이번 주 미니 캘린더 ──
  const weekStart = getWeekStart();
  const miniCalCells = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(weekStart);
    day.setDate(weekStart.getDate() + i);
    const dateStr = day.toISOString().slice(0, 10);
    const dayDow = day.getDay();
    const isToday = dateStr === today;
    const hasData = !!state.dailyData[dateStr];
    const isWeekend = dayDow === 0 || dayDow === 6;

    // 출근 인원 계산
    let miniPresent = 0;
    if (hasData) {
      const de = (state.dailyData[dateStr].emp || {});
      state.employees.forEach(emp => {
        const ed = de[emp.id] || { status: '출근' };
        if (ed.status !== '휴무' && ed.status !== '연차') miniPresent++;
      });
    }

    miniCalCells.push(
      '<div class="mini-cal-day' +
        (isToday ? ' today' : '') +
        (hasData ? ' has-data' : '') +
        (isWeekend ? ' is-weekend' : '') +
        '" onclick="switchToTab(\'daily\');document.getElementById(\'daily-date\').value=\'' + dateStr + '\';loadDailyData();">' +
        '<span class="mini-cal-dow">' + DAYS_KO[dayDow] + '</span>' +
        '<span class="mini-cal-date">' + day.getDate() + '</span>' +
        (hasData ? '<span class="mini-cal-count">' + miniPresent + '명</span>' : '') +
        '<span class="mini-cal-dot"></span>' +
      '</div>'
    );
  }

  // ── 전체 조립 ──
  root.innerHTML =
    '<div class="dashboard-date-header">' +
      yy + '.' + mm + '.' + dd +
      '<span class="dow-badge">' + dow + '요일</span>' +
    '</div>' +

    // KPI 그리드
    '<div class="dashboard-kpi-grid">' + kpiHTML + '</div>' +

    // 프로젝트 투입 + 주간 미니캘린더 2열
    '<div class="dashboard-row">' +
      '<div class="card">' +
        '<div class="card-title">오늘 프로젝트별 투입 현황</div>' +
        projBarHTML +
      '</div>' +
      '<div class="card">' +
        '<div class="card-title">이번 주</div>' +
        '<div class="mini-cal">' + miniCalCells.join('') + '</div>' +
      '</div>' +
    '</div>';
}

// ══════════════════════════════════════════
//  [N2] 직원 상세 모달
// ══════════════════════════════════════════

/**
 * 직원 상세 모달 표시
 * @param {number} empId - 직원 ID
 */
function showEmpDetail(empId) {
  const emp = state.employees.find(e => e.id === empId);
  if (!emp) return;

  const modal = document.getElementById('emp-detail-modal');
  const content = document.getElementById('emp-detail-content');
  if (!modal || !content) return;

  // ── 이번 달 데이터 집계 ──
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const daysInMonth = new Date(year, month, 0).getDate();

  let workDays = 0, absentDays = 0, halfDays = 0;
  let otDays = 0, otHours = 0;
  let tripDays = 0;
  const projDays = {};   // projId → days
  let unassignedDays = 0;
  const recentRows = []; // 최근 5일

  for (let d = daysInMonth; d >= 1; d--) {
    const dateStr = year + '-' + String(month).padStart(2,'0') + '-' + String(d).padStart(2,'0');
    const dayData = state.dailyData[dateStr];
    if (!dayData) continue;
    const ed = (dayData.emp || {})[empId];

    // [단계7] 주말 여부 판별
    const dow2Val = new Date(dateStr + 'T00:00:00').getDay();
    const isWeekendDay = (dow2Val === 0 || dow2Val === 6);

    // [단계7] status:'휴무'인 날은 출근률 분모(totalDays)에서 제외
    if (ed && ed.status === '휴무') {
      // 주말 휴무 → 분모·분자 모두 미포함
    } else if (!ed) {
      // 데이터 있는 날인데 이 직원 기록 없음 → 출근으로 간주
      workDays++;
    } else if (ed.status === '연차') {
      // [단계7] 연차만 연차(결근) 집계, 분모에는 포함
      absentDays++;
    } else if (ed.status === '반차') {
      workDays++;
      halfDays++;
    } else {
      // 출근
      workDays++;
    }

    if (ed && ed.status !== '휴무' && ed.status !== '연차') {
      const otH = ed.overtimeHours || 0;
      if (otH > 0) { otDays++; otHours += otH; }
      if (ed.onTrip) tripDays++;
      const pId = String(ed.projId || '');
      if (pId && state.projects.find(p => String(p.id) === pId)) {
        projDays[pId] = (projDays[pId] || 0) + 1;
      } else {
        unassignedDays++;
      }
    }

    // 최근 5일 수집
    if (recentRows.length < 5 && dayData) {
      const dd2 = new Date(dateStr + 'T00:00:00');
      const dow2 = DAYS_KO[dd2.getDay()];
      const edR = (dayData.emp || {})[empId] || { status: '출근' };
      const proj = state.projects.find(p => String(p.id) === String(edR.projId || ''));
      const projLabel = proj ? proj.client : '';
      const otLabel = (edR.overtimeHours > 0) ? ' 잔업' + edR.overtimeHours + 'h' : '';
      const tripLabel = edR.onTrip ? ' ✈출장' : '';
      const statusLabel = edR.status === '출근' ? '출근' : edR.status === '반차' ? '반차' + (edR.halfDayHours || 4) + 'h' : edR.status;

      recentRows.push(
        '<div class="emp-detail-recent-row">' +
          '<span class="emp-detail-recent-date">' +
            String(month).padStart(2,'0') + '.' + String(d).padStart(2,'0') + '(' + dow2 + ')' +
          '</span>' +
          '<span class="emp-detail-recent-status">' + statusLabel + '</span>' +
          '<span class="emp-detail-recent-info">' +
            (projLabel ? '[' + projLabel + ']' : '') + otLabel + tripLabel +
          '</span>' +
        '</div>'
      );
    }
  }

  const totalDays = workDays + absentDays;
  const workRate = totalDays > 0 ? Math.round(workDays / totalDays * 100) : 0;
  const divInfo = DIVISIONS[emp.div] || { label: emp.div, cls: '' };

  // ── 프로젝트 투입 바 ──
  let projBarsHTML = '';
  if (workDays > 0) {
    const projEntries = Object.entries(projDays).sort((a,b) => b[1] - a[1]);
    projEntries.forEach(([pId, days]) => {
      const proj = state.projects.find(p => String(p.id) === pId);
      const label = proj ? proj.client : '프로젝트';
      const pct = Math.round(days / workDays * 100);
      projBarsHTML +=
        '<div class="emp-detail-proj-bar-row">' +
          '<div class="emp-detail-proj-name" title="' + label + '">' + label + '</div>' +
          '<div class="emp-detail-proj-track">' +
            '<div class="emp-detail-proj-fill" style="width:' + pct + '%"></div>' +
          '</div>' +
          '<div class="emp-detail-proj-pct">' + days + '일 / ' + pct + '%</div>' +
        '</div>';
    });
    if (unassignedDays > 0) {
      const pct = Math.round(unassignedDays / workDays * 100);
      projBarsHTML +=
        '<div class="emp-detail-proj-bar-row">' +
          '<div class="emp-detail-proj-name" style="color:var(--text3)">미배정</div>' +
          '<div class="emp-detail-proj-track">' +
            '<div class="emp-detail-proj-fill" style="width:' + pct + '%;background:var(--surface3);"></div>' +
          '</div>' +
          '<div class="emp-detail-proj-pct" style="color:var(--text3)">' + unassignedDays + '일 / ' + pct + '%</div>' +
        '</div>';
    }
    if (!projBarsHTML) projBarsHTML = '<div style="font-size:12px;color:var(--text3);">이번 달 프로젝트 투입 기록 없음</div>';
  } else {
    projBarsHTML = '<div style="font-size:12px;color:var(--text3);">이번 달 출근 기록 없음</div>';
  }

  // ── 모달 내용 조립 ──
  content.innerHTML =
    '<div class="emp-detail-header">' +
      '<div>' +
        '<div class="emp-detail-name">' +
          emp.name + ' &nbsp;<span class="div-badge ' + divInfo.cls + '">' + divInfo.label + '</span>' +
        '</div>' +
        '<div style="font-size:12px;color:var(--text3);margin-top:4px;">' +
          (emp.home ? '기본 출장지: ' + emp.home : '&nbsp;') +
        '</div>' +
      '</div>' +
      '<button class="emp-detail-close" onclick="closeEmpDetailModal()">✕ 닫기</button>' +
    '</div>' +

    '<div class="emp-detail-body">' +
      // KPI 4칸
      '<div class="emp-detail-kpi-row">' +
        '<div class="emp-detail-kpi">' +
          '<div class="emp-detail-kpi-val" style="color:var(--green)">' + workDays + '</div>' +
          '<div class="emp-detail-kpi-lbl">출근일 / ' + totalDays + '일</div>' +
        '</div>' +
        '<div class="emp-detail-kpi">' +
          '<div class="emp-detail-kpi-val" style="color:var(--accent)">' + workRate + '%</div>' +
          '<div class="emp-detail-kpi-lbl">출근율</div>' +
        '</div>' +
        '<div class="emp-detail-kpi">' +
          '<div class="emp-detail-kpi-val" style="color:var(--yellow)">' + otHours.toFixed(1) + 'h</div>' +
          '<div class="emp-detail-kpi-lbl">잔업 (' + otDays + '회)</div>' +
        '</div>' +
        '<div class="emp-detail-kpi">' +
          '<div class="emp-detail-kpi-val" style="color:var(--accent4)">' + tripDays + '</div>' +
          '<div class="emp-detail-kpi-lbl">출장일</div>' +
        '</div>' +
      '</div>' +

      // 추가 정보 행
      '<div style="display:flex;gap:12px;margin-bottom:8px;font-size:12px;color:var(--text2);">' +
        '<span>연차: <strong style="color:var(--red)">' + absentDays + '일</strong></span>' +
        (halfDays > 0 ? '<span>반차: <strong style="color:var(--yellow)">' + halfDays + '회</strong></span>' : '') +
      '</div>' +

      // 프로젝트 투입
      '<div class="emp-detail-section-title">이번 달 프로젝트 투입</div>' +
      projBarsHTML +

      // 최근 5일
      '<div class="emp-detail-section-title">최근 기록</div>' +
      '<div class="emp-detail-recent-list">' +
        (recentRows.length > 0 ? recentRows.join('') : '<div style="font-size:12px;color:var(--text3);">최근 기록 없음</div>') +
      '</div>' +
    '</div>';

  // 모달 표시
  modal.style.display = 'flex';
  document.addEventListener('keydown', _onEmpDetailEsc);
}

/**
 * ESC 키로 모달 닫기 핸들러
 * @param {KeyboardEvent} e
 */
function _onEmpDetailEsc(e) {
  if (e.key === 'Escape') closeEmpDetailModal();
}

/**
 * 직원 상세 모달 닫기
 * @param {Event} [evt] - 클릭 이벤트 (배경 클릭 구분용)
 */
function closeEmpDetailModal(evt) {
  const modal = document.getElementById('emp-detail-modal');
  if (modal) modal.style.display = 'none';
  document.removeEventListener('keydown', _onEmpDetailEsc);
}

// ══════════════════════════════════════════
//  [N4] 데이터 검증 표시
// ══════════════════════════════════════════

/**
 * 지정 날짜의 일일 입력 데이터를 검증하고 경고 배열을 반환한다.
 * 저장을 차단하지 않으며, 시각적 경고 표시 전용.
 * @param {string} date - 'YYYY-MM-DD'
 * @returns {Array<{type: string, empId: number|null, msg: string}>}
 */
function validateDailyData(date) {
  const warnings = [];
  const data = state.dailyData[date];
  if (!data) return warnings;

  const empData = data.emp || {};
  let presentCount = 0;

  state.employees.forEach(emp => {
    const ed = empData[emp.id];
    if (!ed) return;

    // 완전 출근자(status === '출근')이고 프로젝트 미배정인 경우
    if (ed.status === '출근' && !ed.projId) {
      warnings.push({
        type: 'unassigned',
        empId: emp.id,
        msg: emp.name + ' 프로젝트 미배정'
      });
    }

    // 잔업 8시간 초과
    const otH = parseFloat(ed.overtimeHours) || 0;
    if (otH > 8) {
      warnings.push({
        type: 'overtime',
        empId: emp.id,
        msg: emp.name + ' 잔업 ' + otH + 'h (8h 초과 — 확인 필요)'
      });
    }

    // 출근 인원 카운트 (휴무·연차 제외)
    if (ed.status !== '휴무' && ed.status !== '연차') {
      presentCount++;
    }
  });

  // 전체 출근 인원 0명
  if (state.employees.length > 0 && presentCount === 0) {
    warnings.push({
      type: 'zero_present',
      empId: null,
      msg: '출근 인원이 0명입니다. 확인하세요'
    });
  }

  return warnings;
}

/**
 * 검증 경고를 해당 emp-row에 시각적으로 표시한다.
 * 3초 후 자동 해제.
 * @param {Array} warnings - validateDailyData() 반환값
 */
function highlightWarnings(warnings) {
  if (!warnings || warnings.length === 0) return;

  // zero_present → 토스트만
  const zeroWarn = warnings.find(w => w.type === 'zero_present');
  if (zeroWarn) {
    showToast(zeroWarn.msg, 'error');
  }

  // unassigned / overtime → emp-row 하이라이트 + 토스트 요약
  const rowWarnings = warnings.filter(w => w.empId !== null);
  if (rowWarnings.length > 0) {
    const msgs = rowWarnings.map(w => w.msg);
    showToast(
      '⚠ ' + msgs.slice(0, 3).join(' / ') + (msgs.length > 3 ? ' 외 ' + (msgs.length - 3) + '건' : ''),
      'error'
    );

    rowWarnings.forEach(w => {
      const row = document.getElementById('emp-row-' + w.empId);
      if (!row) return;

      const borderColor = w.type === 'overtime' ? 'var(--red)' : 'var(--accent4)';

      // 아이콘 뱃지 삽입 (중복 방지)
      const badgeId = 'n4-badge-' + w.empId;
      if (!document.getElementById(badgeId)) {
        const badge = document.createElement('span');
        badge.id = badgeId;
        badge.title = w.msg;
        badge.style.cssText = 'font-size:13px;cursor:default;margin-left:4px;';
        badge.textContent = w.type === 'overtime' ? '🔴' : '⚠️';
        const nameEl = row.querySelector('.emp-row-name');
        if (nameEl) nameEl.after(badge);
      }

      row.style.borderColor = borderColor;
      row.style.boxShadow = '0 0 0 2px ' + borderColor + '33';

      // 3초 후 원복
      setTimeout(() => {
        row.style.borderColor = '';
        row.style.boxShadow = '';
        const b = document.getElementById(badgeId);
        if (b) b.remove();
      }, 3000);
    });
  }
}

// ══════════════════════════════════════════
//  [N3] 알림 / 리마인더 배너
// ══════════════════════════════════════════

/** 최대 표시 알림 수 */
const ALERT_MAX = 4;

/**
 * 알림 규칙 4개를 체크하고 배너를 렌더한다.
 * init(), saveDailyData(), 탭 전환 시 호출.
 */
function checkAlerts() {
  const dismissed = _getDismissedAlerts();
  const alerts = [];
  const today = todayStr();
  const now = new Date();
  const hour = now.getHours();

  // ── 규칙 1: 17시 이후 오늘 일일 입력 미저장 ──
  const rule1Id = 'no_daily_' + today;
  if (hour >= 17 && !state.dailyData[today] && !dismissed.has(rule1Id)) {
    alerts.push({
      id: rule1Id,
      type: 'warn',
      msg: '⚠ 오늘(' + today + ') 일일 입력이 아직 저장되지 않았습니다.',
      action: { label: '입력하러 가기', tab: 'daily' }
    });
  }

  // ── 규칙 2: 서버 동기화 3일 이상 미실시 ──
  const rule2Id = 'no_sync_3d';
  if (state._lastSyncTime && !dismissed.has(rule2Id)) {
    const lastSync = new Date(state._lastSyncTime);
    const diffDays = (now - lastSync) / (1000 * 60 * 60 * 24);
    if (diffDays >= 3) {
      const syncDateStr = lastSync.toLocaleDateString('ko-KR');
      alerts.push({
        id: rule2Id,
        type: 'warn',
        msg: '⚠ 서버 동기화가 ' + Math.floor(diffDays) + '일째 되지 않았습니다. (마지막: ' + syncDateStr + ')',
        action: null
      });
    }
  }

  // ── 규칙 3: 내일 워크오더 미배정 인원 ──
  const rule3Id = 'wo_unassigned_' + today;
  if (!dismissed.has(rule3Id)) {
    const tomorrow = new Date(today + 'T00:00:00');
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);
    const woData = (state.dailyData[tomorrowStr] || {}).wo || {};
    let unassignedWo = 0;
    state.employees.forEach(emp => {
      if (WO_EXCLUDE_DIV.includes(emp.div)) return;  // 기존 WO_EXCLUDE_DIV 상수 재사용
      const wd = woData[emp.id] || {};
      if (!wd.projId && !wd.excluded) unassignedWo++;
    });
    if (unassignedWo > 0) {
      alerts.push({
        id: rule3Id,
        type: 'info',
        msg: 'ℹ 내일(' + tomorrowStr + ') 워크오더 미배정 인원: ' + unassignedWo + '명',
        action: { label: '워크오더로 이동', tab: 'wo' }
      });
    }
  }

  // ── 규칙 4: 이번 달 연차 3회 이상 직원 ──
  const rule4Id = 'leave_3_' + now.getFullYear() + '_' + (now.getMonth()+1);
  if (!dismissed.has(rule4Id)) {
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const daysInMonth = new Date(year, month, 0).getDate();
    const leaveCounts = {};
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = year + '-' + String(month).padStart(2,'0') + '-' + String(d).padStart(2,'0');
      const dayEmp = (state.dailyData[ds] || {}).emp || {};
      state.employees.forEach(emp => {
        const ed = dayEmp[emp.id];
        if (ed && ed.status === '연차') {
          leaveCounts[emp.id] = (leaveCounts[emp.id] || 0) + 1;
        }
      });
    }
    const highLeave = Object.entries(leaveCounts)
      .filter(([,cnt]) => cnt >= 3)
      .map(([id, cnt]) => {
        const emp = state.employees.find(e => e.id === Number(id));
        return emp ? emp.name + '(' + cnt + '회)' : '';
      }).filter(Boolean);
    if (highLeave.length > 0) {
      alerts.push({
        id: rule4Id,
        type: 'info',
        msg: 'ℹ 이번 달 연차 3회 이상: ' + highLeave.join(', '),
        action: null
      });
    }
  }

  // 최대 ALERT_MAX개만 표시
  const toShow = alerts.slice(0, ALERT_MAX);
  _renderAlertBanner(toShow);
}

/**
 * 알림 배너 DOM 렌더
 * @param {Array} alerts
 */
function _renderAlertBanner(alerts) {
  const banner = document.getElementById('alert-banner');
  const inline = document.getElementById('alert-banner-inline');
  if (!banner) return;

  if (alerts.length === 0) {
    banner.style.display = 'none';
    banner.innerHTML = '';
    if (inline) inline.innerHTML = '';
    return;
  }

  banner.style.display = 'block';
  banner.innerHTML = alerts.map(alert =>
    '<div class="alert-item' + (alert.type === 'info' ? ' info' : '') + '">' +
      '<span>' + alert.msg + '</span>' +
      (alert.action
        ? '<button class="btn btn-ghost btn-sm" style="font-size:11px;padding:2px 8px;white-space:nowrap;" onclick="switchToTab(\'' + alert.action.tab + '\')">' + alert.action.label + '</button>'
        : '') +
      '<button class="alert-item-close" onclick="dismissAlert(\'' + alert.id + '\')" title="닫기">✕</button>' +
    '</div>'
  ).join('');

  // 헤더 인라인: 경고 개수 뱃지만 표시
  if (inline) {
    const warnCount = alerts.filter(a => a.type === 'warn').length;
    if (warnCount > 0) {
      inline.innerHTML =
        '<div class="alert-inline-badge" onclick="document.getElementById(\'alert-banner\').scrollIntoView({behavior:\'smooth\'})">' +
          '⚠ 알림 ' + alerts.length + '건' +
        '</div>';
    } else {
      inline.innerHTML = '';
    }
  }
}

/**
 * 특정 알림을 세션 동안 닫기
 * @param {string} alertId
 */
function dismissAlert(alertId) {
  try {
    const raw = sessionStorage.getItem('sejong_dismissed_alerts') || '[]';
    const list = JSON.parse(raw);
    if (!list.includes(alertId)) list.push(alertId);
    sessionStorage.setItem('sejong_dismissed_alerts', JSON.stringify(list));
  } catch { /* sessionStorage 접근 실패 시 무시 */ }
  checkAlerts(); // 재렌더
}

/**
 * 세션에서 dismissed된 알림 ID Set 반환
 * @returns {Set<string>}
 */
function _getDismissedAlerts() {
  try {
    const raw = sessionStorage.getItem('sejong_dismissed_alerts') || '[]';
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}


// ══════════════════════════════════════════
//  [F3] 구매요청관리 (PR 모듈)
// ══════════════════════════════════════════

/** 현재 활성 서브탭 */
let pr_activeSubTab = 'input';

/** 구매 요청서 작성 폼의 품목 배열 (임시) */
let pr_formItems = [];

/**
 * 구매요청 서브탭 전환
 * @param {string} subId - 'input'|'db'|'stats'
 */
function pr_switchSub(subId) {
  ['input', 'db', 'stats'].forEach(id => {
    const panel = document.getElementById('pr-panel-' + id);
    const btn   = document.getElementById('pr-subnav-' + id);
    if (panel) panel.classList.toggle('active', id === subId);
    if (btn)   btn.classList.toggle('active', id === subId);
  });
  pr_activeSubTab = subId;
  if (subId === 'db')    pr_renderDB();
  if (subId === 'stats') pr_renderStats();
}

/**
 * 구매요청 탭 초기화 (탭 클릭 시 호출)
 */
function pr_init() {
  pr_populateProjectSelect();
  pr_setDefaultDate();
  if (pr_formItems.length === 0) pr_addItemRow();
  if (pr_activeSubTab === 'db')    pr_renderDB();
  if (pr_activeSubTab === 'stats') pr_renderStats();
}

/**
 * 요청일자 기본값을 오늘로 설정
 */
function pr_setDefaultDate() {
  const el = document.getElementById('pr-req-date');
  if (el && !el.value) el.value = todayStr();
}

/**
 * 프로젝트 드롭다운 갱신 — 완료 프로젝트는 기본 미노출, 옵트인 토글 시 노출
 */
function pr_populateProjectSelect() {
  const sel = document.getElementById('pr-proj-sel');
  if (!sel) return;
  const currentVal = sel.value;
  const includeCompleted = document.getElementById('pr-show-completed')?.checked || false;
  const active = state.projects.filter(p => !p.completed);
  const completedProjs = state.projects.filter(p => p.completed);

  let html = '<option value="">-- 프로젝트 선택 --</option>';
  active.forEach(p => {
    html += '<option value="' + p.id + '"' + (String(p.id) === currentVal ? ' selected' : '') + '>' +
      p.client + (p.code ? ' (' + p.code + ')' : '') + '</option>';
  });

  if (includeCompleted && completedProjs.length > 0) {
    const byYear = {};
    completedProjs.forEach(p => {
      const y = p.completedYear || '기타';
      if (!byYear[y]) byYear[y] = [];
      byYear[y].push(p);
    });
    Object.entries(byYear).sort((a, b) => String(b[0]).localeCompare(String(a[0]))).forEach(([year, projs]) => {
      html += '<optgroup label="완료 - ' + year + '">';
      projs.forEach(p => {
        html += '<option value="' + p.id + '"' + (String(p.id) === currentVal ? ' selected' : '') + '>' +
          p.client + (p.code ? ' (' + p.code + ')' : '') + '</option>';
      });
      html += '</optgroup>';
    });
  }
  sel.innerHTML = html;
}

/**
 * 프로젝트 선택 시 자동 입력 (담당자, 현장, 전화번호, 청구번호, 직급)
 */
function pr_onProjectChange() {
  const sel  = document.getElementById('pr-proj-sel');
  const proj = state.projects.find(p => String(p.id) === sel.value);
  if (!proj) return;

  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  setVal('pr-site',    proj.site);
  setVal('pr-manager', proj.manager);

  // [단계10] 담당자 이름으로 직원 매칭 → 직급·전화번호 자동입력
  const matchedEmp = state.employees.find(e => e.name === proj.manager);
  setVal('pr-position', matchedEmp?.position || '');
  setVal('pr-phone',    proj.phone || matchedEmp?.phone || '');

  // [단계10] 청구번호: 해당 프로젝트 claimPrefix 기반 최대 시퀀스 + 1
  if (proj.claimPrefix) {
    const prefix = proj.claimPrefix;
    const existingNums = (state.purchaseDB || [])
      .filter(r => r.claim && r.claim.startsWith(prefix + '-'))
      .map(r => parseInt(r.claim.split('-').pop(), 10))
      .filter(n => !isNaN(n));
    const nextSeq = existingNums.length > 0 ? Math.max(...existingNums) + 1 : 1;
    setVal('pr-claim-no', prefix + '-' + String(nextSeq).padStart(2, '0'));
  }
}

/**
 * 품목 행 추가
 */
function pr_addItemRow() {
  const tbody = document.getElementById('pr-item-tbody');
  if (!tbody) return;
  const idx = tbody.rows.length + 1;
  const tr = document.createElement('tr');
  tr.innerHTML =
    '<td style="text-align:center;font-family:var(--mono);color:var(--text3);">' + idx + '</td>' +
    '<td><input type="text" class="pr-input pr-item-name" placeholder="품목명" style="width:100%;"></td>' +
    '<td><input type="text" class="pr-item-spec" placeholder="규격/사양" style="width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:4px 6px;font-size:12px;"></td>' +
    '<td><input type="text" class="pr-item-qty"  placeholder="수량" style="width:100%;text-align:center;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:4px 6px;font-size:12px;"></td>' +
    '<td><input type="text" class="pr-item-note" placeholder="비고" style="width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:4px 6px;font-size:12px;"></td>' +
    '<td style="text-align:center;"><button class="btn btn-ghost btn-sm" style="padding:2px 6px;color:var(--red);" onclick="this.closest(\'tr\').remove();_pr_reindexRows()">✕</button></td>';
  tbody.appendChild(tr);
}

/**
 * 품목 행 재번호화
 */
function _pr_reindexRows() {
  const rows = document.querySelectorAll('#pr-item-tbody tr');
  rows.forEach((tr, i) => {
    const firstCell = tr.cells[0];
    if (firstCell) firstCell.textContent = i + 1;
  });
}

/**
 * 폼에서 품목 배열 수집
 * @returns {Array} items
 */
function _pr_collectItems() {
  const items = [];
  document.querySelectorAll('#pr-item-tbody tr').forEach((tr, i) => {
    const name = tr.querySelector('.pr-item-name')?.value?.trim() || '';
    const spec = tr.querySelector('.pr-item-spec')?.value?.trim() || '';
    const qty  = tr.querySelector('.pr-item-qty')?.value?.trim()  || '';
    const note = tr.querySelector('.pr-item-note')?.value?.trim() || '';
    if (name || spec || qty) {
      items.push({ itemNo: i + 1, itemName: name, itemSpec: spec, itemQty: qty, itemNote: note });
    }
  });
  return items;
}

/**
 * 구매요청 저장
 */
async function pr_saveEntry() {
  const sel     = document.getElementById('pr-proj-sel');
  const projId  = sel ? sel.value : '';
  const proj    = state.projects.find(p => String(p.id) === projId);
  const reqDate = document.getElementById('pr-req-date')?.value || todayStr();
  const claimNo = document.getElementById('pr-claim-no')?.value?.trim() || '';
  const site    = document.getElementById('pr-site')?.value?.trim()    || '';
  const manager = document.getElementById('pr-manager')?.value?.trim() || '';
  const position= document.getElementById('pr-position')?.value?.trim()|| '';
  const phone   = document.getElementById('pr-phone')?.value?.trim()   || '';
  const items   = _pr_collectItems();

  if (!proj)  { showToast('프로젝트를 선택하세요.', 'error'); return; }
  if (items.length === 0) { showToast('품목을 1개 이상 입력하세요.', 'error'); return; }

  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
    .replace(/\//g, '-').replace(' ', ' ').replace(/\./g, '-').replace(/ -$/, '');

  items.forEach(item => {
    state.purchaseDB.push({
      ts:       now,
      claim:    claimNo,
      date:     reqDate.replace(/-/g, '.'),
      projId:   proj.id,
      projName: proj.client,
      projCode: proj.code || '',
      site, manager, position, phone,
      itemNo:   item.itemNo,
      itemName: item.itemName,
      itemSpec: item.itemSpec,
      itemQty:  item.itemQty,
      itemNote: item.itemNote
    });
  });

  saveState();
  const btn = document.getElementById('pr-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 저장 중...'; }
  try {
    await saveToSheet();
    showToast(items.length + '개 품목 저장 완료', 'success');
    pr_resetForm();
  } catch(e) {
    showToast('서버 저장 실패 (로컬엔 저장됨)', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '저장'; }
  }
}

/**
 * 폼 초기화
 */
function pr_resetForm() {
  ['pr-proj-sel','pr-req-date','pr-claim-no','pr-site','pr-manager','pr-position','pr-phone'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const tbody = document.getElementById('pr-item-tbody');
  if (tbody) tbody.innerHTML = '';
  pr_formItems = [];
  pr_addItemRow();
  pr_setDefaultDate();
}

/**
 * 구매 데이터 테이블 렌더 (서브②)
 */
function pr_renderDB() {
  const tbody    = document.getElementById('pr-db-tbody');
  const countEl  = document.getElementById('pr-db-count');
  const searchEl = document.getElementById('pr-db-search');
  if (!tbody) return;

  const q = (searchEl?.value || '').toLowerCase();
  const db = (state.purchaseDB || []).filter(row => {
    if (!q) return true;
    return (row.projName + row.claim + row.itemName + row.manager + row.site).toLowerCase().includes(q);
  });

  if (countEl) countEl.textContent = '총 ' + db.length + '건';

  if (db.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;color:var(--text3);padding:24px;">저장된 구매요청 데이터가 없습니다.</td></tr>';
    return;
  }

  // [단계12] 같은 청구번호 중 첫 번째 행 추적
  const seenClaims = new Set();

  tbody.innerHTML = db.map((row, i) => {
    const actualIdx = state.purchaseDB.indexOf(row);
    const isFirstOfClaim = row.claim && !seenClaims.has(row.claim);
    if (row.claim) seenClaims.add(row.claim);
    const safeClaimAttr = encodeURIComponent(row.claim || '');
    return '<tr>' +
      '<td style=\"font-size:10px;color:var(--text3);white-space:nowrap;\">' + (row.ts || '') + '</td>' +
      '<td style=\"font-family:var(--mono);font-size:11px;color:var(--accent4);\">' + (row.claim || '') + '</td>' +
      '<td style=\"font-size:11px;white-space:nowrap;\">' + (row.date || '') + '</td>' +
      '<td style=\"font-weight:600;\">' + (row.projName || '') + '</td>' +
      '<td style=\"color:var(--text2)\">' + (row.site || '') + '</td>' +
      '<td style=\"font-weight:500;\">' + (row.itemName || '') + '</td>' +
      '<td style=\"color:var(--text2);font-size:11px;\">' + (row.itemSpec || '') + '</td>' +
      '<td style=\"text-align:center;font-family:var(--mono);color:var(--accent2);\">' + (row.itemQty || '') + '</td>' +
      '<td style=\"color:var(--text2)\">' + (row.manager || '') + '</td>' +
      '<td style=\"color:var(--text3);font-size:11px;\">' + (row.itemNote || '') + '</td>' +
      '<td style=\"white-space:nowrap;\">' +
        (isFirstOfClaim ? '<button class="btn btn-ghost btn-sm" style="padding:2px 6px;font-size:11px;margin-right:4px;" onclick="pr_viewEntry(decodeURIComponent(this.dataset.claim))" data-claim="' + safeClaimAttr + '" title="해당 청구건 전체 재인쇄">🖨️</button>' : '') +
        '<button class=\"btn btn-ghost btn-sm\" style=\"color:var(--red);padding:2px 6px;font-size:10px;\" onclick=\"pr_deleteRow(' + actualIdx + ')\">삭제</button>' +
      '</td>' +
      '</tr>';
  }).join('');
}

/**
 * 특정 DB 행 삭제
 * @param {number} idx - state.purchaseDB 인덱스
 */
/**
 * [단계12] 청구번호 기준으로 해당 건 전체를 모아 인쇄 팝업 표시
 * @param {string} claimNo - 청구번호
 */
function pr_viewEntry(claimNo) {
  const entries = (state.purchaseDB || []).filter(r => r.claim === claimNo);
  if (entries.length === 0) { showToast('해당 청구번호 데이터가 없습니다.', 'error'); return; }

  const first = entries[0];
  const info = {
    reqDate:  first.date  || '',
    claimNo:  first.claim || '',
    projName: first.projName || '',
    projCode: first.projCode || '',
    site:     first.site    || '',
    manager:  first.manager || '',
    position: first.position || '',
    phone:    first.phone   || ''
  };

  const items = entries.map((r, i) => ({
    itemNo:   r.itemNo   || (i + 1),
    itemName: r.itemName || '',
    itemSpec: r.itemSpec || '',
    itemQty:  r.itemQty  || '',
    itemNote: r.itemNote || ''
  }));

  const html = pr_buildPrintHTML(info, items);
  const win  = window.open('', '_blank', 'width=900,height=800');
  if (!win) { showToast('팝업이 차단되었습니다.', 'error'); return; }
  win.document.write(html);
  win.document.close();
}

function pr_deleteRow(idx) {
  if (!confirm('이 항목을 삭제하시겠습니까?')) return;
  state.purchaseDB.splice(idx, 1);
  saveState();
  pr_renderDB();
  showToast('삭제 완료', 'success');
}

/**
 * 현황판 렌더 (서브③)
 */
function pr_renderStats() {
  const summaryEl = document.getElementById('pr-stats-summary');
  const tbody     = document.getElementById('pr-stats-tbody');
  if (!tbody) return;

  const db = state.purchaseDB || [];

  // 프로젝트별 집계
  const projMap = {};  // projId → { projName, claimSet, itemCount, latestDate, manager }
  db.forEach(row => {
    const key = String(row.projId || row.projName || '');
    if (!projMap[key]) projMap[key] = { projName: row.projName || '(미지정)', claimSet: new Set(), itemCount: 0, latestDate: '', manager: row.manager || '' };
    if (row.claim) projMap[key].claimSet.add(row.claim);
    projMap[key].itemCount++;
    if (!projMap[key].latestDate || row.date > projMap[key].latestDate) {
      projMap[key].latestDate = row.date;
      projMap[key].manager = row.manager || projMap[key].manager;
    }
  });

  // KPI 요약 카드
  const totalClaims = new Set(db.map(r => r.claim).filter(Boolean)).size;
  const totalItems  = db.length;
  const projCount   = Object.keys(projMap).length;

  if (summaryEl) {
    summaryEl.innerHTML =
      '<div class="stats-card"><div class="s-val" style="color:var(--accent)">' + totalClaims + '</div><div class="s-lbl">총 청구 건수</div></div>' +
      '<div class="stats-card"><div class="s-val" style="color:var(--green)">' + totalItems + '</div><div class="s-lbl">총 품목 수</div></div>' +
      '<div class="stats-card"><div class="s-val" style="color:var(--accent4)">' + projCount + '</div><div class="s-lbl">프로젝트 수</div></div>';
  }

  if (Object.keys(projMap).length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:24px;">데이터가 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = Object.values(projMap)
    .sort((a, b) => (b.latestDate || '').localeCompare(a.latestDate || ''))
    .map(d =>
      '<tr>' +
      '<td style="font-weight:700;">' + d.projName + '</td>' +
      '<td style="text-align:center;font-family:var(--mono);color:var(--accent);">' + d.claimSet.size + '</td>' +
      '<td style="text-align:center;font-family:var(--mono);color:var(--accent4);">' + d.itemCount + '</td>' +
      '<td style="text-align:center;font-size:11px;color:var(--text2);">' + (d.latestDate || '—') + '</td>' +
      '<td style="color:var(--text2)">' + (d.manager || '—') + '</td>' +
      '</tr>'
    ).join('');
}

/**
 * 구매요청서 인쇄 미리보기 (M3 양식 적용)
 */
function pr_printFromForm() {
  const sel     = document.getElementById('pr-proj-sel');
  const projId  = sel ? sel.value : '';
  const proj    = state.projects.find(p => String(p.id) === projId) || {};
  const reqDate = (document.getElementById('pr-req-date')?.value || todayStr()).replace(/-/g, '.');
  const claimNo = document.getElementById('pr-claim-no')?.value?.trim() || '';
  const site    = document.getElementById('pr-site')?.value?.trim()     || proj.site    || '';
  const manager = document.getElementById('pr-manager')?.value?.trim()  || proj.manager || '';
  const position= document.getElementById('pr-position')?.value?.trim() || '';
  const phone   = document.getElementById('pr-phone')?.value?.trim()    || proj.phone   || '';
  const items   = _pr_collectItems();

  if (items.length === 0) { showToast('품목을 입력하세요.', 'error'); return; }

  const info = {
    reqDate, claimNo,
    projName: proj.client || '(미선택)',
    projCode: proj.code   || '',
    site, manager, position, phone
  };

  const html = pr_buildPrintHTML(info, items);
  const win  = window.open('', '_blank', 'width=900,height=800');
  if (!win) { showToast('팝업이 차단되었습니다.', 'error'); return; }
  win.document.write(html);
  win.document.close();
}

/**
 * 구매요청서 A4 인쇄 HTML 생성 (M3 수정 양식 반영)
 * [단계11] "서부신발" 텍스트: 코드 전체 grep 결과 미발견. 브라우저 캐시 또는 이전 배포 잔존 가능.
 *          → 배포 후 캐시 강제 클리어(Ctrl+Shift+R) 안내 필요.
 * @param {Object} info - {reqDate, claimNo, projName, projCode, site, manager, position, phone}
 * @param {Array}  items - [{itemNo, itemName, itemSpec, itemQty, itemNote}]
 * @returns {string} HTML
 */
function pr_buildPrintHTML(info, items) {
  // ── M3 수정 사항 ──
  // 1) 결재란 "월 일" 간격 확대 (10개 nbsp)
  // 2) 결재란 9열 구조 (수신부서 빈 칸 삭제)
  // 3) 꼬리말: no-print 제거, "(주)세종기술 ... 2026.04.13 (Rev.6)"

  const DATE_CELL_CONTENT = '월&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;일';

  const signTableHTML =
    '<table class="sign-table">' +
    '<thead>' +
    '<tr>' +
      '<th rowspan="3" class="sign-side-hd">발<br>신<br>부<br>서</th>' +
      '<td class="role-hd">담당자</td>' +
      '<td class="role-hd">부서장</td>' +
      '<td class="role-hd">승인권자</td>' +
      '<th rowspan="3" class="sign-divider"></th>' +
      '<th rowspan="3" class="sign-side-hd">수<br>신<br>부<br>서</th>' +
      '<td class="role-hd">접수</td>' +
      '<td class="role-hd">검토</td>' +
      '<td class="role-hd">승인</td>' +
    '</tr>' +
    '<tr>' +
      '<td style="height:52px;"></td>' +
      '<td></td>' +
      '<td></td>' +
      '<td style="height:52px;"></td>' +
      '<td></td>' +
      '<td></td>' +
    '</tr>' +
    '<tr>' +
      '<td class="date-cell">' + DATE_CELL_CONTENT + '</td>' +
      '<td class="date-cell">' + DATE_CELL_CONTENT + '</td>' +
      '<td class="date-cell">' + DATE_CELL_CONTENT + '</td>' +
      '<td class="date-cell">' + DATE_CELL_CONTENT + '</td>' +
      '<td class="date-cell">' + DATE_CELL_CONTENT + '</td>' +
      '<td class="date-cell">' + DATE_CELL_CONTENT + '</td>' +
    '</tr>' +
    '</thead>' +
    '</table>';

  const itemRowsHTML = items.map(item =>
    '<tr>' +
    '<td style="text-align:center;">' + item.itemNo + '</td>' +
    '<td>' + (item.itemName || '') + '</td>' +
    '<td>' + (item.itemSpec || '') + '</td>' +
    '<td style="text-align:center;">' + (item.itemQty || '') + '</td>' +
    '<td>' + (item.itemNote || '') + '</td>' +
    '</tr>'
  ).join('');

  // 빈 행 패딩 (최소 8행)
  const padCount = Math.max(0, 8 - items.length);
  const padRowsHTML = Array(padCount).fill('<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr>').join('');

  const css = [
    '* { margin:0; padding:0; box-sizing:border-box; }',
    "body { font-family:'맑은 고딕','Malgun Gothic','나눔고딕',sans-serif; color:#000; background:#fff; font-size:9pt; }",
    '.wrap { padding:10mm 12mm; }',
    /* 문서 헤더 */
    '.doc-hdr { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px; }',
    '.doc-title { font-size:20pt; font-weight:900; letter-spacing:8px; }',
    '.doc-sub { font-size:8pt; color:#555; margin-top:4px; }',
    '.doc-meta-right { text-align:right; font-size:8.5pt; line-height:1.7; }',
    /* 결재란 */
    '.sign-table { width:100%; border-collapse:collapse; margin-bottom:10px; }',
    '.sign-table td, .sign-table th { border:1px solid #666; }',
    '.sign-side-hd { background:#ddd; font-weight:900; font-size:8pt; width:16px; padding:4px 2px; text-align:center; letter-spacing:2px; writing-mode:vertical-lr; text-orientation:upright; }',
    '.sign-divider { width:8px; background:#fff; border:none !important; }',
    '.role-hd { background:#e8e8e8; font-weight:700; font-size:8pt; text-align:center; padding:4px 6px; min-width:72px; }',
    '.date-cell { font-size:7.5pt; color:#555; text-align:center; padding:4px 8px; min-width:72px; }',
    /* 요청 정보 */
    '.info-table { width:100%; border-collapse:collapse; margin-bottom:8px; font-size:8.5pt; }',
    '.info-table th { background:#f0f0f0; font-weight:700; padding:5px 8px; border:1px solid #bbb; text-align:center; width:70px; }',
    '.info-table td { padding:5px 8px; border:1px solid #bbb; }',
    /* 품목 테이블 */
    '.item-table { width:100%; border-collapse:collapse; font-size:8.5pt; }',
    '.item-table th { background:#333; color:#fff; padding:6px 8px; text-align:center; border:1px solid #666; font-weight:700; }',
    '.item-table td { padding:5px 8px; border:1px solid #bbb; }',
    '.item-table tr:nth-child(even) td { background:#f8f8f8; }',
    /* 꼬리말 (M3: no-print 제거 → 인쇄 포함) */
    '.doc-footer { display:flex; justify-content:space-between; align-items:center; margin-top:10px; padding-top:6px; border-top:1px solid #bbb; font-size:7.5pt; color:#666; }',
    '@page { margin:8mm; size:A4 portrait; }',
    '@media print { body { -webkit-print-color-adjust:exact; print-color-adjust:exact; } }'
  ].join('\n');

  return '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">' +
    '<title>구매요청서 ' + info.claimNo + '</title>' +
    '<style>' + css + '</style></head><body>' +
    '<div class="wrap">' +

    '<div class="doc-hdr">' +
      '<div>' +
        '<div class="doc-title">구 매 요 청 서</div>' +
      '</div>' +
      '<div class="doc-meta-right">' +
        '<div>청구번호: <strong>' + (info.claimNo || '—') + '</strong></div>' +
        '<div>요청일자: <strong>' + info.reqDate + '</strong></div>' +
        '<div>프로젝트: <strong>' + info.projName + (info.projCode ? ' (' + info.projCode + ')' : '') + '</strong></div>' +
      '</div>' +
    '</div>' +

    '<table class="info-table">' +
    '<tr>' +
      '<th>투입 현장</th><td>' + info.site + '</td>' +
      '<th>담당자</th><td>' + info.manager + (info.position ? ' (' + info.position + ')' : '') + '</td>' +
      '<th>연락처</th><td>' + info.phone + '</td>' +
    '</tr>' +
    '</table>' +

    '<table class="item-table">' +
    '<thead><tr>' +
      '<th style="width:36px;">No.</th>' +
      '<th>품목명</th>' +
      '<th style="width:160px;">규격/사양</th>' +
      '<th style="width:80px;">수량</th>' +
      '<th style="width:140px;">비고</th>' +
    '</tr></thead>' +
    '<tbody>' + itemRowsHTML + padRowsHTML + '</tbody>' +
    '</table>' +

    // [수정2] 결재란을 품목 테이블 아래로 이동
    signTableHTML +

    // M3 수정 꼬리말 (no-print 제거, 내용 변경)
    '<div class="doc-footer">' +
      '<span>(주)세종기술 SEJONG TECHNOLOGY CO.LTD</span>' +
      '<span>2026.04.13 (Rev.6)</span>' +
    '</div>' +

    '</div>' +
    '<script>window.onload=function(){window.print();}<\/script>' +
    '</body></html>';
}

/**
 * 구매 데이터 CSV 내보내기
 */
function pr_exportCSV() {
  const db = state.purchaseDB || [];
  if (db.length === 0) { showToast('내보낼 데이터가 없습니다.', 'error'); return; }
  const headers = ['저장일시','청구번호','요청일','프로젝트','현장','품목명','규격','수량','담당자','비고'];
  const rows = db.map(r => [r.ts, r.claim, r.date, r.projName, r.site, r.itemName, r.itemSpec, r.itemQty, r.manager, r.itemNote]
    .map(v => '"' + String(v || '').replace(/"/g, '""') + '"').join(','));
  const csv  = [headers.join(','), ...rows].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = '세종기술_구매이력_' + todayStr() + '.csv'; a.click();
  showToast('CSV 내보내기 완료', 'success');
}

/**
 * 구매 데이터 엑셀(.xlsx) 내보내기 (N5)
 */
function pr_exportExcel() {
  if (typeof XLSX === 'undefined') {
    showToast('엑셀 기능을 사용할 수 없습니다. SheetJS 로드를 확인하세요.', 'error');
    pr_exportCSV(); // CSV 폴백
    return;
  }
  const db = state.purchaseDB || [];
  if (db.length === 0) { showToast('내보낼 데이터가 없습니다.', 'error'); return; }

  try {
    const rows = db.map(r => ({
      저장일시: r.ts || '',
      청구번호: r.claim || '',
      요청일: r.date || '',
      프로젝트: r.projName || '',
      현장: r.site || '',
      품목No: r.itemNo || '',
      품목명: r.itemName || '',
      규격사양: r.itemSpec || '',
      수량: r.itemQty || '',
      담당자: r.manager || '',
      직급: r.position || '',
      전화번호: r.phone || '',
      비고: r.itemNote || ''
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, '구매이력');
    XLSX.writeFile(wb, '세종기술_구매이력_' + todayStr() + '.xlsx');
    showToast('엑셀 다운로드 완료', 'success');
  } catch (err) {
    showToast('엑셀 내보내기 오류: ' + err.message, 'error');
    pr_exportCSV();
  }
}

// ══════════════════════════════════════════
//  시작
// ══════════════════════════════════════════
init();

// ══════════════════════════════════════════
//  M/D TRACKER 모듈
// ══════════════════════════════════════════
let md_parsedResults = [];

function md_uid() {
  return 'md_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}
function md_esc(s) {
  return String(s || '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}
function md_showError(msg) {
  const el = document.getElementById('md-login-error');
  if (!el) return;
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

// ── 탭 진입점 ──
function md_initTab() {
  md_enterApp();
}

// ── 로그인 화면 렌더 ──
function md_renderLogin() {
  const area = document.getElementById('md-login-form-area');
  if (!area) return;
  const emps = state.employees;
  if (!emps.length) {
    area.innerHTML = `
      <div style="background:rgba(79,127,255,0.1);border:1px solid var(--accent);border-radius:8px;padding:12px;font-size:12px;color:var(--accent);margin-bottom:16px;text-align:center;line-height:1.8;">
        👋 <b>직원이 없습니다.</b><br>② 설정 탭에서 직원을 먼저 등록해 주세요.
      </div>
      <button style="width:100%;padding:12px;font-size:14px;font-weight:600;background:var(--accent);color:white;border:none;border-radius:8px;cursor:pointer;"
        onclick="document.getElementById('md-login-overlay').style.display='none'; switchToTab('settings');">설정 탭으로 이동</button>
    `;
    return;
  }
  if (!emps.length) {
    area.innerHTML = `
      <div style="background:rgba(79,127,255,0.1);border:1px solid var(--accent);border-radius:8px;padding:12px;font-size:12px;color:var(--accent);margin-bottom:16px;text-align:center;line-height:1.8;">
        등록된 직원이 없습니다.<br>② 설정에서 직원을 먼저 등록해 주세요.
      </div>
    `;
    return;
  }
  area.innerHTML = `
    <label style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px;font-weight:500;">이름</label>
    <input type="text" id="md-li-user" placeholder="이름을 입력하세요" autocomplete="off"
      onkeydown="if(event.key==='Enter') document.getElementById('md-li-pin').focus()"
      style="width:100%;padding:10px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:14px;margin-bottom:14px;">
    <label style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px;font-weight:500;">PIN (4자리)</label>
    <input type="password" id="md-li-pin" maxlength="4" inputmode="numeric" placeholder="••••"
      onkeydown="if(event.key==='Enter') md_doLogin()"
      style="width:100%;padding:10px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:20px;letter-spacing:8px;text-align:center;margin-bottom:20px;">
    <button onclick="md_doLogin()"
      style="width:100%;padding:12px;font-size:14px;font-weight:600;background:var(--accent);color:white;border:none;border-radius:8px;cursor:pointer;">
      로그인
    </button>
    <div style="font-size:11px;color:var(--text3);text-align:center;margin-top:16px;line-height:1.7;padding-top:12px;border-top:1px solid var(--border);">
      🔑 처음 로그인은 기본 PIN
      <span style="background:var(--surface3);padding:1px 6px;border-radius:3px;color:var(--accent);">0000</span>
      으로 입력 후 변경해 주세요.
    </div>
  `;
  setTimeout(() => document.getElementById('md-li-pin')?.focus(), 100);
}

function md_doLogin() {
  const nameEl = document.getElementById('md-li-user');
  const pinEl  = document.getElementById('md-li-pin');
  if (!nameEl || !pinEl) return;
  const inputName = nameEl.value.trim();
  const pin = pinEl.value.trim();
  if (!inputName) { md_showError('이름을 입력하세요.'); return; }
  const emp = state.employees.find(e => e.name === inputName);
  if (!emp) { md_showError('등록된 이름이 아닙니다.'); return; }
  const empPin = emp.pin || '0000';
  if (empPin !== pin) {
    md_showError('PIN이 올바르지 않습니다.');
    pinEl.value = '';
    return;
  }
  md_showError('');
  if (!emp.pinChanged) {
    md_renderPinChange(emp);
    return;
  }
  md_setCurrentUser(emp);
  _finishInit();
}

function md_renderPinChange(emp) {
  const area = document.getElementById('md-login-form-area');
  area.innerHTML = `
    <div style="background:rgba(79,127,255,0.1);border:1px solid var(--accent);border-radius:8px;padding:12px;font-size:12px;color:var(--accent);margin-bottom:16px;text-align:center;line-height:1.8;">
      🔑 <b>첫 로그인입니다, ${md_esc(emp.name)}님!</b><br>본인만 아는 PIN으로 변경해 주세요.
    </div>
    <label style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px;font-weight:500;">새 PIN (4자리)</label>
    <input type="password" id="md-new-pin" maxlength="4" inputmode="numeric" placeholder="••••"
      style="width:100%;padding:10px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:20px;letter-spacing:8px;text-align:center;margin-bottom:10px;">
    <label style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px;font-weight:500;">새 PIN 확인</label>
    <input type="password" id="md-new-pin2" maxlength="4" inputmode="numeric" placeholder="••••"
      onkeydown="if(event.key==='Enter') md_doChangePinFirst(${emp.id})"
      style="width:100%;padding:10px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:20px;letter-spacing:8px;text-align:center;margin-bottom:20px;">
    <button onclick="md_doChangePinFirst(${emp.id})"
      style="width:100%;padding:12px;font-size:14px;font-weight:600;background:var(--accent);color:white;border:none;border-radius:8px;cursor:pointer;">
      PIN 변경 완료
    </button>
  `;
  md_showError('');
  setTimeout(() => document.getElementById('md-new-pin')?.focus(), 100);
}

async function md_doChangePinFirst(empId) {
  const np  = document.getElementById('md-new-pin')?.value.trim();
  const np2 = document.getElementById('md-new-pin2')?.value.trim();
  if (!/^\d{4}$/.test(np))  { md_showError('PIN은 4자리 숫자로 입력하세요.'); return; }
  if (np === '0000')         { md_showError('기본 PIN(0000)은 사용할 수 없습니다.'); return; }
  if (np !== np2)            { md_showError('두 PIN이 일치하지 않습니다.'); document.getElementById('md-new-pin2').value = ''; return; }
  const emp = state.employees.find(e => e.id === empId);
  if (!emp) return;
  emp.pin = np;
  emp.pinChanged = true;
  saveLocal();
  await saveToSheet();
  md_setCurrentUser(emp);
  md_showError('');
  showToast('PIN 변경 완료! 환영합니다, ' + emp.name + '님', 'success');
  _finishInit();
}

function md_setCurrentUser(emp) {
  currentUser = {
    id: emp.id,
    name: emp.name,
    position: emp.position || '',
    div: emp.div,
    mdRole: emp.mdRole || '일반',
    role: emp.mdRole === '관리자' ? 'admin' : emp.mdRole === '열람용' ? 'viewer' : 'user'
  };
  sessionStorage.setItem('md_session', JSON.stringify(currentUser));
}

function md_logout() {
  currentUser = null;
  sessionStorage.removeItem('md_session');
  document.querySelector('.app-header').style.display = 'none';
  document.querySelector('.app-body').style.display = 'none';
  document.getElementById('app-user-badge').style.display = 'none';
  document.getElementById('app-logout-btn').style.display = 'none';
  document.getElementById('md-login-overlay').style.display = 'flex';
  md_renderLogin();
}

async function md_changePin() {
  if (!currentUser) return;
  const emp = state.employees.find(e => e.id === currentUser.id);
  if (!emp) return;
  const curPin = prompt('현재 PIN을 입력하세요:');
  if (curPin === null) return;
  if (emp.pin !== curPin) { showToast('현재 PIN이 올바르지 않습니다.', 'error'); return; }
  const newPin = prompt('새 PIN을 입력하세요 (4자리 숫자):');
  if (!newPin) return;
  if (!/^\d{4}$/.test(newPin)) { showToast('PIN은 4자리 숫자여야 합니다.', 'error'); return; }
  if (newPin === '0000') { showToast('기본 PIN(0000)은 사용할 수 없습니다.', 'error'); return; }
  emp.pin = newPin;
  emp.pinChanged = true;
  saveLocal();
  showToast('PIN 변경 완료', 'success');
  saveToSheet();
}

// ── 앱 진입 후 초기화 ──
function md_enterApp() {
  const badge = document.getElementById('md-user-badge');
  if (badge) {
    badge.innerHTML =
      `🧑 <strong>${md_esc(currentUser.name)}</strong>` +
      `<span style="font-size:11px;color:var(--text3);margin-left:6px;">${md_esc(currentUser.position || currentUser.div)}</span>` +
      (currentUser.role === 'admin' ? '<span style="font-size:11px;color:var(--accent);margin-left:6px;">[관리자]</span>' : '');
  }
  const today = todayStr();
  const mdFrom = document.getElementById('md-f-from');
  const mdTo   = document.getElementById('md-f-to');
  if (mdFrom && !mdFrom.value) mdFrom.value = today.slice(0, 7) + '-01';
  if (mdTo   && !mdTo.value)   mdTo.value   = today;

  // 관리자만 검사관 필터 노출
  const inspCol = document.getElementById('md-f-insp-col');
  if (inspCol) inspCol.style.display = currentUser.role === 'admin' ? '' : 'none';

  md_refreshProjectFilter();
  md_renderRecent();
  md_renderSummary();
}

// ── 파서 ──
function md_parseLine(line) {
  const raw = line;
  let date = todayStr();
  const dateMatch = line.match(/^(\d{1,2})\/(\d{1,2})\s+/);
  if (dateMatch) {
    const mm = dateMatch[1].padStart(2, '0');
    const dd = dateMatch[2].padStart(2, '0');
    date = `${new Date().getFullYear()}-${mm}-${dd}`;
    line = line.slice(dateMatch[0].length);
  }
  const parts = line.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return { error: '쉼표로 [프로젝트코드 명칭], [아이템 업무 시간] 구분 필요', raw };
  const p1tokens = parts[0].split(/\s+/);
  const projCode = p1tokens[0] || '';
  const projName = p1tokens.slice(1).join(' ') || '';
  const p2 = parts[1];
  let regular = 0, ot = 0, remaining = p2;
  const regRe = /정규\s*(\d+(?:\.\d+)?)\s*(?:시간|h|H)/g;
  const otRe  = /(?:야근|잔업|OT|ot)\s*(\d+(?:\.\d+)?)\s*(?:시간|h|H)/g;
  let m;
  while ((m = regRe.exec(p2)) !== null) { regular += parseFloat(m[1]); remaining = remaining.replace(m[0], ''); }
  while ((m = otRe.exec(p2))  !== null) { ot += parseFloat(m[1]);      remaining = remaining.replace(m[0], ''); }
  if (regular === 0 && ot === 0) {
    const solo = p2.match(/(\d+(?:\.\d+)?)\s*(?:시간|h|H)/);
    if (solo) { regular = parseFloat(solo[1]); remaining = remaining.replace(solo[0], ''); }
  }
  const tokens = remaining.replace(/\s+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const item = tokens[0] || '';
  const work = tokens.slice(1).join(' ') || '';
  if (regular + ot === 0) return { error: '시간 정보 없음 (예: 8시간, 정규8시간 야근2시간)', raw };
  if (!projCode)           return { error: '프로젝트 코드가 비어있습니다.', raw };
  const matched = state.projects.find(p => p.code === projCode);
  const resolvedName = projName || (matched ? (matched.client || matched.title || '') : '');
  return { date, projCode, projName: resolvedName, item, work, regular, ot, raw, matched: !!matched };
}

function md_parseKakao() {
  const text = document.getElementById('md-input')?.value.trim();
  if (!text) { showToast('입력이 비어있습니다.', 'error'); return; }
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  md_parsedResults = lines.map(md_parseLine);
  md_renderPreview();
}

function md_renderPreview() {
  const area = document.getElementById('md-preview');
  if (!area) return;
  if (!md_parsedResults.length) { area.innerHTML = ''; return; }
  let validCount = 0;
  let html = `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:14px;margin-top:12px;">
    <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:10px;">📝 파싱 결과 (${md_parsedResults.length}건)</div>`;
  md_parsedResults.forEach((r, idx) => {
    if (r.error) {
      html += `<div style="background:rgba(255,71,87,0.1);border:1px solid var(--red);border-radius:6px;padding:10px;margin-bottom:6px;">
        <span style="color:var(--red);font-weight:600;">❌ 줄${idx + 1}:</span> ${md_esc(r.error)}
        <div style="font-family:var(--mono);font-size:11px;color:var(--text3);margin-top:3px;">${md_esc(r.raw)}</div>
      </div>`;
    } else {
      validCount++;
      const md = ((r.regular + r.ot * 1.5) / 8).toFixed(2);
      html += `<div style="background:var(--surface3);border:1px solid var(--border);border-radius:6px;padding:10px;margin-bottom:6px;">
        <div style="display:grid;grid-template-columns:80px 1fr;gap:3px;font-size:12px;">
          <span style="color:var(--text3);">날짜</span><span>${r.date}</span>
          <span style="color:var(--text3);">프로젝트</span>
          <span><strong style="color:var(--accent);">${md_esc(r.projCode)}</strong> ${md_esc(r.projName)}
            ${r.matched ? '<span style="color:var(--green);font-size:11px;margin-left:4px;">✓ 자동매칭</span>' : '<span style="color:var(--yellow);font-size:11px;margin-left:4px;">⚠ 미등록</span>'}
          </span>
          <span style="color:var(--text3);">아이템/업무</span><span>${md_esc(r.item)} ${md_esc(r.work)}</span>
          <span style="color:var(--text3);">시간/M/D</span>
          <span>정규 ${r.regular}h${r.ot > 0 ? ` + 야근 ${r.ot}h` : ''} = <strong style="color:var(--accent4);">${md} M/D</strong></span>
        </div>
      </div>`;
    }
  });
  html += `<div style="display:flex;gap:8px;margin-top:10px;">
    <button onclick="md_confirmSave()"
      ${validCount === 0 ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : ''}
      style="padding:8px 18px;background:var(--accent);color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">
      ✓ ${validCount}건 저장
    </button>
    <button onclick="md_cancelParse()"
      style="padding:8px 14px;background:var(--surface3);color:var(--text);border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:13px;">
      취소
    </button>
  </div></div>`;
  area.innerHTML = html;
}

function md_confirmSave() {
  if (!currentUser) return;
  const valid = md_parsedResults.filter(r => !r.error);
  if (!valid.length) return;
  valid.forEach(r => {
    state.mdEntries.push({
      id: md_uid(),
      employeeId: currentUser.id,
      employeeName: currentUser.name,
      employeePosition: currentUser.position || '',
      date: r.date,
      projCode: r.projCode,
      projName: r.projName,
      item: r.item,
      work: r.work,
      regular: r.regular,
      ot: r.ot,
      createdAt: new Date().toISOString()
    });
  });
  saveLocal();
  showToast(`${valid.length}건 저장 완료`, 'success');
  document.getElementById('md-input').value = '';
  document.getElementById('md-preview').innerHTML = '';
  md_parsedResults = [];
  md_renderRecent();
  md_renderSummary();
  saveToSheet();
}

function md_cancelParse() {
  document.getElementById('md-preview').innerHTML = '';
  md_parsedResults = [];
}

// ── 최근 입력 렌더 ──
function md_renderRecent() {
  const list = document.getElementById('md-recent-list');
  if (!list || !currentUser) return;
  const isAdmin = currentUser.role === 'admin';
  const base = isAdmin
    ? state.mdEntries
    : state.mdEntries.filter(e => e.employeeId === currentUser.id);
  const entries = [...base].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20);
  if (!entries.length) {
    list.innerHTML = '<div style="text-align:center;color:var(--text3);padding:28px;">아직 입력된 기록이 없습니다.</div>';
    return;
  }
  list.innerHTML = entries.map(e => {
    const md = ((e.regular + e.ot * 1.5) / 8).toFixed(2);
    const canDel = isAdmin || e.employeeId === currentUser.id;
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;margin-bottom:6px;gap:10px;flex-wrap:wrap;">
      <div style="flex:1;min-width:200px;font-size:12px;">
        <strong style="color:var(--accent);">${e.date}</strong>
        ${isAdmin ? `<span style="color:var(--text3);margin-left:8px;">${md_esc(e.employeeName)}</span>` : ''}
        <span style="color:var(--text3);margin-left:8px;">${md_esc(e.projCode)} ${md_esc(e.projName)}</span>
        <span style="color:var(--text3);margin-left:8px;">${md_esc(e.item)} ${md_esc(e.work)}</span>
        <br>
        <span>정규 ${e.regular}h${e.ot > 0 ? ` + 야근 ${e.ot}h` : ''} =
          <strong style="color:var(--accent4);">${md} M/D</strong>
        </span>
      </div>
      ${canDel
        ? `<button onclick="md_deleteEntry('${e.id}')"
            style="padding:4px 10px;background:transparent;color:var(--red);border:1px solid var(--red);border-radius:4px;cursor:pointer;font-size:11px;flex-shrink:0;">
            삭제
          </button>`
        : ''}
    </div>`;
  }).join('');
}

// ── dailyData → 가상 M/D 엔트리 변환 ──
function md_getDailyEntries() {
  const entries = [];
  Object.entries(state.dailyData).forEach(([date, dayData]) => {
    const empData = dayData.emp || {};
    Object.entries(empData).forEach(([empIdStr, ed]) => {
      if (ed.status === '연차' || ed.status === '휴무') return;
      const empId = parseInt(empIdStr);
      let regular = 0;
      if (ed.status === '출근') regular = 8;
      else if (ed.status === '반차') regular = ed.halfDayHours || 4;
      const ot = ed.overtimeHours || 0;
      if (regular === 0 && ot === 0) return;
      const proj = state.projects.find(p => p.id === ed.projId || p.id === parseInt(ed.projId));
      const emp  = state.employees.find(e => e.id === empId);
      entries.push({
        id:         `daily_${date}_${empId}`,
        employeeId: empId,
        empName:    emp ? emp.name : String(empId),
        date,
        projCode:   proj ? proj.code  : (ed.projId ? '미배정' : '미배정'),
        projName:   proj ? (proj.client || proj.title || '') : '',
        item:       '',
        work:       ed.work || '',
        regular,
        ot,
        createdAt:  date,
        source:     'daily'
      });
    });
  });
  return entries;
}

// ── M/D 집계 렌더 ──
function md_renderSummary() {
  const table = document.getElementById('md-summary-table');
  if (!table || !currentUser) return;
  const from      = document.getElementById('md-f-from')?.value || '';
  const to        = document.getElementById('md-f-to')?.value   || '';
  const projFilter = document.getElementById('md-f-proj')?.value || '';
  const inspFilter = document.getElementById('md-f-insp')?.value || '';
  const isAdmin = currentUser.role === 'admin';

  let data = isAdmin
    ? [...state.mdEntries]
    : state.mdEntries.filter(e => e.employeeId === currentUser.id);
  if (from)        data = data.filter(e => e.date >= from);
  if (to)          data = data.filter(e => e.date <= to);
  if (projFilter)  data = data.filter(e => (e.projName || '') === projFilter);
  if (inspFilter)  data = data.filter(e => String(e.employeeId) === inspFilter);
  data.sort((a, b) => b.date.localeCompare(a.date));
  if (!data.length) {
    table.innerHTML = '<div style="text-align:center;color:var(--text3);padding:24px;">조건에 맞는 데이터가 없습니다.</div>';
    return;
  }
  const totalReg = data.reduce((s, e) => s + (Number(e.regular) || 0), 0);
  const totalOt  = data.reduce((s, e) => s + (Number(e.ot)      || 0), 0);
  const totalMd  = ((totalReg + totalOt * 1.5) / 8).toFixed(2);
  const colspan  = isAdmin ? 3 : 2;
  let html = `<div style="overflow-x:auto;">
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr style="background:var(--surface3);">
        ${isAdmin ? '<th style="padding:9px 8px;text-align:left;border:1px solid var(--border);color:var(--text2);">이름</th>' : ''}
        <th style="padding:9px 8px;text-align:left;border:1px solid var(--border);color:var(--text2);">프로젝트</th>
        <th style="padding:9px 8px;text-align:left;border:1px solid var(--border);color:var(--text2);">작업내용</th>
        <th style="padding:9px 8px;text-align:right;border:1px solid var(--border);color:var(--text2);">정규</th>
        <th style="padding:9px 8px;text-align:right;border:1px solid var(--border);color:var(--text2);">잔업/특근</th>
        <th style="padding:9px 8px;text-align:right;border:1px solid var(--border);color:var(--text2);">M/D</th>
      </tr></thead>
      <tbody>`;
  data.forEach(e => {
    const reg = Number(e.regular) || 0;
    const ot  = Number(e.ot)      || 0;
    const md  = ((reg + ot * 1.5) / 8).toFixed(2);
    html += `<tr>
      ${isAdmin ? `<td style="padding:8px;border:1px solid var(--border);">${md_esc(e.employeeName || '')}</td>` : ''}
      <td style="padding:8px;border:1px solid var(--border);color:var(--text2);">${md_esc(e.projCode || '')}</td>
      <td style="padding:8px;border:1px solid var(--border);color:var(--text2);">${md_esc(e.projName || '')}</td>
      <td style="padding:8px;text-align:right;border:1px solid var(--border);">${reg > 0 ? reg.toFixed(1) + 'h' : '-'}</td>
      <td style="padding:8px;text-align:right;border:1px solid var(--border);color:var(--accent4);">${ot > 0 ? ot.toFixed(1) + 'h' : '-'}</td>
      <td style="padding:8px;text-align:right;border:1px solid var(--border);"><strong style="color:var(--accent4);">${md}</strong></td>
    </tr>`;
  });
  html += `<tr style="background:var(--surface3);font-weight:600;">
    <td colspan="${colspan}" style="padding:8px;border:1px solid var(--border);">합계 (${data.length}건)</td>
    <td style="padding:8px;text-align:right;border:1px solid var(--border);">${totalReg.toFixed(1)}h</td>
    <td style="padding:8px;text-align:right;border:1px solid var(--border);color:var(--accent4);">${totalOt > 0 ? totalOt.toFixed(1) + 'h' : '-'}</td>
    <td style="padding:8px;text-align:right;border:1px solid var(--border);"><strong style="color:var(--accent4);">${totalMd}</strong></td>
  </tr>
  </tbody></table></div>`;
  table.innerHTML = html;
}

function md_refreshProjectFilter() {
  const sel = document.getElementById('md-f-proj');
  if (!sel) return;
  const usedNames = [...new Set(state.mdEntries.map(e => e.projName || '').filter(Boolean))].sort();
  sel.innerHTML = '<option value="">전체 프로젝트</option>' +
    usedNames.map(n => `<option value="${md_esc(n)}">${md_esc(n)}</option>`).join('');
  // 관리자 검사관 필터
  const inspSel = document.getElementById('md-f-insp');
  if (inspSel && currentUser?.role === 'admin') {
    inspSel.innerHTML = '<option value="">전체 인원</option>' +
      state.employees.map(e => `<option value="${e.id}">${md_esc(e.name)} ${md_esc(e.position || '')}</option>`).join('');
  }
}

function md_quickFilter(type) {
  const today = new Date();
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (type === 'today') {
    const t = fmt(today);
    document.getElementById('md-f-from').value = t;
    document.getElementById('md-f-to').value   = t;
  } else if (type === 'week') {
    const day = today.getDay();
    const mon = new Date(today); mon.setDate(today.getDate() - (day === 0 ? 6 : day - 1));
    const sun = new Date(mon);  sun.setDate(mon.getDate() + 6);
    document.getElementById('md-f-from').value = fmt(mon);
    document.getElementById('md-f-to').value   = fmt(sun);
  } else if (type === 'month') {
    document.getElementById('md-f-from').value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
    document.getElementById('md-f-to').value   = fmt(today);
  }
  md_renderSummary();
}

function md_deleteEntry(id) {
  if (!currentUser) return;
  const entry = state.mdEntries.find(e => e.id === id);
  if (!entry) return;
  if (currentUser.role !== 'admin' && entry.employeeId !== currentUser.id) {
    showToast('삭제 권한이 없습니다.', 'error'); return;
  }
  if (!confirm('이 기록을 삭제하시겠습니까?')) return;
  state.mdEntries = state.mdEntries.filter(e => e.id !== id);
  saveLocal();
  showToast('삭제 완료', 'success');
  md_renderRecent();
  md_renderSummary();
  saveToSheet();
}

function md_exportCSV() {
  if (!currentUser) return;
  const isAdmin = currentUser.role === 'admin';
  const data = isAdmin
    ? state.mdEntries
    : state.mdEntries.filter(e => e.employeeId === currentUser.id);
  if (!data.length) { showToast('내보낼 데이터가 없습니다.', 'error'); return; }
  const headers = ['날짜', '이름', '프로젝트코드', '프로젝트명', '아이템', '업무', '정규(h)', '야근(h)', 'M/D'];
  const rows = data.map(e => [
    e.date, e.employeeName, e.projCode, e.projName, e.item, e.work,
    e.regular, e.ot, ((e.regular + e.ot * 1.5) / 8).toFixed(2)
  ]);
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `manday_${todayStr()}.csv`; a.click();
  URL.revokeObjectURL(url);
  showToast('CSV 내보내기 완료', 'success');
}
