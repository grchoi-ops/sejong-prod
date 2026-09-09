/* ============================================================
   tbm.js — TBM 회의록 모듈 (탭⑫)
   사진 뭉치를 떨구면 촬영일별로 자동 정리되고, 그날 출근자·작업예정이
   자동으로 채워진다. 밀린 날짜를 몰아서 처리하는 것이 이 화면의 목적이다.
   공용 헬퍼(EXIF 판별·압축·업로드·자동채움)는 tbm-shared.js에 있다.
   ============================================================ */


const TBM_DIV_LABEL = { 제관: '제관사', 용접: '용접사', 보조: '보조사', 가공: '가공반', 구동: '구동부', 공사: '공사부' };
const TBM_DIV_ORDER = ['제관', '용접', '보조', '가공', '구동', '공사'];

let _tbmInited = false;
let _tbmDate = null;        // 편집 중인 레코드의 날짜
let _tbmOnlyDraft = false;
let _tbmIngesting = false;
let _tbmSaveTimer = null;

function tbmEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function tbmIsViewer() { return !!(typeof currentUser !== 'undefined' && currentUser && currentUser.mdRole === '열람용'); }
function tbmMsg(msg, type) { if (typeof showToast === 'function') showToast(msg, type || ''); }

/* ══════════════════════════════════════════
   초기화
   ══════════════════════════════════════════ */
function tbmInit() {
  if (!_tbmInited) {
    tbmInjectStyle();
    tbmBuildShell();
    tbmBindDropZone();
    _tbmInited = true;
  }
  tbmRenderList();
  tbmOpen(_tbmDate || tbmPickInitialDate());
}

/** 밀린 것부터 처리하도록 '가장 오래된 미작성'을 먼저 연다 */
function tbmPickInitialDate() {
  const recs = tbmRecords().slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const drafts = recs.filter(r => r.status !== 'done');
  if (drafts.length) return drafts[0].date;
  if (recs.length) return recs[recs.length - 1].date;
  return tbmToday();
}

/** JSON 백업 복원 후 app.js가 호출 */
function tbmRefresh() {
  if (!_tbmInited) return;
  _tbmDate = null;
  tbmRenderList();
  tbmOpen(tbmPickInitialDate());
}

/* ══════════════════════════════════════════
   저장
   ══════════════════════════════════════════ */
function tbmScheduleLocalSave() {
  clearTimeout(_tbmSaveTimer);
  _tbmSaveTimer = setTimeout(() => {
    if (tbmIsViewer()) return;
    tbmCollect();
    if (typeof saveState === 'function') saveState();
    tbmSetStatus('로컬 저장됨 (서버 미반영)');
  }, 800);
}

/** 서버 반영 — tbmRecords만 올린다 */
async function tbmSave(silent) {
  if (tbmIsViewer()) { tbmMsg('열람용 계정은 저장할 수 없습니다.', 'error'); return; }
  clearTimeout(_tbmSaveTimer);
  tbmCollect();
  if (typeof saveState === 'function') saveState();
  tbmRenderList();
  if (typeof saveFieldsToSheet === 'function') await saveFieldsToSheet(['tbmRecords']);
  tbmSetStatus('서버 저장됨');
  if (!silent) tbmMsg('저장했습니다', 'success');
}

function tbmSetStatus(text) {
  const el = document.getElementById('tbm-savestatus');
  if (el) el.textContent = text;
}

/* ══════════════════════════════════════════
   껍데기
   ══════════════════════════════════════════ */
function tbmBuildShell() {
  const root = document.getElementById('tbm-root');
  if (!root) return;
  root.innerHTML =
    '<div class="tbm-wrap">' +
      '<div class="tbm-drop" id="tbm-drop">' +
        '<input type="file" id="tbm-drop-input" accept="image/*" multiple hidden>' +
        '<div class="tbm-drop-icon">📥</div>' +
        '<div class="tbm-drop-main">찍어둔 TBM 사진을 여기에 드래그하거나 클릭해서 고르세요</div>' +
        '<div class="tbm-drop-sub">촬영일을 읽어 날짜별로 자동 분류하고, 그날 출근자·작업예정까지 채워 초안을 만듭니다. 한 달치를 한 번에 던져도 됩니다.</div>' +
      '</div>' +
      '<div class="tbm-phone">📱 폰에서 올리려면 <a href="tbm.html" target="_blank" rel="noopener">tbm.html</a> — 갤러리에서 여러 장 골라 올리면 여기에 날짜별로 들어옵니다. ' +
        '<button class="tbm-btn tbm-btn-sm" onclick="tbmToggleQR()">QR 보기</button>' +
      '</div>' +
      '<div id="tbm-qr" hidden></div>' +
      '<div class="tbm-prog" id="tbm-prog" hidden><div class="tbm-prog-bar"><i id="tbm-prog-fill"></i></div><div class="tbm-prog-text" id="tbm-prog-text"></div></div>' +
      '<div class="tbm-main">' +
        '<aside class="tbm-side">' +
          '<div class="tbm-side-head">' +
            '<div class="tbm-side-title">회의록 목록 <span id="tbm-count"></span></div>' +
            '<label class="tbm-chk"><input type="checkbox" id="tbm-only-draft" onchange="tbmToggleOnlyDraft(this.checked)"> 미작성만</label>' +
          '</div>' +
          '<div class="tbm-side-add">' +
            '<input type="date" id="tbm-newdate">' +
            '<button class="tbm-btn tbm-btn-sm" onclick="tbmAddDate()">＋ 날짜 추가</button>' +
          '</div>' +
          '<div class="tbm-list" id="tbm-list"></div>' +
          '<div class="tbm-side-foot">' +
            '<div class="tbm-side-foot-title">🖨 기간 일괄 인쇄</div>' +
            '<div class="tbm-range"><input type="date" id="tbm-range-from"><span>~</span><input type="date" id="tbm-range-to"></div>' +
            '<button class="tbm-btn tbm-btn-sm tbm-btn-wide" onclick="tbmPrintRange()">기간 내 전체 인쇄</button>' +
          '</div>' +
        '</aside>' +
        '<section class="tbm-editor" id="tbm-editor"></section>' +
      '</div>' +
    '</div>';

  // 편집 영역은 레코드를 열 때마다 다시 그려지므로 감시는 여기서 한 번만 건다
  const ed = document.getElementById('tbm-editor');
  if (ed) ed.addEventListener('input', () => { if (!tbmIsViewer()) tbmScheduleLocalSave(); });

  const nd = document.getElementById('tbm-newdate');
  if (nd) nd.value = tbmToday();
  const rf = document.getElementById('tbm-range-from');
  const rt = document.getElementById('tbm-range-to');
  const d = new Date(); d.setDate(1);
  if (rf) rf.value = tbmIso(d);
  if (rt) rt.value = tbmToday();
}

/** 폰에서 열 주소를 QR로 띄운다 (홈 화면에 추가해두고 쓰라는 의미) */
function tbmToggleQR() {
  const box = document.getElementById('tbm-qr');
  if (!box) return;
  if (!box.dataset.ready) {
    const url = location.origin + location.pathname.replace(/[^/]*$/, '') + 'tbm.html';
    box.innerHTML = '<img alt="TBM 사진 업로드 주소 QR" src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&margin=6&data=' +
      encodeURIComponent(url) + '"><div class="tbm-qr-url">' + tbmEsc(url) + '</div>';
    box.dataset.ready = '1';
  }
  box.hidden = !box.hidden;
}

/* ══════════════════════════════════════════
   사진 투입 (드래그앤드롭 / 파일선택)
   ══════════════════════════════════════════ */
function tbmBindDropZone() {
  const zone = document.getElementById('tbm-drop');
  const input = document.getElementById('tbm-drop-input');
  if (!zone || !input) return;

  zone.addEventListener('click', () => { if (!_tbmIngesting) input.click(); });
  input.addEventListener('change', () => { tbmIngest(input.files); input.value = ''; });

  ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, e => {
    e.preventDefault(); e.stopPropagation(); zone.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, e => {
    e.preventDefault(); e.stopPropagation();
    if (ev === 'dragleave' && zone.contains(e.relatedTarget)) return;
    zone.classList.remove('over');
  }));
  zone.addEventListener('drop', e => {
    if (e.dataTransfer && e.dataTransfer.files) tbmIngest(e.dataTransfer.files);
  });
}

