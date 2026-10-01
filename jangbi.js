/* ============================================================
   jangbi.js — 장비관리 모듈 (sejong-prod 통합 버전)
   원본: jangbi/index.html <script> 블록 추출
   변경: Auth 통합, 상태기반 미니라우터, Supabase 하드코딩
   ============================================================ */

// ⬇ 실제 Supabase 값으로 교체 필요
const JB_SUPA_URL = 'https://fjpqsoxqsxyzstjuysdx.supabase.co';
const JB_SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZqcHFzb3hxc3h5enN0anV5c2R4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3NDg2NzMsImV4cCI6MjA5MTMyNDY3M30.47aiG4TEKQtS7rw3vz2h0aJUgdxGAWU3rUFcaoVpfKU';

/* ── 유틸 ── */
const LS = {
  get(k, def){ try{ return JSON.parse(localStorage.getItem(k)) ?? def; }catch{ return def; } },
  set(k, v){ localStorage.setItem(k, JSON.stringify(v)); },
};
const uid = () => Math.random().toString(36).slice(2,10);
const pad2 = n => String(n).padStart(2,'0');
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
};
const toLocalMidnight = (d) => {
  if(!d) return null;
  if(typeof d === 'string'){
    const s = d.slice(0,10);
    const [y,m,day] = s.split('-').map(Number);
    if(!y) return null;
    return new Date(y, m-1, day);
  }
  const x = new Date(d);
  return new Date(x.getFullYear(), x.getMonth(), x.getDate());
};
const fmt = (d) => {
  if(!d) return '';
  if(typeof d === 'string') return d.slice(0,10);
  const x = new Date(d);
  return `${x.getFullYear()}-${pad2(x.getMonth()+1)}-${pad2(x.getDate())}`;
};
// 'YYYY-MM-DD' + n개월. 말일 넘침은 그 달 말일로 맞춘다 (1/31 + 1개월 → 2/28)
const addMonthsISO = (iso, n) => {
  const [y,m,d] = iso.slice(0,10).split('-').map(Number);
  const last = new Date(y, m-1+n+1, 0).getDate();
  return fmt(new Date(y, m-1+n, Math.min(d, last)));
};
const daysBetween = (a,b) => {
  const A = toLocalMidnight(a), B = toLocalMidnight(b);
  if(!A || !B) return 0;
  return Math.round((B - A) / 86400000);
};
const isOverdue = (dateStr) => {
  const d = toLocalMidnight(dateStr); if(!d) return false;
  return d < toLocalMidnight(todayISO());
};

/* ── Supabase 클라이언트 (하드코딩) ── */
let _supaClient = null;
function getSupaClient(){
  if(_supaClient) return _supaClient;
  if(!JB_SUPA_URL || JB_SUPA_URL.includes('YOUR_PROJECT')) return null;
  try{ _supaClient = window.supabase.createClient(JB_SUPA_URL, JB_SUPA_KEY); }
  catch(e){ console.error('[jangbi] Supabase 초기화 실패', e); return null; }
  return _supaClient;
}
function resetSupaClient(){ _supaClient = null; SupaStore.enabled = false; }

const BUCKET = 'equipment-photos';
function qrUrl(id){ return 'https://api.qrserver.com/v1/create-qr-code/?size=120x120&margin=4&data='+encodeURIComponent(id); }

/* ── SupaStore ── */
const SupaStore = {
  enabled: false,
  loading: false,
  lastError: null,
  _channel: null,
  _refreshPending: false,
  TBL: c => 'jb_' + c,
  toRow:  d => ({ id: d.id, data: d, created_at: d.createdAt||null, updated_at: d.updatedAt||new Date().toISOString() }),
  fromRow: r => ({ ...r.data, id: r.id }),
  async init(){
    const supa = getSupaClient();
    if(!supa){ this.enabled = false; return false; }
    this.loading = true;
    try{
      await this.loadAll(supa);
      this.startRealtime(supa);
      this.enabled = true;
      this.lastError = null;
    }catch(e){
      this.lastError = e.message;
      console.error('[SupaStore] init 오류:', e);
    }finally{
      this.loading = false;
    }
    return this.enabled;
  },
  async loadAll(supa){
    const cols = ['equipment','checkouts','maintenance','sites','users','consumables','auditLogs'];
    const results = await Promise.all(cols.map(c=>
      supa.from(this.TBL(c)).select('*').order('created_at')
    ));
    cols.forEach((c, i)=>{
      const {data, error} = results[i];
      if(error){ console.warn(`[SupaStore] load ${c}:`, error.message); return; }
      if(data && data.length > 0){
        Store[c] = data.map(r=>this.fromRow(r));
        Store.save(c);
      }
    });
    if(Store.users.length===0)
      Store.add('users', {employeeId:'admin', name:'관리자', pin:'0000', role:'admin', active:true});
    if(Store.sites.length===0)
      Store.add('sites', {name:'사내 창고', address:'본사', contact:'', active:true});
  },
  startRealtime(supa){
    if(this._channel){ try{ supa.removeChannel(this._channel); }catch{} }
    this._channel = supa.channel('jb-realtime')
      .on('postgres_changes',{event:'*',schema:'public',table:this.TBL('equipment')},
          ()=>this.onRemoteChange('equipment'))
      .on('postgres_changes',{event:'*',schema:'public',table:this.TBL('checkouts')},
          ()=>this.onRemoteChange('checkouts'))
      .subscribe();
  },
  onRemoteChange(c){
    if(this._refreshPending) return;
    this._refreshPending = true;
    setTimeout(async()=>{
      this._refreshPending = false;
      const supa = getSupaClient(); if(!supa) return;
      const {data} = await supa.from(this.TBL(c)).select('*').order('created_at');
      if(data){ Store[c] = data.map(r=>this.fromRow(r)); Store.save(c); }
      jbRender();
    }, 600);
  },
  push(c, doc){
    if(!this.enabled) return;
    const supa = getSupaClient(); if(!supa) return;
    supa.from(this.TBL(c)).upsert(this.toRow(doc))
      .then(({error})=>{ if(error) console.error(`[SupaStore] push ${c}:`, error.message); });
  },
  del(c, id){
    if(!this.enabled) return;
    const supa = getSupaClient(); if(!supa) return;
    supa.from(this.TBL(c)).delete().eq('id', id)
      .then(({error})=>{ if(error) console.error(`[SupaStore] del ${c}:`, error.message); });
  },
  async migrateFromLocal(onProgress){
    const supa = getSupaClient();
    if(!supa) throw new Error('Supabase 미연결');
    const cols = ['equipment','checkouts','maintenance','sites','users','consumables','auditLogs'];
    let total = cols.reduce((s,c)=>s+Store[c].length,0);
    let done = 0;
    for(const c of cols){
      for(const doc of Store[c]){
        const {error} = await supa.from(this.TBL(c)).upsert(this.toRow(doc));
        if(error) console.warn(`migrate ${c} ${doc.id}:`, error.message);
        done++;
        if(onProgress) onProgress(done, total, c);
      }
    }
    return done;
  },
};

/* ── 이미지 압축 ── */
async function compressImage(file, maxW=640, quality=0.65){
  return new Promise((resolve, reject)=>{
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = ()=>{
      const scale = Math.min(1, maxW / img.naturalWidth);
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob(blob=>{
        if(!blob){ reject(new Error('압축 실패')); return; }
        resolve(new File([blob], file.name.replace(/\.[^.]+$/, '')+'.jpg', {type:'image/jpeg'}));
      }, 'image/jpeg', quality);
    };
    img.onerror = ()=>{ URL.revokeObjectURL(url); reject(new Error('이미지 로드 실패')); };
    img.src = url;
  });
}

/* ── Supabase Storage 업로드 ── */
async function uploadQR(equipmentId){
  const supa = getSupaClient();
  if(!supa) return null;
  try{
    const apiUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=4&data='+encodeURIComponent(equipmentId);
    const resp = await fetch(apiUrl);
    if(!resp.ok) return null;
    const blob = await resp.blob();
    const path = 'qr/'+equipmentId+'.png';
    const { error } = await supa.storage.from(BUCKET).upload(path, blob, { upsert:true, contentType:'image/png' });
    if(error) return null;
    const { data } = supa.storage.from(BUCKET).getPublicUrl(path);
    return data.publicUrl;
  }catch(e){ return null; }
}

async function uploadPhoto(file, equipmentId){
  const supa = getSupaClient();
  if(!supa) return { error: 'Supabase 미설정' };
  let compressed;
  try{ compressed = await compressImage(file); }
  catch(e){ return { error: '압축 실패: '+e.message }; }
  const path = `${equipmentId}/main_${Date.now()}.jpg`;
  const { error } = await supa.storage.from(BUCKET).upload(path, compressed, {
    upsert: true, contentType: 'image/jpeg',
  });
  if(error) return { error: error.message };
  const { data } = supa.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl };
}

/* ── 데이터 스토어 ── */
const Store = {
  collections: ['equipment','checkouts','maintenance','sites','users','consumables','config','auditLogs'],
  load(){
    for(const c of this.collections){ this[c] = LS.get('jb_'+c, []); }
    if(!Array.isArray(this.config)) this.config = [];
    if(this.users.length === 0){
      this.users = [{id:uid(), employeeId:'admin', name:'관리자', pin:'0000', role:'admin', active:true}];
      this.save('users');
    }
    if(this.sites.length === 0){
      this.sites = [{id:uid(), name:'사내 창고', address:'본사', contact:'', active:true}];
      this.save('sites');
    }
  },
  save(c){ LS.set('jb_'+c, this[c]); },
  log(action, equipmentId, detail, meta={}){
    this.add('auditLogs', {
      action, equipmentId, detail,
      actor: Auth.current?.employeeId || '?',
      actorName: Auth.current?.name || '?',
      ts: new Date().toISOString(),
      ...meta,
    });
  },
  add(c, doc){
    doc.id = doc.id || uid();
    doc.createdAt = doc.createdAt || new Date().toISOString();
    doc.updatedAt = new Date().toISOString();
    this[c].push(doc);
    this.save(c);
    SupaStore.push(c, doc);
    return doc;
  },
  update(c, id, patch){
    const i = this[c].findIndex(x=>x.id===id);
    if(i>=0){
      this[c][i] = {...this[c][i], ...patch, updatedAt:new Date().toISOString()};
      this.save(c);
      SupaStore.push(c, this[c][i]);
      return this[c][i];
    }
  },
  remove(c, id){
    this[c] = this[c].filter(x=>x.id!==id);
    this.save(c);
    SupaStore.del(c, id);
  },
  getById(c, id){ return this[c].find(x=>x.id===id); },
  byEqId(c, equipmentId){ return this[c].filter(x=>x.equipmentId===equipmentId); },
};

/* ── Auth (sejong-prod 통합 — 로그인 없음) ── */
const Auth = {
  current: null,
  isAdmin(){ return this.current?.role === 'admin'; },
};

/* ── 상태 기반 미니 라우터 ── */
let _jbPath = '#/';
function jbNavigate(path){ _jbPath = path; jbRender(); }
const routes = {};
function route(path, fn){ routes[path] = fn; }
function jbRender(){
  const hash = _jbPath;
  const path = hash.split('?')[0];
  let view = routes[path];
  let params = {};
  if(!view){
    for(const p in routes){
      if(p.includes(':')){
        const re = new RegExp('^'+p.replace(/:[^/]+/g,'([^/]+)')+'$');
        const m = path.match(re);
        if(m){
          view = routes[p];
          const keys = [...p.matchAll(/:([^/]+)/g)].map(x=>x[1]);
          keys.forEach((k,i)=>params[k]=m[i+1]);
          break;
        }
      }
    }
  }
  if(!view) view = ()=>`<div class="p-8 text-center">페이지 없음 <a href="#/" class="text-blue-600">홈</a></div>`;
  const container = document.getElementById('jangbi-root');
  if(!container) return;
  container.innerHTML = layout(view(params));
  bindNav();
  if(window._afterRender){ window._afterRender(params); window._afterRender=null; }
}
function bindNav(){
  document.querySelectorAll('#jangbi-root [data-nav]').forEach(a=>{
    if(_jbPath.startsWith(a.getAttribute('href'))) a.classList.add('active');
    a.addEventListener('click', ()=>{
      if(window.innerWidth < 768){
        const m = document.getElementById('mnav');
        if(m && !m.classList.contains('hidden')) m.classList.add('hidden');
      }
    });
  });
}

/* ── 레이아웃 ── */
function layout(content){
  if(!Auth.current) return `<div style="padding:16px;">${content}</div>`;
  const admin = Auth.isAdmin();
  const navItems = [
    {h:'#/', label:'대시보드', icon:'🏠'},
    {h:'#/equipment', label:'장비목록', icon:'🔧'},
    admin && {h:'#/maintenance', label:'정비입력', icon:'🛠️'},
    admin && {h:'#/consumables', label:'소모품', icon:'📦'},
    {h:'#/inspection', label:'월간점검', icon:'📋'},
  ].filter(Boolean);

  return `
  <div style="min-height:100vh;background:var(--bg);color:var(--text);">
    <div style="display:flex;gap:6px;padding:10px 16px;background:var(--surface);border-bottom:1px solid var(--border);flex-wrap:wrap;align-items:center;">
      <span style="font-size:13px;font-weight:700;color:var(--text2);margin-right:6px;flex-shrink:0;">🏭 장비관리</span>
      ${navItems.map(n=>{
        const active = n.h==='#/' ? _jbPath==='#/' : _jbPath.startsWith(n.h);
        return `<a href="${n.h}" data-nav style="padding:5px 13px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;background:${active?'var(--accent)':'var(--surface3)'};color:${active?'#fff':'var(--text2)'};border:1px solid ${active?'var(--accent)':'var(--border)'};">${n.icon} ${n.label}</a>`;
      }).join('')}
    </div>
    <div style="padding:16px;">${content}</div>
  </div>`;
}

/* ── 홈 ── */
route('#/', ()=>{
  if(Auth.isAdmin()) return adminDashboard();
  return workerHome();
});

function workerHome(){
  const me = Auth.current;
  const myItems = Store.equipment.filter(e=>e.currentHolderId===me.employeeId && e.status==='출장중');
  return `
  <div>
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-2xl font-bold">대시보드</h1>
      <span class="text-sm text-slate-500">${me.name} (작업자)</span>
    </div>
    <h2 class="font-bold mb-2">내 출장 장비 (${myItems.length})</h2>
    <div class="bg-white rounded-xl shadow-sm overflow-hidden">
      ${myItems.length===0?'<div class="p-4 text-slate-400 text-sm">없음</div>':myItems.map(e=>{
        const overdue = isOverdue(e.expectedReturnDate);
        const site = Store.getById('sites', e.currentSiteId);
        return `<a href="#/equipment/${e.id}" class="flex justify-between items-center px-4 py-3 border-t first:border-t-0 hover:bg-slate-50">
          <div>
            <span class="font-semibold">${e.id}</span> · ${e.type}
            <span class="text-xs text-slate-500 ml-2">${site?.name||''} · 예정 ${fmt(e.expectedReturnDate)||'-'}</span>
          </div>
          ${overdue?'<span class="badge b-분실">⚠ 반납지연</span>':'<span class="badge b-출장중">출장중</span>'}
        </a>`;
      }).join('')}
    </div>
  </div>`;
}

function adminDashboard(){
  const eqs = Store.equipment;
  const counts = {사내:0, 출장중:0, 정비중:0, 분실:0, 폐기:0};
  eqs.forEach(e=>{ counts[e.status] = (counts[e.status]||0)+1; });
  const overdue = eqs.filter(e=>e.status==='출장중' && isOverdue(e.expectedReturnDate));
  const onTrip = eqs.filter(e=>e.status==='출장중').sort((a,b)=>a.id.localeCompare(b.id));
  const underMaint = eqs.filter(e=>e.status==='정비중').sort((a,b)=>a.id.localeCompare(b.id));
  const inspOverdue = eqs.filter(e=>e.status!=='폐기' && e.nextInspectionDate && isOverdue(e.nextInspectionDate));
  const inspSoon = eqs.filter(e=>e.status!=='폐기' && e.nextInspectionDate && daysBetween(todayISO(), e.nextInspectionDate)<=14 && daysBetween(todayISO(), e.nextInspectionDate)>=0);
  const lowStock = Store.consumables.filter(c=>Number(c.currentStock)<=Number(c.minStock||0));

  const eqRow = (e, showOverdue=false)=>{
    const site = Store.getById('sites', e.currentSiteId);
    const holder = Store.users.find(x=>x.employeeId===e.currentHolderId);
    const od = showOverdue && isOverdue(e.expectedReturnDate);
    return `<a href="#/equipment/${e.id}" class="flex justify-between items-center px-3 py-2 border-t first:border-t-0 text-sm hover:bg-slate-50">
      <span><strong>${e.id}</strong> <span class="text-slate-500">${e.type||''}</span>${site?' · '+site.name:''}</span>
      <span class="flex items-center gap-2">
        ${holder?`<span class="text-slate-400 text-xs">${holder.name}</span>`:''}
        ${e.expectedReturnDate?`<span class="${od?'text-red-600 font-semibold':'text-slate-400'} text-xs">~${fmt(e.expectedReturnDate)}${od?` (${daysBetween(e.expectedReturnDate,todayISO())}일 초과)`:''}</span>`:''}
      </span>
    </a>`;
  };

  return `
  <div>
    <h1 class="text-2xl font-bold mb-4">대시보드</h1>
    <div class="grid grid-cols-5 gap-3 mb-5">
      ${Object.entries(counts).map(([k,v])=>`
        <a href="#/equipment?status=${encodeURIComponent(k)}" class="bg-white rounded-xl p-4 shadow-sm hover:shadow">
          <div class="text-xs text-slate-500">${k}</div>
          <div class="text-2xl font-bold mt-1"><span class="badge b-${k}">${v}</span></div>
        </a>`).join('')}
    </div>

    <div class="grid grid-cols-2 gap-4 mb-4">
      <div class="bg-white rounded-xl shadow-sm overflow-hidden">
        <div class="px-4 py-3 border-b font-bold text-sm flex items-center gap-2">
          <span class="badge b-출장중">출장중</span> 장비 (${onTrip.length})
        </div>
        ${onTrip.length===0
          ?'<div class="px-4 py-3 text-slate-400 text-sm">없음</div>'
          :onTrip.map(e=>eqRow(e, true)).join('')}
      </div>
      <div class="bg-white rounded-xl shadow-sm overflow-hidden">
        <div class="px-4 py-3 border-b font-bold text-sm flex items-center gap-2">
          <span class="badge b-정비중">정비중</span> 장비 (${underMaint.length})
        </div>
        ${underMaint.length===0
          ?'<div class="px-4 py-3 text-slate-400 text-sm">없음</div>'
          :underMaint.map(e=>eqRow(e)).join('')}
      </div>
    </div>

    ${(inspOverdue.length||inspSoon.length)?`
    <div class="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
      <h2 class="font-bold text-amber-700 mb-2">🛠 점검 필요 (${inspOverdue.length+inspSoon.length})</h2>
      ${inspOverdue.map(e=>`
        <a href="#/equipment/${e.id}" class="flex justify-between items-center px-3 py-1.5 text-sm border-t first:border-t-0 hover:bg-amber-100">
          <span><strong>${e.id}</strong> ${e.type}</span>
          <span class="text-red-600 font-semibold text-xs">⛔ ${fmt(e.nextInspectionDate)} (${daysBetween(e.nextInspectionDate, todayISO())}일 초과)</span>
        </a>`).join('')}
      ${inspSoon.map(e=>`
        <a href="#/equipment/${e.id}" class="flex justify-between items-center px-3 py-1.5 text-sm border-t first:border-t-0 hover:bg-amber-100">
          <span><strong>${e.id}</strong> ${e.type}</span>
          <span class="text-amber-700 text-xs">${fmt(e.nextInspectionDate)} (D-${daysBetween(todayISO(), e.nextInspectionDate)})</span>
        </a>`).join('')}
    </div>`:''}

    ${lowStock.length?`
    <div class="bg-orange-50 border border-orange-200 rounded-xl p-4 mb-4">
      <h2 class="font-bold text-orange-700 mb-2">📦 소모품 재고 부족 (${lowStock.length})</h2>
      ${lowStock.map(c=>{
        const cur = Number(c.currentStock);
        const min = Number(c.minStock||0);
        const unit = c.unit ? ' '+c.unit : '';
        return `<div class="flex justify-between items-center px-3 py-1.5 text-sm border-t first:border-t-0">
          <span>${c.name}</span>
          <span class="text-orange-700">현재 <strong>${cur}${unit}</strong> / 최소 ${min}${unit}</span>
        </div>`;
      }).join('')}
    </div>`:''}
  </div>`;
}

