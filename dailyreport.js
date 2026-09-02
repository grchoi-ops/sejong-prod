/* ============================================================
   dailyreport.js — 일일업무보고서(생산부) 모듈 (탭⑪)
   날짜별 서술형 결재 문서. 저장은 기존 state.dailyReports를 통해
   app.js의 서버 저장(Supabase)·로컬 백업 경로를 그대로 공유한다.
   ============================================================ */

const DR_SECTIONS = ['today', 'heavy', 'next'];
const DR_MIN_ROWS = { today: 4, heavy: 2, next: 4 };
const DR_TITLES = {
  today: '금일 업무 진행 상황',
  heavy: '금일 중량물 취급 계획',
  next:  '익일 업무 계획'
};
const DR_COLS = {
  today: ['프로젝트명', '주요 업무 / 공정 내용', '진척도', '비고'],
  heavy: ['프로젝트명', '취급 내용 / 중량 / 장비', '중량', '비고'],
  next:  ['프로젝트명', '주요 업무 / 공정 내용', '진척도', '비고']
};
const DR_PH = {
  today: { proj: '프로젝트', work: '작업 내용', pct: '%', note: '' },
  heavy: { proj: '프로젝트', work: '인양 대상 · 사용 장비 · 슬링 규격', pct: '톤', note: '' },
  next:  { proj: '프로젝트', work: '작업 계획', pct: '%', note: '' }
};

let _drInitialized = false;
let _drDate = null;
let _drSaveTimer = null;
let _drLoading = false;
let _drAcBox = null, _drAcInput = null, _drAcIdx = -1;
let _drToastTimer = null;

