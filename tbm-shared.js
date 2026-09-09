/* ============================================================
   tbm-shared.js — TBM 회의록 공용 헬퍼
   index.html(⑫ TBM 탭)과 tbm.html(폰 사진 업로드) 양쪽에서 로드된다.
   따라서 app.js·jangbi.js에 의존하지 않고 홀로 동작해야 하며,
   전역 이름은 전부 tbm* 접두사를 붙여 jangbi.js와 충돌을 피한다.
   공통 전제: 전역 state 객체에 employees / dailyData / dailyReports /
   tbmRecords 가 들어있다 (tbm.html은 /api/load 결과로 직접 채운다).
   ============================================================ */

/* ── Supabase (jangbi.js와 같은 프로젝트, 같은 버킷의 tbm/ 경로를 씀) ── */
const TBM_SUPA_URL = 'https://fjpqsoxqsxyzstjuysdx.supabase.co';
const TBM_SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZqcHFzb3hxc3h5enN0anV5c2R4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3NDg2NzMsImV4cCI6MjA5MTMyNDY3M30.47aiG4TEKQtS7rw3vz2h0aJUgdxGAWU3rUFcaoVpfKU';
const TBM_BUCKET = 'equipment-photos';

let _tbmSupaClient = null;
function tbmSupa() {
  if (_tbmSupaClient) return _tbmSupaClient;
  if (!window.supabase || !window.supabase.createClient) return null;
  try { _tbmSupaClient = window.supabase.createClient(TBM_SUPA_URL, TBM_SUPA_KEY); }
  catch (e) { console.error('[tbm] Supabase 초기화 실패', e); return null; }
  return _tbmSupaClient;
}

/* ── 날짜 유틸 ── */
function tbmIso(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function tbmToday() { return tbmIso(new Date()); }
const TBM_DAYS = ['일', '월', '화', '수', '목', '금', '토'];
function tbmKorDate(s) {
  const parts = String(s).split('-').map(Number);
  if (!parts[0]) return s;
  const dt = new Date(parts[0], parts[1] - 1, parts[2]);
  return parts[0] + '. ' + String(parts[1]).padStart(2, '0') + '. ' + String(parts[2]).padStart(2, '0')
       + ' (' + TBM_DAYS[dt.getDay()] + ')';
}

/* ══════════════════════════════════════════
   촬영일 판별 — EXIF → 파일명 → 파일 날짜
   ══════════════════════════════════════════ */

/** JPEG EXIF에서 촬영일(DateTimeOriginal)만 뽑아내는 최소 파서 */
function tbmParseExifDate(view) {
  if (view.byteLength < 20 || view.getUint16(0) !== 0xFFD8) return null;   // JPEG(SOI) 아님
  let offset = 2;
  while (offset < view.byteLength - 4) {
    if (view.getUint8(offset) !== 0xFF) return null;
    const marker = view.getUint8(offset + 1);
    if (marker === 0xDA || marker === 0xD9) return null;                   // 이미지 데이터 시작 — EXIF 없음
    const size = view.getUint16(offset + 2);
    if (marker === 0xE1) {
      if (view.getUint32(offset + 4) !== 0x45786966) return null;          // "Exif" 시그니처
      return tbmReadTiffDate(view, offset + 10);
    }
    offset += 2 + size;
  }
  return null;
}

function tbmReadTiffDate(view, start) {
  if (start + 8 > view.byteLength) return null;
  const little = view.getUint16(start) === 0x4949;                          // 0x4949 = "II" = little endian
  const u16 = o => view.getUint16(o, little);
  const u32 = o => view.getUint32(o, little);
  if (u16(start + 2) !== 0x002A) return null;

  const ifd0 = start + u32(start + 4);
  if (ifd0 + 2 > view.byteLength) return null;

  // IFD0에서 Exif SubIFD 포인터(0x8769)를 찾는다
  let exifIfd = 0;
  const n0 = u16(ifd0);
  for (let i = 0; i < n0; i++) {
    const e = ifd0 + 2 + i * 12;
    if (e + 12 > view.byteLength) break;
    if (u16(e) === 0x8769) { exifIfd = start + u32(e + 8); break; }
  }

  // 0x9003 DateTimeOriginal → 0x9004 DateTimeDigitized → 0x0132 DateTime 순으로 채택
  const scan = ifd => {
    if (!ifd || ifd + 2 > view.byteLength) return null;
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > view.byteLength) break;
      const tag = u16(e);
      if (tag !== 0x9003 && tag !== 0x9004 && tag !== 0x0132) continue;
      const count = u32(e + 4);
      const valOff = start + u32(e + 8);
      if (count < 10 || valOff + count > view.byteLength) continue;
      let str = '';
      for (let k = 0; k < count - 1; k++) str += String.fromCharCode(view.getUint8(valOff + k));
      const m = str.match(/^(\d{4}):(\d{2}):(\d{2})/);
      if (m && Number(m[1]) > 1990) return m[1] + '-' + m[2] + '-' + m[3];
    }
    return null;
  };
  return scan(exifIfd) || scan(ifd0);
}