/* ── 인증 (장비별 복수 인증, 없으면 미인증) ── */
// 인증 종류는 기본값 + 장비에 실제로 붙어 있는 인증에서 모은다 (별도 저장소 없음).
// 새 인증은 입력하는 즉시 종류에 추가되고, 어느 장비에도 없으면 목록에서 사라진다(기본값 제외).
const CERT_DEFAULTS = ['원자력 인증','ISO 인증'];
const escH = s => String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const certsOf = e => Array.isArray(e?.certs) ? e.certs.filter(Boolean) : [];
const allCertTypes = () => [...new Set([...CERT_DEFAULTS, ...Store.equipment.flatMap(certsOf)])];
const certBadges = e => certsOf(e).map(c=>`<span class="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 ml-1">${escH(c)}</span>`).join('');
// 폼용: 인증 체크박스 + 직접 입력칸. 값은 collectCerts(FormData)로 읽는다.
const certInputs = (cur=[]) => `
  <div class="flex flex-wrap gap-x-4 gap-y-1 mt-1">
    ${allCertTypes().map(c=>`<label class="inline-flex items-center gap-1 text-sm"><input type="checkbox" name="certs" value="${escH(c)}" ${cur.includes(c)?'checked':''} /> ${escH(c)}</label>`).join('')}
  </div>
  <input name="newCerts" class="w-full border rounded px-3 py-2 mt-2" placeholder="다른 인증 직접 입력 (쉼표로 여러 개) — 모두 비우면 미인증" />`;
const collectCerts = fd => [...new Set([
  ...fd.getAll('certs'),
  ...String(fd.get('newCerts')||'').split(',').map(s=>s.trim()),
].filter(Boolean))];

// 목록 화면의 체크 선택 — 다시 그려도(실시간 동기화 포함) 유지되도록 모듈 변수에 둔다.
const _eqSel = new Set();