/* ── 날짜 유틸 (DAYS_KO는 app.js 전역) ── */
function drIso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function drParse(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function drShift(s, n) { const d = drParse(s); d.setDate(d.getDate() + n); return drIso(d); }
function drTodayStr() { return drIso(new Date()); }
function drKorDate(s) { const d = drParse(s); return `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getDate()).padStart(2, '0')} (${DAYS_KO[d.getDay()]})`; }
function drEsc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function drIsViewer() { return (currentUser && currentUser.mdRole === '열람용'); }

/* ══════════════════════════════════════════
   초기화
   ══════════════════════════════════════════ */
function drInit() {
  if (!_drInitialized) {
    drInjectStyle();
    drBuildShell();
    _drInitialized = true;
  }
  drApplyRolePermissions();
  drLoad(_drDate || drTodayStr());
}

// 데이터 복원(JSON 백업 복원) 후 현재 탭이 열려 있으면 다시 그린다
function drRefresh() {
  if (!_drInitialized) return;
  drRenderHistoryList();
  drLoad(_drDate || drTodayStr(), { noCarry: true });
}

function drApplyRolePermissions() {
  const root = document.getElementById('dr-root');
  if (!root) return;
  const viewer = drIsViewer();
  root.classList.toggle('dr-readonly', !!viewer);
  const notice = document.getElementById('dr-viewer-notice');
  if (notice) notice.hidden = !viewer;
  const carryBtn = document.getElementById('dr-carry-btn');
  if (carryBtn) carryBtn.disabled = !!viewer;
  const saveBtn = document.getElementById('dr-save-btn');
  if (saveBtn) saveBtn.style.display = viewer ? 'none' : '';
  drSetCellsEditable(!viewer);
}

// 열람용 계정: 모든 입력 셀을 편집 불가로 전환 (내용은 그대로 보이고 복사만 가능)
function drSetCellsEditable(editable) {
  const sheet = document.getElementById('dr-sheet');
  if (!sheet) return;
  sheet.querySelectorAll('.dr-cell').forEach(el => { el.contentEditable = editable ? 'plaintext-only' : 'false'; });
  sheet.querySelectorAll('textarea.dr-work').forEach(el => { el.readOnly = !editable; });
}

/* ══════════════════════════════════════════
   화면 골격 생성 (최초 1회)
   ══════════════════════════════════════════ */
function drBuildShell() {
  const root = document.getElementById('dr-root');
  root.innerHTML = `
    <div class="card">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <div class="date-nav">
          <button id="dr-prev" title="전일">‹</button>
          <div class="date-display"><input type="date" id="dr-date"></div>
          <button id="dr-next" title="익일">›</button>
        </div>
        <div id="dr-dow" style="font-size:13px;color:var(--text2);"></div>
        <button class="btn btn-success btn-sm" id="dr-save-btn" title="로컬 저장 + 서버 저장을 즉시 실행합니다 (Ctrl+S)">✓ 저장</button>
        <button class="btn btn-ghost btn-sm" id="dr-today-btn">오늘</button>
        <button class="btn btn-ghost btn-sm" id="dr-carry-btn" title="금일 진행상황을 익일 계획으로 복사">익일 계획으로 복사</button>
        <div style="margin-left:auto;display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
          <div class="dr-fit" id="dr-fit"><span id="dr-fit-lab">1장 여유</span><span class="dr-fitbar"><i id="dr-fit-fill"></i></span></div>
          <span class="dr-save-status" id="dr-save-status"></span>
          <button class="btn btn-ghost btn-sm" id="dr-hist-btn">📁 기록</button>
          <button class="btn btn-primary" id="dr-print-btn">🖨️ 인쇄</button>
        </div>
      </div>
    </div>
    <div id="dr-viewer-notice" class="dr-notice" hidden>열람 전용 계정입니다. 작성·저장은 관리자·검사관만 가능합니다.</div>

    <div class="dr-wrap">
      <div class="dr-sheet" id="dr-sheet">
        <table class="dr-head">
          <colgroup><col style="width:58%"><col style="width:14%"><col style="width:14%"><col style="width:14%"></colgroup>
          <tr>
            <td rowspan="2" class="dr-titlecell">
              <div class="dr-doctitle">일일업무보고서</div>
              <div class="dr-dept">[ <span class="dr-cell" contenteditable="plaintext-only" id="dr-dept">생산부</span> ]</div>
              <div class="dr-repdate">보고일자 : <span id="dr-repdate-txt"></span></div>
            </td>
            <th>작성</th><th>검토</th><th>결재</th>
          </tr>
          <tr>
            <td class="dr-sign"></td><td class="dr-sign"></td><td class="dr-sign"></td>
          </tr>
        </table>

        ${DR_SECTIONS.map(sec => `
        <section class="dr-block${sec === 'heavy' ? ' dr-heavy' : ''}" data-key="${sec}">
          <h2 class="dr-sec">${DR_TITLES[sec]}</h2>
          <table class="dr-tbl">
            <colgroup><col style="width:17%"><col style="width:57%"><col style="width:11%"><col style="width:15%"></colgroup>
            <thead><tr>${DR_COLS[sec].map(c => `<th>${c}</th>`).join('')}</tr></thead>
            <tbody id="dr-tbody-${sec}"></tbody>
          </table>
          <button class="dr-addrow no-print" data-sec="${sec}">+ 행 추가</button>
        </section>`).join('')}
      </div>
    </div>

    <aside class="dr-drawer no-print" id="dr-drawer">
      <div class="dr-drawer-head">
        <strong>작성 기록</strong>
        <button id="dr-drawer-close" title="닫기">×</button>
      </div>
      <input class="dr-drawer-q" id="dr-drawer-q" placeholder="프로젝트명·업무 내용 검색">
      <div class="dr-drawer-list" id="dr-drawer-list"></div>
      <div class="dr-drawer-foot">
        <button class="btn btn-ghost btn-sm" id="dr-export-csv">CSV 내보내기</button>
      </div>
    </aside>

    <div class="dr-toast" id="dr-toast"><span id="dr-toast-msg"></span><button id="dr-toast-act" hidden></button></div>
  `;

  DR_SECTIONS.forEach(sec => drEnsureMinRows(sec));

  // 이벤트 위임
  root.addEventListener('input', e => {
    if (e.target.matches('.dr-cell, .dr-work, .dr-input')) {
      if (e.target.classList.contains('dr-work')) drAutoGrow(e.target);
      drScheduleSave();
      if (e.target.classList.contains('dr-proj')) drOpenAc(e.target);
    }
  });
  root.addEventListener('focusin', e => {
    if (e.target.classList && e.target.classList.contains('dr-proj')) drOpenAc(e.target);
    else drCloseAc();
  });
  root.addEventListener('focusout', e => {
    const t = e.target;
    if (t.classList && t.classList.contains('dr-pct')) {
      const sec = t.closest('.dr-block').dataset.key;
      const v = t.textContent.trim();
      if (/^\d+(\.\d+)?$/.test(v)) t.textContent = v + (sec === 'heavy' ? 'TON' : '%');
    }
    setTimeout(() => { if (!root.contains(document.activeElement)) drCloseAc(); }, 0);
  });
  root.addEventListener('keydown', e => {
    const t = e.target;
    if (t.classList && t.classList.contains('dr-proj') && _drAcBox && _drAcInput === t) {
      if (e.key === 'ArrowDown') { e.preventDefault(); drMoveAc(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); drMoveAc(-1); return; }
      if (e.key === 'Enter' && _drAcIdx >= 0) { e.preventDefault(); drPickAc(_drAcBox.children[_drAcIdx].textContent); return; }
      if (e.key === 'Escape') { e.preventDefault(); drCloseAc(); return; }
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      const tr = t.closest ? t.closest('tr.dr-line') : null;
      if (!tr) return;
      e.preventDefault();
      const sec = tr.closest('.dr-block').dataset.key;
      const nr = drMakeRow(sec);
      tr.after(nr);
      nr.querySelector('.dr-proj').focus();
      drScheduleSave();
    }
  });
  root.querySelectorAll('.dr-addrow').forEach(b => {
    b.addEventListener('click', () => {
      const sec = b.dataset.sec;
      const row = drMakeRow(sec);
      drTbody(sec).appendChild(row);
      row.querySelector('.dr-proj').focus();
      drScheduleSave();
    });
  });

  document.getElementById('dr-date').addEventListener('change', e => drLoad(e.target.value));
  document.getElementById('dr-prev').addEventListener('click', () => drLoad(drShift(_drDate, -1)));
  document.getElementById('dr-next').addEventListener('click', () => drLoad(drShift(_drDate, 1)));
  document.getElementById('dr-save-btn').addEventListener('click', drSaveToServer);
  document.getElementById('dr-today-btn').addEventListener('click', () => drLoad(drTodayStr()));
  document.getElementById('dr-carry-btn').addEventListener('click', drCarryToNext);
  document.getElementById('dr-print-btn').addEventListener('click', drPrint);
  document.getElementById('dr-hist-btn').addEventListener('click', () => {
    document.getElementById('dr-drawer').classList.add('open');
    drRenderHistoryList();
  });
  document.getElementById('dr-drawer-close').addEventListener('click', () => document.getElementById('dr-drawer').classList.remove('open'));
  document.getElementById('dr-drawer-q').addEventListener('input', drRenderHistoryList);
  document.getElementById('dr-export-csv').addEventListener('click', drExportCsv);

  root.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      drSaveToServer();
    }
  });
}