async function tbmIngest(files, targetDate) {
  if (tbmIsViewer()) { tbmMsg('열람용 계정은 사진을 올릴 수 없습니다.', 'error'); return; }
  if (_tbmIngesting) { tbmMsg('업로드가 진행 중입니다.', 'error'); return; }
  const list = Array.from(files || []);
  if (!list.length) return;

  // 편집 중 내용이 날아가지 않게 먼저 확정
  tbmCollect();

  _tbmIngesting = true;
  const prog = document.getElementById('tbm-prog');
  const fill = document.getElementById('tbm-prog-fill');
  const text = document.getElementById('tbm-prog-text');
  if (prog) prog.hidden = false;

  const res = await tbmIngestFiles(list, {
    forceDate: targetDate || null,
    onProgress: (done, total, name) => {
      if (fill) fill.style.width = Math.round(done / total * 100) + '%';
      if (text) text.textContent = done + ' / ' + total + '장 처리 중 — ' + name;
    }
  });

  _tbmIngesting = false;
  if (prog) prog.hidden = true;
  if (fill) fill.style.width = '0%';

  const dates = Object.keys(res.byDate).sort();
  if (res.added) {
    if (typeof saveState === 'function') saveState();
    if (typeof saveFieldsToSheet === 'function') await saveFieldsToSheet(['tbmRecords']);
    const src = [];
    if (res.sources.exif)     src.push('촬영정보 ' + res.sources.exif);
    if (res.sources.filename) src.push('파일명 ' + res.sources.filename);
    if (res.sources.mtime)    src.push('파일 날짜 ' + res.sources.mtime);
    tbmMsg(res.added + '장 등록 · ' + dates.length + '개 날짜 (' + src.join(', ') + ')', 'success');
  }
  if (res.failed.length) tbmMsg(res.failed.length + '장 실패: ' + res.failed[0].error, 'error');
  if (res.skipped)       tbmMsg(res.skipped + '개는 이미지가 아니라 건너뛰었습니다.');
  if (!res.added && !res.failed.length && !res.skipped) tbmMsg('처리할 사진이 없습니다.');

  tbmRenderList();
  tbmOpen(targetDate || (dates.length ? dates[0] : _tbmDate));
}

/* ══════════════════════════════════════════
   목록
   ══════════════════════════════════════════ */
function tbmToggleOnlyDraft(v) { _tbmOnlyDraft = !!v; tbmRenderList(); }

function tbmRenderList() {
  const box = document.getElementById('tbm-list');
  if (!box) return;
  const all = tbmRecords().slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const recs = _tbmOnlyDraft ? all.filter(r => r.status !== 'done') : all;

  const cnt = document.getElementById('tbm-count');
  const draftN = all.filter(r => r.status !== 'done').length;
  if (cnt) cnt.textContent = '(' + all.length + '건' + (draftN ? ' · 미작성 ' + draftN : '') + ')';

  if (!recs.length) {
    box.innerHTML = '<div class="tbm-empty-sm">' + (_tbmOnlyDraft ? '미작성 회의록이 없습니다.' : '기록이 없습니다. 위에 사진을 떨어뜨려 시작하세요.') + '</div>';
    return;
  }
  box.innerHTML = recs.map(r =>
    '<button class="tbm-item' + (r.date === _tbmDate ? ' active' : '') + '" onclick="tbmOpen(\'' + r.date + '\')">' +
      '<span class="tbm-item-top">' +
        '<span class="tbm-item-date">' + tbmEsc(tbmKorDate(r.date)) + '</span>' +
        '<span class="tbm-badge ' + (r.status === 'done' ? 'done' : 'draft') + '">' + (r.status === 'done' ? '완료' : '미작성') + '</span>' +
      '</span>' +
      '<span class="tbm-item-meta">📷 ' + (r.photos || []).length + ' · 👥 ' + (r.participants || []).length +
        (r.workName ? ' · ' + tbmEsc(String(r.workName).slice(0, 14)) : '') + '</span>' +
    '</button>'
  ).join('');
}

function tbmAddDate() {
  if (tbmIsViewer()) { tbmMsg('열람용 계정은 작성할 수 없습니다.', 'error'); return; }
  const el = document.getElementById('tbm-newdate');
  const date = el ? el.value : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { tbmMsg('날짜를 선택하세요.', 'error'); return; }
  if (tbmFindByDate(date)) { tbmMsg('이미 해당 날짜의 회의록이 있습니다.'); tbmOpen(date); return; }
  tbmCollect();
  tbmFindOrCreateDraft(date);
  if (typeof saveState === 'function') saveState();
  tbmRenderList();
  tbmOpen(date);
  tbmMsg(tbmKorDate(date) + ' 회의록을 만들었습니다', 'success');
}

function tbmDelete() {
  if (tbmIsViewer()) return;
  const rec = tbmFindByDate(_tbmDate);
  if (!rec) return;
  if (!confirm(tbmKorDate(rec.date) + ' 회의록을 삭제하시겠습니까?\n(첨부 사진 ' + (rec.photos || []).length + '장의 연결도 함께 사라집니다)')) return;
  state.tbmRecords = tbmRecords().filter(r => r !== rec);
  if (typeof saveState === 'function') saveState();
  if (typeof saveFieldsToSheet === 'function') saveFieldsToSheet(['tbmRecords']);
  _tbmDate = null;
  tbmRenderList();
  tbmOpen(tbmPickInitialDate());
  tbmMsg('삭제했습니다', 'success');
}

/* ══════════════════════════════════════════
   편집 화면
   ══════════════════════════════════════════ */
function tbmOpen(date) {
  // 다른 날짜로 넘어가기 전에 현재 편집 내용을 확정
  if (_tbmDate && _tbmDate !== date) { clearTimeout(_tbmSaveTimer); tbmCollect(); if (typeof saveState === 'function') saveState(); }
  _tbmDate = date || null;
  tbmRenderList();
  tbmRenderEditor();
}

