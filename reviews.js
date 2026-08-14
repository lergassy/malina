// Malina Visa — живая лента Google-отзывов.
// Ключ хранится ТОЛЬКО в переменной окружения Vercel GOOGLE_PLACES_KEY.
// Кэш: CDN Vercel держит ответ 6 часов (s-maxage), плюс сутки stale-while-revalidate.

const PLACE_ID = 'ChIJfbRP-49F0i0Rc0Hik27Qxd0'; // Malina Visa, Jimbaran

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
      { n: 'Ivan', d: 'Jun 2026', r: 5, t: 'Came in needing a visa “yesterday”, with almost no time before the trip — and the application still got done in time.' },
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

async function fetchLang(key, lang) {
  const url = `https://places.googleapis.com/v1/places/${PLACE_ID}?languageCode=${lang}`;
  const resp = await fetch(url, {
    headers: {
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'rating,userRatingCount,reviews'
    }
  });
  if (!resp.ok) throw new Error('places ' + resp.status);
  const data = await resp.json();
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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // кэш на CDN Vercel: 6 часов свежий, сутки — отдаём старое и обновляем фоном
  res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');

  const key = process.env.GOOGLE_PLACES_KEY;
  if (!key) return res.status(200).json(FALLBACK);

  try {
    const [ru, en] = await Promise.all([fetchLang(key, 'ru'), fetchLang(key, 'en')]);
    if (!ru.reviews.length && !en.reviews.length) return res.status(200).json(FALLBACK);
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
    return res.status(200).json(FALLBACK);
  }
};
