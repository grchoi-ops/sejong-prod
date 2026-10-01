/* ============================================================
   insp-shared.js — 월간 점검(기계 설비 점검 기준표) 공용 정의
   index.html(장비관리 월간점검)과 inspect.html(폰 QR 점검) 양쪽에서 로드된다.
   app.js·jangbi.js 에 의존하지 않고 홀로 동작해야 한다.
   ============================================================ */

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

const inspSummary = rec => {
  const r = rec.inspection.results||[];
  const bad = r.filter(x=>x && x!=='○').length;
  return bad ? `이상 ${bad}건 (${INSP_MARKS.filter(([s])=>r.includes(s) && s!=='○').map(([s,l])=>`${s}${l} ${r.filter(x=>x===s).length}`).join(', ')})` : '전 항목 양호';
};

// 점검 기록 문서 — PC(jangbi.js)와 폰(inspect.html)이 같은 모양으로 저장하도록 한 곳에서 만든다.
// 정비 이력(jb_maintenance)의 data 로 들어간다.
function inspBuildDoc({equipmentId, info, results, action, date, inspector, performerId, via}){
  return {
    equipmentId, type:'월간점검', date, inspector,
    performerId: performerId || inspector,
    note: action, partsReplaced:'', cost:0,
    inspection:{tpl:info.tpl, items:info.items.map(it=>it[0]), results:[...results], action, via: via||'pc'},
  };
}
// 결과 검증 — 통과하면 null, 아니면 사용자에게 보일 문구
function inspValidate({info, results, action, inspector}){
  const left = info.items.length - results.filter(Boolean).length;
  if(left) return `아직 결과를 고르지 않은 항목이 ${left}개 있습니다.`;
  if(!String(inspector||'').trim()) return '점검자 이름을 입력하세요.';
  if(results.some(x=>x==='△'||x==='×') && !String(action||'').trim()) return '수리(△)·교환(×) 항목이 있으면 조치사항을 적어 주세요.';
  return null;
}