function tbmRenderEditor() {
  const box = document.getElementById('tbm-editor');
  if (!box) return;
  const rec = _tbmDate ? tbmFindByDate(_tbmDate) : null;
  if (!rec) {
    box.innerHTML = '<div class="tbm-empty">' +
      '<div class="tbm-empty-icon">📋</div>' +
      '<div class="tbm-empty-title">작성할 회의록을 고르세요</div>' +
      '<div class="tbm-empty-sub">위에 사진을 떨어뜨리면 촬영일별로 초안이 만들어집니다. 사진 없이 시작하려면 왼쪽에서 날짜를 추가하세요.</div>' +
    '</div>';
    return;
  }
  const ro = tbmIsViewer();
  const dis = ro ? ' disabled' : '';

  box.innerHTML =
    '<div class="tbm-ed-head">' +
      '<div class="tbm-ed-title">' + tbmEsc(tbmKorDate(rec.date)) +
        '<button class="tbm-badge tbm-badge-btn ' + (rec.status === 'done' ? 'done' : 'draft') + '" onclick="tbmToggleStatus()"' + dis +
          ' title="눌러서 상태 바꾸기 — 인쇄하면 자동으로 완료가 됩니다">' + (rec.status === 'done' ? '작성완료' : '미작성') + '</button>' +
      '</div>' +
      '<div class="tbm-ed-actions">' +
        '<span class="tbm-savestatus" id="tbm-savestatus"></span>' +
        '<button class="tbm-btn" onclick="tbmAutoFill()"' + dis + '>🔄 자동 채움</button>' +
        '<button class="tbm-btn tbm-btn-primary" onclick="tbmSave()"' + dis + '>💾 저장</button>' +
        '<button class="tbm-btn tbm-btn-print" onclick="tbmPrint()">🖨 인쇄</button>' +
        '<button class="tbm-btn tbm-btn-danger" onclick="tbmDelete()"' + dis + '>삭제</button>' +
      '</div>' +
    '</div>' +

    /* ① 기본정보 */
    '<div class="tbm-sec">' +
      '<div class="tbm-sec-h">① 기본 정보</div>' +
      '<div class="tbm-grid2">' +
        '<label class="tbm-fld"><span>TBM 시간</span><span class="tbm-time"><input type="time" id="tbm-f-start" value="' + tbmEsc(rec.timeStart) + '"' + dis + '> ~ <input type="time" id="tbm-f-end" value="' + tbmEsc(rec.timeEnd) + '"' + dis + '></span></label>' +
        '<label class="tbm-fld"><span>TBM 장소</span><input type="text" id="tbm-f-place" value="' + tbmEsc(rec.tbmPlace) + '" placeholder="3공장"' + dis + '></label>' +
        '<label class="tbm-fld"><span>작업명</span><input type="text" id="tbm-f-workname" value="' + tbmEsc(rec.workName) + '" placeholder="작업명"' + dis + '></label>' +
        '<label class="tbm-fld"><span>위험성평가</span><span class="tbm-radio">' +
          '<label><input type="radio" name="tbm-risk" value="yes"' + (rec.riskAssess === 'yes' ? ' checked' : '') + dis + '> 예</label>' +
          '<label><input type="radio" name="tbm-risk" value="no"' + (rec.riskAssess === 'no' ? ' checked' : '') + dis + '> 아니오</label>' +
        '</span></label>' +
      '</div>' +
      '<label class="tbm-fld tbm-fld-full"><span>작업예정</span><textarea id="tbm-f-workcontent" rows="2" placeholder="⑪일일업무보고서에서 자동으로 채워집니다"' + dis + '>' + tbmEsc(rec.workContent) + '</textarea></label>' +
    '</div>' +

    /* ② 잠재위험요인 */
    '<div class="tbm-sec">' +
      '<div class="tbm-sec-h">② 잠재위험요인 및 대책' +
        '<button class="tbm-btn tbm-btn-sm" onclick="tbmCopyPrevHazards()"' + dis + '>직전 기록 복사</button>' +
      '</div>' +
      '<details class="tbm-presets"' + (rec.hazards && rec.hazards.length ? '' : ' open') + '>' +
        '<summary>🏷 위험요인 프리셋 — 클릭하면 아래 표와 ④ 안전조치 확인에 동시 입력됩니다</summary>' +
        '<div class="tbm-preset-body">' + tbmPresetHTML() + '</div>' +
      '</details>' +
      '<table class="tbm-tbl tbm-tbl-risk"><thead><tr>' +
        '<th style="width:34px;">No</th><th style="width:44px;">중점</th><th style="width:44%;">잠재위험요인</th><th>대책 (제거→대체→통제)</th><th style="width:34px;"></th>' +
      '</tr></thead><tbody id="tbm-risk-tbody"></tbody></table>' +
      '<button class="tbm-addrow" onclick="tbmAddRiskRow()"' + dis + '>＋ 행 추가</button>' +
    '</div>' +

    /* ③ 리더 */
    '<div class="tbm-sec">' +
      '<div class="tbm-sec-h">③ TBM 리더 확인</div>' +
      '<div class="tbm-grid3">' +
        '<label class="tbm-fld"><span>소속</span><input type="text" id="tbm-f-ldept" value="' + tbmEsc(rec.leader && rec.leader.dept) + '"' + dis + '></label>' +
        '<label class="tbm-fld"><span>직책</span><input type="text" id="tbm-f-lpos" value="' + tbmEsc(rec.leader && rec.leader.position) + '"' + dis + '></label>' +
        '<label class="tbm-fld"><span>성명</span><input type="text" id="tbm-f-lname" value="' + tbmEsc(rec.leader && rec.leader.name) + '"' + dis + '></label>' +
      '</div>' +
    '</div>' +

    /* ④ 안전조치 */
    '<div class="tbm-sec">' +
      '<div class="tbm-sec-h">④ 작업 전 안전조치 확인 <span class="tbm-note">※ 위 잠재위험요인(중점위험 포함) 조치 여부 재확인</span></div>' +
      '<table class="tbm-tbl tbm-tbl-safety"><thead><tr>' +
        '<th style="width:42%;">잠재위험요소</th><th style="width:130px;">조치 여부</th><th>\'아니오\'인 경우 조치 내용</th><th style="width:34px;"></th>' +
      '</tr></thead><tbody id="tbm-safety-tbody"></tbody></table>' +
      '<button class="tbm-addrow" onclick="tbmAddSafetyRow()"' + dis + '>＋ 행 추가</button>' +
    '</div>' +

    /* ⑤⑥ */
    '<div class="tbm-sec">' +
      '<div class="tbm-grid2">' +
        '<label class="tbm-fld tbm-fld-col"><span>⑤ 작업 전 일일 안전점검 결과</span><textarea id="tbm-f-inspection" rows="3"' + dis + '>' + tbmEsc(rec.inspection) + '</textarea></label>' +
        '<label class="tbm-fld tbm-fld-col"><span>⑥ 작업 후 종료 미팅 (중점대책 실효성)</span><textarea id="tbm-f-closing" rows="3"' + dis + '>' + tbmEsc(rec.closingMeeting) + '</textarea></label>' +
      '</div>' +
    '</div>' +

    /* ⑦ 참석자 */
    '<div class="tbm-sec">' +
      '<div class="tbm-sec-h">⑦ 참석자 확인 <span id="tbm-part-count" class="tbm-note"></span>' +
        '<button class="tbm-btn tbm-btn-sm" onclick="tbmFillParticipants()"' + dis + '>그날 출근자로 채우기</button>' +
        '<button class="tbm-btn tbm-btn-sm" onclick="tbmClearParticipants()"' + dis + '>전체 해제</button>' +
      '</div>' +
      '<div class="tbm-part" id="tbm-part-grid"></div>' +
      '<label class="tbm-fld tbm-fld-full"><span>명단 외 인원</span><input type="text" id="tbm-f-extra" placeholder="쉼표로 구분 (협력업체 등)"' + dis + '></label>' +
    '</div>' +

    /* ⑧ 사진 */
    '<div class="tbm-sec">' +
      '<div class="tbm-sec-h">⑧ TBM 활동 사진 <span class="tbm-note">인쇄 시 2장씩 사진대지로 출력됩니다</span>' +
        '<input type="file" id="tbm-add-photo" accept="image/*" multiple hidden>' +
        '<button class="tbm-btn tbm-btn-sm" onclick="document.getElementById(\'tbm-add-photo\').click()"' + dis + '>＋ 이 날짜에 사진 추가</button>' +
      '</div>' +
      '<div class="tbm-photos" id="tbm-photo-grid"></div>' +
    '</div>';

  tbmRenderRiskRows(rec);
  tbmRenderSafetyRows(rec);
  tbmRenderParticipants(rec);
  tbmRenderPhotos(rec);

  const addPhoto = document.getElementById('tbm-add-photo');
  if (addPhoto) addPhoto.addEventListener('change', () => { tbmIngest(addPhoto.files, rec.date); addPhoto.value = ''; });

  box.classList.toggle('tbm-readonly', ro);
}

/* ── 잠재위험요인 표 ── */
function tbmRiskRowHTML(h, dis) {
  return '<tr>' +
    '<td class="c tbm-no"></td>' +
    '<td class="c"><input type="checkbox" class="tbm-key"' + (h && h.isKey ? ' checked' : '') + dis + '></td>' +
    '<td><textarea rows="2" placeholder="잠재위험요인"' + dis + '>' + tbmEsc(h && h.risk) + '</textarea></td>' +
    '<td><textarea rows="2" placeholder="안전대책"' + dis + '>' + tbmEsc(h && h.measure) + '</textarea></td>' +
    '<td class="c"><button class="tbm-del" onclick="tbmDelRow(this)" title="행 삭제"' + dis + '>✕</button></td>' +
  '</tr>';
}
function tbmRenderRiskRows(rec) {
  const tb = document.getElementById('tbm-risk-tbody');
  if (!tb) return;
  const dis = tbmIsViewer() ? ' disabled' : '';
  const rows = (rec.hazards && rec.hazards.length) ? rec.hazards : [null, null, null];
  tb.innerHTML = rows.map(h => tbmRiskRowHTML(h, dis)).join('');
  tbmRenumber();
}
function tbmAddRiskRow(risk, measure) {
  const tb = document.getElementById('tbm-risk-tbody');
  if (!tb || tbmIsViewer()) return null;
  tb.insertAdjacentHTML('beforeend', tbmRiskRowHTML({ risk: risk || '', measure: measure || '' }, ''));
  tbmRenumber();
  return tb.lastElementChild;
}
function tbmRenumber() {
  document.querySelectorAll('#tbm-risk-tbody tr').forEach((tr, i) => {
    const c = tr.querySelector('.tbm-no'); if (c) c.textContent = i + 1;
  });
}
function tbmDelRow(btn) {
  const tr = btn.closest('tr');
  const tb = tr.parentElement;
  tr.remove();
  if (!tb.children.length) tb.insertAdjacentHTML('beforeend', tb.id === 'tbm-risk-tbody' ? tbmRiskRowHTML(null, '') : tbmSafetyRowHTML(null, ''));
  tbmRenumber();
  tbmScheduleLocalSave();
}

/* ── 안전조치 확인 표 ── */
function tbmSafetyRowHTML(s, dis) {
  const n = 'tbm-s' + Math.random().toString(36).slice(2, 8);
  return '<tr>' +
    '<td><input type="text" class="tbm-sfactor" value="' + tbmEsc(s && s.factor) + '" placeholder="위험요소"' + dis + '></td>' +
    '<td class="c"><span class="tbm-radio">' +
      '<label><input type="radio" name="' + n + '" value="yes"' + (s && s.action === 'yes' ? ' checked' : '') + dis + '> 예</label>' +
      '<label><input type="radio" name="' + n + '" value="no"' + (s && s.action === 'no' ? ' checked' : '') + dis + '> 아니오</label>' +
    '</span></td>' +
    '<td><input type="text" class="tbm-snote" value="' + tbmEsc(s && s.note) + '" placeholder="조치 내용"' + dis + '></td>' +
    '<td class="c"><button class="tbm-del" onclick="tbmDelRow(this)" title="행 삭제"' + dis + '>✕</button></td>' +
  '</tr>';
}
function tbmRenderSafetyRows(rec) {
  const tb = document.getElementById('tbm-safety-tbody');
  if (!tb) return;
  const dis = tbmIsViewer() ? ' disabled' : '';
  const rows = (rec.safetyChecks && rec.safetyChecks.length) ? rec.safetyChecks : [null, null, null];
  tb.innerHTML = rows.map(s => tbmSafetyRowHTML(s, dis)).join('');
}
function tbmAddSafetyRow(factor) {
  const tb = document.getElementById('tbm-safety-tbody');
  if (!tb || tbmIsViewer()) return null;
  tb.insertAdjacentHTML('beforeend', tbmSafetyRowHTML({ factor: factor || '', action: '', note: '' }, ''));
  return tb.lastElementChild;
}

