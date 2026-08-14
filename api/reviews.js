// Malina Visa — живая лента Google-отзывов + диагностика.
const PLACE_ID = 'ChIJfbRP-49F0i0Rc0Hik27Qxd0';

const FALLBACK = {
  source: 'fallback', rating: 5.0, total: 101,
  reviews: {
    ru: [
      { n: 'Саша', d: 'июль 2026', r: 5, t: 'Ответ на визовый запрос пришёл за ночь: Матвей быстро всё оформил, подробно объяснил каждый шаг, а на въезде не возникло ни одного вопроса. На связи круглосуточно.' },
      { n: 'Иван', d: 'июнь 2026', r: 5, t: 'Виза была нужна «вчера», до поездки оставались считанные дни — и всё равно заявление успели подать вовремя.' },
      { n: 'Адиль', d: 'март 2026', r: 5, t: 'Продление на месяц без единой заминки: отправил документы, оплатил — через три дня виза была готова.' },
      { n: 'Мирас', d: 'ноябрь 2025', r: 5, t: 'Сопровождение от и до — Матвей был на связи весь процесс и провёл через все шаги, в итоге годовая виза успешно получена.' },
      { n: 'Радослав', d: 'ноябрь 2025', r: 5, t: 'Чёткая, быстрая и дружелюбная коммуникация на всём пути KITAS — профессионально, гибко и гладко от начала до конца.' }
    ],
    en: [
      { n: 'Sasha', d: 'Jul 2026', r: 5, t: 'A visa request answered overnight: Matvey sorted everything fast, explained each step in detail, and arrival went without a single question. Reachable around the clock.' },
      { n: 'Ivan', d: 'Jun 2026', r: 5, t: 'Came in needing a visa yesterday, with almost no time before the trip — and the application still got done in time.' },
      { n: 'Adil', d: 'Mar 2026', r: 5, t: 'A one-month extension with zero hassle: sent the documents, paid, and had the visa back three days later.' },
      { n: 'Miras', d: 'Nov 2025', r: 5, t: 'Support from start to finish — Matvey stayed in touch the whole way and walked through the entire process, ending in a successful one-year visa.' },
      { n: 'Radoslav', d: 'Nov 2025', r: 5, t: 'Clear, fast and friendly communication throughout the KITAS process — professional, flexible, and smooth from beginning to end.' }
    ]
  }
};

function fmtDate(iso, lang) {
  try { return new Date(iso).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch (e) { return ''; }
}

async function selfTest(key) {
  var out = { keyTail: key ? ('...' + key.slice(-6)) : null, keyLen: key ? key.length : 0 };
  try {
    var r1 = await fetch('https://places.googleapis.com/v1/places/' + PLACE_ID + '?languageCode=en',
      { headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'id,displayName' } });
    out.newStatus = r1.status; out.newBody = (await r1.text()).slice(0, 260);
  } catch (e) { out.newErr = String(e); }
  try {
    var r2 = await fetch('https://maps.googleapis.com/maps/api/place/details/json?place_id=' + PLACE_ID + '&fields=name&key=' + key);
    var j2 = await r2.json(); out.legacyStatus = j2.status; out.legacyMsg = j2.error_message || '';
  } catch (e) { out.legacyErr = String(e); }
  return out;
}

async function fetchNew(key, lang) {
  const r = await fetch('https://places.googleapis.com/v1/places/' + PLACE_ID + '?languageCode=' + lang,
    { headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'rating,userRatingCount,reviews' } });
  const body = await r.text();
  if (!r.ok) throw new Error('new:' + r.status);
  const d = JSON.parse(body);
  const reviews = (d.reviews || []).filter(x => (x.rating || 0) >= 4 && x.text && x.text.text).map(x => ({
    n: (x.authorAttribution && x.authorAttribution.displayName) || 'Google user',
    a: (x.authorAttribution && x.authorAttribution.photoUri) || '',
    d: fmtDate(x.publishTime, lang), r: x.rating || 5, t: x.text.text
  }));
  return { rating: d.rating, total: d.userRatingCount, reviews };
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  const key = process.env.GOOGLE_PLACES_KEY;

  if (req.url && req.url.indexOf('debug=1') !== -1) {
    return res.status(200).json({ diag: await selfTest(key) });
  }
  if (!key) return res.status(200).json(FALLBACK);
  try {
    const [ru, en] = await Promise.all([fetchNew(key, 'ru'), fetchNew(key, 'en')]);
    if (!ru.reviews.length && !en.reviews.length) return res.status(200).json(FALLBACK);
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    return res.status(200).json({
      source: 'google', rating: ru.rating || 5.0, total: ru.total || 101,
      reviews: { ru: ru.reviews.length ? ru.reviews : FALLBACK.reviews.ru, en: en.reviews.length ? en.reviews : FALLBACK.reviews.en }
    });
  } catch (e) { return res.status(200).json(FALLBACK); }
};