function drAutoGrow(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

/* ══════════════════════════════════════════
   행(row) 관리
   ══════════════════════════════════════════ */
function drTbody(sec) { return document.getElementById('dr-tbody-' + sec); }

function drMakeRow(sec, data) {
  const tr = document.createElement('tr');
  tr.className = 'dr-line';

  const tdProj = document.createElement('td');
  tdProj.className = 'proj';
  const tools = document.createElement('div');
  tools.className = 'dr-rowtools no-print';
  const delBtn = document.createElement('button');
  delBtn.type = 'button'; delBtn.textContent = '×'; delBtn.title = '행 삭제';
  delBtn.onclick = () => { tr.remove(); drEnsureMinRows(sec); drScheduleSave(); };
  const insBtn = document.createElement('button');
  insBtn.type = 'button'; insBtn.textContent = '+'; insBtn.title = '아래에 행 추가';
  insBtn.onclick = () => { const nr = drMakeRow(sec); tr.after(nr); drScheduleSave(); };
  tools.append(delBtn, insBtn);
  const projSpan = document.createElement('div');
  projSpan.className = 'dr-cell dr-proj';
  projSpan.contentEditable = 'plaintext-only';
  projSpan.dataset.f = 'proj';
  projSpan.dataset.ph = DR_PH[sec].proj;
  projSpan.textContent = (data && data.proj) || '';
  tdProj.append(tools, projSpan);

  const tdWork = document.createElement('td');
  tdWork.className = 'work';
  const work = document.createElement('textarea');
  work.className = 'dr-input dr-work';
  work.rows = 1;
  work.placeholder = DR_PH[sec].work;
  work.value = (data && data.work) || '';
  tdWork.appendChild(work);

  const tdPct = document.createElement('td');
  tdPct.className = 'pct';
  const pctSpan = document.createElement('div');
  pctSpan.className = 'dr-cell dr-pct';
  pctSpan.contentEditable = 'plaintext-only';
  pctSpan.dataset.f = 'pct';
  pctSpan.dataset.ph = DR_PH[sec].pct;
  pctSpan.textContent = (data && data.pct) || '';
  tdPct.appendChild(pctSpan);

  const tdNote = document.createElement('td');
  tdNote.className = 'note';
  const noteSpan = document.createElement('div');
  noteSpan.className = 'dr-cell dr-note';
  noteSpan.contentEditable = 'plaintext-only';
  noteSpan.dataset.f = 'note';
  noteSpan.dataset.ph = DR_PH[sec].note;
  noteSpan.textContent = (data && data.note) || '';
  tdNote.appendChild(noteSpan);

  tr.append(tdProj, tdWork, tdPct, tdNote);
  requestAnimationFrame(() => drAutoGrow(work));
  return tr;
}

function drEnsureMinRows(sec) {
  const tb = drTbody(sec);
  while (tb.children.length < DR_MIN_ROWS[sec]) tb.appendChild(drMakeRow(sec));
}

function drReadSection(sec) {
  return [...drTbody(sec).children].map(tr => ({
    proj: tr.querySelector('.dr-proj').textContent.replace(/\u00a0/g, ' ').trim(),
    work: tr.querySelector('.dr-work').value.trim(),
    pct:  tr.querySelector('.dr-pct').textContent.replace(/\u00a0/g, ' ').trim(),
    note: tr.querySelector('.dr-note').textContent.trim()
  }));
}

function drWriteSection(sec, rows) {
  const tb = drTbody(sec);
  tb.innerHTML = '';
  (rows || []).forEach(r => tb.appendChild(drMakeRow(sec, r)));
  drEnsureMinRows(sec);
}

const drNotEmpty = r => !!(r.proj || r.work || r.pct || r.note);

/* ══════════════════════════════════════════
   1장 채움 게이지
   ══════════════════════════════════════════ */
const DR_MM = 96 / 25.4;
function drRecalcFit() {
  const sheet = document.getElementById('dr-sheet');
  if (!sheet) return;
  const avail = 297 * DR_MM - 24 * DR_MM; // A4 높이 - 상하 여백 12mm
  const pad = 12 * 2 * DR_MM;
  let used = sheet.scrollHeight - pad;
  sheet.querySelectorAll('tr.dr-line').forEach(tr => {
    const empty = !drNotEmpty({
      proj: tr.querySelector('.dr-proj').textContent.trim(),
      work: tr.querySelector('.dr-work').value.trim(),
      pct: tr.querySelector('.dr-pct').textContent.trim(),
      note: tr.querySelector('td.note .dr-cell').textContent.trim()
    });
    if (empty) used -= tr.offsetHeight;
  });
  sheet.querySelectorAll('.dr-addrow').forEach(b => { used -= b.offsetHeight + 6; });
  const r = Math.max(0, used / avail);
  const fill = document.getElementById('dr-fit-fill');
  const lab = document.getElementById('dr-fit-lab');
  const wrap = document.getElementById('dr-fit');
  if (!fill) return;
  fill.style.width = Math.min(100, r * 100) + '%';
  wrap.classList.toggle('warn', r > 1);
  lab.textContent = r > 1 ? `1장 초과 ${Math.round((r - 1) * 100)}%` : `1장 ${Math.round(r * 100)}%`;
}

/* ══════════════════════════════════════════
   불러오기 / 저장
   ══════════════════════════════════════════ */
function drCollect() {
  const o = {
    dept: document.getElementById('dr-dept').textContent.trim() || '생산부',
    writer: localStorage.getItem('sejong_user_name') || '',
    updatedAt: Date.now()
  };
  DR_SECTIONS.forEach(s => { o[s] = drReadSection(s).filter(drNotEmpty); });
  return o;
}

function drApplyRecord(rec) {
  _drLoading = true;
  document.getElementById('dr-dept').textContent = (rec && rec.dept) || '생산부';
  DR_SECTIONS.forEach(s => drWriteSection(s, rec ? rec[s] : []));
  _drLoading = false;
  drSetCellsEditable(!drIsViewer());
  document.getElementById('dr-dept').contentEditable = drIsViewer() ? 'false' : 'plaintext-only';
  drRecalcFit();
}

function drLoad(date, opts) {
  clearTimeout(_drSaveTimer);
  _drDate = date;
  document.getElementById('dr-date').value = date;
  document.getElementById('dr-dow').textContent = DAYS_KO[drParse(date).getDay()] + '요일';
  document.getElementById('dr-repdate-txt').textContent = drKorDate(date);

  const rec = (state.dailyReports || {})[date];
  if (rec) {
    drApplyRecord(rec);
    drUpdateSaveStatus('저장됨');
    return;
  }

  // 신규 — 직전 보고서의 익일 계획을 금일 진행상황으로 승계
  const prevDates = Object.keys(state.dailyReports || {}).filter(d => d < date).sort();
  const prevDate = prevDates[prevDates.length - 1];
  const prev = prevDate ? state.dailyReports[prevDate] : null;
  drApplyRecord(null);
  drUpdateSaveStatus('');

  if (prev && prev.next && prev.next.length && !(opts && opts.noCarry) && !drIsViewer()) {
    drWriteSection('today', prev.next.map(r => ({ proj: r.proj, work: r.work, pct: r.pct, note: r.note })));
    drRecalcFit();
    drToast(`${drKorDate(prevDate).replace(/\s/g, '')}의 익일 계획을 불러왔습니다`, '되돌리기', () => {
      drWriteSection('today', []);
      drScheduleSave();
    });
  }
}

function drScheduleSave() {
  if (_drLoading || drIsViewer()) return;
  drUpdateSaveStatus('저장 중…');
  clearTimeout(_drSaveTimer);
  _drSaveTimer = setTimeout(drSaveNow, 700);
  drRecalcFit();
}

function drSaveNow() {
  if (drIsViewer()) return;
  const rec = drCollect();
  const hasAny = DR_SECTIONS.some(s => rec[s].length);
  if (!state.dailyReports) state.dailyReports = {};
  if (hasAny) {
    state.dailyReports[_drDate] = rec;
  } else {
    delete state.dailyReports[_drDate];
  }
  saveState();
  const t = new Date();
  drUpdateSaveStatus(`저장됨 ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`);
  if (document.getElementById('dr-drawer').classList.contains('open')) drRenderHistoryList();
}

function drUpdateSaveStatus(text) {
  const el = document.getElementById('dr-save-status');
  if (el) el.textContent = text;
}

// ✓ 저장 버튼 / Ctrl+S — 로컬 즉시 저장 + 서버(Supabase) 즉시 저장 (③워크오더·④일일 입력의 saveDailyData()와 동일한 흐름)
async function drSaveToServer() {
  if (drIsViewer()) return;
  clearTimeout(_drSaveTimer);
  drSaveNow();

  const btn = document.getElementById('dr-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 저장 중...'; }
  drToast('서버에 저장 중...');
  try {
    await saveToSheet();
    drToast('저장 완료');
  } catch (e) {
    drToast('서버 저장 실패 (로컬엔 저장됨)');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✓ 저장'; }
  }
}

function drCarryToNext() {
  if (drIsViewer()) return;
  const rows = drReadSection('today').filter(drNotEmpty);
  if (!rows.length) { drToast('금일 진행상황이 비어 있습니다'); return; }
  const before = drReadSection('next');
  drWriteSection('next', rows);
  drScheduleSave();
  drToast(`${rows.length}개 항목을 익일 계획으로 복사했습니다`, '되돌리기', () => {
    drWriteSection('next', before);
    drScheduleSave();
  });
}

/* ══════════════════════════════════════════
   프로젝트명 자동완성
   ══════════════════════════════════════════ */
function drProjectNames() {
  const names = new Set();
  (state.projects || []).forEach(p => p.client && names.add(p.client));
  Object.values(state.dailyReports || {}).forEach(rec => {
    DR_SECTIONS.forEach(s => (rec[s] || []).forEach(r => r.proj && names.add(r.proj)));
  });
  return [...names];
}

function drCloseAc() {
  if (_drAcBox) { _drAcBox.remove(); _drAcBox = null; _drAcInput = null; _drAcIdx = -1; }
}

function drOpenAc(cell) {
  const typed = cell.textContent.trim();
  const hits = drProjectNames()
    .filter(p => p && p !== typed && (!typed || p.toLowerCase().includes(typed.toLowerCase())))
    .slice(0, 7);
  drCloseAc();
  if (!hits.length) return;
  const r = cell.getBoundingClientRect();
  _drAcBox = document.createElement('div');
  _drAcBox.className = 'dr-ac no-print';
  _drAcBox.style.left = (r.left + window.scrollX) + 'px';
  _drAcBox.style.top = (r.bottom + window.scrollY + 2) + 'px';
  _drAcBox.style.minWidth = r.width + 'px';
  hits.forEach(p => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = p;
    b.onmousedown = e => { e.preventDefault(); drPickAc(p); };
    _drAcBox.appendChild(b);
  });
  document.body.appendChild(_drAcBox);
  _drAcInput = cell; _drAcIdx = -1;
}