/* ── 프리셋 ── */
function tbmPresetHTML() {
  return TBM_PRESETS.map((cat, ci) =>
    '<div class="tbm-preset-cat">' +
      '<div class="tbm-preset-cat-name">' + cat.icon + ' ' + tbmEsc(cat.category) + '</div>' +
      '<div class="tbm-preset-tags">' + cat.items.map((it, ii) =>
        '<button class="tbm-tag" onclick="tbmApplyPreset(' + ci + ',' + ii + ')" title="' + tbmEsc(it.risk) + '">' + tbmEsc(it.label) + '</button>'
      ).join('') + '</div>' +
    '</div>'
  ).join('');
}

/** 프리셋 하나를 잠재위험요인 표와 안전조치 표에 동시에 넣는다 (기존 앱과 같은 동작) */
function tbmApplyPreset(ci, ii) {
  if (tbmIsViewer()) return;
  const it = TBM_PRESETS[ci] && TBM_PRESETS[ci].items[ii];
  if (!it) return;

  // 잠재위험요인 — 비어 있는 첫 행을 쓰고, 없으면 새 행
  let target = null;
  document.querySelectorAll('#tbm-risk-tbody tr').forEach(tr => {
    if (target) return;
    const ta = tr.querySelectorAll('textarea');
    if (!ta[0].value.trim() && !ta[1].value.trim()) target = tr;
  });
  if (!target) target = tbmAddRiskRow();
  if (target) {
    const ta = target.querySelectorAll('textarea');
    ta[0].value = it.risk; ta[1].value = it.ct;
  }

  // 안전조치 확인
  let sTarget = null;
  document.querySelectorAll('#tbm-safety-tbody tr').forEach(tr => {
    if (sTarget) return;
    if (!tr.querySelector('.tbm-sfactor').value.trim()) sTarget = tr;
  });
  if (!sTarget) sTarget = tbmAddSafetyRow();
  if (sTarget) {
    sTarget.querySelector('.tbm-sfactor').value = it.label;
    const yes = sTarget.querySelector('input[value="yes"]');
    if (yes) yes.checked = true;
  }
  tbmScheduleLocalSave();
}

function tbmCopyPrevHazards() {
  if (tbmIsViewer()) return;
  const prev = tbmPrevRecord(_tbmDate);
  if (!prev || !(prev.hazards || []).length) { tbmMsg('복사할 직전 기록이 없습니다.', 'error'); return; }
  const rec = tbmFindByDate(_tbmDate);
  rec.hazards = prev.hazards.map(h => ({ no: h.no, isKey: h.isKey, risk: h.risk, measure: h.measure }));
  if (!(rec.safetyChecks || []).length) {
    rec.safetyChecks = (prev.safetyChecks || []).map(s => ({ factor: s.factor, action: s.action, note: s.note }));
  }
  tbmRenderRiskRows(rec);
  tbmRenderSafetyRows(rec);
  tbmScheduleLocalSave();
  tbmMsg(tbmKorDate(prev.date) + ' 위험요인을 복사했습니다', 'success');
}

/* ── 참석자 ── */
function tbmEmployeesFor(date) {
  return (state.employees || [])
    .filter(e => e && !e.deleted)
    .filter(e => !(e.hireDate && date < e.hireDate));
}

function tbmRenderParticipants(rec) {
  const box = document.getElementById('tbm-part-grid');
  if (!box) return;
  const dis = tbmIsViewer() ? ' disabled' : '';
  const emps = tbmEmployeesFor(rec.date);
  const picked = rec.participants || [];
  const names = emps.map(e => e.name);

  const groups = {};
  emps.forEach(e => { const d = e.div || '기타'; (groups[d] = groups[d] || []).push(e); });
  const order = TBM_DIV_ORDER.filter(d => groups[d]).concat(Object.keys(groups).filter(d => TBM_DIV_ORDER.indexOf(d) === -1));

  box.innerHTML = order.map(d =>
    '<div class="tbm-part-grp">' +
      '<div class="tbm-part-grp-name">' + tbmEsc(TBM_DIV_LABEL[d] || d) + '</div>' +
      '<div class="tbm-part-names">' + groups[d].map(e =>
        '<label class="tbm-part-chk"><input type="checkbox" value="' + tbmEsc(e.name) + '"' +
          (picked.indexOf(e.name) !== -1 ? ' checked' : '') + dis + ' onchange="tbmUpdatePartCount()"> ' + tbmEsc(e.name) + '</label>'
      ).join('') + '</div>' +
    '</div>'
  ).join('');

  const extra = picked.filter(n => names.indexOf(n) === -1);
  const ex = document.getElementById('tbm-f-extra');
  if (ex) ex.value = extra.join(', ');
  tbmUpdatePartCount();
}

function tbmUpdatePartCount() {
  const el = document.getElementById('tbm-part-count');
  if (!el) return;
  const n = document.querySelectorAll('#tbm-part-grid input[type="checkbox"]:checked').length;
  el.textContent = n + '명 선택됨';
}

function tbmFillParticipants() {
  if (tbmIsViewer()) return;
  const auto = tbmAutoParticipants(_tbmDate);
  if (!auto.length) { tbmMsg('그날 출근 기록이 없습니다. ④일일 입력을 먼저 채워주세요.', 'error'); return; }
  document.querySelectorAll('#tbm-part-grid input[type="checkbox"]').forEach(c => { c.checked = auto.indexOf(c.value) !== -1; });
  tbmUpdatePartCount();
  tbmScheduleLocalSave();
  tbmMsg('출근자 ' + auto.length + '명을 참석자로 채웠습니다', 'success');
}

function tbmClearParticipants() {
  if (tbmIsViewer()) return;
  document.querySelectorAll('#tbm-part-grid input[type="checkbox"]').forEach(c => { c.checked = false; });
  tbmUpdatePartCount();
  tbmScheduleLocalSave();
}

/**
 * 미작성 ↔ 작성완료 수동 전환.
 * 인쇄하면 자동으로 완료가 되지만, 배치만 확인하려고 시험 삼아 뽑는 경우가 있어
 * 되돌릴 길이 필요하다 (이게 없으면 삭제 후 재작성밖에 방법이 없어 사진까지 날아간다).
 */
function tbmToggleStatus() {
  if (tbmIsViewer()) return;
  const rec = tbmFindByDate(_tbmDate);
  if (!rec) return;
  tbmCollect();
  rec.status = rec.status === 'done' ? 'draft' : 'done';
  rec.updatedAt = Date.now();
  tbmRenderList();
  tbmRenderEditor();
  tbmSave(true);
  tbmMsg(rec.status === 'done' ? '작성완료로 표시했습니다' : '미작성으로 되돌렸습니다', 'success');
}

/** 참석자·작업예정을 그날 데이터로 다시 끌어온다 (저장과는 분리된 명시적 동작) */
function tbmAutoFill() {
  if (tbmIsViewer()) return;
  const rec = tbmFindByDate(_tbmDate);
  if (!rec) return;
  tbmCollect();
  const filled = [];   // 새로 채운 것
  const kept   = [];   // 이미 쓴 내용이 있어 건드리지 않은 것

  // ── 그날 데이터에서 끌어오는 것들은 덮어쓴다 (다시 불러오는 게 이 버튼의 목적)
  const work = tbmAutoWork(rec.date);
  if (work.workName || work.workContent) {
    rec.workName = work.workName; rec.workContent = work.workContent;
    filled.push('작업예정');
  } else {
    kept.push('작업명·작업예정은 ⑪일일보고서에 ' + rec.date + ' 기록이 없어 비워둠');
  }

  const auto = tbmAutoParticipants(rec.date);
  if (auto.length) { rec.participants = auto; filled.push('참석자 ' + auto.length + '명'); }
  else kept.push('참석자는 ④일일 입력에 그날 출근 기록이 없어 비워둠');

  const prev = tbmPrevRecord(rec.date);
  if (prev) {
    rec.timeStart = prev.timeStart; rec.timeEnd = prev.timeEnd; rec.tbmPlace = prev.tbmPlace;
    if (prev.leader) rec.leader = { dept: prev.leader.dept, position: prev.leader.position, name: prev.leader.name };
    filled.push('시간·장소·리더');
  }

  // ── 아래는 '기본값'이라 이미 손댄 내용이 있으면 덮어쓰지 않는다.
  //    자동 채움을 다시 눌렀다고 공들여 쓴 위험요인이 날아가면 안 된다.
  if (!(rec.hazards || []).length) {
    rec.hazards = tbmDefaultHazards(rec.date);
    if (!(rec.safetyChecks || []).length) rec.safetyChecks = tbmDefaultSafetyChecks(rec.date);
    const season = tbmSeasonLabel(rec.date);   // 봄·가을은 고정 항목이 없어 null
    filled.push('위험요인 ' + rec.hazards.length + '건' + (season ? '(' + season + ' 포함)' : ''));
  } else {
    kept.push('위험요인은 이미 작성돼 있어 그대로 둠');
  }
  if (!rec.riskAssess) { rec.riskAssess = TBM_DEFAULTS.riskAssess; filled.push('위험성평가'); }
  if (!String(rec.inspection || '').trim()) { rec.inspection = TBM_DEFAULTS.inspection; filled.push('안전점검 결과'); }

  tbmRenderEditor();
  tbmScheduleLocalSave();
  if (!filled.length && !kept.length) { tbmMsg('가져올 데이터가 없습니다'); return; }
  tbmMsg((filled.length ? filled.join(' / ') + ' 채움' : '새로 채운 항목 없음') +
         (kept.length ? ' — ' + kept.join(', ') : ''), filled.length ? 'success' : '');
}

