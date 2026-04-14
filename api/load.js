// api/load.js - 데이터 불러오기
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async (req, res) => {
  // CORS 허용
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET만 허용' });

  try {
    const { data, error } = await supabase
      .from('app_data')
      .select('key, value');

    if (error) throw error;

    // key-value 형태로 변환
    const result = {};
    data.forEach(row => { result[row.key] = row.value; });

    return res.status(200).json({
      success: true,
      data: {
        employees:    result.employees    || [],
        projects:     result.projects     || [],
        dailyData:    result.dailyData    || {},
        // [Phase1] 구매요청 DB + 충돌 감지 메타 추가
        purchaseDB:   result.purchaseDB   || [],
        lastModified: result.lastModified || null,
        modifiedBy:   result.modifiedBy   || null
      }
    });

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