function drPickAc(v) {
  if (!_drAcInput) return;
  _drAcInput.textContent = v;
  const cell = _drAcInput;
  drCloseAc();
  const next = cell.closest('tr').querySelector('.dr-work');
  if (next) next.focus();
  drScheduleSave();
}

function drMoveAc(n) {
  if (!_drAcBox) return;
  const bs = [..._drAcBox.children];
  _drAcIdx = (_drAcIdx + n + bs.length + 1) % (bs.length + 1) - 1;
  bs.forEach((b, i) => b.classList.toggle('on', i === _drAcIdx));
  if (_drAcIdx >= 0) bs[_drAcIdx].scrollIntoView({ block: 'nearest' });
}

/* ══════════════════════════════════════════
   토스트 (되돌리기 액션 지원)
   ══════════════════════════════════════════ */
function drToast(msg, actLabel, act) {
  document.getElementById('dr-toast-msg').textContent = msg;
  const b = document.getElementById('dr-toast-act');
  if (actLabel) { b.hidden = false; b.textContent = actLabel; b.onclick = () => { act(); drHideToast(); }; }
  else b.hidden = true;
  document.getElementById('dr-toast').classList.add('on');
  clearTimeout(_drToastTimer);
  _drToastTimer = setTimeout(drHideToast, actLabel ? 7000 : 2600);
}
function drHideToast() { document.getElementById('dr-toast').classList.remove('on'); }