/* ── 사진 ── */
function tbmRenderPhotos(rec) {
  const box = document.getElementById('tbm-photo-grid');
  if (!box) return;
  const dis = tbmIsViewer() ? ' disabled' : '';
  const photos = rec.photos || [];
  if (!photos.length) {
    box.innerHTML = '<div class="tbm-empty-sm">첨부된 사진이 없습니다.</div>';
    return;
  }
  box.innerHTML = photos.map((p, i) =>
    '<div class="tbm-photo">' +
      '<a href="' + tbmEsc(p.url) + '" target="_blank" rel="noopener"><img src="' + tbmEsc(p.url) + '" alt="사진 ' + (i + 1) + '" loading="lazy"></a>' +
      '<div class="tbm-photo-no">PHOTO ' + String(i + 1).padStart(2, '0') +
        (p.dateSource ? '<span class="tbm-photo-src">' + tbmEsc(TBM_DATE_SOURCE_LABEL[p.dateSource] || '') + '</span>' : '') + '</div>' +
      '<input type="text" class="tbm-photo-cap" data-pi="' + i + '" value="' + tbmEsc(p.caption) + '" placeholder="설명 (선택)"' + dis + '>' +
      '<div class="tbm-photo-btns">' +
        '<button class="tbm-btn tbm-btn-xs" onclick="tbmMovePhoto(' + i + ')"' + dis + '>날짜 이동</button>' +
        '<button class="tbm-btn tbm-btn-xs tbm-btn-danger" onclick="tbmRemovePhoto(' + i + ')"' + dis + '>삭제</button>' +
      '</div>' +
    '</div>'
  ).join('');
}

function tbmRemovePhoto(i) {
  if (tbmIsViewer()) return;
  const rec = tbmFindByDate(_tbmDate);
  if (!rec || !rec.photos[i]) return;
  if (!confirm('이 사진을 회의록에서 뺄까요?')) return;
  tbmCollect();
  rec.photos.splice(i, 1);
  tbmRenderPhotos(rec);
  tbmRenderList();
  tbmSave(true);
}

/** 촬영일 자동 판별이 틀렸을 때 다른 날짜로 옮긴다 */
function tbmMovePhoto(i) {
  if (tbmIsViewer()) return;
  const rec = tbmFindByDate(_tbmDate);
  if (!rec || !rec.photos[i]) return;
  const to = prompt('이 사진을 옮길 날짜 (YYYY-MM-DD)', rec.date);
  if (!to) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) { tbmMsg('날짜 형식이 올바르지 않습니다 (예: 2026-09-09)', 'error'); return; }
  if (to === rec.date) return;
  tbmCollect();
  const photo = rec.photos.splice(i, 1)[0];
  photo.takenAt = to;
  const dest = tbmFindOrCreateDraft(to);
  if (!Array.isArray(dest.photos)) dest.photos = [];
  dest.photos.push(photo);
  dest.updatedAt = Date.now();
  tbmRenderPhotos(rec);
  tbmRenderList();
  tbmSave(true);
  tbmMsg(tbmKorDate(to) + '(으)로 옮겼습니다', 'success');
}

/* ══════════════════════════════════════════
   화면 → 레코드
   ══════════════════════════════════════════ */
function tbmCollect() {
  if (tbmIsViewer()) return null;
  const rec = _tbmDate ? tbmFindByDate(_tbmDate) : null;
  if (!rec) return null;
  const g = id => document.getElementById(id);
  if (!g('tbm-f-start')) return rec;   // 편집 화면이 그려지기 전

  const v = id => { const el = g(id); return el ? el.value.trim() : ''; };
  rec.timeStart   = v('tbm-f-start');
  rec.timeEnd     = v('tbm-f-end');
  rec.tbmPlace    = v('tbm-f-place');
  rec.workName    = v('tbm-f-workname');
  rec.workContent = g('tbm-f-workcontent') ? g('tbm-f-workcontent').value : '';
  const ra = document.querySelector('input[name="tbm-risk"]:checked');
  rec.riskAssess  = ra ? ra.value : '';
  rec.leader      = { dept: v('tbm-f-ldept'), position: v('tbm-f-lpos'), name: v('tbm-f-lname') };
  rec.inspection     = g('tbm-f-inspection') ? g('tbm-f-inspection').value : '';
  rec.closingMeeting = g('tbm-f-closing') ? g('tbm-f-closing').value : '';

  rec.hazards = Array.from(document.querySelectorAll('#tbm-risk-tbody tr')).map((tr, i) => {
    const ta = tr.querySelectorAll('textarea');
    return { no: i + 1, isKey: tr.querySelector('.tbm-key').checked, risk: ta[0].value.trim(), measure: ta[1].value.trim() };
  }).filter(h => h.risk || h.measure).map((h, i) => { h.no = i + 1; return h; });

  rec.safetyChecks = Array.from(document.querySelectorAll('#tbm-safety-tbody tr')).map(tr => {
    const r = tr.querySelector('input[type="radio"]:checked');
    return { factor: tr.querySelector('.tbm-sfactor').value.trim(), action: r ? r.value : '', note: tr.querySelector('.tbm-snote').value.trim() };
  }).filter(s => s.factor || s.note);

  const picked = Array.from(document.querySelectorAll('#tbm-part-grid input[type="checkbox"]:checked')).map(c => c.value);
  const extra = (v('tbm-f-extra') || '').split(/[,\n]/).map(s => s.trim()).filter(Boolean);
  rec.participants = picked.concat(extra.filter(n => picked.indexOf(n) === -1));

  document.querySelectorAll('#tbm-photo-grid .tbm-photo-cap').forEach(el => {
    const i = Number(el.dataset.pi);
    if (rec.photos && rec.photos[i]) rec.photos[i].caption = el.value.trim();
  });

  rec.updatedAt = Date.now();
  return rec;
}

/* ══════════════════════════════════════════
   인쇄
   ══════════════════════════════════════════ */
function tbmPrint() {
  const rec = tbmCollect() || tbmFindByDate(_tbmDate);
  if (!rec) { tbmMsg('인쇄할 회의록이 없습니다.', 'error'); return; }
  if (!tbmIsViewer() && rec.status !== 'done') {
    rec.status = 'done';                  // 인쇄했다면 작성이 끝난 것으로 본다
    if (typeof saveState === 'function') saveState();
    if (typeof saveFieldsToSheet === 'function') saveFieldsToSheet(['tbmRecords']);
    tbmRenderList();
    tbmRenderEditor();
  }
  tbmPrintRecords([rec], 'TBM회의록_' + rec.date);
}

function tbmPrintRange() {
  const from = (document.getElementById('tbm-range-from') || {}).value;
  const to   = (document.getElementById('tbm-range-to') || {}).value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) { tbmMsg('기간을 올바르게 선택하세요.', 'error'); return; }
  tbmCollect();
  const recs = tbmRecords().filter(r => r.date >= from && r.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  if (!recs.length) { tbmMsg('해당 기간에 회의록이 없습니다.', 'error'); return; }

  // 한 건 인쇄와 규칙을 맞춘다 — 뽑았으면 작성이 끝난 것으로 본다.
  // 여러 건 상태가 한꺼번에 바뀌므로 확인창에서 미리 알려준다.
  const drafts = tbmIsViewer() ? [] : recs.filter(r => r.status !== 'done');
  const ask = [recs.length + '건을 이어서 인쇄합니다.'];
  if (drafts.length) ask.push('미작성 ' + drafts.length + '건은 작성완료로 표시됩니다.');
  ask.push('계속할까요?');
  if (!confirm(ask.join('\n'))) return;

  if (drafts.length) {
    drafts.forEach(r => { r.status = 'done'; r.updatedAt = Date.now(); });
    if (typeof saveState === 'function') saveState();
    if (typeof saveFieldsToSheet === 'function') saveFieldsToSheet(['tbmRecords']);
    tbmRenderList();
    tbmRenderEditor();
  }
  tbmPrintRecords(recs, 'TBM회의록_' + from + '_' + to);
}

