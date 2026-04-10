// api/save.js - 데이터 저장
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async (req, res) => {
  // CORS 허용
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용' });

  try {
    const { employees, projects, dailyData } = req.body;

    // 각 항목을 upsert (있으면 업데이트, 없으면 삽입)
    const updates = [];

    if (employees !== undefined) {
      updates.push({ key: 'employees', value: employees, updated_at: new Date().toISOString() });
    }
    if (projects !== undefined) {
      updates.push({ key: 'projects', value: projects, updated_at: new Date().toISOString() });
    }
    if (dailyData !== undefined) {
      updates.push({ key: 'dailyData', value: dailyData, updated_at: new Date().toISOString() });
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: '저장할 데이터 없음' });
    }

    const { error } = await supabase
      .from('app_data')
      .upsert(updates, { onConflict: 'key' });

    if (error) throw error;

    return res.status(200).json({
      success: true,
      savedAt: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
    });

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
