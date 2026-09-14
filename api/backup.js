// api/backup.js - 스냅샷 목록 조회 / 복원
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const DATA_KEYS = ['employees', 'projects', 'dailyData', 'purchaseDB', 'purchaseDrafts', 'mdEntries', 'dailyReports', 'overtimeReports', 'tbmRecords', 'lastModified', 'modifiedBy'];

/** 스냅샷 안의 값이 몇 건짜리인지 한 줄로 요약 (배열=길이, 객체=키 수) */
function describeValue(v) {
  if (Array.isArray(v)) return { type: 'array', count: v.length };
  if (v && typeof v === 'object') return { type: 'object', count: Object.keys(v).length };
  return { type: typeof v, value: v };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // ── GET: 스냅샷 목록, 또는 ?id= 로 특정 스냅샷 내용 조회(읽기 전용) ──
    // 복원(POST)은 현재 데이터를 덮어쓰므로, "그때 무슨 데이터가 있었는지"만
    // 확인하고 싶을 때 쓸 수 있는 안전한 경로가 필요하다.
    //   GET /api/backup                      → 목록
    //   GET /api/backup?id=533               → 그 스냅샷의 키별 건수 요약
    //   GET /api/backup?id=533&key=purchaseDB → 해당 키의 실제 값
    if (req.method === 'GET') {
      const id  = req.query?.id;
      const key = req.query?.key;

      if (id) {
        const { data, error } = await supabase
          .from('app_data_history')
          .select('saved_at, saved_by, snapshot')
          .eq('id', id)
          .single();

        if (error || !data) throw error || new Error('스냅샷을 찾을 수 없습니다');

        const snapshot = data.snapshot || {};

        if (key) {
          if (!DATA_KEYS.includes(key)) {
            return res.status(400).json({ success: false, error: '알 수 없는 key: ' + key });
          }
          return res.status(200).json({
            success: true, id: Number(id), saved_at: data.saved_at, saved_by: data.saved_by,
            key, value: snapshot[key] === undefined ? null : snapshot[key]
          });
        }

        const summary = {};
        Object.keys(snapshot).forEach(k => { summary[k] = describeValue(snapshot[k]); });
        return res.status(200).json({
          success: true, id: Number(id), saved_at: data.saved_at, saved_by: data.saved_by, summary
        });
      }

      const { data, error } = await supabase
        .from('app_data_history')
        .select('id, saved_at, saved_by')
        .order('saved_at', { ascending: false })
        .limit(30);

      if (error) throw error;
      return res.status(200).json({ success: true, snapshots: data });
    }

    // ── POST: 복원 ──
    if (req.method === 'POST') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'id 필요' });

      const { data, error } = await supabase
        .from('app_data_history')
        .select('snapshot, saved_at')
        .eq('id', id)
        .single();

      if (error || !data) throw error || new Error('스냅샷을 찾을 수 없습니다');

      const snapshot = data.snapshot;
      const now = new Date().toISOString();

      // 현재 데이터를 스냅샷으로 먼저 저장 (복원 전 백업)
      const { data: current } = await supabase.from('app_data').select('key, value');
      if (current && current.length > 0) {
        const curSnap = {};
        current.forEach(r => { curSnap[r.key] = r.value; });
        await supabase.from('app_data_history').insert({
          saved_by: '복원 전 자동 백업',
          snapshot: curSnap
        });
      }

      // app_data 전체 복원
      for (const key of DATA_KEYS) {
        if (snapshot[key] === undefined) continue;
        const { data: existing } = await supabase
          .from('app_data').select('key').eq('key', key).limit(1);
        if (existing && existing.length > 0) {
          await supabase.from('app_data')
            .update({ value: snapshot[key], updated_at: now }).eq('key', key);
        } else {
          await supabase.from('app_data')
            .insert({ key, value: snapshot[key], updated_at: now });
        }
      }

      // 30개 초과 스냅샷 정리
      const { data: old } = await supabase
        .from('app_data_history')
        .select('id')
        .order('saved_at', { ascending: false })
        .range(30, 9999);
      if (old && old.length > 0) {
        await supabase.from('app_data_history')
          .delete().in('id', old.map(r => r.id));
      }

      return res.status(200).json({ success: true, restoredFrom: data.saved_at });
    }

    return res.status(405).json({ error: '허용되지 않는 메서드' });

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
