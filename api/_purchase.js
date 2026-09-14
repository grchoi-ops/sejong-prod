// api/_purchase.js — 구매요청 저장소 공용 헬퍼
// 파일명이 _ 로 시작하므로 Vercel이 이 파일을 라우트로 만들지 않는다 (번들에는 포함된다).

// DB 행(snake_case) → 앱이 쓰는 모양(camelCase).
// 앱 전체가 row.itemName / row.date 같은 이름을 쓰고 있으므로 모양을 그대로 유지한다.
function toApp(r) {
  return {
    id:       r.id,
    ts:       r.ts       || '',
    claim:    r.claim    || '',
    date:     r.req_date || '',
    projId:   r.proj_id  || '',
    projName: r.proj_name || '',
    projCode: r.proj_code || '',
    site:     r.site     || '',
    manager:  r.manager  || '',
    position: r.manager_position || '',
    phone:    r.phone    || '',
    itemNo:   r.item_no  || 1,
    itemName: r.item_name || '',
    itemSpec: r.item_spec || '',
    itemQty:  r.item_qty  || '',
    itemNote: r.item_note || ''
  };
}

/** 앱이 보낸 모양 → DB 행. id가 없으면 서버에서 만들어 준다. */
function toRow(o, createdBy) {
  return {
    id:       String(o.id || newId()),
    ts:       str(o.ts),
    claim:    str(o.claim),
    req_date: str(o.date),
    proj_id:  str(o.projId),
    proj_name: str(o.projName),
    proj_code: str(o.projCode),
    site:     str(o.site),
    manager:  str(o.manager),
    manager_position: str(o.position),
    phone:    str(o.phone),
    item_no:  Number.isFinite(Number(o.itemNo)) ? Number(o.itemNo) : 1,
    item_name: str(o.itemName),
    item_spec: str(o.itemSpec),
    item_qty:  str(o.itemQty),
    item_note: str(o.itemNote),
    created_by: str(createdBy)
  };
}

function str(v) { return (v === undefined || v === null) ? '' : String(v); }

let _idSeq = 0;
function newId() {
  _idSeq = (_idSeq + 1) % 100000;
  return 'pr_' + Date.now().toString(36) + '_' + _idSeq.toString(36) +
         '_' + Math.random().toString(36).slice(2, 8);
}

/**
 * 구매요청 전체를 순서대로 읽는다. PostgREST 기본 상한(1000행)에 걸리지 않도록
 * 끝까지 페이지를 넘겨 가며 모은다 — 건수 제한으로 데이터가 잘려 보이는 일을
 * 애초에 만들지 않기 위함이다.
 */
async function readAll(supabase) {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('purchase_items')
      .select('*')
      .order('seq', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out.map(toApp);
}

/**
 * 행 단위 테이블로의 이관이 끝났는지 확인한다.
 * 테이블이 없거나(아직 SQL 미실행) 비어 있으면(아직 이관 전) false —
 * 이 경우 load/save는 예전 app_data.purchaseDB 경로를 그대로 쓴다.
 * 덕분에 SQL 실행 전에 배포해도 앱이 멀쩡히 돌아간다.
 */
async function isLive(supabase) {
  try {
    const { count, error } = await supabase
      .from('purchase_items')
      .select('id', { count: 'exact', head: true });
    if (error) return false;
    return (count || 0) > 0;
  } catch (_) {
    return false;
  }
}

module.exports = { toApp, toRow, newId, readAll, isLive };
