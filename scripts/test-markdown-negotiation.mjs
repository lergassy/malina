#!/usr/bin/env node
// Локальные тесты согласования типа контента.
// Поднимают статический сервер по папке репозитория, подставляют его вместо
// CDN и прогоняют обработчик netlify/edge-functions/markdown.js как на проде.
// Запуск: node scripts/html-to-md.mjs . && node scripts/test-markdown-negotiation.mjs

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import handler from '../netlify/edge-functions/markdown.js';

const ROOT = process.cwd();

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': path.endsWith('.md') ? 'text/markdown; charset=utf-8' : 'text/html; charset=utf-8' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
});

await new Promise((resolve) => server.listen(0, resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

// context.next() эмулирует поведение Netlify: страница есть — 200 HTML, нет — 404 HTML.
function makeContext(pathname) {
  return {
    async next() {
      const candidates = pathname === '/' ? ['/index.html'] : [pathname + '.html', pathname + '/index.html'];
      for (const c of candidates) {
        try {
          const body = await readFile(join(ROOT, c.slice(1)));
          return new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
        } catch { /* пробуем следующий вариант */ }
      }
      const notFound = await readFile(join(ROOT, '404.html'));
      return new Response(notFound, { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
  };
}

const call = (pathname, accept) =>
  handler(new Request(origin + pathname, { headers: { accept } }), makeContext(pathname));

const results = [];
const check = (name, condition, detail = '') => {
  results.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${name}${detail && !condition ? ` — ${detail}` : ''}`);
};

// 1. Главная по Accept: text/markdown отдаёт markdown с Vary: Accept
{
  const res = await call('/', 'text/markdown');
  const body = await res.text();
  check('homepage markdown: статус 200', res.status === 200, `получен ${res.status}`);
  check('homepage markdown: Content-Type', (res.headers.get('content-type') || '').startsWith('text/markdown'), res.headers.get('content-type'));
  check('homepage markdown: Vary: Accept', (res.headers.get('vary') || '').toLowerCase().includes('accept'), res.headers.get('vary'));
  check('homepage markdown: тело непустое', body.length > 500, `${body.length} символов`);
  check('homepage markdown: есть заголовок и ссылки', body.includes('# ') && body.includes('https://www.malinavisa.com'));
}

// 2. Главная по Accept: text/html остаётся HTML, но с Vary: Accept
{
  const res = await call('/', 'text/html,application/xhtml+xml');
  const body = await res.text();
  check('homepage html: статус 200', res.status === 200, `получен ${res.status}`);
  check('homepage html: Content-Type', (res.headers.get('content-type') || '').includes('text/html'), res.headers.get('content-type'));
  check('homepage html: Vary: Accept', (res.headers.get('vary') || '').toLowerCase().includes('accept'), res.headers.get('vary'));
  check('homepage html: это HTML', body.includes('<!DOCTYPE html') || body.includes('<html'));
}

// 3. Несуществующий адрес по markdown: 404 и markdown-тело с подсказками
{
  const res = await call('/__ora-404-probe-n3kktamy', 'text/markdown');
  const body = await res.text();
  check('404 markdown: статус 404', res.status === 404, `получен ${res.status}`);
  check('404 markdown: Content-Type', (res.headers.get('content-type') || '').startsWith('text/markdown'), res.headers.get('content-type'));
  check('404 markdown: объяснение длиннее 20 символов', body.replace(/\s+/g, ' ').trim().length > 20);
  check('404 markdown: ссылка на sitemap', body.includes('/sitemap.xml'));
  check('404 markdown: ссылка на llms.txt', body.includes('/llms.txt'));
}

// 4. Английская страница отдаёт английское зеркало
{
  const res = await call('/en', 'text/markdown');
  const body = await res.text();
  check('en markdown: статус 200', res.status === 200, `получен ${res.status}`);
  check('en markdown: язык в шапке', body.includes('language: en'));
}

// 5. Английский 404 объясняется по-английски
{
  const res = await call('/en/no-such-page', 'text/markdown');
  const body = await res.text();
  check('en 404: статус 404', res.status === 404, `получен ${res.status}`);
  check('en 404: текст на английском', body.includes('page not found'));
}

// 6. Обычный краулер без Accept ничего не ломает
{
  const res = await call('/price', '*/*');
  check('crawler */*: отдаётся HTML', (res.headers.get('content-type') || '').includes('text/html'), res.headers.get('content-type'));
}

server.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} проверок пройдено`);
process.exit(failed.length ? 1 : 0);