/* ══════════════════════════════════════════
   작성 기록 조회
   ══════════════════════════════════════════ */
function drRenderHistoryList() {
  const q = (document.getElementById('dr-drawer-q').value || '').trim().toLowerCase();
  const list = document.getElementById('dr-drawer-list');
  const dates = Object.keys(state.dailyReports || {}).sort((a, b) => b.localeCompare(a));
  let items = dates.map(d => {
    const rec = state.dailyReports[d];
    const first = rec.today[0];
    const sum = first ? ((first.proj ? first.proj + ' · ' : '') + (first.work || '')).split('\n')[0].slice(0, 60) : '(내용 없음)';
    const n = (rec.today || []).length + (rec.heavy || []).length + (rec.next || []).length;
    return { date: d, sum, n };
  });
  if (q) items = items.filter(it => (it.date + ' ' + it.sum).toLowerCase().includes(q));
  if (!items.length) {
    list.innerHTML = `<div class="dr-empty">${dates.length ? '검색 결과가 없습니다.' : '작성한 보고서가 여기에 날짜별로 쌓입니다.'}</div>`;
    return;
  }
  list.innerHTML = items.map(it => `
    <button type="button" class="dr-item${it.date === _drDate ? ' cur' : ''}" data-date="${it.date}">
      <div class="dr-item-d">${it.date.slice(5).replace('-', '. ')} (${DAYS_KO[drParse(it.date).getDay()]}) <span class="dr-item-n">${it.n}건</span></div>
      <div class="dr-item-s">${drEsc(it.sum)}</div>
    </button>`).join('');
  list.querySelectorAll('.dr-item').forEach(b => {
    b.addEventListener('click', () => drLoad(b.dataset.date, { noCarry: true }));
  });
}