/* 인쇄 창 안에서 실행되는 스크립트.
   사진이 다 뜬 뒤에야 높이를 잴 수 있으므로 로딩을 기다린 다음,
   1장을 살짝 넘긴 문서만 --tp-scale로 줄여 1장에 맞춘다
   (dailyreport.js의 --dr-scale과 같은 방식). */
const TBM_PRINT_SCRIPT = [
  'function fit(){',
  '  var pageH = (297 - 16) * 96 / 25.4;',              // A4 297mm - 상하 여백 8mm*2
  '  var docs = document.querySelectorAll(".tp-doc");',
  '  for (var i = 0; i < docs.length; i++) {',
  '    var p1 = docs[i].querySelector(".tp-page1");',
  '    if (!p1) continue;',
  '    var s = 1;',
  '    while (s > 0.82 && p1.scrollHeight > pageH) {',
  '      s = Math.max(0.82, s - 0.02);',
  '      docs[i].style.setProperty("--tp-scale", s);',
  '    }',
  '    if (p1.scrollHeight > pageH) docs[i].style.setProperty("--tp-scale", 1);',  // 줄여도 안 맞으면 포기
  '  }',
  '  setTimeout(function(){ window.print(); }, 150);',
  '}',
  'window.onload = function(){',
  '  var imgs = document.images, n = imgs.length;',
  '  if (!n) return fit();',
  '  var done = function(){ if (--n <= 0) fit(); };',
  '  for (var k = 0; k < imgs.length; k++) {',
  '    if (imgs[k].complete) done();',
  '    else { imgs[k].onload = done; imgs[k].onerror = done; }',
  '  }',
  '};'
].join('\n');

function tbmPrintRecords(recs, title) {
  const css = [
    '@page { size: A4 portrait; margin: 8mm 10mm; }',
    'html, body { margin:0; padding:0; }',
    'body { font-family:"맑은 고딕","Malgun Gothic",sans-serif; color:#1B2733; -webkit-print-color-adjust:exact; print-color-adjust:exact; }',
    // 내용이 많은 날은 1장을 살짝 넘긴다. --tp-scale로 글자·사진을 조금 줄여 1장에 맞춘다.
    '.tp-doc { --tp-scale:1; font-size:calc(9pt * var(--tp-scale)); }',
    '.tp-doc + .tp-doc { page-break-before: always; }',
    '.tp-head { display:flex; justify-content:space-between; align-items:center; background:#243447; color:#fff; padding:7px 12px; }',
    '.tp-title { font-size:15pt; font-weight:900; letter-spacing:-0.3px; }',
    '.tp-title span { font-size:7.5pt; font-weight:600; letter-spacing:1.6px; opacity:.75; display:block; }',
    '.tp-appr { display:flex; border:1px solid rgba(255,255,255,.5); }',
    '.tp-appr-cell { text-align:center; border-right:1px solid rgba(255,255,255,.5); min-width:64px; }',
    '.tp-appr-cell:last-child { border-right:none; }',
    '.tp-appr-cell .l { font-size:7pt; font-weight:700; letter-spacing:2px; background:rgba(255,255,255,.15); padding:2px 6px; }',
    '.tp-appr-cell .s { height:34px; background:#fff; color:#1B2733; font-size:8pt; display:flex; align-items:center; justify-content:center; }',
    '.tp-appr-cell .s img { max-height:30px; max-width:56px; object-fit:contain; }',
    'table { width:100%; border-collapse:collapse; table-layout:fixed; }',
    'th, td { border:1px solid #9AA5B1; padding:3px 6px; vertical-align:top; word-break:break-word; white-space:pre-wrap; box-sizing:border-box; }',
    'th { background:#EEF1F4; font-weight:700; text-align:center; border-color:#5A6B7D; }',
    'td.c { text-align:center; }',
    'td.nw { white-space:nowrap; }',
    'td.k { background:#F4F6F8; font-weight:700; text-align:center; width:76px; }',
    '.tp-sec { background:#3A4A5C; color:#fff; font-size:8.5pt; font-weight:700; padding:3px 8px; margin-top:4px; }',
    '.tp-key { color:#C0392B; font-weight:800; }',
    '.tp-note { font-size:7.5pt; color:#5A6B7D; padding:2px 2px 3px; }',
    '.tp-part td { height:20px; text-align:center; font-size:8.5pt; }',
    '.tp-photopage { margin-top:4px; border:1px solid #5A6B7D; }',
    '.tp-page1 + .tp-photopage, .tp-photopage + .tp-photopage { page-break-before: always; }',
    '.tp-photo-hdr { background:#243447; color:#fff; padding:4px 10px; font-size:8pt; font-weight:700; }',
    '.tp-photo-hdr small { font-weight:400; opacity:.85; margin-left:10px; }',
    '.tp-photo-cells { display:grid; grid-template-columns:1fr 1fr; }',
    '.tp-photo-cell { border-right:1px solid #9AA5B1; padding:4px 6px; text-align:center; }',
    '.tp-photo-cell:last-child { border-right:none; }',
    '.tp-photo-cell .n { font-size:7.5pt; font-weight:700; color:#C0392B; margin-bottom:2px; }',
    '.tp-photo-cell img { width:100%; height:calc(50mm * var(--tp-scale)); object-fit:contain; border:1px solid #C9D2DB; background:#fff; }',
    '.tp-photo-cell .cap { font-size:7.5pt; margin-top:2px; }'
  ].join('\n');

  const body = recs.map(tbmPrintDoc).join('');
  const html = '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>' + tbmEsc(title) + '</title>' +
    '<style>' + css + '</style></head><body>' + body +
    '<script>' + TBM_PRINT_SCRIPT + '<\/script></body></html>';

  const win = window.open('', '_blank', 'width=900,height=1000');
  if (!win) { tbmMsg('팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요.', 'error'); return; }
  win.document.write(html);
  win.document.close();
  tbmMsg(recs.length + '건 인쇄', 'success');
}

/**
 * 작성자 서명. tbm-sign-{이름}.png 가 있으면 그 도장을, 없으면 이름 글자를 찍는다.
 * 파일 존재 여부를 미리 알 수 없으므로 onerror로 떨어뜨린다 — 새 작성자가 생기면
 * 코드를 고칠 필요 없이 같은 규칙으로 png만 추가하면 된다.
 */
function tbmSignHTML(name) {
  if (!name) return '';
  const src = 'tbm-sign-' + encodeURIComponent(name) + '.png';
  return '<img src="' + tbmEsc(src) + '" alt="' + tbmEsc(name) + '" onerror="this.replaceWith(this.alt)">';
}

