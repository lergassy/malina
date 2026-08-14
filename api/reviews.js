// Malina Visa — живая лента Google-отзывов.
// Ключ хранится ТОЛЬКО в переменной окружения Vercel GOOGLE_PLACES_KEY.

const PLACE_ID = 'ChIJfbRP-49F0i0Rc0Hik27Qxd0';

const FALLBACK = {
  source: 'fallback',
  rating: 5.0,
  total: 101,
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
      { n: 'Ivan', d: 'Jun 2026', r: 5, t: 'Came in needing a visa "yesterday", with almost no time before the trip — and the application still got done in time.' },
      { n: 'Adil', d: 'Mar 2026', r: 5, t: 'A one-month extension with zero hassle: sent the documents, paid, and had the visa back three days later.' },
      { n: 'Miras', d: 'Nov 2025', r: 5, t: 'Support from start to finish — Matvey stayed in touch the whole way and walked through the entire process, ending in a successful one-year visa.' },
      { n: 'Radoslav', d: 'Nov 2025', r: 5, t: 'Clear, fast and friendly communication throughout the KITAS process — professional, flexible, and smooth from beginning to end.' }
    ]
  }
};

function fmtDate(iso, lang) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch (e) { return ''; }
}

async function fetchLangNew(key, lang) {
  const url = `https://places.googleapis.com/v1/places/${PLACE_ID}?languageCode=${lang}`;
  const resp = await fetch(url, {
    headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'rating,userRatingCount,reviews' }
  });
  const body = await resp.text();
  if (!resp.ok) throw new Error('new:' + resp.status + ':' + body.slice(0, 300));
  const data = JSON.parse(body);
  const reviews = (data.reviews || [])
    .filter(r => (r.rating || 0) >= 4 && r.text && r.text.text)
    .map(r => ({
      n: (r.authorAttribution && r.authorAttribution.displayName) || 'Google user',
      a: (r.authorAttribution && r.authorAttribution.photoUri) || '',
      d: fmtDate(r.publishTime, lang),
      r: r.rating || 5,
      t: r.text.text
    }));
  return { rating: data.rating, total: data.userRatingCount, reviews };
}

async function fetchLangLegacy(key, lang) {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${PLACE_ID}&fields=rating,user_ratings_total,reviews&language=${lang}&key=${key}`;
  const resp = await fetch(url);
  const data = await resp.json();
  if (data.status !== 'OK') throw new Error('legacy:' + data.status + ':' + (data.error_message || ''));
  const res = data.result || {};
  const reviews = (res.reviews || [])
    .filter(r => (r.rating || 0) >= 4 && r.text)
    .map(r => ({
      n: r.author_name || 'Google user',
      a: r.profile_photo_url || '',
      d: r.relative_time_description || '',
      r: r.rating || 5,
      t: r.text
    }));
  return { rating: res.rating, total: res.user_ratings_total, reviews };
}

async function fetchLang(key, lang, errors) {
  try { return await fetchLangNew(key, lang); }
  catch (e1) {
    errors.push(String(e1.message || e1));
    try { return await fetchLangLegacy(key, lang); }
    catch (e2) { errors.push(String(e2.message || e2)); throw e2; }
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');

  const debug = req.url && req.url.indexOf('debug=1') !== -1;
  const key = process.env.GOOGLE_PLACES_KEY;
  if (!key) {
    const out = Object.assign({}, FALLBACK);
    if (debug) out.err = ['NO_KEY: переменная GOOGLE_PLACES_KEY не видна функции'];
    return res.status(200).json(out);
  }

  const errors = [];
  try {
    const [ru, en] = await Promise.all([fetchLang(key, 'ru', errors), fetchLang(key, 'en', errors)]);
    if (!ru.reviews.length && !en.reviews.length) {
      const out = Object.assign({}, FALLBACK);
      if (debug) out.err = errors.slice(0, 4);
      return res.status(200).json(out);
    }
    return res.status(200).json({
      source: 'google',
      rating: ru.rating || en.rating || 5.0,
      total: ru.total || en.total || 101,
      reviews: {
        ru: ru.reviews.length ? ru.reviews : FALLBACK.reviews.ru,
        en: en.reviews.length ? en.reviews : FALLBACK.reviews.en
      }
    });
  } catch (e) {
    const out = Object.assign({}, FALLBACK);
    if (debug) out.err = errors.slice(0, 4);
    return res.status(200).json(out);
  }
};
