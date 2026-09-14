// api/load.js - 데이터 불러오기
const { createClient } = require('@supabase/supabase-js');
const { readAll, isLive } = require('./_purchase');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

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

    const mdRaw = result.mdEntries;
    const mdArr = Array.isArray(mdRaw) ? mdRaw
                : (typeof mdRaw === 'string' ? (() => { try { const p = JSON.parse(mdRaw); return Array.isArray(p) ? p : []; } catch { return []; } })()
                : []);

    // 구매요청은 행 단위 테이블(purchase_items)이 있으면 그쪽이 원본이다.
    // 아직 테이블을 만들지 않았거나 이관 전이면 예전 app_data.purchaseDB를 그대로
    // 쓴다 — SQL 실행 전에 배포해도 앱이 멀쩡히 돌아가게 하기 위함.
    let purchaseDB = result.purchaseDB || [];
    let purchaseSource = 'app_data';
    if (await isLive(supabase)) {
      try {
        purchaseDB = await readAll(supabase);
        purchaseSource = 'purchase_items';
      } catch (e) {
        purchaseSource = 'app_data (purchase_items 읽기 실패: ' + e.message + ')';
      }
    }

    return res.status(200).json({
      success: true,
      _debug: {
        rowCount: data.length,
        keys: data.map(r => r.key),
        mdRawType: Array.isArray(mdRaw) ? 'array' : typeof mdRaw,
        mdLength: mdArr.length,
        purchaseSource,
        purchaseCount: purchaseDB.length
      },
      data: {
        employees:    result.employees    || [],
        projects:     result.projects     || [],
        dailyData:    result.dailyData    || {},
        purchaseDB,
        purchaseDrafts: result.purchaseDrafts || [],
        mdEntries:    mdArr,
        dailyReports: result.dailyReports || {},
        overtimeReports: result.overtimeReports || [],
        tbmRecords:   result.tbmRecords   || [],
        lastModified: result.lastModified || null,
        modifiedBy:   result.modifiedBy   || null
      }
    });

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