function tbmPrintDoc(rec) {
  const e = tbmEsc;
  const hazards = (rec.hazards || []).length ? rec.hazards : [{ no: 1, risk: '', measure: '' }, { no: 2, risk: '', measure: '' }, { no: 3, risk: '', measure: '' }];
  const safety  = (rec.safetyChecks || []).length ? rec.safetyChecks : [{ factor: '', action: '', note: '' }, { factor: '', action: '', note: '' }, { factor: '', action: '', note: '' }];
  const parts   = (rec.participants || []).slice();
  const PER_ROW = 10;
  while (parts.length % PER_ROW !== 0 || !parts.length) parts.push('');

  const partRows = [];
  for (let i = 0; i < parts.length; i += PER_ROW) {
    partRows.push('<tr>' + parts.slice(i, i + PER_ROW).map(n => '<td>' + e(n) + '</td>').join('') + '</tr>');
  }

  const photos = rec.photos || [];
  const photoPages = [];
  for (let i = 0; i < photos.length; i += 2) {
    const cells = photos.slice(i, i + 2).map((p, k) =>
      '<div class="tp-photo-cell">' +
        '<div class="n">PHOTO ' + String(i + k + 1).padStart(2, '0') + '</div>' +
        '<img src="' + e(p.url) + '" alt="">' +
        (p.caption ? '<div class="cap">' + e(p.caption) + '</div>' : '') +
      '</div>'
    );
    if (cells.length === 1) cells.push('<div class="tp-photo-cell"></div>');
    photoPages.push(
      '<div class="tp-photopage">' +
        '<div class="tp-photo-hdr">TBM 활동 사진대지<small>작업명: ' + e(rec.workName || '-') + ' &nbsp;|&nbsp; 일자: ' + e(rec.date) + ' &nbsp;|&nbsp; 장소: ' + e(rec.tbmPlace || '-') + '</small></div>' +
        '<div class="tp-photo-cells">' + cells.join('') + '</div>' +
      '</div>');
  }

  const chk = v => v ? '☑' : '☐';

  // 폼과 첫 사진대지를 한 묶음으로 감싼다 — 이 묶음이 A4 1장에 들어가야 한다
  return '<div class="tp-doc"><div class="tp-page1">' +
    '<div class="tp-head">' +
      '<div class="tp-title"><span>TOOL BOX MEETING</span>TBM 회의록</div>' +
      '<div class="tp-appr">' +
        '<div class="tp-appr-cell"><div class="l">작 성</div><div class="s">' + tbmSignHTML(rec.createdBy || (rec.leader && rec.leader.name) || '') + '</div></div>' +
        '<div class="tp-appr-cell"><div class="l">승 인</div><div class="s"><img src="tbm-sign-approver.png" alt=""></div></div>' +
      '</div>' +
    '</div>' +

    '<table>' +
      '<colgroup><col style="width:76px"><col><col style="width:76px"><col></colgroup>' +
      '<tr><td class="k">TBM 일시</td><td>' + e(tbmKorDate(rec.date)) + '&nbsp;&nbsp;' + e(rec.timeStart) + ' ~ ' + e(rec.timeEnd) + '</td>' +
          '<td class="k">TBM 장소</td><td>' + e(rec.tbmPlace) + '</td></tr>' +
      '<tr><td class="k">작 업 명</td><td>' + e(rec.workName) + '</td>' +
          '<td class="k">위험성평가</td><td class="nw">' + chk(rec.riskAssess === 'yes') + ' 예 &nbsp;&nbsp; ' + chk(rec.riskAssess === 'no') + ' 아니오</td></tr>' +
      '<tr><td class="k">작업예정</td><td colspan="3">' + e(rec.workContent) + '</td></tr>' +
    '</table>' +

    '<div class="tp-sec">■ 잠재위험요인 및 대책</div>' +
    '<table>' +
      '<colgroup><col style="width:34px"><col style="width:44px"><col style="width:44%"><col></colgroup>' +
      '<thead><tr><th>No</th><th>중점</th><th>잠재위험요인</th><th>대책 (제거→대체→통제)</th></tr></thead>' +
      '<tbody>' + hazards.map((h, i) =>
        '<tr><td class="c">' + (i + 1) + '</td><td class="c' + (h.isKey ? ' tp-key' : '') + '">' + (h.isKey ? '●' : '') + '</td>' +
        '<td>' + e(h.risk) + (h.isKey ? ' <span class="tp-key">[중점]</span>' : '') + '</td><td>' + e(h.measure) + '</td></tr>'
      ).join('') + '</tbody>' +
    '</table>' +

    '<div class="tp-sec">■ TBM 리더 확인</div>' +
    '<table>' +
      '<colgroup><col style="width:60px"><col><col style="width:60px"><col><col style="width:84px"><col></colgroup>' +
      '<tr><td class="k">소속</td><td>' + e(rec.leader && rec.leader.dept) + '</td>' +
          '<td class="k">직책</td><td>' + e(rec.leader && rec.leader.position) + '</td>' +
          '<td class="k">성명(서명)</td><td>' + e(rec.leader && rec.leader.name) + '</td></tr>' +
    '</table>' +

    '<div class="tp-sec">■ 작업 전 안전조치 확인</div>' +
    '<div class="tp-note">※ 위 잠재위험요인(중점위험 포함) 안전조치 여부 재확인</div>' +
    '<table>' +
      '<colgroup><col style="width:42%"><col style="width:96px"><col></colgroup>' +
      '<thead><tr><th>잠재위험요소 (중점위험 포함)</th><th>조치 여부</th><th>\'아니오\'인 경우 조치 내용</th></tr></thead>' +
      '<tbody>' + safety.map(s =>
        '<tr><td>' + e(s.factor) + '</td><td class="c nw">' + chk(s.action === 'yes') + ' 예 &nbsp; ' + chk(s.action === 'no') + ' 아니오</td><td>' + e(s.note) + '</td></tr>'
      ).join('') + '</tbody>' +
    '</table>' +

    '<table style="margin-top:4px;">' +
      '<thead><tr><th>작업 전 일일 안전점검 결과</th><th>작업 후 종료 미팅 (중점대책 실효성)</th></tr></thead>' +
      '<tbody><tr><td style="height:16mm;">' + e(rec.inspection) + '</td><td style="height:16mm;">' + e(rec.closingMeeting) + '</td></tr></tbody>' +
    '</table>' +

    '<div class="tp-sec">■ 참석자 확인 (' + (rec.participants || []).filter(Boolean).length + '명)</div>' +
    '<div class="tp-note">※ TBM에 참여하지 않은 작업자를 확인하여 미팅 참석 유도</div>' +
    '<table class="tp-part"><tbody>' + partRows.join('') + '</tbody></table>' +
    (photoPages[0] || '') +
  '</div>' +
    photoPages.slice(1).join('') +
  '</div>';
}

/* ══════════════════════════════════════════
   스타일
   ══════════════════════════════════════════ */