function tbmExifDate(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => {
      try { resolve(tbmParseExifDate(new DataView(reader.result))); }
      catch (e) { resolve(null); }
    };
    reader.onerror = () => resolve(null);
    reader.readAsArrayBuffer(file.slice(0, 131072));   // EXIF는 파일 앞부분에만 있으므로 128KB면 충분
  });
}

/**
 * 파일명에서 날짜 추출 — 카톡을 경유해 EXIF가 지워진 경우의 안전망.
 * 20260901_143022.jpg / IMG_20260901_... / KakaoTalk_Photo_2026-09-01-... 등
 */
function tbmFilenameDate(name) {
  const m = String(name || '').match(/(20\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])/);
  return m ? m[1] + '-' + m[2] + '-' + m[3] : null;
}

/** 촬영일 판별. { date, source: 'exif'|'filename'|'mtime' } */
async function tbmDetectDate(file) {
  const fromExif = await tbmExifDate(file);
  if (fromExif) return { date: fromExif, source: 'exif' };

  const fromName = tbmFilenameDate(file.name);
  if (fromName) return { date: fromName, source: 'filename' };

  if (file.lastModified) return { date: tbmIso(new Date(file.lastModified)), source: 'mtime' };
  return { date: tbmToday(), source: 'mtime' };
}

const TBM_DATE_SOURCE_LABEL = { exif: '촬영정보', filename: '파일명', mtime: '파일 날짜', manual: '직접 지정' };

/* ══════════════════════════════════════════
   압축 · 업로드
   ══════════════════════════════════════════ */

/** 인쇄용이라 장변 1280px 유지 (인쇄 시 2열 배치, 사진 1장이 약 95mm 폭) */
function tbmCompressImage(file, maxPx, quality) {
  maxPx = maxPx || 1280;
  quality = quality || 0.75;
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('압축 실패')), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 읽지 못했습니다')); };
    img.src = url;
  });
}

/** 압축 후 Supabase Storage에 올리고 공개 URL을 돌려준다 */
async function tbmUploadPhoto(file, date) {
  const supa = tbmSupa();
  if (!supa) return { error: 'Supabase 연결 실패 (supabase-js 미로드)' };
  let blob;
  try { blob = await tbmCompressImage(file); }
  catch (e) { return { error: e.message }; }

  const rand = Math.random().toString(36).slice(2, 8);
  const path = 'tbm/' + date + '/' + Date.now() + '_' + rand + '.jpg';
  const up = await supa.storage.from(TBM_BUCKET).upload(path, blob, {
    upsert: false, contentType: 'image/jpeg',
  });
  if (up.error) return { error: up.error.message };
  const pub = supa.storage.from(TBM_BUCKET).getPublicUrl(path);
  return { url: pub.data.publicUrl, path: path, size: blob.size };
}

/* ══════════════════════════════════════════
   자동 채움 — 앱이 이미 가진 그날 데이터를 활용
   ══════════════════════════════════════════ */

/** 그날 '출근'으로 기록된 인원 (입사 전·삭제 인원 제외) */
function tbmAutoParticipants(date) {
  const day = (state.dailyData || {})[date];
  if (!day || !day.emp) return [];
  return (state.employees || [])
    .filter(e => e && !e.deleted)
    .filter(e => !(e.hireDate && date < e.hireDate))
    .filter(e => { const ed = day.emp[e.id]; return ed && ed.status === '출근'; })
    .map(e => e.name);
}

/** ⑪일일보고서의 '금일 업무 진행 상황'에서 작업명·작업내용을 끌어온다 */
function tbmAutoWork(date) {
  const rep = (state.dailyReports || {})[date];
  const rows = (rep && Array.isArray(rep.today) ? rep.today : []).filter(r => r && (r.proj || r.work));
  if (!rows.length) return { workName: '', workContent: '' };
  const projs = [];
  rows.forEach(r => {
    const p = (r.proj || '').trim();
    if (p && projs.indexOf(p) === -1) projs.push(p);
  });
  const content = rows.map(r => {
    const p = (r.proj || '').trim();
    const w = (r.work || '').trim().replace(/\s*\n+\s*/g, ' / ');
    return p && w ? p + ': ' + w : (p || w);
  }).filter(Boolean).join('\n');
  return { workName: projs.join(', '), workContent: content };
}