/* ── 장비 목록 ── */
route('#/equipment', ()=>{
  const params = new URLSearchParams(_jbPath.split('?')[1]||'');
  const filterStatus = params.get('status')||'';
  const filterCat = params.get('cat')||'';
  const filterMob = params.get('mob')||'';
  const filterCert = params.get('cert')||'';   // '' | '__none'(미인증) | 인증명
  const q0 = params.get('q')||'';
  const admin = Auth.isAdmin();
  const updateHash = (k,v)=>{
    const p = new URLSearchParams(_jbPath.split('?')[1]||'');
    if(v) p.set(k,v); else p.delete(k);
    const qs = p.toString();
    jbNavigate('#/equipment'+(qs?'?'+qs:''));
  };
  for(const id of [..._eqSel]) if(!Store.getById('equipment', id)) _eqSel.delete(id);
  setTimeout(()=>{
    const search = document.getElementById('eq-search');
    if(search){
      search.value = q0;
      search.focus();
      let t;
      search.oninput = ()=>{
        const q = search.value.toLowerCase();
        document.querySelectorAll('[data-eq-row]').forEach(r=>{
          r.style.display = r.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
        syncSelUI();
        clearTimeout(t); t = setTimeout(()=>updateHash('q', search.value), 600);
      };
    }
    const fs = document.getElementById('f-status');
    const fc = document.getElementById('f-cat');
    const fm = document.getElementById('f-mob');
    const fct = document.getElementById('f-cert');
    if(fs) fs.onchange = e=>updateHash('status', e.target.value);
    if(fc) fc.onchange = e=>updateHash('cat', e.target.value);
    if(fm) fm.onchange = e=>updateHash('mob', e.target.value);
    if(fct) fct.onchange = e=>updateHash('cert', e.target.value);

    // 체크 선택
    const visibleBoxes = ()=>[...document.querySelectorAll('[data-sel]')].filter(b=>b.closest('[data-eq-row]').style.display!=='none');
    const syncSelUI = ()=>{
      const bar = document.getElementById('cert-bar');
      const cnt = document.getElementById('sel-count');
      const all = document.getElementById('sel-all');
      if(bar) bar.style.display = _eqSel.size ? '' : 'none';
      if(cnt) cnt.textContent = _eqSel.size;
      if(all){
        const vis = visibleBoxes();
        const n = vis.filter(b=>b.checked).length;
        all.checked = vis.length>0 && n===vis.length;
        all.indeterminate = n>0 && n<vis.length;
      }
    };
    document.querySelectorAll('[data-sel]').forEach(b=>{
      b.onchange = ()=>{ b.checked ? _eqSel.add(b.value) : _eqSel.delete(b.value); syncSelUI(); };
    });
    const selAll = document.getElementById('sel-all');
    if(selAll) selAll.onchange = ()=>{
      visibleBoxes().forEach(b=>{ b.checked = selAll.checked; selAll.checked ? _eqSel.add(b.value) : _eqSel.delete(b.value); });
      syncSelUI();
    };
    syncSelUI();

    window.clearEqSel = ()=>{ _eqSel.clear(); jbRender(); };
    // op: 'add' | 'remove' | 'clear'(모든 인증 제거 → 미인증)
    window.bulkCert = (op)=>{
      const ids = [..._eqSel].filter(id=>Store.getById('equipment', id));
      if(!ids.length) return;
      const name = (document.getElementById('cert-input')?.value||'').trim();
      if(op!=='clear' && !name){ alert('인증을 선택하거나 입력하세요'); return; }
      const msg = op==='add' ? `선택한 ${ids.length}건에 "${name}"을(를) 추가할까요?`
        : op==='remove' ? `선택한 ${ids.length}건에서 "${name}"을(를) 제거할까요?`
        : `선택한 ${ids.length}건의 인증을 모두 지우고 미인증으로 바꿀까요?`;
      if(!confirm(msg)) return;
      let changed = 0;
      for(const id of ids){
        const cur = certsOf(Store.getById('equipment', id));
        const next = op==='add' ? (cur.includes(name) ? cur : [...cur, name])
          : op==='remove' ? cur.filter(c=>c!==name) : [];
        if(next.length===cur.length) continue;
        Store.update('equipment', id, {certs: next});
        Store.log('cert_change', id, `인증 변경: ${cur.join(', ')||'미인증'} → ${next.join(', ')||'미인증'}`, {certs: next});
        changed++;
      }
      alert(`${changed}건 변경${ids.length-changed?` (이미 해당 상태 ${ids.length-changed}건)`:''}`);
      jbRender();
    };

    // opt 없음: 현재 화면 목록 / {all:true}: 전체 / {cert:이름}: 해당 인증 / {none:true}: 미인증
    window.printEquipmentList = (opt)=>{
      const menu = document.getElementById('print-menu'); if(menu) menu.open = false;
      const byId = (a,b)=>a.id.localeCompare(b.id);
      const printList = !opt ? list
        : opt.all ? Store.equipment.slice().sort(byId)
        : opt.none ? Store.equipment.filter(e=>certsOf(e).length===0).sort(byId)
        : Store.equipment.filter(e=>certsOf(e).includes(opt.cert)).sort(byId);
      // 인증은 내부 관리용 — 인쇄물에는 제목·열 어디에도 인증 상태를 드러내지 않는다.
      const title = '장비 목록';
      const rows = printList.map(e=>{
        const site = Store.getById('sites', e.currentSiteId);
        const holder = e.currentHolderId||'';
        const loc = e.status==='출장중'?[site?.name,holder].filter(Boolean).join(' / ')||'-':'-';
        const lastMaint = Store.byEqId('maintenance', e.id).sort((a,b)=>(b.date||'').localeCompare(a.date||''))[0];
        return `<tr>
          <td>${e.type||''}${e.spec?' · '+e.spec:''}</td>
          <td>${e.id}</td>
          <td>${e.category||''}</td>
          <td>${e.status||'사내'}</td>
          <td>${loc}</td>
          <td>${fmt(lastMaint?.date)||'-'}</td>
          <td>${fmt(e.nextInspectionDate)||'-'}</td>
        </tr>`;
      }).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title>
      <style>
        @page{size:A4 landscape;margin:12mm}
        body{font-family:'Malgun Gothic',sans-serif;font-size:11px;color:#000}
        h2{font-size:13px;margin:0 0 6px}
        p{font-size:10px;color:#666;margin:0 0 8px}
        table{width:100%;border-collapse:collapse}
        th,td{border:1px solid #bbb;padding:4px 6px;text-align:left;white-space:nowrap}
        th{background:#e8e8e8;font-weight:bold}
        tr:nth-child(even) td{background:#f8f8f8}
      </style></head><body>
        <h2>${title} (${printList.length}건)</h2>
        <p>출력일: ${todayISO()}</p>
        <table><thead><tr><th>장비명</th><th>장비관리번호</th><th>카테고리</th><th>상태</th><th>현재위치/소지자</th><th>최근점검</th><th>점검예정일</th></tr></thead>
        <tbody>${rows}</tbody></table>
      </body></html>`;
      const w = window.open('','_blank','width=860,height=1200');
      if(!w) return;
      w.document.write(html); w.document.close(); w.focus();
      setTimeout(()=>{ w.print(); }, 400);
    };
  });
  let list = Store.equipment.slice().sort((a,b)=>a.id.localeCompare(b.id));
  if(filterStatus) list = list.filter(e=>e.status===filterStatus);
  if(filterCat) list = list.filter(e=>e.category===filterCat);
  if(filterMob) list = list.filter(e=>(e.mobility||'portable')===filterMob);
  if(filterCert) list = list.filter(e=>filterCert==='__none' ? certsOf(e).length===0 : certsOf(e).includes(filterCert));
  if(q0){ const qq = q0.toLowerCase(); list = list.filter(e=>JSON.stringify(e).toLowerCase().includes(qq)); }
  const cats = [...new Set(Store.equipment.map(e=>e.category).filter(Boolean))];
  const certTypes = allCertTypes();
  const menuBtn = 'block w-full text-left px-4 py-2 hover:bg-slate-100';

  return `
  <div>
    <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
      <h1 class="text-2xl font-bold">장비 목록 (${list.length})</h1>
      ${admin?`<div class="flex gap-2 flex-wrap">
        <a href="#/equipment/new" class="bg-slate-900 text-white px-4 py-2 rounded-lg">+ 신규 등록</a>
        <a href="#/equipment/bulk" class="bg-emerald-600 text-white px-4 py-2 rounded-lg">+ 일괄 등록</a>
        <a href="#/equipment/import-card" class="bg-teal-600 text-white px-4 py-2 rounded-lg">📇 이력카드 가져오기</a>
        <a href="#/qr-print" class="bg-amber-500 text-white px-4 py-2 rounded-lg">🏷 라벨 인쇄</a>
        <details id="print-menu" class="relative">
          <summary class="bg-slate-600 text-white px-4 py-2 rounded-lg cursor-pointer list-none">🖨 목록 인쇄 ▾</summary>
          <div class="absolute left-0 md:left-auto md:right-0 mt-1 z-10 bg-white text-slate-800 border rounded-lg shadow-lg py-1 min-w-[200px] text-sm">
            <button onclick="printEquipmentList({all:true})" class="${menuBtn}">전체 장비목록</button>
            ${certTypes.map(c=>`<button data-cert="${escH(c)}" onclick="printEquipmentList({cert:this.dataset.cert})" class="${menuBtn}">${escH(c)} 장비목록</button>`).join('')}
            <button onclick="printEquipmentList({none:true})" class="${menuBtn}">미인증 장비목록</button>
            <button onclick="printEquipmentList()" class="${menuBtn} border-t">현재 화면 목록</button>
          </div>
        </details>
      </div>`:''}
    </div>
    <div class="bg-white rounded-xl p-3 shadow-sm mb-3 flex flex-wrap gap-2 items-center">
      <input id="eq-search" placeholder="검색 (장비명, 관리번호, 모델명, 스펙...)" class="border rounded-lg px-3 py-2 flex-1 min-w-[180px]" />
      <select id="f-status" class="border rounded-lg px-2 py-2">
        <option value="">전체 상태</option>
        ${['사내','출장중','정비중','분실','폐기'].map(s=>`<option value="${s}" ${s===filterStatus?'selected':''}>${s}</option>`).join('')}
      </select>
      <select id="f-cat" class="border rounded-lg px-2 py-2">
        <option value="">전체 카테고리</option>
        ${cats.map(c=>`<option value="${c}" ${c===filterCat?'selected':''}>${c}</option>`).join('')}
      </select>
      <select id="f-mob" class="border rounded-lg px-2 py-2">
        <option value="">전체 유형</option>
        <option value="portable" ${filterMob==='portable'?'selected':''}>이동장비</option>
        <option value="fixed" ${filterMob==='fixed'?'selected':''}>고정설비</option>
      </select>
      <select id="f-cert" class="border rounded-lg px-2 py-2">
        <option value="">전체 인증</option>
        <option value="__none" ${filterCert==='__none'?'selected':''}>미인증</option>
        ${certTypes.map(c=>`<option value="${escH(c)}" ${c===filterCert?'selected':''}>${escH(c)}</option>`).join('')}
      </select>
      ${(filterStatus||filterCat||filterMob||filterCert||q0)?`<a href="#/equipment" class="text-xs text-slate-500 underline">필터 해제</a>`:''}
    </div>
    ${admin?`
    <div id="cert-bar" style="display:none" class="bg-indigo-50 border border-indigo-200 text-slate-800 rounded-xl p-3 mb-3 flex flex-wrap gap-2 items-center text-sm">
      <span class="font-semibold">선택 <span id="sel-count">0</span>건</span>
      <input id="cert-input" list="cert-types" placeholder="인증 선택 또는 새로 입력" class="border rounded-lg px-3 py-1.5 bg-white min-w-[180px]" />
      <datalist id="cert-types">${certTypes.map(c=>`<option value="${escH(c)}"></option>`).join('')}</datalist>
      <button onclick="bulkCert('add')" class="bg-indigo-600 text-white px-3 py-1.5 rounded-lg">+ 인증 추가</button>
      <button onclick="bulkCert('remove')" class="bg-white border border-indigo-300 text-indigo-700 px-3 py-1.5 rounded-lg">− 인증 제거</button>
      <button onclick="bulkCert('clear')" class="bg-white border px-3 py-1.5 rounded-lg">미인증으로</button>
      <button onclick="clearEqSel()" class="text-xs text-slate-500 underline ml-auto">선택 해제</button>
    </div>`:''}
    <div class="bg-white rounded-xl shadow-sm overflow-hidden">
      <div class="flex items-center bg-slate-50 text-xs font-semibold text-slate-500">
        ${admin?`<label class="pl-4 pr-1 py-2 cursor-pointer" title="보이는 장비 전체 선택"><input id="sel-all" type="checkbox" /></label>`:''}
        <div class="grid grid-cols-12 flex-1 px-4 py-2">
          <div class="col-span-3">장비명</div><div class="col-span-2">장비관리번호</div><div class="col-span-1">카테고리</div>
          <div class="col-span-2">상태</div><div class="col-span-2">현재 위치</div>
          <div class="col-span-1 text-right">최근점검</div><div class="col-span-1 text-right">점검예정일</div>
        </div>
      </div>
      ${list.length===0?'<div class="p-6 text-center text-slate-400">등록된 장비 없음</div>':list.map(e=>{
        const site = Store.getById('sites', e.currentSiteId);
        const u = Store.users.find(x=>x.employeeId===e.currentHolderId);
        const overdue = e.status==='출장중' && isOverdue(e.expectedReturnDate);
        const inspSoon = e.nextInspectionDate && daysBetween(todayISO(), e.nextInspectionDate)<=14;
        const inspOverdue = e.nextInspectionDate && isOverdue(e.nextInspectionDate);
        const fixed = (e.mobility||'portable')==='fixed';
        const lastMaint = Store.byEqId('maintenance', e.id).sort((a,b)=>(b.date||'').localeCompare(a.date||''))[0];
        return `<div data-eq-row class="flex items-center border-t hover:bg-slate-50">
          ${admin?`<label class="pl-4 pr-1 py-3 cursor-pointer"><input type="checkbox" data-sel value="${e.id}" ${_eqSel.has(e.id)?'checked':''} /></label>`:''}
          <a href="#/equipment/${e.id}" class="grid grid-cols-12 flex-1 px-4 py-3 text-sm items-center">
          <div class="col-span-3 font-bold">${e.type||''} ${fixed?'<span class="badge b-폐기" title="고정설비">📌</span>':''}${certBadges(e)}<div class="text-slate-400 text-xs font-normal">${e.spec||''}</div></div>
          <div class="col-span-2 text-xs text-slate-500">${e.id}</div>
          <div class="col-span-1 text-slate-500 text-xs">${e.category||''}</div>
          <div class="col-span-2">
            <span class="badge b-${e.status||'사내'}">${e.status||'사내'}</span>
            ${overdue?'<span class="badge b-분실 ml-1">지연</span>':''}
          </div>
          <div class="col-span-2 text-xs text-slate-500">${e.status==='출장중'?(site?.name||'-')+(u?` / ${u.name}`:''):'-'}</div>
          <div class="col-span-1 text-right text-xs text-slate-400">${fmt(lastMaint?.date)||'-'}</div>
          <div class="col-span-1 text-right text-xs ${inspOverdue?'text-red-500 font-semibold':inspSoon?'text-amber-500 font-semibold':'text-slate-400'}">${fmt(e.nextInspectionDate)||'-'}</div>
          </a>
        </div>`;
      }).join('')}
    </div>
  </div>`;
});

/* ── 장비 상세 ── */
route('#/equipment/:id', ({id})=>{
  if(id==='new') return equipmentEdit(null);
  const e = Store.getById('equipment', id);
  if(!e) return `<div class="p-8">장비 없음 - <a href="#/equipment" class="text-blue-600">목록</a></div>`;
  const site = Store.getById('sites', e.currentSiteId);
  const holder = Store.users.find(x=>x.employeeId===e.currentHolderId);
  const checkouts = Store.byEqId('checkouts', id).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
  const maint = Store.byEqId('maintenance', id).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const lostHistory = (Store.auditLogs||[]).filter(a=>a.equipmentId===id && ['lost','found'].includes(a.action));
  const fixed = (e.mobility||'portable')==='fixed';


  const events = [];
  checkouts.forEach(c=>{
    const s = Store.getById('sites', c.siteId);
    const u = Store.users.find(x=>x.employeeId===c.requesterId);
    if(c.checkoutDate||c.createdAt) events.push({
      ts: c.checkoutDate||c.createdAt, kind:'checkout',
      icon:'📤', color:'border-amber-400 bg-amber-50',
      title: `출고 — ${u?.name||c.requesterId} → ${s?.name||'-'}`,
      sub: c.purpose||'', badge: c.status, badgeClass:`b-${c.status}`,
      extra: `예정 반납 ${fmt(c.expectedReturnDate)}`,
    });
    if(c.actualReturnDate) events.push({
      ts: c.actualReturnDate, kind:'return',
      icon:'📥', color:'border-emerald-400 bg-emerald-50',
      title: `반납 — ${u?.name||c.requesterId} (${s?.name||'-'})`,
      sub: c.returnNote||'', badgeClass:'b-반납완료', badge:'반납완료',
      extra: c.returnPhotoUrl?`<a href="${c.returnPhotoUrl}" target="_blank" class="text-blue-600 underline">상태 사진 보기</a>`:'',
    });
  });
  maint.forEach(m=>{
    const u = Store.users.find(x=>x.employeeId===m.performerId);
    events.push({
      ts: m.date||m.createdAt, kind:'maintenance',
      icon:'🔧', color:'border-blue-400 bg-blue-50',
      title: `${m.type} — ${m.inspector||u?.name||m.performerId||'-'}`,
      sub: m.inspection ? inspSummary(m)
        : [m.partsReplaced?'부품: '+m.partsReplaced:'', m.cost?Number(m.cost).toLocaleString()+'원':''].filter(Boolean).join(' · '),
      extra: [m.note||'', m.nextInspectionDate?`다음점검: ${fmt(m.nextInspectionDate)}`:''].filter(Boolean).join(' | '),
    });
  });
  Store.byEqId('auditLogs', id)
    // cert_change(인증 변경)는 내부 관리용이라 기록만 남기고 타임라인에는 띄우지 않는다.
    // "다음 점검일 갱신"도 정비 항목의 "다음점검:"과 겹치므로 띄우지 않는다.
    .filter(a=>['lost','found','status_change'].includes(a.action) && !String(a.detail||'').startsWith('다음 점검일 갱신'))
    .forEach(a=>{
      const iconMap = {lost:'🔴', found:'🟢', status_change:'🔄'};
      events.push({
        ts: a.ts, kind: a.action,
        icon: iconMap[a.action]||'📝',
        color: a.action==='lost'?'border-red-400 bg-red-50':a.action==='found'?'border-emerald-400 bg-emerald-50':'border-slate-300 bg-slate-50',
        title: a.detail, sub: `${a.actorName||a.actor}`, extra:'',
      });
    });
  events.sort((a,b)=>(b.ts||'').localeCompare(a.ts||''));


  return `
  <div>
    <a href="#/equipment" class="text-sm text-blue-600">← 목록</a>
    <div class="bg-white rounded-xl shadow-sm p-4 md:p-6 mt-2">
      <div class="flex flex-wrap gap-4">
        <div class="flex-shrink-0">
          ${e.photoUrl?`<img src="${e.photoUrl}" class="w-52 h-52 object-cover rounded-lg border" />`:'<div class="w-52 h-52 bg-slate-100 rounded-lg flex items-center justify-center text-slate-400 text-sm">사진 없음</div>'}
        </div>
        <div class="flex-1 min-w-[200px]" style="position:relative;">
          <div style="position:absolute;top:0;right:0;text-align:center;">
            <img src="${(e.qrUrl||qrUrl(e.id))}" style="width:90px;height:90px;border-radius:6px;border:1px solid var(--border);display:block;" />
            <div style="font-size:10px;color:var(--text-muted,#aaa);margin-top:3px;">${e.id}</div>
          </div>
          <div class="flex items-center gap-2 flex-wrap" style="padding-right:100px;">
            <h1 class="text-2xl font-bold">${e.type||e.id}</h1>
            <span class="badge b-${e.status||'사내'}">${e.status||'사내'}</span>
            ${lostHistory.length?`<span class="badge b-분실" title="과거 분실 이력">⚠ 분실이력 ${lostHistory.filter(x=>x.action==='lost').length}회</span>`:''}
          </div>
          <p class="text-slate-500 text-sm">${e.spec||''}</p>
          <dl style="display:grid;grid-template-columns:7em 1fr;row-gap:3px;column-gap:12px;margin-top:10px;font-size:13px;">
            <dt style="color:var(--text-muted,#999);">장비관리번호</dt><dd>${e.id}</dd>
            <dt style="color:var(--text-muted,#999);">카테고리</dt><dd>${e.category||'-'}</dd>
            ${e.location?`<dt style="color:var(--text-muted,#999);">위치</dt><dd>${escH(e.location)}</dd>`:''}
            <dt style="color:var(--text-muted,#999);">인증</dt><dd>${certsOf(e).length?certBadges(e).replace(/ ml-1/g,' mr-1'):'미인증'}</dd>
            <dt style="color:var(--text-muted,#999);">모델명</dt><dd>${e.serial||'-'}</dd>
            <dt style="color:var(--text-muted,#999);">구입일</dt><dd>${fmt(e.purchaseDate)||'-'}</dd>
            <dt style="color:var(--text-muted,#999);">점검주기</dt><dd>${e.inspectionCycleMonths?e.inspectionCycleMonths+'개월':'-'}</dd>
            <dt style="color:var(--text-muted,#999);">다음점검</dt><dd>${fmt(e.nextInspectionDate)||'-'}</dd>
            ${e.status==='출장중'?`
            <dt style="color:var(--text-muted,#999);">현장</dt><dd>${site?.name||'-'}</dd>
            <dt style="color:var(--text-muted,#999);">소지자</dt><dd>${holder?.name||e.currentHolderId||'-'}</dd>
            <dt style="color:var(--text-muted,#999);">반납예정</dt><dd style="${isOverdue(e.expectedReturnDate)?'color:#ef4444;font-weight:600':''}">${fmt(e.expectedReturnDate)||'-'}${isOverdue(e.expectedReturnDate)?` <span style="font-size:11px;">(${daysBetween(e.expectedReturnDate,todayISO())}일 경과)</span>`:''}</dd>
            `:''}
            ${fixed?'<dt style="color:var(--text-muted,#999);">유형</dt><dd><span class="badge b-폐기">📌 고정설비</span></dd>':''}
            ${e.note?`<dt style="color:var(--text-muted,#999);">비고</dt><dd style="white-space:pre-wrap;">${e.note}</dd>`:''}
          </dl>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;align-items:center;">
            ${Auth.isAdmin()?`
              ${!fixed?`
                ${e.status==='출장중'
                  ?`<button style="background:#3b82f6;color:#fff;padding:5px 13px;border-radius:6px;border:none;font-size:13px;cursor:default;">📤 출장중</button>
                    <button onclick="doReturn('${e.id}')" style="background:#10b981;color:#fff;padding:5px 13px;border-radius:6px;border:none;font-size:13px;cursor:pointer;">📥 반납</button>`
                  :e.status==='사내'
                    ?`<a href="#/trip/${e.id}" style="background:var(--surface3);border:1px solid var(--border);color:var(--text);padding:5px 13px;border-radius:6px;font-size:13px;text-decoration:none;display:inline-block;">📤 출장 처리</a>`
                    :`<button disabled style="background:var(--surface3);border:1px solid var(--border);color:var(--text);padding:5px 13px;border-radius:6px;font-size:13px;opacity:0.35;">📤 출장 처리</button>`
                }
              `:''}
              ${e.status==='정비중'
                ?`<button onclick="markStatus('${e.id}','사내')" style="background:#f59e0b;color:#fff;padding:5px 13px;border-radius:6px;border:none;font-size:13px;cursor:pointer;" title="클릭 시 수리 완료">🔧 수리중 ✓</button>`
                :`<button onclick="markStatus('${e.id}','정비중')" style="background:var(--surface3);border:1px solid var(--border);color:var(--text);padding:5px 13px;border-radius:6px;font-size:13px;cursor:pointer;">🔧 수리</button>`
              }
              ${e.status==='분실'
                ?`<button onclick="markStatus('${e.id}','사내')" style="background:#ef4444;color:#fff;padding:5px 13px;border-radius:6px;border:none;font-size:13px;cursor:pointer;" title="클릭 시 재발견 처리">🔴 분실 ✓</button>`
                :`<button onclick="markStatus('${e.id}','분실')" style="background:var(--surface3);border:1px solid var(--border);color:var(--text);padding:5px 13px;border-radius:6px;font-size:13px;cursor:pointer;">🔴 분실</button>`
              }
              ${e.status==='폐기'
                ?`<button disabled style="background:#6b7280;color:#fff;padding:5px 13px;border-radius:6px;border:none;font-size:13px;opacity:0.75;">🗑 폐기됨</button>`
                :`<button onclick="markStatus('${e.id}','폐기')" style="background:var(--surface3);border:1px solid var(--border);color:var(--text);padding:5px 13px;border-radius:6px;font-size:13px;cursor:pointer;">🗑 폐기</button>`
              }
              <span style="width:1px;height:20px;background:var(--border);display:inline-block;margin:0 2px;"></span>
              <a href="#/equipment/${e.id}/edit" style="background:var(--surface3);border:1px solid var(--border);color:var(--text);padding:5px 13px;border-radius:6px;font-size:13px;text-decoration:none;display:inline-block;">✏️ 수정</a>
              <a href="#/maintenance?eq=${e.id}" style="background:var(--surface3);border:1px solid var(--border);color:var(--text);padding:5px 13px;border-radius:6px;font-size:13px;text-decoration:none;display:inline-block;">📋 정비기록</a>
              ${inspInfo(e)?`<a href="#/inspection/${e.id}" style="background:#059669;color:#fff;padding:5px 13px;border-radius:6px;font-size:13px;text-decoration:none;display:inline-block;">✅ 월간 점검${inspOf(e.id, thisMonth())?' (이번 달 완료)':''}</a>`:''}
            `:''}
          </div>
        </div>
      </div>
    </div>
    ${events.length===0?`<div class="bg-white rounded-xl shadow-sm p-4 mt-4 text-slate-400 text-sm">이력 없음</div>`:`
    <div class="bg-white rounded-xl shadow-sm p-4 mt-4">
      <h2 class="font-bold mb-3">전체 이력 타임라인 (${events.length}건)</h2>
      <ul class="space-y-2 relative">
        <div class="absolute left-4 top-0 bottom-0 w-0.5 bg-slate-200"></div>
        ${events.slice(0,40).map(ev=>`
        <li class="pl-10 relative">
          <span class="absolute left-2 top-2 w-5 h-5 flex items-center justify-center text-base">${ev.icon}</span>
          <div class="rounded-lg border-l-4 ${ev.color} px-3 py-2 text-sm">
            <div class="flex flex-wrap justify-between gap-1">
              <strong>${ev.title}</strong>
              <span class="text-xs text-slate-400">${fmt(ev.ts)}</span>
            </div>
            ${ev.badge?`<span class="badge ${ev.badgeClass||''} mt-0.5">${ev.badge}</span>`:''}
            ${ev.sub?`<div class="text-xs text-slate-500 mt-0.5">${ev.sub}</div>`:''}
            ${ev.extra?`<div class="text-xs text-slate-600 mt-0.5">${ev.extra}</div>`:''}
          </div>
        </li>`).join('')}
      </ul>
      ${events.length>40?`<p class="text-xs text-slate-400 mt-2 pl-10">... 최근 40건만 표시</p>`:''}
    </div>`}
  </div>`;
});

window.markStatus = (id, status)=>{
  const e = Store.getById('equipment', id); if(!e) return;
  const prevStatus = e.status;
  if(status === '분실'){
    const reason = prompt(`"${id}" 분실 처리\n분실 경위를 입력하세요 (선택):`);
    if(reason === null) return;
    Store.update('equipment', id, {status:'분실', currentSiteId:null, currentHolderId:null, expectedReturnDate:null, lostAt:new Date().toISOString(), lostReason:reason||''});
    Store.log('lost', id, `분실 처리 (이전상태: ${prevStatus})${reason?' — '+reason:''}`, {prevStatus, reason});
    jbRender(); return;
  }
  if(prevStatus === '분실' && status === '사내'){
    const note = prompt(`"${id}" 재발견 처리\n발견 경위를 입력하세요 (선택):`);
    if(note === null) return;
    Store.update('equipment', id, {status:'사내', foundAt:new Date().toISOString(), foundNote:note||''});
    Store.log('found', id, `재발견 처리${note?' — '+note:''}`, {note});
    jbRender(); return;
  }
  if(!confirm(`${id}을(를) "${status}" 상태로 변경합니까?`)) return;
  const patch = {status};
  if(['폐기','정비중'].includes(status)){ patch.currentSiteId=null; patch.currentHolderId=null; patch.expectedReturnDate=null; }
  Store.update('equipment', id, patch);
  Store.log('status_change', id, `상태 변경: ${prevStatus} → ${status}`, {prevStatus, newStatus:status});
  jbRender();
};

function processReturn(id, note, photoUrl){
  const e = Store.getById('equipment', id); if(!e) return false;
  const now = new Date().toISOString();
  const active = Store.checkouts
    .filter(x=>x.equipmentId===id && x.status==='출고완료')
    .sort((a,b)=>(b.checkoutDate||b.createdAt||'').localeCompare(a.checkoutDate||a.createdAt||''));
  if(active[0]){
    Store.update('checkouts', active[0].id, {status:'반납완료', actualReturnDate:now, returnNote:note||'', returnPhotoUrl:photoUrl||''});
  }
  const site = Store.getById('sites', e.currentSiteId);
  Store.update('equipment', id, {status:'사내', currentSiteId:null, currentHolderId:null, expectedReturnDate:null});
  Store.log('return', id, `반납 처리 — ${site?.name||'-'}에서 복귀${note?' / '+note:''}${photoUrl?' / 사진첨부':''}`, {checkoutId:active[0]?.id, note, photoUrl});
  return true;
}
window.returnEquipment = (id)=>{ jbNavigate('#/return/'+id); };

/* ── 장비 일괄 등록 ── */
route('#/equipment/bulk', ()=>{
  if(!Auth.isAdmin()) return `<div class="p-6">관리자만 가능합니다.</div>`;
  setTimeout(()=>{
    const f = document.getElementById('bulk-form');
    const preview = document.getElementById('bulk-preview');
    const computeIds = ()=>{
      const prefix = f.prefix.value.trim();
      const start = Number(f.start.value)||1;
      const count = Math.max(0, Math.min(200, Number(f.count.value)||0));
      const pad = Number(f.pad.value)||2;
      const ids = [];
      for(let i=0;i<count;i++){ ids.push(prefix + String(start+i).padStart(pad,'0')); }
      return ids;
    };
    const refresh = ()=>{
      const ids = computeIds();
      const dup = ids.filter(id=>Store.getById('equipment', id));
      preview.innerHTML = ids.length===0 ? '<span class="text-slate-400">개수를 입력하세요</span>'
        : ids.map(id=>`<span class="inline-block px-2 py-1 m-0.5 rounded text-xs ${dup.includes(id)?'bg-red-200 text-red-800':'bg-slate-200'}">${id}</span>`).join('')
          + (dup.length?`<div class="text-red-600 text-xs mt-2">⚠ ${dup.length}개 ID가 이미 존재합니다 (해당 항목은 건너뜀)</div>`:'');
    };
    ['prefix','start','count','pad'].forEach(n=>f[n].oninput = refresh);
    refresh();
    f.onsubmit = e=>{
      e.preventDefault();
      const ids = computeIds();
      if(ids.length===0){ alert('개수를 입력하세요'); return; }
      const base = {
        category:f.category.value, type:f.type.value.trim(), spec:f.spec.value.trim(),
        mobility:f.mobility.value, certs:collectCerts(new FormData(f)), inspectionCycleMonths:Number(f.inspectionCycleMonths.value)||12,
        nextInspectionDate:f.nextInspectionDate.value||'', purchaseDate:f.purchaseDate.value||'', status:'사내',
      };
      if(!base.type){ alert('종류를 입력하세요'); return; }
      let added=0, skipped=0;
      for(const id of ids){
        if(Store.getById('equipment', id)){ skipped++; continue; }
        Store.add('equipment', {...base, id}); added++;
      }
      alert(`등록 ${added}건, 건너뜀 ${skipped}건`);
      jbNavigate('#/equipment');
    };
  });
  return `
  <div>
    <a href="#/equipment" class="text-sm text-blue-600">← 목록</a>
    <h1 class="text-2xl font-bold mb-1 mt-1">장비 일괄 등록</h1>
    <p class="text-sm text-slate-500 mb-4">동일 종류·스펙의 여러 개체를 한 번에 생성합니다. 예: <code class="bg-slate-200 px-1 rounded">CB-5T-</code> + 시작 <code>1</code> + 개수 <code>4</code> → CB-5T-01, 02, 03, 04</p>
    <form id="bulk-form" class="bg-white rounded-xl shadow-sm p-4 grid grid-cols-2 gap-3">
      <fieldset class="col-span-2 border rounded-lg p-3">
        <legend class="text-sm font-semibold px-1">① ID 패턴</legend>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
          <label class="block text-sm">ID 접두어<input name="prefix" required placeholder="예: CB-5T-" class="w-full border rounded px-2 py-1 mt-1" /></label>
          <label class="block text-sm">시작 번호<input name="start" type="number" value="1" class="w-full border rounded px-2 py-1 mt-1" /></label>
          <label class="block text-sm">개수<input name="count" type="number" value="4" min="1" max="200" class="w-full border rounded px-2 py-1 mt-1" /></label>
          <label class="block text-sm">자릿수 0패딩<input name="pad" type="number" value="2" min="1" max="5" class="w-full border rounded px-2 py-1 mt-1" /></label>
        </div>
        <div class="mt-2 text-sm">미리보기: <div id="bulk-preview" class="mt-1"></div></div>
      </fieldset>
      <fieldset class="col-span-2 border rounded-lg p-3">
        <legend class="text-sm font-semibold px-1">② 공통 정보</legend>
        <div class="grid grid-cols-2 gap-2">
          <label class="block text-sm">카테고리<select name="category" class="w-full border rounded px-2 py-1 mt-1">${['공작','용접','운반','공구','측정','기타'].map(c=>`<option>${c}</option>`).join('')}</select></label>
          <label class="block text-sm">유형<select name="mobility" class="w-full border rounded px-2 py-1 mt-1"><option value="portable">이동장비 (출고 가능)</option><option value="fixed">📌 고정설비</option></select></label>
          <label class="block text-sm">종류 *<input name="type" required placeholder="예: 체인블록" class="w-full border rounded px-2 py-1 mt-1" /></label>
          <label class="block text-sm">스펙<input name="spec" placeholder="예: 5Ton" class="w-full border rounded px-2 py-1 mt-1" /></label>
          <label class="block text-sm">구입일<input type="date" name="purchaseDate" class="w-full border rounded px-2 py-1 mt-1" /></label>
          <label class="block text-sm">점검주기(개월)<input type="number" name="inspectionCycleMonths" value="12" class="w-full border rounded px-2 py-1 mt-1" /></label>
          <label class="block text-sm col-span-2">다음점검일<input type="date" name="nextInspectionDate" class="w-full border rounded px-2 py-1 mt-1" /></label>
          <div class="block text-sm col-span-2">인증${certInputs()}</div>
        </div>
      </fieldset>
      <div class="col-span-2 text-right"><button class="bg-emerald-600 text-white px-6 py-2 rounded-lg font-semibold">일괄 등록 실행</button></div>
    </form>
  </div>`;
});

/* ── 장비이력카드(xlsx) 가져오기 ──
   양식 10-03-01: 시트 1장 = 장비 1건(또는 관리번호 범위 "SJ-CB-02~04").
   값은 고정 칸(J2 관리번호, C3 장비명, C4 모델명, I4 규격 …), 사진은 행 10 아래에 박힌 그림.
   셀 값은 SheetJS 로, 그림은 xlsx(zip) 안의 drawing XML 을 직접 읽어 꺼낸다. */
const CARD_CATS = [
  [/용접기|건조기|건조로/, '용접'],
  [/선반|밀링|드릴|밴드\s*쇼|플라즈마|가우징|밴딩|확관|커팅/, '공작'],
  [/체인|레버블록|크레인/, '운반'],
  [/임팩|렌치|잭/, '공구'],
  [/정반|V\s*블록|게이지|시험기/, '측정'],
];
const CARD_FIXED = /선반|밀링|드릴 머신|밴드\s*쇼|컴프레서|크레인|정반|유압프레스|^용접봉 건조로/;
let _card = null;   // { fileName, rows:[...], photos:{key:{blob,url}} }

async function parseEquipmentCards(file){
  const buf = new Uint8Array(await file.arrayBuffer());
  const wb = XLSX.read(buf, {type:'array'});
  const zip = XLSX.CFB.read(buf, {type:'array'});
  const readZip = p => XLSX.CFB.find(zip, '/'+p)?.content;   // CFB 는 앞에 '/'가 있어야 전체 경로로 찾는다
  const readXml = p => { const c = readZip(p); return c ? new DOMParser().parseFromString(new TextDecoder().decode(c), 'application/xml') : null; };
  const tags = (doc, name) => doc ? [...doc.getElementsByTagNameNS('*', name)] : [];
  const RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const resolve = (base, target) => {
    if(target.startsWith('/')) return target.slice(1);
    const parts = base.split('/').slice(0,-1);
    for(const seg of target.split('/')){ if(seg==='..') parts.pop(); else if(seg!=='.') parts.push(seg); }
    return parts.join('/');
  };
  const rels = path => {
    const i = path.lastIndexOf('/');
    const doc = readXml(path.slice(0,i)+'/_rels/'+path.slice(i+1)+'.rels');
    const m = {}; tags(doc,'Relationship').forEach(r=>m[r.getAttribute('Id')] = resolve(path, r.getAttribute('Target')));
    return m;
  };
  // 시트 이름 → 시트 XML 경로
  const wbRels = rels('xl/workbook.xml');
  const sheetPath = {};
  tags(readXml('xl/workbook.xml'),'sheet').forEach(s=>sheetPath[s.getAttribute('name')] = wbRels[s.getAttributeNS(RNS,'id')]);
  // 시트 XML → 사진 영역(행 10 이하)의 그림들, 위→아래·왼→오른 순
  const photosOf = sp => {
    if(!sp) return [];
    const dr = tags(readXml(sp),'drawing')[0]; if(!dr) return [];
    const drPath = rels(sp)[dr.getAttributeNS(RNS,'id')]; if(!drPath) return [];
    const media = rels(drPath);
    const out = [];
    for(const a of [...tags(readXml(drPath),'twoCellAnchor'), ...tags(readXml(drPath),'oneCellAnchor')]){
      const from = tags(a,'from')[0], blip = tags(a,'blip')[0];
      if(!from || !blip) continue;
      const row = Number(tags(from,'row')[0]?.textContent), col = Number(tags(from,'col')[0]?.textContent);
      const mp = media[blip.getAttributeNS(RNS,'embed')];
      if(row < 8 || !mp) continue;          // 맨 위 로고 제외
      out.push({row, col, path: mp});
    }
    return out.sort((x,y)=>x.row-y.row || x.col-y.col);
  };

  const clean = v => { const s = String(v??'').replace(/\s+/g,' ').trim(); return /^(N\/A|-+|\?+)$/i.test(s) ? '' : s; };
  const photos = {};
  const rows = [];
  for(const name of wb.SheetNames){
    const ws = wb.Sheets[name];
    const cell = a => ws[a]?.v;
    const sheetRef = `시트 "${name.trim()}"`;
    if(String(cell('A3')||'').replace(/\s/g,'')!=='장비명' || String(cell('J1')||'').replace(/\s/g,'')!=='장비관리번호'){
      rows.push({sheet:name, error:`${sheetRef}: 장비이력카드 양식이 아님`}); continue;
    }
    const rawId = String(cell('J2')||'').replace(/\s/g,'');
    const qty = parseInt(String(cell('I3')||''), 10);
    let ids = [];
    const range = rawId.match(/^(.*?)(\d+)~(\d+)$/);
    if(range){
      const [, pre, a, b] = range;
      for(let n=Number(a); n<=Number(b) && ids.length<200; n++) ids.push(pre+String(n).padStart(a.length,'0'));
    } else if(/^[\w-]+$/.test(rawId)) ids = [rawId];
    const base = {sheet:name};
    if(!ids.length){ rows.push({...base, error:`${sheetRef}: 관리번호 "${clean(cell('J2'))||'없음'}"를 해석할 수 없음`}); continue; }

    // 카드 장비명 그대로 ("아크 용접기 1") — 번호로 개체를 구분한다.
    // 톤수가 붙은 이름("체인블록 7Ton")은 톤수를 떼고 관리번호 끝 숫자를 붙인다(SJ-CB-05 → 체인블록 5).
    // 톤수는 규격 칸에 있으므로 거기서 구분한다. 용량 표기는 "7TON"으로 통일.
    const TON_RE = /\s*\d+(?:\.\d+)?\s*ton\b/i;
    const rawType = clean(cell('C3'));
    const byIdNumber = TON_RE.test(rawType);
    const type = byIdNumber ? rawType.replace(TON_RE, '').trim() : rawType;
    const nameFor = (id, i) => {
      const n = id.match(/(\d+)$/);
      if(byIdNumber && n) return `${type} ${Number(n[1])}`;
      return ids.length>1 ? `${type} ${i+1}` : type;
    };
    const rawDate = clean(cell('I5'));
    const dm = rawDate.match(/^(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})\.?$/);
    const purchaseDate = dm ? `${dm[1]}-${pad2(dm[2])}-${pad2(dm[3])}` : '';
    const price = cell('C8');
    const history = [];
    for(let r=10; r<=19; r++){ const v = clean(cell('G'+r)); if(v) history.push(v); }
    const note = [
      clean(cell('C5')) && `구입처: ${clean(cell('C5'))}`,
      clean(cell('C6')) && `구매처 주소: ${clean(cell('C6'))}`,
      clean(cell('C7')) && `구매처 TEL: ${clean(cell('C7'))}`,
      clean(cell('I7')) && `구매처 FAX: ${clean(cell('I7'))}`,
      !dm && rawDate && `구입 일시: ${rawDate}`,
      clean(price) && `구매 가액: ${typeof price==='number' ? price.toLocaleString()+'원' : clean(price)}`,
      clean(cell('I8')) && `구매 구분: ${clean(cell('I8'))}`,
      history.length && `기타 주요 이력:\n${history.join('\n')}`,
    ].filter(Boolean).join('\n');
    const category = (CARD_CATS.find(([re])=>re.test(type))||[,'기타'])[1];
    const mobility = CARD_FIXED.test(type) ? 'fixed' : 'portable';

    const pics = photosOf(sheetPath[name]);
    pics.forEach(p=>{
      if(photos[p.path]) return;
      const ext = p.path.split('.').pop().toLowerCase();
      const blob = new Blob([readZip(p.path)], {type: ext==='png' ? 'image/png' : 'image/jpeg'});
      photos[p.path] = {blob, url: URL.createObjectURL(blob)};
    });
    const warn = (range && qty && qty!==ids.length) ? `수량 ${qty} ≠ 관리번호 ${ids.length}개` : '';
    ids.forEach((id, i)=>rows.push({
      ...base, id, type: nameFor(id, i), spec: clean(cell('I4')).replace(/(\d)\s*ton\b/gi, '$1TON'), serial: clean(cell('C4')),
      purchaseDate, note, category, mobility,
      photo: (pics.length===ids.length ? pics[i] : pics[0])?.path || null,
      warn, include: true,
    }));
  }
  numberDuplicateNames(rows.filter(r=>!r.error));
  return {fileName: file.name, rows, photos};
}

// 같은 장비명이 여러 건이면 관리번호 순으로 " 1", " 2" … 를 붙인다 (예: 수압 시험기 → 수압 시험기 1, 2)
function numberDuplicateNames(rows){
  const groups = {};
  rows.forEach(r=>(groups[r.type] ||= []).push(r));
  Object.values(groups).filter(g=>g.length>1).forEach(g=>{
    g.sort((a,b)=>a.id.localeCompare(b.id)).forEach((r,i)=>{ r.type = `${r.type} ${i+1}`; });
  });
}

// 각 행의 가져오기 가능 여부: 파일 안 관리번호 중복, 이미 등록된 번호
function cardRowStatus(r, rows){
  if(r.error) return {ok:false, cls:'text-red-600', text:r.error};
  if(!r.id) return {ok:false, cls:'text-red-600', text:'관리번호 없음'};
  if(Store.getById('equipment', r.id)) return {ok:false, cls:'text-slate-400', text:'이미 등록됨 (건너뜀)'};
  if(rows.filter(x=>!x.error && x.id===r.id).length>1) return {ok:false, cls:'text-red-600', text:'파일 안에서 관리번호 중복 — 수정 필요'};
  if(!r.type) return {ok:false, cls:'text-red-600', text:'장비명 없음'};
  return {ok:true, cls: r.warn?'text-amber-600':'text-emerald-600', text: r.warn ? '⚠ '+r.warn : '가져오기 가능'};
}

function renderCardPreview(){
  const box = document.getElementById('card-preview'); if(!box || !_card) return;
  const rows = _card.rows;
  const st = rows.map(r=>cardRowStatus(r, rows));
  const ready = rows.filter((r,i)=>st[i].ok && r.include).length;
  const cats = ['공작','용접','운반','공구','측정','기타'];
  box.innerHTML = `
    <div class="flex flex-wrap items-center gap-2 mb-2 text-sm">
      <span class="font-semibold">${escH(_card.fileName)}</span>
      <span class="text-slate-500">시트 ${new Set(rows.map(r=>r.sheet)).size}장 → 장비 ${rows.filter(r=>!r.error).length}건,
        가져올 장비 <b class="text-emerald-700">${ready}</b>건, 확인 필요 <b class="text-red-600">${st.filter(s=>!s.ok && s.cls==='text-red-600').length}</b>건</span>
    </div>
    <div class="overflow-x-auto border rounded-lg">
    <table class="w-full text-xs">
      <thead class="bg-slate-50 text-slate-500"><tr>
        <th class="p-2"></th><th class="p-2 text-left">사진</th><th class="p-2 text-left">관리번호</th><th class="p-2 text-left">장비명</th>
        <th class="p-2 text-left">카테고리</th><th class="p-2 text-left">유형</th><th class="p-2 text-left">모델명 / 규격</th>
        <th class="p-2 text-left">구입일</th><th class="p-2 text-left">비고</th><th class="p-2 text-left">상태</th>
      </tr></thead>
      <tbody>${rows.map((r,i)=> r.error ? `
        <tr class="border-t bg-red-50"><td></td><td colspan="9" class="p-2 text-red-600">${escH(r.error)}</td></tr>` : `
        <tr class="border-t ${st[i].ok?'':'bg-slate-50'}">
          <td class="p-2"><input type="checkbox" data-ci="${i}" data-f="include" ${r.include&&st[i].ok?'checked':''} ${st[i].ok?'':'disabled'} /></td>
          <td class="p-2">${r.photo?`<img src="${_card.photos[r.photo].url}" class="w-12 h-12 object-cover rounded border" />`:'<span class="text-slate-400">없음</span>'}</td>
          <td class="p-2"><input data-ci="${i}" data-f="id" value="${escH(r.id)}" class="border rounded px-1 py-0.5 w-28" /></td>
          <td class="p-2"><input data-ci="${i}" data-f="type" value="${escH(r.type)}" class="border rounded px-1 py-0.5 w-32" /></td>
          <td class="p-2"><select data-ci="${i}" data-f="category" class="border rounded px-1 py-0.5">${cats.map(c=>`<option ${r.category===c?'selected':''}>${c}</option>`).join('')}</select></td>
          <td class="p-2"><select data-ci="${i}" data-f="mobility" class="border rounded px-1 py-0.5"><option value="portable" ${r.mobility==='portable'?'selected':''}>이동</option><option value="fixed" ${r.mobility==='fixed'?'selected':''}>고정</option></select></td>
          <td class="p-2">${escH(r.serial)||'-'}<div class="text-slate-400">${escH(r.spec)}</div></td>
          <td class="p-2 whitespace-nowrap">${r.purchaseDate||'-'}</td>
          <td class="p-2 text-slate-500 max-w-[220px] truncate" title="${escH(r.note)}">${escH(r.note.replace(/\n/g,' · '))||'-'}</td>
          <td class="p-2 ${st[i].cls}">${escH(st[i].text)}<div class="text-slate-400">${escH(r.sheet.trim())}</div></td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
  box.querySelectorAll('[data-ci]').forEach(el=>{
    el.onchange = ()=>{
      const r = rows[Number(el.dataset.ci)];
      r[el.dataset.f] = el.type==='checkbox' ? el.checked : el.dataset.f==='id' ? el.value.replace(/\s/g,'') : el.value.trim();
      renderCardPreview();
    };
  });
  const btn = document.getElementById('card-import-btn');
  if(btn){ btn.disabled = ready===0; btn.textContent = `선택한 ${ready}건 가져오기`; }
}

route('#/equipment/import-card', ()=>{
  if(!Auth.isAdmin()) return `<div class="p-6">관리자만 가능합니다.</div>`;
  setTimeout(()=>{
    const fileIn = document.getElementById('card-file');
    const msg = document.getElementById('card-msg');
    if(_card) renderCardPreview();
    fileIn.onchange = async ()=>{
      const file = fileIn.files[0]; if(!file) return;
      msg.textContent = '파일 읽는 중... (사진이 많으면 몇 초 걸립니다)';
      try{
        if(_card) Object.values(_card.photos).forEach(p=>URL.revokeObjectURL(p.url));
        _card = await parseEquipmentCards(file);
        msg.textContent = '';
        renderCardPreview();
      }catch(e){ console.error(e); msg.textContent = '❌ 파일을 읽지 못했습니다: '+e.message; }
    };
    document.getElementById('card-import-btn').onclick = async ()=>{
      if(!_card) return;
      const btn = document.getElementById('card-import-btn');
      const rows = _card.rows.filter(r=>r.include && cardRowStatus(r, _card.rows).ok);
      if(!rows.length) return;
      const certs = collectCerts(new FormData(document.getElementById('card-opts')));
      const supa = !!getSupaClient();
      if(!confirm(`장비 ${rows.length}건을 등록합니다.${certs.length?`\n인증: ${certs.join(', ')}`:''}${supa?'':'\n\n⚠ Supabase 미연결 — 사진 없이 등록됩니다.'}\n계속할까요?`)) return;
      btn.disabled = true;
      const uploaded = {};   // 같은 사진(범위 관리번호)은 한 번만 올린다
      let added = 0, photoFail = 0;
      for(const r of rows){
        msg.textContent = `(${added+1}/${rows.length}) ${r.id} 등록 중...`;
        let photoUrl = '';
        if(r.photo && supa){
          if(!(r.photo in uploaded)){
            const p = _card.photos[r.photo];
            const res = await uploadPhoto(new File([p.blob], r.id+'.'+(p.blob.type==='image/png'?'png':'jpg'), {type:p.blob.type}), r.id);
            uploaded[r.photo] = res.url || '';
            if(res.error){ photoFail++; console.warn('[card] 사진 업로드 실패', r.id, res.error); }
          }
          photoUrl = uploaded[r.photo];
        }
        if(Store.getById('equipment', r.id)) continue;
        Store.add('equipment', {
          id:r.id, type:r.type, spec:r.spec, serial:r.serial, category:r.category, mobility:r.mobility,
          purchaseDate:r.purchaseDate, note:r.note, photoUrl, certs,
          inspectionCycleMonths:12, nextInspectionDate:'', status:'사내',
        });
        added++;
      }
      Object.values(_card.photos).forEach(p=>URL.revokeObjectURL(p.url));
      _card = null;
      alert(`장비 ${added}건 등록 완료${photoFail?`\n사진 업로드 실패 ${photoFail}건 — 해당 장비는 수정 화면에서 사진을 다시 올려 주세요`:''}`);
      jbNavigate('#/equipment');
    };
  });
  return `
  <div>
    <a href="#/equipment" class="text-sm text-blue-600">← 목록</a>
    <h1 class="text-2xl font-bold mb-1 mt-1">장비이력카드 가져오기</h1>
    <p class="text-sm text-slate-500 mb-4">장비이력카드 엑셀(양식 10-03-01, 시트 1장 = 장비 1건)을 읽어 장비를 한꺼번에 등록합니다. 카드 안의 사진도 함께 올립니다.
      관리번호가 <code class="bg-slate-200 px-1 rounded">SJ-CB-02~04</code>처럼 범위면 번호마다 한 건씩 만듭니다. 이미 등록된 관리번호는 건너뜁니다.</p>
    <div class="bg-white rounded-xl shadow-sm p-4 mb-3 space-y-3">
      <input id="card-file" type="file" accept=".xlsx" class="border rounded px-3 py-2 w-full" />
      <form id="card-opts" onsubmit="return false" class="text-sm">
        <div class="font-semibold">가져오는 장비에 붙일 인증 <span class="text-xs text-slate-400 font-normal">(선택 안 하면 미인증)</span></div>
        ${certInputs()}
      </form>
      <div id="card-msg" class="text-sm text-slate-500"></div>
    </div>
    <div id="card-preview" class="bg-white rounded-xl shadow-sm p-4 mb-3 text-sm text-slate-400">파일을 선택하면 미리보기가 나옵니다. 관리번호·장비명·카테고리·유형은 여기서 고칠 수 있습니다.</div>
    <div class="text-right"><button id="card-import-btn" disabled class="bg-emerald-600 text-white px-6 py-2 rounded-lg font-semibold disabled:opacity-40">가져오기</button></div>
  </div>`;
});

/* ── 장비 등록/수정 ── */
route('#/equipment/:id/edit', ({id})=> equipmentEdit(Store.getById('equipment', id)));

function equipmentEdit(eq){
  if(!Auth.isAdmin()) return `<div class="p-6">관리자만 가능합니다.</div>`;
  const isNew = !eq;
  setTimeout(()=>{
    const f = document.getElementById('eq-form');
    const photoInput = document.getElementById('photo');
    const photoPrev  = document.getElementById('photo-prev');
    const photoStatus= document.getElementById('photo-status');
    let photoUrl = eq?.photoUrl || '';
    let pendingFile = null;
    photoInput.onchange = e=>{
      const file = e.target.files[0]; if(!file) return;
      pendingFile = file;
      const blobUrl = URL.createObjectURL(file);
      photoPrev.src = blobUrl; photoPrev.classList.remove('hidden');
      const supa = getSupaClient(); const kb = Math.round(file.size/1024);
      if(supa){ photoStatus.textContent = `📎 ${file.name} (${kb}KB) — 저장 시 Supabase에 자동 업로드·압축`; photoStatus.className = 'text-xs text-blue-600 mt-1'; }
      else { photoStatus.textContent = `⚠ Supabase 미설정 — jangbi.js의 JB_SUPA_URL/KEY를 설정하면 사진이 저장됩니다.`; photoStatus.className = 'text-xs text-amber-600 mt-1'; pendingFile = null; }
    };
    f.onsubmit = async e=>{
      e.preventDefault();
      const btn = e.submitter || f.querySelector('button[type=submit], button:not([type])');
      if(btn){ btn.disabled = true; btn.textContent = '저장 중...'; }
      try{
        if(pendingFile){
          const eqId = isNew ? f.querySelector('[name=id]').value : eq.id;
          photoStatus.textContent = '⬆ 업로드 중...';
          const result = await uploadPhoto(pendingFile, eqId);
          if(result.error){ photoStatus.textContent='❌ 업로드 실패: '+result.error; photoStatus.className='text-xs text-red-600 mt-1'; btn.disabled=false; btn.textContent=isNew?'등록':'저장'; return; }
          photoUrl = result.url;
          photoStatus.textContent = '✅ 업로드 완료'; photoStatus.className = 'text-xs text-emerald-600 mt-1';
        }
        const fd = new FormData(f);
        const data = Object.fromEntries(fd.entries());
        data.certs = collectCerts(fd); delete data.newCerts;
        data.photoUrl = photoUrl;
        data.inspectionCycleMonths = Number(data.inspectionCycleMonths)||12;
        if(isNew){
          if(Store.getById('equipment', data.id)){ alert('이미 존재하는 ID'); btn.disabled=false; btn.textContent='등록'; return; }
          data.status = data.status || '사내';
          Store.add('equipment', data);
        } else { Store.update('equipment', eq.id, data); }
        // QR 이미지 Supabase Storage에 업로드 후 URL 저장
        const targetId = isNew ? data.id : eq.id;
        const qrStorageUrl = await uploadQR(targetId);
        if(qrStorageUrl) Store.update('equipment', targetId, {qrUrl: qrStorageUrl});
        jbNavigate('#/equipment/'+targetId);
      } finally { if(btn){ btn.disabled=false; btn.textContent=isNew?'등록':'저장'; } }
    };
  });
  return `
  <div>
    <a href="#/equipment" class="text-sm text-blue-600">← 목록</a>
    <h1 class="text-2xl font-bold mb-4">${isNew?'장비 신규 등록':eq.id+' 수정'}</h1>
    <form id="eq-form" class="bg-white rounded-xl shadow-sm p-4 grid grid-cols-2 gap-3">
      <label class="block">장비관리번호 *<input name="id" value="${eq?.id||''}" ${isNew?'':'readonly'} required class="w-full border rounded px-3 py-2 mt-1" placeholder="예: TIG-01" /></label>
      <label class="block">카테고리<select name="category" class="w-full border rounded px-3 py-2 mt-1">${['공작','용접','운반','공구','측정','기타'].map(c=>`<option ${eq?.category===c?'selected':''}>${c}</option>`).join('')}</select></label>
      <label class="block">장비명 *<input name="type" value="${eq?.type||''}" required class="w-full border rounded px-3 py-2 mt-1" placeholder="예: TIG 용접기" /></label>
      <label class="block">스펙<input name="spec" value="${eq?.spec||''}" class="w-full border rounded px-3 py-2 mt-1" placeholder="예: 350A" /></label>
      <label class="block">모델명<input name="serial" value="${eq?.serial||''}" class="w-full border rounded px-3 py-2 mt-1" placeholder="예: Miller Dynasty 350" /></label>
      <label class="block">구입일<input type="date" name="purchaseDate" value="${fmt(eq?.purchaseDate)}" class="w-full border rounded px-3 py-2 mt-1" /></label>
      <label class="block">점검주기(개월)<input type="number" name="inspectionCycleMonths" value="${eq?.inspectionCycleMonths||12}" class="w-full border rounded px-3 py-2 mt-1" /></label>
      <label class="block">다음점검일<input type="date" name="nextInspectionDate" value="${fmt(eq?.nextInspectionDate)}" class="w-full border rounded px-3 py-2 mt-1" /></label>
      <label class="block">상태<select name="status" class="w-full border rounded px-3 py-2 mt-1">${['사내','출장중','정비중','분실','폐기'].map(s=>`<option ${eq?.status===s?'selected':''}>${s}</option>`).join('')}</select></label>
      <label class="block">유형<select name="mobility" class="w-full border rounded px-3 py-2 mt-1"><option value="portable" ${(eq?.mobility||'portable')==='portable'?'selected':''}>이동장비 (출고 가능)</option><option value="fixed" ${eq?.mobility==='fixed'?'selected':''}>📌 고정설비</option></select></label>
      <label class="block col-span-2">위치 <span class="text-xs text-slate-400">(점검 기준표에 인쇄됨)</span><input name="location" value="${escH(eq?.location||'')}" class="w-full border rounded px-3 py-2 mt-1" placeholder="예: 3공장, 1공장(가공반)" /></label>
      <div class="block col-span-2">인증 <span class="text-xs text-slate-400">(여러 개 선택 가능, 없으면 미인증)</span>${certInputs(certsOf(eq))}</div>
      <label class="block col-span-2">비고 (NOTE)<textarea name="note" rows="3" class="w-full border rounded px-3 py-2 mt-1" placeholder="자유 기재 (특이사항, 보관위치 등)">${eq?.note||''}</textarea></label>
      <label class="block col-span-2">대표사진
        <input id="photo" type="file" accept="image/*" capture="environment" class="w-full border rounded px-3 py-2 mt-1" />
        <img id="photo-prev" src="${eq?.photoUrl||''}" class="${eq?.photoUrl?'':'hidden'} mt-2 w-32 h-32 object-cover rounded border" />
        <p id="photo-status" class="text-xs text-slate-400 mt-1">${eq?.photoUrl?'✅ 기존 사진 있음':getSupaClient()?'📷 사진 선택 시 Supabase에 저장':'⚠ jangbi.js의 JB_SUPA_URL/KEY 설정 후 사진 업로드 가능'}</p>
      </label>
      <div class="col-span-2 flex gap-2 justify-end">
        ${!isNew?`<button type="button" onclick="if(confirm('삭제?')){Store.remove('equipment','${eq.id}');jbNavigate('#/equipment');}" class="bg-red-500 text-white px-4 py-2 rounded-lg">삭제</button>`:''}
        <button class="bg-slate-900 text-white px-6 py-2 rounded-lg">${isNew?'등록':'저장'}</button>
      </div>
    </form>
  </div>`;
}

/* ── 출장 처리 (관리자 직접 기록) ── */
route('#/trip/:id', ({id})=>{
  if(!Auth.isAdmin()) return `<div class="p-6">관리자만 가능합니다.</div>`;
  const e = Store.getById('equipment', id);
  if(!e) return `<div class="p-8">장비 없음 <a href="#/equipment">← 목록</a></div>`;
  if(e.status!=='사내') return `<div class="p-8">출장 처리 불가 (현재 상태: ${e.status}) <a href="#/equipment/${id}">← 돌아가기</a></div>`;
  setTimeout(()=>{
    const f = document.getElementById('trip-form'); if(!f) return;
    f.onsubmit = ev=>{
      ev.preventDefault();
      const d = Object.fromEntries(new FormData(f).entries());
      const holderName = d.holderName.trim();
      // 현장: 드롭다운 선택 우선, 없으면 직접 입력 사용
      const siteName = (d.siteSelect||'').trim() || (d.customSite||'').trim();
      let finalSiteId = null;
      if(siteName){
        let existing = Store.sites.find(s=>s.name===siteName);
        if(!existing){ existing = {name:siteName, active:true}; Store.add('sites', existing); }
        finalSiteId = existing.id;
      }
      Store.update('equipment', id, {status:'출장중', currentSiteId:finalSiteId, currentHolderId:holderName||null, expectedReturnDate:d.expectedReturnDate});
      Store.add('checkouts', {equipmentId:id, requesterId:holderName||Auth.current.employeeId, siteId:finalSiteId, purpose:d.purpose||'', expectedReturnDate:d.expectedReturnDate, status:'출고완료', approverId:Auth.current.employeeId, checkoutDate:new Date().toISOString()});
      Store.log('checkout', id, `출장 처리 — ${holderName||'-'} → ${siteName||'-'} (예정반납 ${fmt(d.expectedReturnDate)})`, {siteId:finalSiteId, holderName});
      jbNavigate('#/equipment/'+id);
    };
    // 드롭다운 선택 시 직접입력란 비활성화, 미선택 시 활성화
    const sel = document.getElementById('site-select');
    const custom = document.getElementById('custom-site');
    if(sel && custom){
      sel.onchange = ()=>{ custom.disabled = !!sel.value; custom.placeholder = sel.value ? '(프로젝트 선택됨)' : '임의 현장명 입력'; };
    }
  });
  const projects = (window.state?.projects||[]).filter(p=>!p.completed);
  return `
  <div>
    <a href="#/equipment/${id}" class="text-sm text-blue-600">← 장비 상세</a>
    <h1 class="text-2xl font-bold mt-1 mb-4">📤 출장 처리 — ${id}</h1>
    <div class="text-sm text-slate-500 mb-3">${e.type}${e.spec?' · '+e.spec:''}</div>
    <form id="trip-form" class="bg-white rounded-xl shadow-sm p-4 grid grid-cols-2 gap-3 max-w-xl">
      <label class="block col-span-2">현장 (프로젝트 목록)
        <select id="site-select" name="siteSelect" class="w-full border rounded px-3 py-2 mt-1">
          <option value="">— 직접 입력 —</option>
          ${projects.map(p=>`<option value="${p.client||''}">${p.code||''}${p.client?' — '+p.client:''}</option>`).join('')}
        </select>
      </label>
      <label class="block col-span-2">직접 입력 <span class="text-xs text-slate-400">(위에서 선택 시 무시)</span>
        <input id="custom-site" type="text" name="customSite" class="w-full border rounded px-3 py-2 mt-1" placeholder="임의 현장명 입력" />
      </label>
      <label class="block">소지자<input type="text" name="holderName" class="w-full border rounded px-3 py-2 mt-1" placeholder="이름 직접 입력" /></label>
      <label class="block">예정 반납일 *<input type="date" name="expectedReturnDate" required min="${todayISO()}" class="w-full border rounded px-3 py-2 mt-1" /></label>
      <label class="block col-span-2">메모<input name="purpose" class="w-full border rounded px-3 py-2 mt-1" placeholder="사용 용도 또는 메모" /></label>
      <div class="col-span-2 flex gap-2 justify-end">
        <a href="#/equipment/${id}" class="bg-slate-200 px-4 py-2 rounded-lg text-sm">취소</a>
        <button type="submit" class="bg-blue-600 text-white px-6 py-2 rounded-lg">출장 처리</button>
      </div>
    </form>
  </div>`;
});

window.doReturn = (id)=>{
  const e = Store.getById('equipment', id); if(!e) return;
  const site = Store.getById('sites', e.currentSiteId);
  const holder = Store.users.find(x=>x.employeeId===e.currentHolderId);
  const info = [site?.name, holder?.name||e.currentHolderId].filter(Boolean).join(' / ');
  if(!confirm(`반납 처리하겠습니까?\n${e.id} (${e.type})${info?' — '+info:''}`)) return;
  processReturn(id, '', '');
  jbRender();
};

/* ── 정비 이력 입력 ── */
route('#/maintenance', ()=>{
  if(!Auth.isAdmin()) return `<div class="p-6">관리자만</div>`;
  const params = new URLSearchParams(_jbPath.split('?')[1]||'');
  const eqId = params.get('eq')||'';
  setTimeout(()=>{
    const f = document.getElementById('m-form'); if(!f) return;
    f.onsubmit = e=>{
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f).entries());
      d.cost = Number(d.cost)||0;
      d.performerId = Auth.current.employeeId;
      Store.add('maintenance', d);
      Store.log('maintenance', d.equipmentId, `${d.type} — ${d.partsReplaced||'부품없음'} ${d.cost?Number(d.cost).toLocaleString()+'원':''}`.trim(), {maintenanceType:d.type, cost:d.cost, partsReplaced:d.partsReplaced});
      if(d.nextInspectionDate){
        Store.update('equipment', d.equipmentId, {nextInspectionDate:d.nextInspectionDate});
        Store.log('status_change', d.equipmentId, `다음 점검일 갱신 → ${d.nextInspectionDate}`, {nextInspectionDate:d.nextInspectionDate});
      }
      alert('정비 이력 저장됨');
      jbNavigate('#/equipment/'+d.equipmentId);
    };
    // 다음 점검 예정일: 빠른 선택(정비 날짜 기준 N개월 후) 또는 직접 지정
    const dateIn = f.querySelector('[name=date]');
    const nextIn = document.getElementById('next-insp');
    const preset = document.getElementById('next-insp-preset');
    const applyPreset = ()=>{
      const n = Number(preset.value);
      if(n && dateIn.value) nextIn.value = addMonthsISO(dateIn.value, n);
    };
    preset.onchange = applyPreset;
    dateIn.addEventListener('change', applyPreset);         // 정비 날짜를 바꾸면 선택한 기간으로 다시 계산
    nextIn.addEventListener('input', ()=>{ preset.value = ''; });   // 직접 고르면 "직접 지정"
    // 장비를 고르면 그 장비의 점검주기로 채운다 (빠른 선택에 없는 주기면 날짜만 채움)
    const eqsel = document.getElementById('eqsel');
    const fillFromCycle = ()=>{
      const months = Number(Store.getById('equipment', eqsel.value)?.inspectionCycleMonths)||0;
      if(!months) return;
      preset.value = [...preset.options].some(o=>Number(o.value)===months) ? String(months) : '';
      nextIn.value = addMonthsISO(dateIn.value || todayISO(), months);
    };
    if(eqsel){ eqsel.onchange = fillFromCycle; if(eqsel.value) fillFromCycle(); }
  });
  return `
  <div>
    <h1 class="text-2xl font-bold mb-4">정비 이력 입력</h1>
    <form id="m-form" class="bg-white rounded-xl shadow-sm p-4 grid grid-cols-2 gap-3 max-w-3xl">
      <label class="block col-span-2">대상 장비 *<select id="eqsel" name="equipmentId" required class="w-full border rounded px-3 py-2 mt-1"><option value="">선택...</option>${Store.equipment.slice().sort((a,b)=>a.id.localeCompare(b.id)).map(e=>`<option value="${e.id}" ${e.id===eqId?'selected':''}>${e.id} - ${e.type}</option>`).join('')}</select></label>
      <label class="block">날짜<input type="date" name="date" value="${todayISO()}" required class="w-full border rounded px-3 py-2 mt-1" /></label>
      <label class="block">종류<select name="type" class="w-full border rounded px-3 py-2 mt-1">${['일상점검','정기점검','수리','교정'].map(t=>`<option>${t}</option>`).join('')}</select></label>
      <label class="block">교체 부품<input name="partsReplaced" class="w-full border rounded px-3 py-2 mt-1" /></label>
      <label class="block">비용(원)<input type="number" name="cost" class="w-full border rounded px-3 py-2 mt-1" /></label>
      <div class="block col-span-2">다음 점검 예정일 <span class="text-xs text-slate-400">(정비 날짜 기준)</span>
        <div class="flex gap-2 mt-1">
          <select id="next-insp-preset" class="border rounded px-3 py-2">
            <option value="">직접 지정</option>
            <option value="3">3개월 후</option>
            <option value="6">6개월 후</option>
            <option value="12">1년 후</option>
            <option value="24">2년 후</option>
          </select>
          <input id="next-insp" type="date" name="nextInspectionDate" class="flex-1 border rounded px-3 py-2" />
        </div>
      </div>
      <label class="block col-span-2">메모<textarea name="note" rows="3" class="w-full border rounded px-3 py-2 mt-1"></textarea></label>
      <div class="col-span-2 text-right"><button class="bg-slate-900 text-white px-6 py-2 rounded-lg">저장</button></div>
    </form>
  </div>`;
});

/* ── 월간 점검 (기계 설비 점검 기준표, 양식 14-01-07) ──
   점검 항목은 장비 종류별 기준표에서 옮겨 왔다. 항목: [점검부위, 점검항목, 운전 중, 정지 중, 점검기준]
   결과는 정비 이력(maintenance)에 type '월간점검' 으로 장비·월당 1건 저장한다.
   기록은 이번 달 것만 입력·수정할 수 있다 — 지난 달 칸을 나중에 채울 수 없게. */
const INSP_TEMPLATES = (()=>{
  const BODY   = ['몸체 (BODY)','VISUAL',false,true,'파손,결함 및 청결 점검'];
  const WORK   = ['작동 상태 WORKING CONDITION','FUNCTIONAL CONDITION',true,false,'작동 상태 확인 소음진동 여부'];
  const CABLE  = ['케이블 연결상태','FUNCTIONAL CONDITION',false,true,'케이블 연결 및 절연 상태 점검'];
  const CLEAN  = ['내부 청소 INTERNAL CLEANING','VISUAL',false,true,'내부 먼지 상태 점검'];
  const SWITCH = ['스위치 SWITCH','FUNCTIONAL CONDITION',true,false,'스위치 기능 상태 점검'];
  const PGAUGE = ['압력계 PRESSURE GAUGE','FUNCTIONAL CONDITION',true,false,'압력계의 정상 작동 여부'];
  const AMMETER= ['전류계 AMMETER','FUNCTIONAL CONDITION',true,false,'전류계의 정상 작동 여부'];
  const GEAR   = ['보호구 SAFETY GEAR','VISUAL',false,true,'보호구 상태 및 교체 시기 점검'];
  const AIRCOOL= ['냉각 시스템 COOLING SYSTEM','FUNCTIONAL CONDITION',true,true,'공기 공급 정상 작동 점검'];
  const GAS    = ['가스 공급 GAS SUPPLY','FUNCTIONAL CONDITION',true,true,'가스 실린더 및 누설 점검'];
  const ACC    = ['부속품 ACCESSORY','VISUAL',false,true,'부속품 상태 확인'];
  return {
    machine: {label:'공작기계', items:[BODY,
      ['주축 (PRINCIPAL AXIS)','FUNCTIONAL CONDITION',true,false,'회전 상태 및 진동&소음 점검'],
      ['절삭공구대 (TOOL POST)','FUNCTIONAL CONDITION',true,false,'공급 및 기능 정검'],
      ['심압대 (TAILSTOCK)','FUNCTIONAL CONDITION',true,false,'접합부 연결 상태 점검'],
      ['베드 BED','VISUAL & FUNCTIONAL CONDITION',true,true,'흠집,청결 및 기능 상태 점검'],
      ['이송눈금 DIAL FEEDER','Accuracy',true,false,'다이얼 공급기 및 정확도 점검'],
      ['기어박스 GEAR BOX','FUNCTIONAL CONDITION',true,false,'진동 소음 및 오일 점검'],
      ['척 CHUCK','JOINT CONDITION',true,true,'작동 및 연결 상태 점검'],
      SWITCH]},
    plasma: {label:'플라즈마 절단기', items:[BODY, PGAUGE, WORK, CABLE, AIRCOOL,
      ['노즐 및 전극 NOZZLE & ELECTRODE','FUNCTIONAL CONDITION',false,true,'노즐과 전극 교체 시기 점검'], GEAR, CLEAN, SWITCH]},
    gouging: {label:'가우징 머신', items:[BODY, PGAUGE, WORK, CABLE, AIRCOOL,
      ['가우징 로드 GOUGING ROD','FUNCTIONAL CONDITION',false,true,'가우징 로드 상태 점검'], GEAR, CLEAN, SWITCH]},
    arc: {label:'아크 용접기', items:[BODY, AMMETER, WORK, CABLE,
      ['자동전격방지기 AVRD','FUNCTIONAL CONDITION',true,false,'자동전격방지기 작동 여부'], CLEAN, SWITCH]},
    tig: {label:'TIG 용접기', items:[BODY, AMMETER, WORK, CABLE,
      ['냉각 시스템 COOLING SYSTEM','FUNCTIONAL CONDITION',true,false,'냉각수 공급 정상 작동 점검'], GAS,
      ['토치 및 전극 TORCH & ELECTRODE','FUNCTIONAL CONDITION',false,true,'토치,노즐,텅스텐 오염상태 점검'], CLEAN, SWITCH]},
    co2: {label:'CO2 용접기', items:[BODY, AMMETER, WORK, CABLE,
      ['와이어 피더 WIRE FEEDER','FUNCTIONAL CONDITION',true,false,'와이어 피더 정상 작동 점검'], GAS,
      ['토치 및 전극 TORCH & ELECTRODE','FUNCTIONAL CONDITION',false,true,'토치,노즐,피더 오염상태 점검'], CLEAN, SWITCH]},
    compressor: {label:'컴프레서', items:[BODY, PGAUGE, WORK, CABLE,
      ['에어 필터 AIR FILTER','FUNCTIONAL CONDITION',false,true,'에어 필터 청소 및 교체 점검'],
      ['에어 공급 AIR SUPPLY','FUNCTIONAL CONDITION',true,true,'공기 배관 및 누설 점검'],
      ['윤활유 LUBRICANT','FUNCTIONAL CONDITION',false,true,'윤활유 상태 및 교환 주기 점검'],
      ['흡토출 밸브 VALVE','VISUAL',false,true,'흡,토출 밸브 교환 주기 점검'], SWITCH]},
    oven: {label:'용접봉 건조로', items:[BODY, PGAUGE, WORK, CABLE,
      ['내부 청소 INSIDE CLEANING','VISUAL',false,true,'내부 청소 상태']]},
    hwrench: {label:'유압 렌치', items:[BODY,
      ['허용압력 PRESSURE','FUNCTIONAL CONDITION',true,false,'정격 토크값과 최대 허용압력'],
      ['작동 상태 WORKING CONDITION','FUNCTIONAL CONDITION',true,false,'작동 상태 확인 회전,토크 여부'],
      ['유압호스 및 커넥터 상태','VISUAL',false,true,'호스,커넥터 등의 마모,누유,풀림 여부 확인'], ACC]},
    pump: {label:'수중 모터 펌프', items:[BODY,
      ['누수 상태 WATERPROOF','FUNCTIONAL CONDITION',true,false,'모터 누수 상태 및 마감 상태'],
      ['작동 상태 WORKING CONDITION','FUNCTIONAL CONDITION',true,false,'펌프 상태 확인 정상 운전 여부'],
      ['전원 케이블 및 배선','VISUAL',false,true,'전원 케이블 및 연결,손상상태'],
      ['유량 상태 FLOW STATUS','VISUAL',true,false,'펌프 유량 상태 확인']]},
    washer: {label:'고압 세척기', items:[BODY,
      ['작동 상태 WORKING CONDITION','FUNCTIONAL CONDITION',true,false,'작동 상태 확인 회전,토크 여부'],
      ['펌프 및 엔진 PUMP&ENGINE','FUNCTIONAL CONDITION',true,false,'오일 상태 확인 점검 및 교환'],
      ['노즐 NOZZLE','VISUAL',false,true,'노즐 막힘 오염 점검 청소'], ACC,
      ['압력 및 유량 PRESSURE & FLOW','FUNCTIONAL CONDITION',true,false,'압력 설정치 및 분사압력 확인']]},
  };
})();
// 관리번호 → [기준표 종류, 영문 설비명, 번호 붙임 여부]. 정확한 번호가 접두어보다 우선.
const INSP_MAP_EXACT = {
  'SJ-OV-01': ['oven','DRY OVEN',false],
  'SJ-EQ-13': ['pump','SUBMERSIBLE MOTOR PUMP',false],
  'SJ-EQ-14': ['washer','HIGH PRESSURE WASHER',false],
};
const INSP_MAP_PREFIX = {
  LT:['machine','LATHE'], ML:['machine','MILLING MACHINE'], DR:['machine','DRILLING MACHINE'],
  PL:['plasma','PLASMA CUTTER'], GA:['gouging','GOUGING MACHINE'],
  AC:['arc','ARC WELDING MACHINE'], TI:['tig','TIG WELDING MACHINE'], FC:['co2','CO2 WELDING MACHINE'],
  CP:['compressor','COMPRESSOR'], HW:['hwrench','HYDRAULIC WRENCH'],
};
const INSP_MARKS = [['○','양호'],['△','수리'],['□','주유'],['×','교환']];
const INSP_FORM_NO = '(양식 /Form 14-01-07) REV.4';

function inspInfo(e){
  if(!e || e.status==='폐기') return null;
  const ex = INSP_MAP_EXACT[e.id];
  if(ex) return {tpl:ex[0], ...INSP_TEMPLATES[ex[0]], nameEn:ex[1]};
  const m = e.id.match(/^SJ-([A-Z]+)-(\d+)$/);
  const p = m && INSP_MAP_PREFIX[m[1]];
  if(!p) return null;
  return {tpl:p[0], ...INSP_TEMPLATES[p[0]], nameEn:`${p[1]} -${Number(m[2])}`};
}
const inspTargets = () => Store.equipment.filter(e=>inspInfo(e)).sort((a,b)=>a.id.localeCompare(b.id));
const inspRecords = (eqId) => Store.maintenance.filter(m=>m.equipmentId===eqId && m.type==='월간점검' && m.inspection);
// 해당 월(YYYY-MM)의 기록 — 같은 달에 여러 건이면 가장 최근 수정본
const inspOf = (eqId, ym) => inspRecords(eqId).filter(m=>(m.date||'').startsWith(ym))
  .sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''))[0];
const thisMonth = () => todayISO().slice(0,7);
const inspSummary = rec => {
  const r = rec.inspection.results||[];
  const bad = r.filter(x=>x && x!=='○').length;
  return bad ? `이상 ${bad}건 (${INSP_MARKS.filter(([s])=>r.includes(s) && s!=='○').map(([s,l])=>`${s}${l} ${r.filter(x=>x===s).length}`).join(', ')})` : '전 항목 양호';
};

// 다른 기기에서 입력한 점검 결과를 보려면 maintenance 를 다시 읽어야 한다(실시간 구독 대상이 아님)
let _inspReloadAt = 0;
function inspRefresh(){
  if(Date.now()-_inspReloadAt < 30000 || !SupaStore.enabled) return;
  _inspReloadAt = Date.now();
  const supa = getSupaClient(); if(!supa) return;
  supa.from(SupaStore.TBL('maintenance')).select('*').order('created_at').then(({data, error})=>{
    if(error || !data) return;
    Store.maintenance = data.map(r=>SupaStore.fromRow(r)); Store.save('maintenance');
    if(_jbPath.startsWith('#/inspection')) jbRender();
  });
}

/* 점검 현황 */
route('#/inspection', ()=>{
  inspRefresh();
  const params = new URLSearchParams(_jbPath.split('?')[1]||'');
  const ym = /^\d{4}-\d{2}$/.test(params.get('m')||'') ? params.get('m') : thisMonth();
  const isCurrent = ym===thisMonth();
  const targets = inspTargets();
  const done = targets.filter(e=>inspOf(e.id, ym));
  setTimeout(()=>{
    const mi = document.getElementById('insp-month');
    if(mi) mi.onchange = ()=>jbNavigate('#/inspection'+(mi.value && mi.value!==thisMonth() ? '?m='+mi.value : ''));
  });
  const groups = {};
  targets.forEach(e=>{ (groups[inspInfo(e).tpl] ||= []).push(e); });
  const pct = targets.length ? Math.round(done.length/targets.length*100) : 0;
  return `
  <div>
    <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
      <h1 class="text-2xl font-bold">📋 월간 점검</h1>
      <div class="flex gap-2 items-center flex-wrap">
        <input id="insp-month" type="month" value="${ym}" max="${thisMonth()}" class="border rounded-lg px-2 py-1.5" />
        <button onclick="printInspection(null, '${ym.slice(0,4)}')" class="bg-slate-600 text-white px-4 py-2 rounded-lg">🖨 ${ym.slice(0,4)}년 기준표 전체 인쇄</button>
      </div>
    </div>
    <div class="bg-white rounded-xl shadow-sm p-4 mb-3">
      <div class="flex justify-between text-sm mb-1"><span class="font-semibold">${ym.replace('-','년 ')}월 점검</span><span><b>${done.length}</b> / ${targets.length}대 완료 (${pct}%)</span></div>
      <div class="h-2 rounded bg-slate-200 overflow-hidden"><div class="h-2 bg-emerald-500" style="width:${pct}%"></div></div>
      ${isCurrent?'':'<p class="text-xs text-slate-400 mt-2">지난 달 기록은 보기만 할 수 있습니다.</p>'}
    </div>
    ${Object.entries(INSP_TEMPLATES).filter(([k])=>groups[k]).map(([k,t])=>`
    <div class="bg-white rounded-xl shadow-sm overflow-hidden mb-3">
      <div class="px-4 py-2 bg-slate-50 text-xs font-semibold text-slate-500 flex justify-between">
        <span>${t.label} (${groups[k].length}대 · ${t.items.length}항목)</span>
        <span>${groups[k].filter(e=>inspOf(e.id, ym)).length}/${groups[k].length}</span>
      </div>
      ${groups[k].map(e=>{
        const rec = inspOf(e.id, ym);
        const bad = rec && (rec.inspection.results||[]).some(x=>x!=='○');
        return `<div class="flex flex-wrap items-center gap-2 px-4 py-2.5 border-t text-sm">
          <span class="w-5">${rec?(bad?'⚠️':'✅'):'⬜'}</span>
          <a href="#/equipment/${e.id}" class="font-semibold min-w-[150px]">${escH(e.type||'')}</a>
          <span class="text-xs text-slate-500 w-20">${e.id}</span>
          <span class="text-xs text-slate-500 flex-1 min-w-[160px]">${rec?`${fmt(rec.date)} · ${escH(rec.inspector||'')} · ${inspSummary(rec)}`:'미점검'}</span>
          ${isCurrent?`<a href="#/inspection/${e.id}" class="${rec?'bg-slate-200':'bg-emerald-600 text-white'} px-3 py-1 rounded-lg text-xs">${rec?'수정':'점검하기'}</a>`
            : rec?`<a href="#/inspection/${e.id}?m=${ym}" class="bg-slate-200 px-3 py-1 rounded-lg text-xs">보기</a>`:''}
          <button onclick="printInspection('${e.id}', '${ym.slice(0,4)}')" class="text-xs text-slate-500 underline">인쇄</button>
        </div>`;
      }).join('')}
    </div>`).join('')}
  </div>`;
});

/* 점검 입력 / 보기 */
route('#/inspection/:id', ({id})=>{
  const e = Store.getById('equipment', id);
  const info = inspInfo(e);
  if(!info) return `<div class="p-8">월간 점검 대상이 아닌 장비입니다. <a href="#/inspection" class="text-blue-600">← 점검 현황</a></div>`;
  const params = new URLSearchParams(_jbPath.split('?')[1]||'');
  const ym = /^\d{4}-\d{2}$/.test(params.get('m')||'') ? params.get('m') : thisMonth();
  const editable = ym===thisMonth();
  const rec = inspOf(id, ym);
  const results = rec ? [...rec.inspection.results] : info.items.map(()=> '');
  setTimeout(()=>{
    const f = document.getElementById('insp-form'); if(!f || !editable) return;
    f.querySelectorAll('[data-mark]').forEach(b=>{
      b.onclick = ()=>{
        const i = Number(b.dataset.i);
        results[i] = b.dataset.mark;
        f.querySelectorAll(`[data-i="${i}"]`).forEach(x=>x.classList.toggle('insp-on', x===b));
        document.getElementById('insp-left').textContent = results.filter(x=>!x).length;
      };
    });
    f.onsubmit = ev=>{
      ev.preventDefault();
      const fd = Object.fromEntries(new FormData(f).entries());
      const left = results.filter(x=>!x).length;
      if(left){ alert(`아직 결과를 고르지 않은 항목이 ${left}개 있습니다.`); return; }
      if(!fd.inspector.trim()){ alert('점검자를 입력하세요.'); return; }
      if(!fd.date.startsWith(thisMonth()) || fd.date > todayISO()){ alert('점검일은 이번 달, 오늘까지만 고를 수 있습니다.'); return; }
      if(results.some(x=>x==='△'||x==='×') && !fd.action.trim()){ alert('수리(△)·교환(×) 항목이 있으면 조치사항을 적어 주세요.'); return; }
      const doc = {
        equipmentId:id, type:'월간점검', date:fd.date, inspector:fd.inspector.trim(),
        performerId: Auth.current?.employeeId || fd.inspector.trim(),
        note: fd.action.trim(), partsReplaced:'', cost:0,
        inspection:{tpl:info.tpl, items:info.items.map(it=>it[0]), results:[...results], action:fd.action.trim()},
      };
      if(rec) Store.update('maintenance', rec.id, doc); else Store.add('maintenance', doc);
      if(fd.location.trim() !== (e.location||'')) Store.update('equipment', id, {location: fd.location.trim()});
      jbNavigate('#/inspection');
    };
  });
  const markBtn = (i, s, l) => `<button type="button" data-i="${i}" data-mark="${s}" ${editable?'':'disabled'}
      class="insp-mark ${results[i]===s?'insp-on':''}" title="${l}">${s}<span>${l}</span></button>`;
  return `
  <style>
    #jangbi-root .insp-mark{min-width:52px;padding:6px 4px;border:1px solid var(--border);border-radius:8px;background:var(--surface3);color:var(--text);font-size:18px;line-height:1;display:inline-flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer}
    #jangbi-root .insp-mark span{font-size:10px;color:var(--text2)}
    #jangbi-root .insp-mark.insp-on{background:var(--accent);border-color:var(--accent);color:#fff}
    #jangbi-root .insp-mark.insp-on span{color:#fff}
    #jangbi-root .insp-mark:disabled{cursor:default;opacity:.8}
  </style>
  <div class="max-w-3xl">
    <a href="#/inspection${editable?'':'?m='+ym}" class="text-sm text-blue-600">← 점검 현황</a>
    <h1 class="text-2xl font-bold mt-1">${escH(e.type||id)} <span class="text-base font-normal text-slate-500">${id}</span></h1>
    <p class="text-sm text-slate-500 mb-3">${info.label} 점검 기준표 · ${ym.replace('-','년 ')}월 ${rec?`· 마지막 저장 ${escH(rec.inspector||'')} ${fmt(rec.updatedAt)}`:''}</p>
    <form id="insp-form" class="space-y-2">
      ${info.items.map((it,i)=>`
      <div class="bg-white rounded-xl shadow-sm p-3 flex flex-wrap items-center gap-3">
        <div class="flex-1 min-w-[200px]">
          <div class="font-semibold text-sm">${i+1}. ${escH(it[0])}</div>
          <div class="text-xs text-slate-500">${escH(it[4])} <span class="text-slate-400">· ${escH(it[1])} · ${[it[2]&&'운전 중',it[3]&&'정지 중'].filter(Boolean).join('/')}</span></div>
        </div>
        <div class="flex gap-1">${INSP_MARKS.map(([s,l])=>markBtn(i,s,l)).join('')}</div>
      </div>`).join('')}
      <div class="bg-white rounded-xl shadow-sm p-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
        <label class="block">점검일<input type="date" name="date" value="${rec?.date||todayISO()}" min="${thisMonth()}-01" max="${todayISO()}" ${editable?'':'disabled'} class="w-full border rounded px-3 py-2 mt-1" /></label>
        <label class="block">점검자<input name="inspector" value="${escH(rec?.inspector||Auth.current?.name||'')}" ${editable?'':'disabled'} class="w-full border rounded px-3 py-2 mt-1" /></label>
        <label class="block">위치<input name="location" value="${escH(e.location||'')}" ${editable?'':'disabled'} placeholder="예: 3공장" class="w-full border rounded px-3 py-2 mt-1" /></label>
        <label class="block md:col-span-3">조치사항 <span class="text-xs text-slate-400">(수리·교환 항목이 있으면 필수)</span><textarea name="action" rows="2" ${editable?'':'disabled'} class="w-full border rounded px-3 py-2 mt-1">${escH(rec?.inspection.action||'')}</textarea></label>
      </div>
      ${editable?`<div class="flex justify-between items-center"><span class="text-sm text-slate-500">남은 항목 <b id="insp-left">${results.filter(x=>!x).length}</b>개</span>
        <button class="bg-emerald-600 text-white px-6 py-2 rounded-lg font-semibold">${rec?'수정 저장':'점검 저장'}</button></div>`
        :'<p class="text-sm text-slate-400">지난 달 기록은 수정할 수 없습니다.</p>'}
    </form>
  </div>`;
});

/* 연간 기준표 인쇄 — 기존 종이 양식(14-01-07) 배치에 월별 결과·점검일·점검자를 채운다.
   eqId 가 없으면 점검 대상 전체를 장비당 한 장씩. */
window.printInspection = (eqId, year)=>{
  const list = eqId ? [Store.getById('equipment', eqId)] : inspTargets();
  const logo = window._jbLogoDataUrl ? `<img src="${window._jbLogoDataUrl}" style="height:34px" />` : '';
  const pages = list.filter(Boolean).map(e=>{
    const info = inspInfo(e); if(!info) return '';
    const recs = Array.from({length:12}, (_,i)=>inspOf(e.id, `${year}-${pad2(i+1)}`));
    const actions = recs.map((r,i)=>r?.inspection.action ? `${i+1}월: ${escH(r.inspection.action)}` : '').filter(Boolean);
    const mon = (fn)=>recs.map(r=>`<td class="c">${r?fn(r):''}</td>`).join('');
    return `<section class="page">
      <table class="hd">
        <tr><td rowspan="2" class="logo">${logo}</td><td rowspan="2" class="title">기계 설비 점검 기준표<div>CRITERION TABLE FOR INSPECTION OF MACHINE TOOL</div></td>
            <td class="k">문서번호</td><td>SJ-CTIM-${e.id.replace(/^SJ-/,'')}</td></tr>
        <tr><td class="k">위치</td><td>${escH(e.location||'')}</td></tr>
      </table>
      <table class="hd">
        <tr><td class="k">설 비 명<div>NAME OF MACHINE TOOL</div></td><td>${escH(e.type||'')}<div>${escH(info.nameEn)}</div></td>
            <td class="k">관리 번호<div>CONTROL NO.</div></td><td>${e.id}</td>
            <td class="k">연도<div>YEAR</div></td><td>${year}</td></tr>
      </table>
      <table class="grid">
        <thead>
          <tr><th rowspan="2" style="width:28px">순서</th><th rowspan="2">점검부위<div>INSPECTION PART</div></th><th rowspan="2">점검항목<div>CHECK POINT</div></th>
              <th colspan="2">시기 (WHEN)</th><th rowspan="2">점검 기준<div>CHECK CRITERION</div></th>
              ${Array.from({length:12},(_,i)=>`<th rowspan="2" class="m">${i+1}</th>`).join('')}<th rowspan="2" style="width:60px">비고<div>REMARKS</div></th></tr>
          <tr><th class="w">운전<div>During Operation</div></th><th class="w">정지<div>During Stand Still</div></th></tr>
        </thead>
        <tbody>
          ${info.items.map((it,i)=>`<tr><td class="c">${i+1}</td><td>${escH(it[0])}</td><td>${escH(it[1])}</td>
            <td class="c">${it[2]?'○':''}</td><td class="c">${it[3]?'○':''}</td><td>${escH(it[4])}</td>
            ${mon(r=>r.inspection.results[i]||'')}<td></td></tr>`).join('')}
          <tr class="sum"><td colspan="6" class="k">점검일 DATE</td>${mon(r=>fmt(r.date).slice(5).replace('-','/'))}<td></td></tr>
          <tr class="sum"><td colspan="6" class="k">점검자 INSPECTOR</td>${mon(r=>escH(r.inspector||''))}<td></td></tr>
        </tbody>
      </table>
      <table class="ft"><tr>
        <td class="k" style="width:70px">조 치<br>사 항</td><td class="act">${actions.join('<br>')}</td>
        <td style="width:150px"><b>범례</b><br>양호 ○ &nbsp; 수리 △<br>주유 □ &nbsp; 교환 ×</td>
      </tr></table>
      <div class="form">${INSP_FORM_NO}</div>
    </section>`;
  }).join('');
  if(!pages){ alert('인쇄할 점검 대상 장비가 없습니다.'); return; }
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>기계 설비 점검 기준표 ${year}</title>
  <style>
    @page{size:A4 landscape;margin:10mm}
    body{font-family:'Malgun Gothic',sans-serif;font-size:10px;color:#000;margin:0}
    .page{page-break-after:always} .page:last-child{page-break-after:auto}
    table{width:100%;border-collapse:collapse;margin-bottom:4px}
    td,th{border:1px solid #000;padding:3px 4px;vertical-align:middle}
    th{background:#eee;font-weight:bold;text-align:center}
    th div,td div{font-size:8px;font-weight:normal;color:#333}
    .hd .k{background:#eee;text-align:center;width:90px;font-weight:bold}
    .hd .title{text-align:center;font-size:16px;font-weight:bold} .hd .title div{font-size:9px}
    .hd .logo{width:110px;text-align:center}
    .grid td{height:24px} .grid .m{width:30px} .grid .w{width:46px}
    .c{text-align:center} .grid td.c{font-size:13px}
    .grid tr.sum td{font-size:9px;height:18px} .grid tr.sum td.k{background:#eee;text-align:right;font-weight:bold}
    .ft td{height:46px;vertical-align:top} .ft .k{background:#eee;text-align:center;vertical-align:middle;font-weight:bold}
    .form{font-size:9px;margin-top:2px}
  </style></head><body>${pages}</body></html>`;
  const w = window.open('','_blank','width=1200,height=850');
  if(!w) return;
  w.document.write(html); w.document.close(); w.focus();
  setTimeout(()=>{ w.print(); }, 500);
};

/* ── QR 스캔 ── */
route('#/scan', ()=>{
  setTimeout(()=>{
    const reader = new Html5Qrcode("qr-reader");
    let started = false;
    document.getElementById('btn-start').onclick = async ()=>{
      if(started) return;
      try{
        await reader.start({facingMode:'environment'}, {fps:10, qrbox:250}, txt=>{
          reader.stop(); started=false; handleQRResult(txt);
        });
        started = true;
      }catch(err){ alert('카메라 접근 실패: '+err); }
    };
    document.getElementById('btn-manual').onclick = ()=>{
      const id = prompt('장비 ID 직접 입력');
      if(id) handleQRResult('JB:'+id);
    };
    function handleQRResult(txt){
      const id = txt.startsWith('JB:') ? txt.slice(3) : txt;
      if(Store.getById('equipment', id)) jbNavigate('#/equipment/'+id);
      else alert('등록되지 않은 코드: '+txt);
    }
  });
  return `
  <div>
    <h1 class="text-2xl font-bold mb-4">📷 QR 스캔</h1>
    <div id="qr-reader" class="bg-black rounded-xl overflow-hidden mb-3" style="max-width:400px;"></div>
    <div class="flex gap-2">
      <button id="btn-start" class="bg-blue-600 text-white px-6 py-3 rounded-lg flex-1">스캔 시작</button>
      <button id="btn-manual" class="bg-slate-200 px-4 py-3 rounded-lg">ID 직접입력</button>
    </div>
    <p class="text-xs text-slate-500 mt-3">최초 사용 시 카메라 접근을 허용해 주세요.</p>
  </div>`;
});

/* ── 현장 관리 ── */
route('#/sites', ()=>{
  if(!Auth.isAdmin()) return `<div class="p-6">관리자만</div>`;
  setTimeout(()=>{
    const f = document.getElementById('site-form');
    f.onsubmit = e=>{ e.preventDefault(); const d=Object.fromEntries(new FormData(f).entries()); d.active=true; Store.add('sites',d); f.reset(); jbRender(); };
  });
  return `
  <div>
    <h1 class="text-2xl font-bold mb-4">현장 관리</h1>
    <form id="site-form" class="bg-white rounded-xl shadow-sm p-4 grid grid-cols-4 gap-2 mb-4">
      <input name="name" required placeholder="현장명 *" class="border rounded px-3 py-2" />
      <input name="address" placeholder="주소" class="border rounded px-3 py-2" />
      <input name="contact" placeholder="담당 연락처" class="border rounded px-3 py-2" />
      <button class="bg-slate-900 text-white rounded">+ 추가</button>
    </form>
    <div class="bg-white rounded-xl shadow-sm overflow-hidden">
      ${Store.sites.map(s=>{
        const used = Store.equipment.filter(e=>e.currentSiteId===s.id).length;
        return `<div class="px-4 py-3 border-t first:border-t-0 flex justify-between items-center text-sm">
          <div><strong>${s.name}</strong> <span class="text-slate-500">${s.address||''}</span> ${used?`<span class="badge b-출장중">${used}대 출장중</span>`:''}</div>
          <button onclick="if(confirm('삭제?')){Store.remove('sites','${s.id}');jbRender();}" class="text-red-500 text-xs">삭제</button>
        </div>`;
      }).join('')}
    </div>
  </div>`;
});

/* ── 사용자 관리 ── */
route('#/users', ()=>{
  if(!Auth.isAdmin()) return `<div class="p-6">관리자만</div>`;
  setTimeout(()=>{
    document.getElementById('user-form').onsubmit = e=>{
      e.preventDefault();
      const d=Object.fromEntries(new FormData(e.target).entries());
      if(Store.users.find(u=>u.employeeId===d.employeeId)){ alert('중복 사번'); return; }
      d.active=true; Store.add('users',d); e.target.reset(); jbRender();
    };
  });
  return `
  <div>
    <h1 class="text-2xl font-bold mb-4">사용자 관리</h1>
    <p class="text-sm text-slate-500 mb-3">여기서 등록된 사용자는 jangbi 내부 데이터(출고자 등)에 사용됩니다. 로그인은 sejong-prod 계정을 사용합니다.</p>
    <form id="user-form" class="bg-white rounded-xl shadow-sm p-4 grid grid-cols-5 gap-2 mb-4">
      <input name="employeeId" required placeholder="사번 *" class="border rounded px-3 py-2" />
      <input name="name" required placeholder="이름 *" class="border rounded px-3 py-2" />
      <input name="pin" required placeholder="PIN *" class="border rounded px-3 py-2" />
      <select name="role" class="border rounded px-3 py-2"><option value="worker">작업자</option><option value="admin">관리자</option></select>
      <button class="bg-slate-900 text-white rounded">+ 추가</button>
    </form>
    <div class="bg-white rounded-xl shadow-sm overflow-hidden">
      <div class="grid grid-cols-5 px-4 py-2 bg-slate-50 text-xs font-semibold"><div>사번</div><div>이름</div><div>PIN</div><div>역할</div><div></div></div>
      ${Store.users.map(u=>`
        <div class="grid grid-cols-5 px-4 py-2 border-t text-sm items-center">
          <div>${u.employeeId}</div><div>${u.name}</div>
          <div><input value="${u.pin}" onchange="Store.update('users','${u.id}',{pin:this.value})" class="border rounded px-2 py-1 w-24" /></div>
          <div><select onchange="Store.update('users','${u.id}',{role:this.value})" class="border rounded px-2 py-1"><option value="worker" ${u.role==='worker'?'selected':''}>작업자</option><option value="admin" ${u.role==='admin'?'selected':''}>관리자</option></select></div>
          <div class="text-right">${u.employeeId!=='admin'?`<button onclick="if(confirm('삭제?')){Store.remove('users','${u.id}');jbRender();}" class="text-red-500 text-xs">삭제</button>`:''}</div>
        </div>`).join('')}
    </div>
  </div>`;
});

/* ── 소모품 ── */
route('#/consumables', ()=>{
  if(!Auth.isAdmin()) return `<div class="p-6">관리자만</div>`;
  setTimeout(()=>{
    document.getElementById('c-form').onsubmit = e=>{
      e.preventDefault();
      const d=Object.fromEntries(new FormData(e.target).entries());
      d.currentStock=Number(d.currentStock)||0; d.minStock=Number(d.minStock)||0;
      Store.add('consumables',d); e.target.reset(); jbRender();
    };
  });
  return `
  <div>
    <h1 class="text-2xl font-bold mb-4">소모품 재고</h1>
    <form id="c-form" class="bg-white rounded-xl shadow-sm p-4 grid grid-cols-5 gap-2 mb-4">
      <input name="name" required placeholder="품명 *" class="border rounded px-3 py-2" />
      <input name="unit" placeholder="단위 (예: kg)" class="border rounded px-3 py-2" />
      <input name="currentStock" type="number" required placeholder="현재고 *" class="border rounded px-3 py-2" />
      <input name="minStock" type="number" placeholder="최소재고" class="border rounded px-3 py-2" />
      <button class="bg-slate-900 text-white rounded">+ 추가</button>
    </form>
    <div class="bg-white rounded-xl shadow-sm overflow-hidden">
      <div class="grid grid-cols-6 px-4 py-2 bg-slate-50 text-xs font-semibold"><div class="col-span-2">품명</div><div>단위</div><div>현재고</div><div>최소</div><div></div></div>
      ${Store.consumables.map(c=>{
        const low=Number(c.currentStock)<=Number(c.minStock||0);
        return `<div class="grid grid-cols-6 px-4 py-2 border-t text-sm items-center ${low?'bg-orange-50':''}">
          <div class="col-span-2">${c.name} ${low?'<span class="badge b-분실">부족</span>':''}</div>
          <div>${c.unit||''}</div>
          <div><input type="number" value="${c.currentStock}" onchange="Store.update('consumables','${c.id}',{currentStock:Number(this.value)});jbRender();" class="border rounded px-2 py-1 w-20" /></div>
          <div><input type="number" value="${c.minStock||0}" onchange="Store.update('consumables','${c.id}',{minStock:Number(this.value)})" class="border rounded px-2 py-1 w-20" /></div>
          <div class="text-right"><button onclick="if(confirm('삭제?')){Store.remove('consumables','${c.id}');jbRender();}" class="text-red-500 text-xs">삭제</button></div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
});

/* ── CSV 일괄 등록 ── */
route('#/import', ()=>{
  if(!Auth.isAdmin()) return `<div class="p-6">관리자만</div>`;
  setTimeout(()=>{
    document.getElementById('csvfile').onchange = e=>{
      const file=e.target.files[0]; if(!file) return;
      const enc=document.getElementById('csvenc').value||'utf-8';
      const r=new FileReader();
      r.onload=()=>{
        let text=r.result;
        if(text.charCodeAt(0)===0xFEFF) text=text.slice(1);
        const rows=text.split(/\r?\n/).filter(Boolean);
        const header=rows.shift().split(',').map(h=>h.trim().replace(/^﻿/,''));
        const out=[];
        for(const row of rows){ const cells=parseCSVLine(row); const o={}; header.forEach((h,i)=>o[h]=(cells[i]||'').trim()); out.push(o); }
        document.getElementById('preview').textContent=JSON.stringify(out.slice(0,5),null,2)+`\n... 총 ${out.length}건`;
        window._csvData=out;
      };
      r.readAsText(file,enc);
    };
    document.getElementById('btn-import').onclick=()=>{
      const data=window._csvData;
      if(!data?.length){ alert('파일 먼저 선택'); return; }
      let added=0,skipped=0;
      for(const row of data){
        if(!row.id||!row.type){ skipped++; continue; }
        if(Store.getById('equipment',row.id)){ skipped++; continue; }
        Store.add('equipment',{id:row.id,category:row.category||'기타',type:row.type,spec:row.spec||'',serial:row.serial||'',mobility:(row.mobility==='fixed'?'fixed':'portable'),certs:[...new Set((row.certs||'').split(/[;|]/).map(s=>s.trim()).filter(Boolean))],purchaseDate:row.purchaseDate||'',inspectionCycleMonths:Number(row.inspectionCycleMonths)||12,nextInspectionDate:row.nextInspectionDate||'',status:row.status||'사내'});
        added++;
      }
      alert(`등록 ${added}건, 건너뜀 ${skipped}건`);
      jbNavigate('#/equipment');
    };
  });
  function parseCSVLine(line){ const out=[]; let cur=''; let inQ=false; for(const ch of line){ if(ch==='"'){ inQ=!inQ; continue; } if(ch===','&&!inQ){ out.push(cur); cur=''; continue; } cur+=ch; } out.push(cur); return out; }
  const sample=`id,category,type,spec,mobility,serial,purchaseDate,inspectionCycleMonths,nextInspectionDate,status,certs\nTIG-01,용접,TIG 용접기,350A,portable,SN12345,2022-03-15,12,2026-06-01,사내,원자력 인증;ISO 인증\nCB-10T-01,운반,체인블록,10Ton,portable,,,12,,사내,`;
  const sampleBOM='﻿'+sample;
  return `
  <div>
    <h1 class="text-2xl font-bold mb-4">CSV 일괄 등록</h1>
    <div class="bg-white rounded-xl shadow-sm p-4 mb-4">
      <h2 class="font-bold mb-2">1) 템플릿 다운로드</h2>
      <pre class="bg-slate-50 p-3 rounded text-xs overflow-x-auto">${sample}</pre>
      <p class="text-xs text-slate-500 mt-1">certs: 인증이 여러 개면 세미콜론(;)으로 구분, 비우면 미인증</p>
      <a download="equipment_template.csv" href="data:text/csv;charset=utf-8,${encodeURIComponent(sampleBOM)}" class="inline-block mt-2 bg-slate-200 px-3 py-1 rounded text-sm">↓ 템플릿 받기</a>
    </div>
    <div class="bg-white rounded-xl shadow-sm p-4">
      <h2 class="font-bold mb-2">2) 파일 선택 후 등록</h2>
      <div class="flex flex-wrap gap-2 items-center">
        <input id="csvfile" type="file" accept=".csv" class="border rounded px-3 py-2" />
        <select id="csvenc" class="border rounded px-2 py-2 text-sm"><option value="utf-8">UTF-8</option><option value="euc-kr">EUC-KR</option></select>
      </div>
      <pre id="preview" class="bg-slate-50 p-3 mt-2 rounded text-xs overflow-x-auto max-h-64"></pre>
      <button id="btn-import" class="mt-3 bg-emerald-600 text-white px-6 py-2 rounded-lg">등록 실행</button>
    </div>
  </div>`;
});

/* ── 라벨 인쇄 ── */
route('#/qr-print', ()=>{
  if(!Auth.isAdmin()) return `<div class="p-6">관리자만</div>`;
  const list = Store.equipment.filter(e=>e.status!=='폐기');
  setTimeout(async ()=>{
    function doPrint(size){
      const sel = [...document.querySelectorAll('.label-chk:checked')].map(x=>x.value);
      const target = sel.length ? sel : list.map(e=>e.id);
      const labelData = target.map(id=>Store.getById('equipment',id)).filter(Boolean);
      const logoHtml = window._jbLogoDataUrl ? `<img src="${window._jbLogoDataUrl}" class="logo" />` : '';

      let labels, css;
      if(size === 'small'){
        // 소형: 40×30mm — QR 좌측 + 장비명·스펙·관리번호·로고 우측
        labels = labelData.map(e=>{
          const qrImg = `<img src="${(e.qrUrl||qrUrl(e.id))}" style="width:18mm;height:18mm;display:block;" />`;
          const logoS = window._jbLogoDataUrl ? `<img src="${window._jbLogoDataUrl}" style="width:100%;max-width:15mm;margin-top:2px;display:block;" />` : '';
          return `<div class="label">
            <div class="qr-s">${qrImg}</div>
            <div class="info-s">
              <div class="sname">${e.type||''}</div>
              ${e.spec?`<div class="sspec">${e.spec}</div>`:''}
              <div class="sid">${e.id}</div>
              ${logoS}
            </div>
          </div>`;
        }).join('');
        css = `
        @page{size:A4;margin:8mm}
        body{font-family:'Malgun Gothic',sans-serif;margin:0}
        .wrap{display:flex;flex-wrap:wrap;gap:2mm}
        .label{width:40mm;height:30mm;border:1.5px solid #bbb;border-radius:3px;display:flex;
               align-items:center;box-sizing:border-box;overflow:hidden;break-inside:avoid;background:#fff}
        .qr-s{padding:2mm;flex-shrink:0}
        .info-s{flex:1;padding:2mm 2mm 2mm 0;display:flex;flex-direction:column;justify-content:flex-start;padding-top:2mm;gap:1px;overflow:hidden;border-left:1px solid #eee}
        .sname{font-size:10px;font-weight:900;color:#111;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .sspec{font-size:8px;font-weight:600;color:#444;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .sid{font-size:7px;font-family:monospace;color:#666;margin-top:1px}`;
      } else {
        // 대형: 90×65mm
        labels = labelData.map(e=>{
        const qrImg = `<img src="${(e.qrUrl||qrUrl(e.id))}" style="width:70px;height:70px;display:block;" />`;
          return `<div class="label">
            <div class="info">
              <div class="name">${e.type||''}</div>
              ${e.spec?`<div class="spec">${e.spec}</div>`:''}
              <div class="divider"></div>
              <div class="id-row"><span class="id-label">관리번호&nbsp;</span><span class="id-val">${e.id}</span></div>
              ${e.serial?`<div class="model-row"><span class="id-label">모델명&nbsp;</span><span class="model-val">${e.serial}</span></div>`:''}
            </div>
            <div class="qr-block">
              ${qrImg}
              <div class="qr-sub">${e.id}</div>
              ${logoHtml}
            </div>
          </div>`;
        }).join('');
        css = `
        @page{size:A4;margin:10mm}
        body{font-family:'Malgun Gothic',sans-serif;margin:0}
        .wrap{display:flex;flex-wrap:wrap;gap:3mm}
        .label{width:90mm;height:65mm;border:1.5px solid #bbb;border-radius:4px;display:flex;
               box-sizing:border-box;overflow:hidden;break-inside:avoid;background:#fff}
        .info{flex:1;padding:4mm 3mm 4mm 5mm;display:flex;flex-direction:column;justify-content:center;gap:3px;overflow:hidden}
        .name{font-size:20px;font-weight:900;color:#111;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .spec{font-size:13px;font-weight:600;color:#333}
        .divider{height:1px;background:#ddd;margin:3px 0}
        .id-row{display:flex;align-items:baseline;}
        .model-row{display:flex;align-items:baseline;}
        .id-label{font-size:9px;color:#aaa;white-space:nowrap}
        .id-val{font-size:14px;font-weight:700;color:#111;font-family:monospace}
        .model-val{font-size:12px;font-weight:500;color:#444}
        .qr-block{width:28mm;background:#f8f8f8;border-left:1px solid #e8e8e8;
                  display:flex;flex-direction:column;align-items:center;justify-content:center;
                  flex-shrink:0;padding:3mm;gap:2px}
        .qr-sub{font-size:7px;color:#888;text-align:center;word-break:break-all;line-height:1.3}
        .logo{width:100%;max-width:26mm;margin-top:3mm}`;
      }
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>장비 라벨</title>
      <style>${css}</style></head><body>
        <div class="wrap">${labels}</div>
      </body></html>`;
      const w = window.open('','_blank','width=860,height=1200');
      if(!w){ alert('팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요.'); return; }
      w.document.write(html); w.document.close();
    }
    document.getElementById('btn-print-large').onclick = ()=> doPrint('large');
    document.getElementById('btn-print-small').onclick = ()=> doPrint('small');
  });
  return `
  <div>
    <div class="flex flex-wrap justify-between mb-4 items-center gap-2">
      <h1 class="text-2xl font-bold">🏷 라벨 인쇄</h1>
      <div class="flex gap-2">
        <button onclick="document.querySelectorAll('.label-chk').forEach(c=>c.checked=true)" class="bg-slate-200 px-3 py-2 rounded-lg text-sm">전체 선택</button>
        <button onclick="document.querySelectorAll('.label-chk').forEach(c=>c.checked=false)" class="bg-slate-200 px-3 py-2 rounded-lg text-sm">전체 해제</button>
        <button id="btn-print-large" class="bg-slate-900 text-white px-4 py-2 rounded-lg">🖨 대형 (90×65mm)</button>
        <button id="btn-print-small" class="bg-slate-600 text-white px-4 py-2 rounded-lg">🖨 소형 (40×30mm)</button>
      </div>
    </div>
    <p class="text-sm text-slate-500 mb-3">인쇄할 장비를 선택하세요 (미선택 시 전체 인쇄).</p>
    <div class="bg-white rounded-xl shadow-sm p-4">
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;">
        ${list.map(e=>`
        <label style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;cursor:pointer;">
          <input type="checkbox" class="label-chk" value="${e.id}" checked style="width:16px;height:16px;flex-shrink:0;" />
          ${`<img src="${(e.qrUrl||qrUrl(e.id))}" style="width:44px;height:44px;flex-shrink:0;border-radius:3px;" />`}
          <div style="min-width:0;">
            <div style="font-weight:600;font-size:13px;">${e.type||''}</div>
            <div style="font-size:12px;color:var(--text-muted,#999);">${e.id}</div>
            <div style="font-size:11px;color:var(--text-muted,#aaa);">${e.category||''}</div>
          </div>
        </label>`).join('')}
      </div>
    </div>
  </div>`;
});

/* ── 설정 (관리자 전용) ── */
route('#/settings', ()=>{
  if(!Auth.isAdmin()) return `<div class="p-6">관리자만</div>`;
  const supaConnected = SupaStore.enabled;
  setTimeout(()=>{
    // JSON 백업
    document.getElementById('btn-export').onclick = ()=>{
      const data={};
      Store.collections.forEach(c=>data[c]=Store[c]);
      const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
      const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
      a.download=`jangbi_backup_${todayISO()}.json`; a.click();
    };
    document.getElementById('btn-import-json').onchange = e=>{
      const f=e.target.files[0]; if(!f) return;
      if(!confirm('현재 데이터가 모두 덮어써집니다. 계속?')) return;
      const r=new FileReader();
      r.onload=()=>{
        try{
          const d=JSON.parse(r.result);
          for(const c of Store.collections){ if(Array.isArray(d[c])){ Store[c]=d[c]; Store.save(c); } }
          alert('복원 완료'); location.reload();
        }catch{ alert('JSON 파싱 실패'); }
      };
      r.readAsText(f);
    };
    document.getElementById('btn-reset').onclick = ()=>{
      if(!confirm('모든 데이터 삭제. 정말?')) return;
      if(!confirm('마지막 확인 - 복구 불가')) return;
      Store.collections.forEach(c=>localStorage.removeItem('jb_'+c));
      location.reload();
    };
    // SQL 복사
    const sqlCopyBtn=document.getElementById('btn-copy-sql');
    if(sqlCopyBtn) sqlCopyBtn.onclick=()=>{
      const ta=document.getElementById('sql-setup-script');
      if(ta){ navigator.clipboard.writeText(ta.value).then(()=>{ sqlCopyBtn.textContent='복사됨!'; setTimeout(()=>sqlCopyBtn.textContent='SQL 복사',2000); }); }
    };
    // 마이그레이션
    const migrBtn=document.getElementById('btn-migrate');
    const migrStatus=document.getElementById('migrate-status');
    if(migrBtn) migrBtn.onclick=async()=>{
      if(!confirm('로컬 데이터를 Supabase로 복사합니다. 계속?')) return;
      migrBtn.disabled=true; migrBtn.textContent='마이그레이션 중...';
      migrStatus.textContent='준비 중...';
      try{
        let done=0;
        await SupaStore.migrateFromLocal((d,t,c)=>{ done=d; migrStatus.textContent=`(${d}/${t}) ${c} 업로드 중...`; });
        migrStatus.textContent=`완료! ${done}건 업로드됨.`;
        migrStatus.className='text-sm text-emerald-600 mt-2 font-semibold';
      }catch(e){ migrStatus.textContent='오류: '+e.message; migrBtn.disabled=false; migrBtn.textContent='Supabase로 마이그레이션'; }
    };
  });
  const sqlScript=`-- 장비 관리 테이블 생성 (Supabase SQL Editor에서 실행)
DO $$
DECLARE cols TEXT[] := ARRAY['equipment','checkouts','maintenance','sites','users','consumables','config','auditLogs'];
  c TEXT;
BEGIN
  FOREACH c IN ARRAY cols LOOP
    EXECUTE format('CREATE TABLE IF NOT EXISTS jb_%s (id text PRIMARY KEY, data jsonb NOT NULL, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());', c);
    EXECUTE format('ALTER TABLE jb_%s ENABLE ROW LEVEL SECURITY;', c);
    EXECUTE format('CREATE POLICY IF NOT EXISTS "anon_all_%s" ON jb_%s FOR ALL TO anon USING (true) WITH CHECK (true);', c, c);
  END LOOP;
END $$;
ALTER PUBLICATION supabase_realtime ADD TABLE jb_equipment;
ALTER PUBLICATION supabase_realtime ADD TABLE jb_checkouts;`;
  return `
  <div>
    <h1 class="text-2xl font-bold mb-4">설정</h1>
    <div class="space-y-4 max-w-2xl">
      <!-- Supabase 상태 -->
      <div class="bg-white rounded-xl shadow-sm p-4">
        <div class="flex items-center gap-2 mb-2">
          <h2 class="font-bold">Supabase 연결 상태</h2>
          <span class="badge ${supaConnected?'b-사내':'b-폐기'}">${supaConnected?'☁ 멀티유저 활성':'로컬 단독'}</span>
        </div>
        ${supaConnected
          ? `<p class="text-sm text-emerald-700">Supabase 멀티유저 모드로 동작 중입니다. 실시간 동기화가 활성화되어 있습니다.</p>`
          : `<p class="text-sm text-amber-700">현재 localStorage 단독 모드입니다. 멀티유저 동기화를 원하면 <code class="bg-slate-100 px-1 rounded">jangbi.js</code> 파일 상단의 <code class="bg-slate-100 px-1 rounded">JB_SUPA_URL</code>과 <code class="bg-slate-100 px-1 rounded">JB_SUPA_KEY</code>를 실제 값으로 교체하세요.</p>`}
      </div>
      <!-- Supabase 테이블 설정 -->
      <div class="bg-white rounded-xl shadow-sm p-4">
        <h2 class="font-bold mb-2">Supabase 테이블 생성 SQL</h2>
        <p class="text-sm text-slate-500 mb-3">처음 설정 시 Supabase SQL Editor에서 아래 SQL을 실행하세요.</p>
        <div class="relative mb-3">
          <textarea id="sql-setup-script" readonly rows="6" class="w-full font-mono text-xs bg-slate-900 text-green-300 rounded p-3 resize-none border-0 outline-none">${sqlScript}</textarea>
          <button id="btn-copy-sql" class="absolute top-2 right-2 text-xs bg-slate-600 text-white px-2 py-1 rounded">SQL 복사</button>
        </div>
        ${supaConnected?`
        <button id="btn-migrate" class="bg-indigo-600 text-white px-4 py-2 rounded text-sm font-semibold">Supabase로 마이그레이션</button>
        <div id="migrate-status" class="text-sm text-slate-500 mt-2"></div>`:`
        <p class="text-xs text-amber-700 bg-amber-50 rounded p-2">jangbi.js의 Supabase 설정 후 재접속하면 마이그레이션 버튼이 활성화됩니다.</p>`}
      </div>
      <!-- 데이터 백업/복원 -->
      <div class="bg-white rounded-xl shadow-sm p-4">
        <h2 class="font-bold mb-1">데이터 백업 / 복원</h2>
        <p class="text-sm text-slate-500 mb-2">장비·출고·정비 이력의 JSON 백업을 권장합니다.</p>
        <div class="flex gap-2 flex-wrap">
          <button id="btn-export" class="bg-emerald-600 text-white px-4 py-2 rounded">⬇ JSON 백업</button>
          <label class="bg-amber-500 text-white px-4 py-2 rounded cursor-pointer">⬆ JSON 복원<input id="btn-import-json" type="file" accept=".json" class="hidden" /></label>
          <button id="btn-reset" class="bg-red-500 text-white px-4 py-2 rounded">전체 초기화</button>
        </div>
      </div>
    </div>
  </div>`;
});

/* ── 전역 노출 ── */
window.Store = Store;
window.Auth = Auth;
window.SupaStore = SupaStore;
window.jbNavigate = jbNavigate;
window.jbRender = jbRender;

/* ── 초기화 함수 (sejong-prod setupTabs에서 호출) ── */
let _jbInitialized = false;
window.jangbiInit = async function(){
  // sejong-prod currentUser → jangbi Auth 매핑
  if(typeof currentUser !== 'undefined' && currentUser){
    Auth.current = {
      id:         currentUser.id || currentUser.name,
      employeeId: currentUser.name,
      name:       currentUser.name,
      role:       currentUser.mdRole === '관리자' ? 'admin' : 'worker',
      active:     true,
      pin:        '',
    };
  }
  if(!_jbInitialized){
    // sejong-prod 다크 테마에 맞게 Tailwind 색상 클래스 오버라이드
    if(!document.getElementById('jangbi-theme-override')){
      const s = document.createElement('style');
      s.id = 'jangbi-theme-override';
      s.textContent = `
        #jangbi-root { color: var(--text); }
        #jangbi-root .bg-white, #jangbi-root .bg-slate-50 { background: var(--surface2) !important; }
        #jangbi-root .bg-slate-100, #jangbi-root .bg-slate-200 { background: var(--surface3) !important; }
        #jangbi-root .bg-slate-700 { background: var(--surface2) !important; }
        #jangbi-root .bg-slate-800 { background: var(--surface3) !important; }
        #jangbi-root .bg-slate-900 { background: var(--surface) !important; }
        #jangbi-root .text-slate-900, #jangbi-root .text-slate-800, #jangbi-root .text-slate-700 { color: var(--text) !important; }
        #jangbi-root .text-slate-600, #jangbi-root .text-slate-500 { color: var(--text2) !important; }
        #jangbi-root .text-slate-400, #jangbi-root .text-slate-300 { color: var(--text3) !important; }
        #jangbi-root .text-slate-100 { color: var(--text) !important; }
        #jangbi-root .text-white { color: var(--text) !important; }
        #jangbi-root .border-slate-100, #jangbi-root .border-slate-200, #jangbi-root .border-slate-300 { border-color: var(--border) !important; }
        #jangbi-root .border-slate-700, #jangbi-root .border-slate-800 { border-color: var(--border) !important; }
        #jangbi-root .divide-slate-200>:not([hidden])~:not([hidden]) { border-color: var(--border) !important; }
        #jangbi-root .shadow-sm, #jangbi-root .shadow, #jangbi-root .shadow-md { box-shadow: 0 1px 3px rgba(0,0,0,0.5) !important; }
        #jangbi-root input:not([type=radio]):not([type=checkbox]), #jangbi-root select, #jangbi-root textarea {
          background: var(--surface3) !important; border-color: var(--border) !important; color: var(--text) !important;
        }
        #jangbi-root .bg-gradient-to-br { background: var(--surface) !important; }
        #jangbi-root .hover\\:bg-slate-50:hover, #jangbi-root .hover\\:bg-slate-100:hover { background: var(--surface3) !important; }
        #jangbi-root .hover\\:bg-slate-800:hover { background: var(--surface2) !important; }
        #jangbi-root .ring-slate-200 { --tw-ring-color: var(--border) !important; }
        #jangbi-root .bg-emerald-50 { background: rgba(0,212,160,0.1) !important; }
        #jangbi-root .bg-red-50, #jangbi-root .bg-orange-50 { background: rgba(255,107,107,0.1) !important; }
        #jangbi-root .bg-blue-50, #jangbi-root .bg-sky-50 { background: rgba(79,127,255,0.1) !important; }
        #jangbi-root .bg-yellow-50, #jangbi-root .bg-amber-50 { background: rgba(255,179,71,0.1) !important; }
        #jangbi-root .text-emerald-700, #jangbi-root .text-emerald-600 { color: var(--accent2) !important; }
        #jangbi-root .text-red-700, #jangbi-root .text-red-600 { color: var(--accent3) !important; }
        #jangbi-root .text-blue-700, #jangbi-root .text-blue-600 { color: var(--accent) !important; }
        #jangbi-root .text-amber-700, #jangbi-root .text-amber-600 { color: var(--accent4) !important; }
      `;
      document.head.appendChild(s);
    }
    Store.load();
    // 회사 로고: index.html의 숨김 img#jb-logo-src에서 canvas를 통해 dataURL로 변환
    if(!window._jbLogoDataUrl){
      const logoEl = document.getElementById('jb-logo-src');
      if(logoEl){
        const _loadLogo = ()=>{
          try{
            const c = document.createElement('canvas');
            c.width = logoEl.naturalWidth || 1; c.height = logoEl.naturalHeight || 1;
            c.getContext('2d').drawImage(logoEl,0,0);
            window._jbLogoDataUrl = c.toDataURL('image/png');
          }catch(err){ console.warn('로고 변환 실패:',err); }
        };
        if(logoEl.complete && logoEl.naturalWidth>0) _loadLogo(); else logoEl.onload=_loadLogo;
      }
    }
    const supa = getSupaClient();
    if(supa){
      const root = document.getElementById('jangbi-root');
      if(root) root.innerHTML = `
        <div class="min-h-screen flex items-center justify-center bg-slate-100">
          <div class="text-center space-y-3">
            <div class="text-5xl" style="animation:spin 1s linear infinite;display:inline-block">⚙</div>
            <p class="text-slate-600 font-medium">장비 데이터 로드 중...</p>
          </div>
        </div>`;
      await SupaStore.init();
    }
    // 앵커 클릭 인터셉트 (hash 변경 방지, 상태 기반 라우팅 사용)
    const root = document.getElementById('jangbi-root');
    if(root){
      root.addEventListener('click', e=>{
        const a = e.target.closest('a[href^="#/"]');
        if(a){ e.preventDefault(); jbNavigate(a.getAttribute('href')); }
      });
    }
    _jbInitialized = true;
  } else {
    // 재방문 시 currentUser 변경 반영 (역할 재매핑)
    if(typeof currentUser !== 'undefined' && currentUser){
      Auth.current = {
        id:         currentUser.id || currentUser.name,
        employeeId: currentUser.name,
        name:       currentUser.name,
        role:       currentUser.mdRole === '관리자' ? 'admin' : 'worker',
        active:     true,
        pin:        '',
      };
    }
  }
  _jbPath = '#/';
  jbRender();
};