/* ══════════════════════════════════════════
   CSV 내보내기 (기존 md_exportCSV 컨벤션과 동일한 방식)
   ══════════════════════════════════════════ */
function drExportCsv() {
  const dates = Object.keys(state.dailyReports || {}).sort();
  if (!dates.length) { showToast('내보낼 데이터가 없습니다.', 'error'); return; }
  const LAB = { today: '금일 진행상황', heavy: '중량물 취급계획', next: '익일 계획' };
  const headers = ['보고일자', '구분', '프로젝트명', '업무 내용', '진척도/중량', '비고'];
  const rows = [];
  dates.forEach(d => {
    const rec = state.dailyReports[d];
    DR_SECTIONS.forEach(s => (rec[s] || []).forEach(v =>
      rows.push([d, LAB[s], v.proj, (v.work || '').replace(/\n/g, ' / '), v.pct, v.note])
    ));
  });
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c || '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `일일업무보고서_${todayStr()}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  showToast(`${rows.length}개 항목을 CSV로 저장했습니다`, 'success');
}

/* ══════════════════════════════════════════
   인쇄 — 팝업창 + @page margin:0 방식 (기존 워크오더/특근보고서와 동일한 패턴)
   ══════════════════════════════════════════ */
function drBuildPrintTable(sec, rows) {
  const visible = rows.filter(drNotEmpty);
  if (!visible.length) return '';
  const tds = r => `
    <tr>
      <td class="p">${drEsc(r.proj)}</td>
      <td class="w">${drEsc(r.work).replace(/\n/g, '<br>')}</td>
      <td class="c">${drEsc(r.pct)}</td>
      <td class="n">${drEsc(r.note)}</td>
    </tr>`;
  return `
    <section class="dr-print-block${sec === 'heavy' ? ' dr-print-heavy' : ''}">
      <h2 class="dr-print-sec">${DR_TITLES[sec]}</h2>
      <table class="dr-print-tbl">
        <colgroup><col style="width:17%"><col style="width:57%"><col style="width:11%"><col style="width:15%"></colgroup>
        <thead><tr>${DR_COLS[sec].map(c => `<th>${c}</th>`).join('')}</tr></thead>
        <tbody>${visible.map(tds).join('')}</tbody>
      </table>
    </section>`;
}

function drPrint() {
  clearTimeout(_drSaveTimer);
  const rec = drCollect();
  const dateStr = drKorDate(_drDate);
  const css = [
    '@page { size: A4 portrait; margin: 0; }',
    'html, body { margin:0; padding:0; }',
    'body { font-family:"맑은 고딕","Malgun Gothic",sans-serif; color:#14263A; -webkit-print-color-adjust:exact; print-color-adjust:exact; }',
    '.dr-print-sheet { width:210mm; min-height:297mm; padding:12mm 12mm; box-sizing:border-box; font-size:10.5pt; line-height:1.4; }',
    'table.dr-print-head { width:calc(100% - 1px); border-collapse:collapse; table-layout:fixed; margin-bottom:5mm; }',
    '.dr-print-head th, .dr-print-head td { border:1px solid #243447; box-sizing:border-box; }',
    '.dr-print-head th { height:8mm; font-size:11pt; text-align:center; background:#F2F4F6; }',
    '.dr-print-head .dr-print-signbox { height:17mm; }',
    '.dr-print-titlecell { padding:10px 14px; vertical-align:middle; }',
    '.dr-print-doctitle { font-size:20pt; font-weight:700; letter-spacing:10px; text-indent:10px; margin-bottom:5px; }',
    '.dr-print-dept { font-size:13pt; font-weight:600; letter-spacing:3px; margin-bottom:4px; }',
    '.dr-print-repdate { font-size:10.5pt; }',
    '.dr-print-block { break-inside:avoid; margin-bottom:6mm; }',
    '.dr-print-sec { font-size:12pt; font-weight:700; margin-bottom:3mm; }',
    '.dr-print-sec::before { content:"■ "; }',
    'table.dr-print-tbl { width:calc(100% - 1px); border-collapse:collapse; table-layout:fixed; }',
    '.dr-print-tbl th, .dr-print-tbl td { border:1px solid #9AA5B1; padding:4px 6px; vertical-align:top; word-break:break-word; white-space:pre-wrap; box-sizing:border-box; }',
    '.dr-print-tbl th { background:#EEF1F4; text-align:center; font-weight:600; border-color:#243447; }',
    '.dr-print-tbl td.p { font-weight:600; }',
    '.dr-print-tbl td.c { text-align:center; }',
    '.dr-print-heavy .dr-print-tbl th { background:#FBEDE7; border-color:#E0561F; }',
    '.dr-print-heavy .dr-print-tbl { border-top:2px solid #E0561F; }'
  ].join('\n');

  const bodyHTML = `
    <div class="dr-print-sheet">
      <table class="dr-print-head">
        <colgroup><col style="width:58%"><col style="width:14%"><col style="width:14%"><col style="width:14%"></colgroup>
        <tr>
          <td rowspan="2" class="dr-print-titlecell">
            <div class="dr-print-doctitle">일일업무보고서</div>
            <div class="dr-print-dept">[ ${drEsc(rec.dept)} ]</div>
            <div class="dr-print-repdate">보고일자 : ${dateStr}</div>
          </td>
          <th>작성</th><th>검토</th><th>결재</th>
        </tr>
        <tr>
          <td class="dr-print-signbox"></td><td class="dr-print-signbox"></td><td class="dr-print-signbox"></td>
        </tr>
      </table>
      ${DR_SECTIONS.map(s => drBuildPrintTable(s, rec[s])).join('')}
    </div>`;

  const html = '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">' +
    '<title>일일업무보고서_생산부_' + _drDate + '</title>' +
    '<style>' + css + '</style></head><body>' +
    bodyHTML +
    '<script>window.onload=function(){window.print();}<\/script>' +
    '</body></html>';

  const win = window.open('', '_blank', 'width=900,height=1000');
  if (!win) { showToast('팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요.', 'error'); return; }
  win.document.write(html);
  win.document.close();
  showToast('일일업무보고서 인쇄', 'success');
}

