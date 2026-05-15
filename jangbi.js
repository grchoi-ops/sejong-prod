/* ============================================================
   jangbi.js — 장비관리 모듈 (sejong-prod 통합 버전)
   원본: jangbi/index.html <script> 블록 추출
   변경: Auth 통합, 상태기반 미니라우터, Supabase 하드코딩
   ============================================================ */

// ⬇ 실제 Supabase 값으로 교체 필요
const JB_SUPA_URL = 'https://YOUR_PROJECT.supabase.co';
const JB_SUPA_KEY = 'YOUR_ANON_KEY';

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

/* ── 장비 목록 ── */
route('#/equipment', ()=>{
  const params = new URLSearchParams(_jbPath.split('?')[1]||'');
  const filterStatus = params.get('status')||'';
  const filterCat = params.get('cat')||'';
  const filterMob = params.get('mob')||'';
  const q0 = params.get('q')||'';
  const updateHash = (k,v)=>{
    const p = new URLSearchParams(_jbPath.split('?')[1]||'');
    if(v) p.set(k,v); else p.delete(k);
    const qs = p.toString();
    jbNavigate('#/equipment'+(qs?'?'+qs:''));
  };
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
        clearTimeout(t); t = setTimeout(()=>updateHash('q', search.value), 600);
      };
    }
    const fs = document.getElementById('f-status');
    const fc = document.getElementById('f-cat');
    const fm = document.getElementById('f-mob');
    if(fs) fs.onchange = e=>updateHash('status', e.target.value);
    if(fc) fc.onchange = e=>updateHash('cat', e.target.value);
    if(fm) fm.onchange = e=>updateHash('mob', e.target.value);
    window.printEquipmentList = ()=>{
      const rows = list.map(e=>{
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
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>장비목록</title>
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
        <h2>장비 목록 (${list.length}건)</h2>
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
  if(q0){ const qq = q0.toLowerCase(); list = list.filter(e=>JSON.stringify(e).toLowerCase().includes(qq)); }
  const cats = [...new Set(Store.equipment.map(e=>e.category).filter(Boolean))];

  return `
  <div>
    <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
      <h1 class="text-2xl font-bold">장비 목록 (${list.length})</h1>
      ${Auth.isAdmin()?`<div class="flex gap-2 flex-wrap">
        <a href="#/equipment/new" class="bg-slate-900 text-white px-4 py-2 rounded-lg">+ 신규 등록</a>
        <a href="#/equipment/bulk" class="bg-emerald-600 text-white px-4 py-2 rounded-lg">+ 일괄 등록</a>
        <a href="#/qr-print" class="bg-amber-500 text-white px-4 py-2 rounded-lg">🏷 라벨 인쇄</a>
        <button onclick="printEquipmentList()" class="bg-slate-600 text-white px-4 py-2 rounded-lg">🖨 목록 인쇄</button>
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
      ${(filterStatus||filterCat||filterMob||q0)?`<a href="#/equipment" class="text-xs text-slate-500 underline">필터 해제</a>`:''}
    </div>
    <div class="bg-white rounded-xl shadow-sm overflow-hidden">
      <div class="grid grid-cols-12 px-4 py-2 bg-slate-50 text-xs font-semibold text-slate-500">
        <div class="col-span-3">장비명</div><div class="col-span-2">장비관리번호</div><div class="col-span-1">카테고리</div>
        <div class="col-span-2">상태</div><div class="col-span-2">현재 위치</div>
        <div class="col-span-1 text-right">최근점검</div><div class="col-span-1 text-right">점검예정일</div>
      </div>
      ${list.length===0?'<div class="p-6 text-center text-slate-400">등록된 장비 없음</div>':list.map(e=>{
        const site = Store.getById('sites', e.currentSiteId);
        const u = Store.users.find(x=>x.employeeId===e.currentHolderId);
        const overdue = e.status==='출장중' && isOverdue(e.expectedReturnDate);
        const inspSoon = e.nextInspectionDate && daysBetween(todayISO(), e.nextInspectionDate)<=14;
        const inspOverdue = e.nextInspectionDate && isOverdue(e.nextInspectionDate);
        const fixed = (e.mobility||'portable')==='fixed';
        const lastMaint = Store.byEqId('maintenance', e.id).sort((a,b)=>(b.date||'').localeCompare(a.date||''))[0];
        return `<a data-eq-row href="#/equipment/${e.id}" class="grid grid-cols-12 px-4 py-3 border-t hover:bg-slate-50 text-sm items-center">
          <div class="col-span-3 font-bold">${e.type||''} ${fixed?'<span class="badge b-폐기" title="고정설비">📌</span>':''}<div class="text-slate-400 text-xs font-normal">${e.spec||''}</div></div>
          <div class="col-span-2 text-xs text-slate-500">${e.id}</div>
          <div class="col-span-1 text-slate-500 text-xs">${e.category||''}</div>
          <div class="col-span-2">
            <span class="badge b-${e.status||'사내'}">${e.status||'사내'}</span>
            ${overdue?'<span class="badge b-분실 ml-1">지연</span>':''}
          </div>
          <div class="col-span-2 text-xs text-slate-500">${e.status==='출장중'?(site?.name||'-')+(u?` / ${u.name}`:''):'-'}</div>
          <div class="col-span-1 text-right text-xs text-slate-400">${fmt(lastMaint?.date)||'-'}</div>
          <div class="col-span-1 text-right text-xs ${inspOverdue?'text-red-500 font-semibold':inspSoon?'text-amber-500 font-semibold':'text-slate-400'}">${fmt(e.nextInspectionDate)||'-'}</div>
        </a>`;
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
      title: `${m.type} — ${u?.name||m.performerId||'-'}`,
      sub: [m.partsReplaced?'부품: '+m.partsReplaced:'', m.cost?Number(m.cost).toLocaleString()+'원':''].filter(Boolean).join(' · '),
      extra: [m.note||'', m.nextInspectionDate?`다음점검: ${fmt(m.nextInspectionDate)}`:''].filter(Boolean).join(' | '),
    });
  });
  Store.byEqId('auditLogs', id)
    .filter(a=>['lost','found','status_change'].includes(a.action))
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
            ${e.qrDataUrl
              ? `<img src="${e.qrDataUrl}" style="width:90px;height:90px;border-radius:6px;border:1px solid var(--border);" />`
              : `<div style="width:90px;height:90px;border-radius:6px;border:1px dashed var(--border);display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--text-muted,#aaa);">QR없음</div>`
            }
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
        mobility:f.mobility.value, inspectionCycleMonths:Number(f.inspectionCycleMonths.value)||12,
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
        </div>
      </fieldset>
      <div class="col-span-2 text-right"><button class="bg-emerald-600 text-white px-6 py-2 rounded-lg font-semibold">일괄 등록 실행</button></div>
    </form>
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
        data.photoUrl = photoUrl;
        data.inspectionCycleMonths = Number(data.inspectionCycleMonths)||12;
        if(isNew){
          if(Store.getById('equipment', data.id)){ alert('이미 존재하는 ID'); btn.disabled=false; btn.textContent='등록'; return; }
          data.status = data.status || '사내';
          Store.add('equipment', data);
        } else { Store.update('equipment', eq.id, data); }
        // QR 생성 후 저장
        const targetId = isNew ? data.id : eq.id;
        if(window.QRCode){
          try{
            const dataUrl = await QRCode.toDataURL(targetId, {width:120, margin:1, errorCorrectionLevel:'M'});
            Store.update('equipment', targetId, {qrDataUrl: dataUrl});
          }catch(err){ console.error('QR 생성 실패:', err); }
        } else { console.warn('QRCode 라이브러리 미로드'); }
        jbNavigate('#/equipment/'+(isNew ? data.id : eq.id));
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
    const eqsel = document.getElementById('eqsel');
    if(eqsel) eqsel.onchange = e=>{
      const eq = Store.getById('equipment', e.target.value);
      if(eq?.inspectionCycleMonths){
        const next = new Date(); next.setMonth(next.getMonth()+Number(eq.inspectionCycleMonths));
        document.getElementById('next-insp').value = next.toISOString().slice(0,10);
      }
    };
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
      <label class="block col-span-2">다음 점검 예정일<input id="next-insp" type="date" name="nextInspectionDate" class="w-full border rounded px-3 py-2 mt-1" /></label>
      <label class="block col-span-2">메모<textarea name="note" rows="3" class="w-full border rounded px-3 py-2 mt-1"></textarea></label>
      <div class="col-span-2 text-right"><button class="bg-slate-900 text-white px-6 py-2 rounded-lg">저장</button></div>
    </form>
  </div>`;
});

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
        Store.add('equipment',{id:row.id,category:row.category||'기타',type:row.type,spec:row.spec||'',serial:row.serial||'',mobility:(row.mobility==='fixed'?'fixed':'portable'),purchaseDate:row.purchaseDate||'',inspectionCycleMonths:Number(row.inspectionCycleMonths)||12,nextInspectionDate:row.nextInspectionDate||'',status:row.status||'사내'});
        added++;
      }
      alert(`등록 ${added}건, 건너뜀 ${skipped}건`);
      jbNavigate('#/equipment');
    };
  });
  function parseCSVLine(line){ const out=[]; let cur=''; let inQ=false; for(const ch of line){ if(ch==='"'){ inQ=!inQ; continue; } if(ch===','&&!inQ){ out.push(cur); cur=''; continue; } cur+=ch; } out.push(cur); return out; }
  const sample=`id,category,type,spec,mobility,serial,purchaseDate,inspectionCycleMonths,nextInspectionDate,status\nTIG-01,용접,TIG 용접기,350A,portable,SN12345,2022-03-15,12,2026-06-01,사내\nCB-10T-01,운반,체인블록,10Ton,portable,,,12,,사내`;
  const sampleBOM='﻿'+sample;
  return `
  <div>
    <h1 class="text-2xl font-bold mb-4">CSV 일괄 등록</h1>
    <div class="bg-white rounded-xl shadow-sm p-4 mb-4">
      <h2 class="font-bold mb-2">1) 템플릿 다운로드</h2>
      <pre class="bg-slate-50 p-3 rounded text-xs overflow-x-auto">${sample}</pre>
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
          const qrImg = e.qrDataUrl
            ? `<img src="${e.qrDataUrl}" style="width:18mm;height:18mm;display:block;" />`
            : `<div style="width:18mm;height:18mm;border:1px dashed #ccc;display:flex;align-items:center;justify-content:center;font-size:7px;color:#bbb;">QR없음</div>`;
          const logoS = window._jbLogoDataUrl ? `<img src="${window._jbLogoDataUrl}" style="width:100%;max-width:10mm;margin-top:2px;display:block;" />` : '';
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
          const qrImg = e.qrDataUrl
            ? `<img src="${e.qrDataUrl}" style="width:70px;height:70px;display:block;" />`
            : `<div style="width:70px;height:70px;border:1px dashed #ccc;display:flex;align-items:center;justify-content:center;font-size:8px;color:#bbb;">QR없음</div>`;
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
          ${e.qrDataUrl?`<img src="${e.qrDataUrl}" style="width:44px;height:44px;flex-shrink:0;border-radius:3px;" />`:`<div style="width:44px;height:44px;flex-shrink:0;background:var(--surface3);border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--text-muted,#aaa);">QR없음</div>`}
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
    // 기존 장비 중 qrDataUrl 없는 항목 백그라운드 생성
    if(window.QRCode){
      const missing = Store.equipment.filter(e=>!e.qrDataUrl);
      for(const e of missing){
        try{
          const dataUrl = await QRCode.toDataURL(e.id, {width:120, margin:1, errorCorrectionLevel:'M'});
          Store.update('equipment', e.id, {qrDataUrl: dataUrl});
        }catch(err){ console.error('QR 생성 실패 '+e.id+':', err); }
      }
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
