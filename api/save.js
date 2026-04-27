// api/save.js - 데이터 저장
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

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
    const { employees, projects, dailyData, purchaseDB, mdEntries, lastModified, modifiedBy } = req.body;

    const tasks = [];
    if (employees    !== undefined) tasks.push(upsertKey('employees',    employees));
    if (projects     !== undefined) tasks.push(upsertKey('projects',     projects));
    if (dailyData    !== undefined) tasks.push(upsertKey('dailyData',    dailyData));
    if (purchaseDB   !== undefined) tasks.push(upsertKey('purchaseDB',   purchaseDB));
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