/* ══════════════════════════════════════════
   화면 스타일 (다크 테마 크롬 + 흰색 문서 시트)
   ══════════════════════════════════════════ */
function drInjectStyle() {
  if (document.getElementById('dr-style')) return;
  const s = document.createElement('style');
  s.id = 'dr-style';
  s.textContent = `
    .dr-notice { background:rgba(255,179,71,0.12); color:var(--accent4); font-size:12px; padding:8px 14px; border:1px solid rgba(255,179,71,0.3); border-radius:6px; margin-bottom:12px; }
    .dr-wrap { display:flex; justify-content:center; padding-bottom:40px; }
    .dr-sheet {
      width:210mm; max-width:100%; background:#fff; color:#14263A;
      padding:13mm 12mm; box-shadow:var(--shadow); border-radius:4px;
      font-family:'맑은 고딕','Malgun Gothic',sans-serif; font-size:11pt; line-height:1.42;
    }
    .dr-head { width:100%; border-collapse:collapse; table-layout:fixed; margin-bottom:14px; }
    .dr-head th, .dr-head td { border:1px solid #243447; box-sizing:border-box; }
    .dr-head th { height:8mm; font-size:0.85em; text-align:center; background:#F2F4F6; }
    .dr-sign { height:17mm; }
    .dr-titlecell { padding:11px 14px; vertical-align:middle; }
    .dr-doctitle { font-size:1.8em; font-weight:700; letter-spacing:.5em; text-indent:.5em; margin:0 0 6px; }
    .dr-dept { font-size:1.05em; font-weight:600; letter-spacing:.18em; margin-bottom:4px; }
    .dr-repdate { font-size:.9em; color:#333; margin-top:2px; }

    .dr-block { margin-bottom:16px; }
    .dr-sec { margin:0 0 7px; font-size:1.05em; font-weight:700; display:flex; align-items:baseline; gap:7px; }
    .dr-sec::before { content:"■"; color:#243447; font-size:.8em; }

    table.dr-tbl { width:100%; border-collapse:collapse; table-layout:fixed; }
    .dr-tbl th, .dr-tbl td { border:1px solid #9AA5B1; padding:4px 6px; vertical-align:top; box-sizing:border-box; }
    .dr-tbl th { background:#EEF1F4; font-weight:600; font-size:.9em; text-align:center; border-color:#243447; padding:5px 4px; }
    .dr-heavy .dr-tbl th { background:#FBEDE7; border-color:var(--accent4); }
    .dr-heavy .dr-tbl { border-top:2px solid var(--accent4); }

    .dr-cell { min-height:1.42em; outline:0; white-space:pre-wrap; word-break:break-word; font-family:inherit; font-size:1em; color:#14263A; }
    .dr-cell:empty::before { content:attr(data-ph); color:#B7BFC7; }
    .dr-cell:focus { background:#FFF8E8; }
    .dr-readonly .dr-cell { cursor:default; }
    td.pct .dr-cell { text-align:center; font-variant-numeric:tabular-nums; }
    td.proj .dr-cell { font-weight:600; }

    textarea.dr-work {
      width:100%; border:0; resize:none; overflow:hidden; background:transparent;
      font-family:inherit; font-size:1em; color:#14263A; line-height:1.42; padding:0; min-height:1.42em;
    }
    textarea.dr-work::placeholder { color:#B7BFC7; }
    textarea.dr-work:focus { background:#FFF8E8; outline:0; }

    tr.dr-line { position:relative; }
    .dr-rowtools { position:absolute; left:-30px; top:2px; display:flex; flex-direction:column; gap:1px; opacity:0; transition:opacity .12s; }
    tr.dr-line:hover .dr-rowtools, tr.dr-line:focus-within .dr-rowtools { opacity:1; }
    .dr-rowtools button { width:22px; height:19px; border:1px solid #C4CCD4; background:#fff; color:#5C6B7A; border-radius:2px; cursor:pointer; font-size:12px; line-height:1; padding:0; font-family:inherit; }
    .dr-rowtools button:hover { background:#FCE9E1; border-color:var(--accent4); color:#C94A15; }
    .dr-readonly .dr-rowtools { display:none; }

    .dr-addrow { margin-top:4px; background:none; border:1px dashed #B7BFC7; color:#5C6B7A; font-family:inherit; font-size:.86em; padding:3px 10px; border-radius:2px; cursor:pointer; }
    .dr-addrow:hover { border-color:#243447; color:#243447; background:#F5F7F9; }
    .dr-readonly .dr-addrow { display:none; }
    .dr-readonly #dr-carry-btn { display:none; }

    .dr-fit { display:flex; align-items:center; gap:8px; font-size:12px; color:var(--text2); white-space:nowrap; }
    .dr-fitbar { width:104px; height:7px; background:var(--surface3); border-radius:1px; overflow:hidden; }
    .dr-fitbar i { display:block; height:100%; width:0; background:var(--accent2); transition:width .18s; }
    .dr-fit.warn i { background:var(--accent4); }
    .dr-fit.warn { color:var(--accent4); }
    .dr-save-status { font-size:12px; color:var(--text3); min-width:90px; text-align:right; white-space:nowrap; }

    /* 이력 서랍 */
    .dr-drawer { position:fixed; top:0; right:0; height:100%; width:330px; max-width:88vw; z-index:200;
      background:var(--surface); border-left:1px solid var(--border); transform:translateX(101%);
      transition:transform .2s ease; display:flex; flex-direction:column; box-shadow:-4px 0 20px rgba(0,0,0,.35); }
    .dr-drawer.open { transform:none; }
    .dr-drawer-head { padding:14px 16px 10px; font-size:14px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border); color:var(--text); }
    .dr-drawer-head button { background:none; border:0; font-size:18px; cursor:pointer; color:var(--text2); line-height:1; }
    .dr-drawer-q { margin:10px 12px; padding:7px 9px; width:calc(100% - 24px); }
    .dr-drawer-list { flex:1; overflow:auto; padding:0 8px 12px; }
    .dr-item { display:block; width:100%; text-align:left; background:var(--surface2); border:1px solid var(--border); border-radius:3px; padding:9px 11px; margin-bottom:6px; cursor:pointer; font-family:inherit; color:var(--text); }
    .dr-item:hover { border-color:var(--accent); }
    .dr-item.cur { border-color:var(--accent4); border-left-width:3px; }
    .dr-item-d { font-size:13px; font-weight:600; }
    .dr-item-n { font-weight:400; color:var(--text3); font-size:11px; }
    .dr-item-s { font-size:11.5px; color:var(--text2); margin-top:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .dr-drawer-foot { padding:10px 12px; border-top:1px solid var(--border); display:flex; gap:6px; }
    .dr-empty { padding:30px 14px; color:var(--text3); font-size:13px; line-height:1.6; text-align:center; }

    /* 자동완성 */
    .dr-ac { position:absolute; z-index:250; background:var(--surface2); border:1px solid var(--border); border-radius:3px; box-shadow:0 4px 14px rgba(0,0,0,.4); min-width:150px; max-height:180px; overflow:auto; padding:3px; }
    .dr-ac button { display:block; width:100%; text-align:left; background:none; border:0; font-family:inherit; font-size:12.5px; padding:5px 8px; border-radius:2px; cursor:pointer; color:var(--text); }
    .dr-ac button:hover, .dr-ac button.on { background:var(--surface3); }

    /* 토스트 */
    .dr-toast { position:fixed; left:50%; bottom:26px; transform:translate(-50%,14px); z-index:300;
      background:var(--surface); border:1px solid var(--border); color:var(--text); padding:11px 16px; border-radius:4px; font-size:13px;
      display:flex; align-items:center; gap:12px; opacity:0; pointer-events:none; transition:.18s; box-shadow:0 6px 22px rgba(0,0,0,.4); max-width:92vw; }
    .dr-toast.on { opacity:1; transform:translate(-50%,0); pointer-events:auto; }
    .dr-toast button { background:none; border:1px solid var(--border); color:var(--accent); font-family:inherit; font-size:12px; padding:3px 9px; border-radius:2px; cursor:pointer; white-space:nowrap; }

    @media (max-width:640px) {
      .dr-sheet { padding:8mm 6mm; }
      .dr-doctitle { font-size:1.4em; letter-spacing:.3em; text-indent:.3em; }
      .dr-drawer { width:100%; }
    }
  `;
  document.head.appendChild(s);
}
