// api/save.js - 데이터 저장
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function saveSnapshot(modifiedBy) {
  try {
    const { data: rows, error } = await supabase.from('app_data').select('key, value');
    if (error || !rows || rows.length === 0) return;
    const snapshot = {};
    rows.forEach(r => { snapshot[r.key] = r.value; });
    await supabase.from('app_data_history').insert({
      saved_by: modifiedBy || '알 수 없음',
      snapshot
    });
    // 30개 초과분 삭제
    const { data: old } = await supabase
      .from('app_data_history')
      .select('id')
      .order('saved_at', { ascending: false })
      .range(30, 9999);
    if (old && old.length > 0) {
      await supabase.from('app_data_history').delete().in('id', old.map(r => r.id));
    }
  } catch (_) { /* 스냅샷 실패해도 저장은 계속 */ }
}

async function upsertKey(key, value) {
  const now = new Date().toISOString();

  // 기존 행 존재 여부 확인 (중복 행 대비 limit 1)
  const { data: rows, error: selErr } = await supabase
    .from('app_data')
    .select('key')
    .eq('key', key)
    .limit(1);

  if (selErr) throw selErr;

  if (rows && rows.length > 0) {
    const { error } = await supabase
      .from('app_data')
      .update({ value, updated_at: now })
      .eq('key', key);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('app_data')
      .insert({ key, value, updated_at: now });
    if (error) throw error;
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용' });

  try {
    const { employees, projects, dailyData, purchaseDB, purchaseDrafts, mdEntries, lastModified, modifiedBy } = req.body;

    // 실질 데이터 변경 시에만 스냅샷 저장
    const hasRealData = employees !== undefined || projects !== undefined || dailyData !== undefined;
    if (hasRealData) await saveSnapshot(modifiedBy);

    const tasks = [];
    if (employees    !== undefined) tasks.push(upsertKey('employees',    employees));
    if (projects     !== undefined) tasks.push(upsertKey('projects',     projects));
    if (dailyData    !== undefined) tasks.push(upsertKey('dailyData',    dailyData));
    if (purchaseDB   !== undefined) tasks.push(upsertKey('purchaseDB',   purchaseDB));
    if (purchaseDrafts !== undefined) tasks.push(upsertKey('purchaseDrafts', purchaseDrafts));
    if (mdEntries    !== undefined) tasks.push(upsertKey('mdEntries',    mdEntries));
    if (lastModified !== undefined) tasks.push(upsertKey('lastModified', lastModified));
    if (modifiedBy   !== undefined) tasks.push(upsertKey('modifiedBy',   modifiedBy));

    if (tasks.length === 0) {
      return res.status(400).json({ success: false, error: '저장할 데이터 없음' });
    }

    await Promise.all(tasks);

    // 저장 후 mdEntries 건수 검증
    let savedCount = null;
    if (mdEntries !== undefined) {
      const { data } = await supabase
        .from('app_data')
        .select('value')
        .eq('key', 'mdEntries')
        .maybeSingle();
      const val = data?.value;
      savedCount = Array.isArray(val) ? val.length : (typeof val === 'string' ? val.length : -1);
    }

    return res.status(200).json({
      success: true,
      savedAt: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
      savedCount
    });

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