/* ══════════════════════════════════════════
   레코드
   ══════════════════════════════════════════ */

const TBM_DEFAULTS = { timeStart: '08:00', timeEnd: '08:10', tbmPlace: '3공장', leaderDept: '생산부' };

function tbmRecords() {
  if (!Array.isArray(state.tbmRecords)) state.tbmRecords = [];
  return state.tbmRecords;
}
function tbmFindByDate(date) {
  const found = tbmRecords().filter(r => r.date === date);
  return found.length ? found[0] : null;
}

/** 직전(가장 최근) 기록 — 시간·장소·리더 승계용 */
function tbmPrevRecord(beforeDate) {
  const prior = tbmRecords()
    .filter(r => r.date && r.date < beforeDate)
    .sort((a, b) => a.date.localeCompare(b.date));
  return prior.length ? prior[prior.length - 1] : null;
}

/**
 * 새 레코드를 만든다. 자동 채움은 '이 시점 1회'만 일어나며,
 * 저장 동작에는 절대 얽매이지 않는다 (일일보고서에서 무한 연쇄 사고를 겪은 부분).
 */
function tbmNewRecord(date) {
  const prev = tbmPrevRecord(date);
  const work = tbmAutoWork(date);
  const me = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;
  return {
    id: String(Date.now()) + Math.random().toString(36).slice(2, 6),
    date: date,
    status: 'draft',
    timeStart: prev ? prev.timeStart : TBM_DEFAULTS.timeStart,
    timeEnd:   prev ? prev.timeEnd   : TBM_DEFAULTS.timeEnd,
    tbmPlace:  prev ? prev.tbmPlace  : TBM_DEFAULTS.tbmPlace,
    riskAssess: '',
    workName:    work.workName,
    workContent: work.workContent,
    hazards: [],
    leader: prev && prev.leader ? { dept: prev.leader.dept, position: prev.leader.position, name: prev.leader.name } : {
      dept: TBM_DEFAULTS.leaderDept,
      position: me ? (me.position || '') : '',
      name: me ? me.name : ''
    },
    safetyChecks: [],
    inspection: '',
    closingMeeting: '',
    participants: tbmAutoParticipants(date),
    photos: [],
    createdBy: me ? me.name : '',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

function tbmFindOrCreateDraft(date) {
  let rec = tbmFindByDate(date);
  if (rec) return rec;
  rec = tbmNewRecord(date);
  tbmRecords().push(rec);
  return rec;
}

/* ══════════════════════════════════════════
   사진 일괄 투입 — 폰 업로드와 PC 드래그가 모두 여기로 합류한다
   ══════════════════════════════════════════ */

/**
 * @param {FileList|File[]} files
 * @param {{onProgress?:(done:number,total:number,name:string)=>void, forceDate?:string}} opts
 *        forceDate — 촬영일 판별을 건너뛰고 이 날짜에 몰아 넣는다 (특정 날짜에 직접 추가할 때)
 * @returns {{added:number, byDate:Object, failed:Array, sources:Object, skipped:number}}
 */
async function tbmIngestFiles(files, opts) {
  opts = opts || {};
  const onProgress = opts.onProgress || function () {};
  const forceDate = /^\d{4}-\d{2}-\d{2}$/.test(opts.forceDate || '') ? opts.forceDate : null;
  const all = Array.from(files || []);
  const list = all.filter(f => f && /^image\//.test(f.type || ''));
  const out = { added: 0, byDate: {}, failed: [], sources: { exif: 0, filename: 0, mtime: 0, manual: 0 }, skipped: all.length - list.length };

  for (let i = 0; i < list.length; i++) {
    const file = list[i];
    onProgress(i + 1, list.length, file.name);
    try {
      const det = forceDate ? { date: forceDate, source: 'manual' } : await tbmDetectDate(file);
      const up = await tbmUploadPhoto(file, det.date);
      if (up.error) { out.failed.push({ name: file.name, error: up.error }); continue; }

      const rec = tbmFindOrCreateDraft(det.date);
      if (!Array.isArray(rec.photos)) rec.photos = [];
      rec.photos.push({ url: up.url, takenAt: det.date, dateSource: det.source, caption: '' });
      rec.updatedAt = Date.now();

      out.added++;
      out.byDate[det.date] = (out.byDate[det.date] || 0) + 1;
      out.sources[det.source] = (out.sources[det.source] || 0) + 1;
    } catch (e) {
      out.failed.push({ name: file.name, error: e.message || String(e) });
    }
  }
  return out;
}
