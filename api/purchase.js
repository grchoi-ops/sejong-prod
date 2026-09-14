// api/purchase.js — 구매요청 행 단위 API
//
//   GET    /api/purchase              전체 조회 (순서 보존)
//   POST   /api/purchase              { items:[...], modifiedBy } → 보낸 행만 INSERT
//   DELETE /api/purchase?id=<id>      한 행 삭제
//   POST   /api/purchase?action=migrate   app_data.purchaseDB → 테이블 1회 이관
//
// 배열 전체를 덮어쓰는 경로가 없다는 점이 핵심이다. 저장은 언제나 '내가 추가한
// 행만' 넣으므로, 다른 사람이 같은 시각에 저장해도 서로의 행을 지울 수 없다.
const { createClient } = require('@supabase/supabase-js');
const { toRow, readAll } = require('./_purchase');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // ── 조회 ──
    if (req.method === 'GET') {
      const items = await readAll(supabase);
      return res.status(200).json({ success: true, count: items.length, items });
    }

    // ── 삭제 ──
    if (req.method === 'DELETE') {
      const id = req.query?.id;
      if (!id) return res.status(400).json({ success: false, error: 'id 필요' });
      const { error } = await supabase.from('purchase_items').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ success: true, deleted: id });
    }

    if (req.method === 'POST') {
      // ── 1회 이관 ──
      if (req.query?.action === 'migrate') return migrate(req, res);

      // ── 추가 ──
      const items = req.body?.items;
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, error: 'items 배열이 필요합니다' });
      }
      if (items.length > 500) {
        return res.status(400).json({ success: false, error: '한 번에 500행까지만 보낼 수 있습니다' });
      }

      const rows = items.map(o => toRow(o, req.body?.modifiedBy));

      // 같은 id로 다시 보내도 중복이 생기지 않는다 — 저장 실패 후 재시도가 안전해진다.
      const { data, error } = await supabase
        .from('purchase_items')
        .upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
        .select('id');
      if (error) throw error;

      return res.status(200).json({
        success: true,
        requested: rows.length,
        inserted: (data || []).length,          // 이미 있던 행은 여기서 빠진다
        ids: rows.map(r => r.id)
      });
    }

    return res.status(405).json({ success: false, error: '허용되지 않는 메서드' });

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * app_data.purchaseDB(JSON 배열)를 purchase_items 테이블로 옮긴다.
 * 테이블이 비어 있을 때만 동작하므로 실수로 두 번 불러도 데이터가 겹치지 않는다.
 * 원본 app_data.purchaseDB는 지우지 않고 그대로 남겨둔다 (되돌릴 여지를 남긴다).
 */
async function migrate(req, res) {
  const { count, error: cntErr } = await supabase
    .from('purchase_items')
    .select('id', { count: 'exact', head: true });
  if (cntErr) {
    return res.status(500).json({
      success: false,
      error: 'purchase_items 테이블을 읽을 수 없습니다. db/purchase_items.sql 을 먼저 실행하세요. (' + cntErr.message + ')'
    });
  }
  if ((count || 0) > 0) {
    return res.status(409).json({
      success: false, error: '이미 이관되어 있습니다 (' + count + '행). 다시 실행하지 않았습니다.'
    });
  }

  const { data: row, error: readErr } = await supabase
    .from('app_data').select('value').eq('key', 'purchaseDB').maybeSingle();
  if (readErr) throw readErr;

  const legacy = Array.isArray(row?.value) ? row.value : [];
  if (legacy.length === 0) {
    return res.status(200).json({ success: true, migrated: 0, note: '옮길 데이터가 없습니다' });
  }

  // seq는 일부러 지정하지 않는다. 배열 순서대로 넣으면 bigserial이 그 순서대로
  // 번호를 매기므로 화면 정렬이 이관 전과 똑같이 유지되고, 이후 새로 들어오는
  // 행도 자연히 뒤에 붙는다. (seq를 직접 넣으면 시퀀스가 어긋나 새 행이 맨 앞에 선다)
  const rows = legacy.map(o => toRow(o, '이관'));

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('purchase_items').insert(rows.slice(i, i + 500));
    if (error) throw error;
  }

  const after = await readAll(supabase);
  return res.status(200).json({
    success: true, migrated: rows.length, tableCount: after.length
  });
}