function tbmInjectStyle() {
  if (document.getElementById('tbm-style')) return;
  const css = `
/* 앱은 다크 단일 테마다. 색을 직접 쓰지 말고 style.css의 변수만 쓴다
   (인쇄용 .tp-* 스타일은 종이라서 밝은 색을 그대로 유지한다) */
/* color-scheme:dark — 안 주면 날짜·시간 입력의 달력/시계 아이콘을 크롬이 검게 그려
   어두운 입력칸 위에서 안 보인다 */
#tbm-root { color-scheme:dark; --tbm-line:var(--border); --tbm-ink:var(--text); --tbm-mut:var(--text2); --tbm-accent:var(--accent); }
.tbm-wrap { display:flex; flex-direction:column; gap:12px; }

.tbm-drop { border:2px dashed var(--tbm-line); border-radius:var(--radius); padding:18px 16px; text-align:center; cursor:pointer; background:var(--surface2); transition:.15s; }
.tbm-drop:hover, .tbm-drop.over { border-color:var(--tbm-accent); background:rgba(79,127,255,.10); }
.tbm-drop-icon { font-size:26px; line-height:1; }
.tbm-drop-main { font-weight:700; margin-top:6px; font-size:14px; color:var(--tbm-ink); }
.tbm-drop-sub { font-size:12px; color:var(--tbm-mut); margin-top:4px; }

.tbm-phone { font-size:12px; color:var(--tbm-mut); display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.tbm-phone a { color:var(--tbm-accent); font-weight:700; }
#tbm-qr { display:inline-flex; align-self:flex-start; flex-direction:column; align-items:center; gap:5px; padding:9px; background:var(--surface2); border:1px solid var(--tbm-line); border-radius:8px; }
#tbm-qr[hidden] { display:none; }
#tbm-qr img { background:#fff; padding:6px; border-radius:4px; display:block; }
.tbm-qr-url { font-size:11px; color:var(--tbm-mut); word-break:break-all; max-width:220px; text-align:center; }

.tbm-prog { display:flex; align-items:center; gap:10px; }
.tbm-prog-bar { flex:1; height:8px; background:var(--surface3); border-radius:4px; overflow:hidden; }
.tbm-prog-bar i { display:block; height:100%; width:0; background:var(--tbm-accent); transition:width .15s; }
.tbm-prog-text { font-size:12px; color:var(--tbm-mut); white-space:nowrap; }

.tbm-main { display:flex; gap:14px; align-items:flex-start; }
.tbm-side { width:230px; flex-shrink:0; border:1px solid var(--tbm-line); border-radius:var(--radius); overflow:hidden; background:var(--surface); }
.tbm-side-head { padding:8px 10px; border-bottom:1px solid var(--tbm-line); background:var(--surface2); }
.tbm-side-title { font-weight:700; font-size:13px; color:var(--tbm-ink); }
.tbm-side-title span { font-weight:400; color:var(--tbm-mut); font-size:11px; }
.tbm-chk { font-size:11px; color:var(--tbm-mut); display:inline-flex; align-items:center; gap:4px; margin-top:4px; cursor:pointer; }
.tbm-side-add { display:flex; gap:4px; padding:8px 10px; border-bottom:1px solid var(--tbm-line); }
.tbm-side-add input { flex:1; min-width:0; font-size:11px; padding:3px 5px; background:var(--surface3); border:1px solid var(--tbm-line); border-radius:4px; color:var(--tbm-ink); }
.tbm-list { max-height:420px; overflow-y:auto; }
.tbm-item { display:block; width:100%; text-align:left; border:none; border-bottom:1px solid var(--tbm-line); background:none; padding:7px 10px; cursor:pointer; color:var(--tbm-ink); }
.tbm-item:hover { background:var(--surface2); }
.tbm-item.active { background:rgba(79,127,255,.14); box-shadow:inset 3px 0 0 var(--tbm-accent); }
.tbm-item-top { display:flex; justify-content:space-between; align-items:center; gap:6px; }
.tbm-item-date { font-weight:700; font-size:12px; }
.tbm-item-meta { display:block; font-size:11px; color:var(--tbm-mut); margin-top:2px; }
.tbm-badge { font-size:10px; font-weight:700; padding:1px 6px; border-radius:9px; white-space:nowrap; }
.tbm-badge.draft { background:rgba(255,71,87,.16); color:var(--red); }
.tbm-badge.done  { background:rgba(46,213,115,.16); color:var(--green); }
.tbm-badge-btn { border:1px solid transparent; font-family:inherit; cursor:pointer; }
.tbm-badge-btn:hover:not(:disabled) { border-color:currentColor; }
.tbm-badge-btn:disabled { cursor:default; }
.tbm-side-foot { padding:8px 10px; border-top:1px solid var(--tbm-line); background:var(--surface2); }
.tbm-side-foot-title { font-size:11px; font-weight:700; color:var(--tbm-mut); margin-bottom:5px; }
.tbm-range { display:flex; align-items:center; gap:3px; margin-bottom:5px; }
.tbm-range input { flex:1; min-width:0; font-size:10px; padding:2px 4px; background:var(--surface3); border:1px solid var(--tbm-line); border-radius:4px; color:var(--tbm-ink); }
.tbm-range span { font-size:10px; color:var(--tbm-mut); }

.tbm-editor { flex:1; min-width:0; }
.tbm-empty { text-align:center; padding:60px 20px; color:var(--tbm-mut); }
.tbm-empty-icon { font-size:34px; }
.tbm-empty-title { font-weight:700; font-size:15px; margin-top:8px; color:var(--tbm-ink); }
.tbm-empty-sub { font-size:12px; margin-top:4px; }
.tbm-empty-sm { padding:14px 10px; font-size:12px; color:var(--tbm-mut); text-align:center; }

.tbm-ed-head { display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; padding-bottom:8px; border-bottom:2px solid var(--tbm-line); margin-bottom:10px; }
.tbm-ed-title { font-size:16px; font-weight:800; display:flex; align-items:center; gap:8px; color:var(--tbm-ink); }
.tbm-ed-actions { display:flex; align-items:center; gap:5px; flex-wrap:wrap; }
.tbm-savestatus { font-size:11px; color:var(--tbm-mut); margin-right:4px; }

.tbm-btn { border:1px solid var(--tbm-line); background:var(--surface3); color:var(--tbm-ink); border-radius:5px; padding:5px 10px; font-size:12px; font-family:inherit; cursor:pointer; white-space:nowrap; }
.tbm-btn:hover:not(:disabled) { border-color:var(--tbm-accent); color:var(--tbm-accent); }
.tbm-btn:disabled { opacity:.4; cursor:not-allowed; }
.tbm-btn-sm { padding:3px 8px; font-size:11px; }
.tbm-btn-xs { padding:2px 6px; font-size:10px; }
.tbm-btn-wide { width:100%; }
.tbm-btn-primary { background:var(--tbm-accent); border-color:var(--tbm-accent); color:#fff; font-weight:700; }
.tbm-btn-primary:hover:not(:disabled) { background:#3d6ae0; border-color:#3d6ae0; color:#fff; }
.tbm-btn-print { background:var(--accent2); border-color:var(--accent2); color:#0f1117; font-weight:700; }
.tbm-btn-print:hover:not(:disabled) { background:#00b98c; border-color:#00b98c; color:#0f1117; }
.tbm-btn-danger { color:var(--red); }
.tbm-btn-danger:hover:not(:disabled) { background:rgba(255,71,87,.12); border-color:var(--red); color:var(--red); }

.tbm-sec { border:1px solid var(--tbm-line); border-radius:var(--radius); margin-bottom:10px; overflow:hidden; background:var(--surface); }
.tbm-sec-h { display:flex; align-items:center; gap:8px; flex-wrap:wrap; background:var(--surface2); border-bottom:1px solid var(--tbm-line); padding:6px 10px; font-weight:700; font-size:12.5px; color:var(--tbm-ink); }
.tbm-note { font-weight:400; font-size:11px; color:var(--tbm-mut); }

.tbm-grid2 { display:grid; grid-template-columns:1fr 1fr; gap:0; }
.tbm-grid3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:0; }
.tbm-fld { display:flex; align-items:center; gap:8px; padding:6px 10px; border-bottom:1px solid var(--tbm-line); border-right:1px solid var(--tbm-line); font-size:12px; color:var(--tbm-ink); }
.tbm-fld > span:first-child { flex-shrink:0; width:74px; color:var(--tbm-mut); font-weight:700; font-size:11px; }
.tbm-fld input[type="text"], .tbm-fld textarea, .tbm-fld input[type="time"] { flex:1; min-width:0; background:var(--surface3); border:1px solid var(--tbm-line); border-radius:4px; padding:4px 6px; font-size:12px; font-family:inherit; color:var(--tbm-ink); }
.tbm-fld textarea { resize:vertical; }
.tbm-fld-full { border-right:none; }
.tbm-fld-col { flex-direction:column; align-items:stretch; gap:4px; }
.tbm-fld-col > span:first-child { width:auto; }
.tbm-time { display:flex; align-items:center; gap:4px; flex:1; }
.tbm-radio { display:inline-flex; gap:10px; align-items:center; }
.tbm-radio label { display:inline-flex; align-items:center; gap:3px; font-size:12px; cursor:pointer; }

.tbm-presets { border-bottom:1px solid var(--tbm-line); background:var(--surface2); }
.tbm-presets summary { cursor:pointer; padding:6px 10px; font-size:11.5px; color:var(--tbm-mut); }
.tbm-preset-body { display:flex; flex-wrap:wrap; gap:10px; padding:4px 10px 10px; }
.tbm-preset-cat { min-width:150px; }
.tbm-preset-cat-name { font-size:11px; font-weight:700; color:var(--tbm-mut); margin-bottom:3px; }
.tbm-preset-tags { display:flex; flex-wrap:wrap; gap:3px; }
.tbm-tag { border:1px solid var(--tbm-line); background:var(--surface3); color:var(--tbm-ink); border-radius:12px; padding:2px 8px; font-size:11px; font-family:inherit; cursor:pointer; }
.tbm-tag:hover { background:var(--tbm-accent); border-color:var(--tbm-accent); color:#fff; }

.tbm-tbl { width:100%; border-collapse:collapse; }
.tbm-tbl th, .tbm-tbl td { border:1px solid var(--tbm-line); padding:3px 5px; font-size:11.5px; vertical-align:top; color:var(--tbm-ink); }
.tbm-tbl th { background:var(--surface2); font-weight:700; font-size:11px; color:var(--tbm-mut); }
.tbm-tbl td.c { text-align:center; vertical-align:middle; }
.tbm-tbl textarea, .tbm-tbl input[type="text"] { width:100%; box-sizing:border-box; border:none; background:none; color:var(--tbm-ink); font-family:inherit; font-size:11.5px; resize:vertical; padding:2px; }
.tbm-tbl textarea:focus, .tbm-tbl input[type="text"]:focus { outline:1px solid var(--tbm-accent); border-radius:3px; }
.tbm-del { border:none; background:none; color:var(--text3); cursor:pointer; font-size:12px; padding:0 3px; }
.tbm-del:hover { color:var(--red); }
.tbm-addrow { width:100%; border:none; border-top:1px dashed var(--tbm-line); background:var(--surface2); padding:5px; font-size:11.5px; font-family:inherit; color:var(--tbm-mut); cursor:pointer; }
.tbm-addrow:hover:not(:disabled) { color:var(--tbm-accent); }

.tbm-part { display:flex; flex-wrap:wrap; gap:10px; padding:8px 10px; }
.tbm-part-grp { min-width:140px; }
.tbm-part-grp-name { font-size:11px; font-weight:700; color:var(--tbm-mut); margin-bottom:3px; }
.tbm-part-names { display:flex; flex-wrap:wrap; gap:2px 8px; }
.tbm-part-chk { display:inline-flex; align-items:center; gap:3px; font-size:12px; color:var(--tbm-mut); cursor:pointer; padding:1px 3px; border-radius:3px; }
.tbm-part-chk:hover { background:var(--surface2); }
.tbm-part-chk:has(input:checked) { font-weight:700; color:var(--tbm-accent); }

.tbm-photos { display:flex; flex-wrap:wrap; gap:8px; padding:8px 10px; }
.tbm-photo { width:150px; border:1px solid var(--tbm-line); border-radius:6px; overflow:hidden; background:var(--surface2); }
.tbm-photo img { width:100%; height:110px; object-fit:cover; display:block; }
.tbm-photo-no { font-size:10px; font-weight:700; color:var(--tbm-accent); padding:3px 5px 0; display:flex; justify-content:space-between; }
.tbm-photo-src { font-weight:400; color:var(--tbm-mut); }
.tbm-photo-cap { width:100%; box-sizing:border-box; border:none; border-top:1px solid var(--tbm-line); background:none; color:var(--tbm-ink); padding:3px 5px; font-size:11px; font-family:inherit; }
.tbm-photo-btns { display:flex; gap:3px; padding:4px 5px; border-top:1px solid var(--tbm-line); }
.tbm-photo-btns .tbm-btn { flex:1; }

.tbm-readonly input, .tbm-readonly textarea, .tbm-readonly button:not(.tbm-btn-print) { pointer-events:none; }

@media (max-width: 900px) {
  .tbm-main { flex-direction:column; }
  .tbm-side { width:100%; }
  .tbm-grid2, .tbm-grid3 { grid-template-columns:1fr; }
}
`;
  const style = document.createElement('style');
  style.id = 'tbm-style';
  style.textContent = css;
  document.head.appendChild(style);
}
