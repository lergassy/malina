#!/usr/bin/env node
// Проверка живого сайта по требованиям к «читаемости для агентов».
// Запуск: node scripts/verify-agent-readiness.mjs [https://www.malinavisa.com]

const BASE = (process.argv[2] || 'https://www.malinavisa.com').replace(/\/+$/, '');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const get = async (path, accept) => {
  const res = await fetch(BASE + path, { headers: accept ? { accept } : {}, redirect: 'follow' });
  return { res, body: await res.text() };
};

// 1. Согласование markdown на главной
{
  const { res, body } = await get('/', 'text/markdown');
  const ct = res.headers.get('content-type') || '';
  check('главная, Accept: text/markdown → 200', res.status === 200, String(res.status));
  check('главная, Accept: text/markdown → Content-Type', ct.startsWith('text/markdown'), ct);
  check('главная, Accept: text/markdown → Vary: Accept', (res.headers.get('vary') || '').toLowerCase().includes('accept'), res.headers.get('vary'));
  check('главная, markdown-тело непустое', body.trim().length > 500, `${body.length} символов`);
  check('главная, markdown без HTML-разметки', !/<(div|section|script)\b/i.test(body));
}

// 2. HTML не сломан
{
  const { res, body } = await get('/', 'text/html,application/xhtml+xml');
  const ct = res.headers.get('content-type') || '';
  check('главная, Accept: text/html → HTML', res.status === 200 && ct.includes('text/html'), `${res.status} ${ct}`);
  check('главная, HTML содержит разметку страницы', body.includes('<main'));
  check('главная, HTML отдаёт Vary: Accept', (res.headers.get('vary') || '').toLowerCase().includes('accept'), res.headers.get('vary'));
}

// 3. 404 для агентов
{
  const path = '/__agent-404-probe-' + Math.random().toString(36).slice(2, 10);
  const { res, body } = await get(path, 'text/markdown');
  const ct = res.headers.get('content-type') || '';
  check('несуществующий адрес, markdown → 404', res.status === 404, String(res.status));
  check('несуществующий адрес, markdown → Content-Type', ct.startsWith('text/markdown'), ct);
  check('404 markdown: объяснение длиннее 20 символов', body.replace(/\s+/g, ' ').trim().length > 20);
  check('404 markdown: ссылка на sitemap.xml', body.includes('/sitemap.xml'));
  check('404 markdown: ссылка на llms.txt', body.includes('/llms.txt'));

  const html = await get(path, 'text/html');
  check('несуществующий адрес, html → 404', html.res.status === 404, String(html.res.status));
}

// 4. Инструкция для агентов
{
  const { res, body } = await get('/llms.txt');
  check('llms.txt доступен', res.status === 200, String(res.status));
  check('llms.txt: есть раздел «когда обращаться»', /when to use this/i.test(body));
  check('llms.txt: названы конкретные задачи', /КИТАС/.test(body) && /PT PMA/.test(body));
  check('llms.txt: сказано, когда мы не нужны', /Когда мы не нужны|When not to use/i.test(body));
  check('llms.txt: сказано, как нас позвать', /WhatsApp/.test(body) && /t\.me\/malinavisa/.test(body));
}

// 5. JSON-LD на главной
{
  const { body } = await get('/', 'text/html');
  const blocks = [...body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  let org = null;
  for (const b of blocks) {
    try {
      const parsed = JSON.parse(b[1]);
      for (const node of Array.isArray(parsed) ? parsed : [parsed]) {
        const type = node['@type'];
        if (type === 'Organization' || (Array.isArray(type) && type.includes('Organization'))) org = node;
      }
    } catch (e) {
      check('JSON-LD парсится', false, e.message);
    }
  }
  check('на главной есть Organization JSON-LD', Boolean(org));
  if (org) {
    check('Organization: name', Boolean(org.name));
    check('Organization: description', typeof org.description === 'string' && org.description.length > 20);
    check('Organization: url', Boolean(org.url));
    check('Organization: address (PostalAddress)', org.address && org.address['@type'] === 'PostalAddress');
    const cp = Array.isArray(org.contactPoint) ? org.contactPoint[0] : org.contactPoint;
    check('Organization: contactPoint с типом контакта', Boolean(cp && cp.contactType));
    check('Organization: contactPoint с телефоном или почтой', Boolean(cp && (cp.telephone || cp.email)));
    check('Organization: sameAs', Array.isArray(org.sameAs) && org.sameAs.length > 0);
  }
}

// 6. Ключевые страницы отдают markdown
for (const path of ['/price', '/contacts', '/en', '/blog/bali-visa-guide']) {
  const { res, body } = await get(path, 'text/markdown');
  const ct = res.headers.get('content-type') || '';
  check(`${path} → markdown`, res.status === 200 && ct.startsWith('text/markdown') && body.length > 300, `${res.status} ${ct} ${body.length}б`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} проверок пройдено на ${BASE}`);
process.exit(failed.length ? 1 : 0);
