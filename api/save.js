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
    // [Phase1] purchaseDB, lastModified, modifiedBy 추가 지원
    const { employees, projects, dailyData, purchaseDB, lastModified, modifiedBy } = req.body;

    const now = new Date().toISOString();
    const updates = [];

    if (employees !== undefined) {
      updates.push({ key: 'employees', value: employees, updated_at: now });
    }
    if (projects !== undefined) {
      updates.push({ key: 'projects', value: projects, updated_at: now });
    }
    if (dailyData !== undefined) {
      updates.push({ key: 'dailyData', value: dailyData, updated_at: now });
    }
    // [Phase1] 구매요청 DB 저장
    if (purchaseDB !== undefined) {
      updates.push({ key: 'purchaseDB', value: purchaseDB, updated_at: now });
    }
    // [R2] 충돌 감지용 메타 저장
    if (lastModified !== undefined) {
      updates.push({
        key: 'lastModified',
        value: lastModified,
        updated_at: now
      });
    }
    if (modifiedBy !== undefined) {
      updates.push({
        key: 'modifiedBy',
        value: modifiedBy,
        updated_at: now
      });
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
