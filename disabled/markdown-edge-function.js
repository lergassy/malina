// Согласование типа контента для ИИ-агентов.
// Агент присылает Accept: text/markdown — отдаём markdown-версию страницы из /_md
// (её собирает scripts/html-to-md.mjs на сборке). Браузер просит text/html —
// всё работает как раньше, меняется только заголовок Vary.
// Протокол: https://acceptmarkdown.com

const SITE = 'https://www.malinavisa.com';

const MD_HEADERS = {
  'content-type': 'text/markdown; charset=utf-8',
  vary: 'Accept',
  'cache-control': 'public, max-age=0, must-revalidate',
  'netlify-cdn-cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400',
  'x-robots-tag': 'noindex'
};

function wantsMarkdown(accept) {
  if (!accept) return false;
  return accept
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .some((part) => part === 'text/markdown' || part.startsWith('text/markdown;') || part.startsWith('text/x-markdown'));
}

function mdPathFor(pathname) {
  let p = pathname.replace(/\/+$/, '');
  if (!p) return '/_md/index.md';
  if (p.endsWith('.html')) p = p.slice(0, -5);
  return '/_md' + p + '.md';
}

function notFoundBody(pathname) {
  const en = pathname.startsWith('/en');
  return en
    ? [
        '# 404 — page not found',
        '',
        `No page exists at \`${pathname}\` on ${SITE}. The address may be mistyped or the page may have moved.`,
        '',
        'Where to look next:',
        '',
        `- Full list of pages: ${SITE}/sitemap.xml`,
        `- Agent guide with when-to-use notes: ${SITE}/llms.txt`,
        `- Whole site as one text file: ${SITE}/llms-full.txt`,
        `- Home page: ${SITE}/en`,
        ''
      ].join('\n')
    : [
        '# 404 — страница не найдена',
        '',
        `По адресу \`${pathname}\` на ${SITE} страницы нет: возможно, в адресе опечатка или страница переехала.`,
        '',
        'Куда смотреть дальше:',
        '',
        `- Полный список страниц: ${SITE}/sitemap.xml`,
        `- Инструкция для агентов и когда нас звать: ${SITE}/llms.txt`,
        `- Весь сайт одним текстовым файлом: ${SITE}/llms-full.txt`,
        `- Главная страница: ${SITE}/`,
        ''
      ].join('\n');
}

function noMirrorBody(pathname) {
  return [
    '# ' + pathname,
    '',
    `Markdown-версии этой страницы нет. HTML-версия: ${SITE}${pathname}`,
    '',
    `- Карта сайта: ${SITE}/sitemap.xml`,
    `- Инструкция для агентов: ${SITE}/llms.txt`,
    ''
  ].join('\n');
}

export default async function handler(request, context) {
  try {
    return await negotiate(request, context);
  } catch (error) {
    // Любая ошибка согласования не должна ронять сайт: отдаём обычный ответ.
    console.error('markdown negotiation failed', error);
    return context.next();
  }
}

async function negotiate(request, context) {
  const url = new URL(request.url);

  if (!wantsMarkdown(request.headers.get('accept'))) {
    const response = await context.next();
    const type = response.headers.get('content-type') || '';
    if (!type.includes('text/html')) return response;
    const withVary = new Response(response.body, response);
    withVary.headers.set('Vary', 'Accept');
    return withVary;
  }

  const mirror = await fetch(new URL(mdPathFor(url.pathname), url.origin), {
    headers: { accept: 'text/plain' }
  });

  if (mirror.ok) {
    return new Response(await mirror.text(), { status: 200, headers: MD_HEADERS });
  }

  // Зеркала нет: смотрим, что вообще отвечает сайт по этому адресу.
  const original = await context.next();

  if (original.status >= 300 && original.status < 400) return original;

  if (original.status === 404) {
    return new Response(notFoundBody(url.pathname), { status: 404, headers: MD_HEADERS });
  }

  return new Response(noMirrorBody(url.pathname), { status: original.status, headers: MD_HEADERS });
}

export const config = {
  path: '/*',
  // Зеркало и статика мимо функции: иначе fetch за markdown уйдёт сам в себя.
  excludedPath: [
    '/_md/*',
    '/media/*',
    '/api/*',
    '/.netlify/*',
    '/*.xml',
    '/*.txt',
    '/*.json',
    '/*.js',
    '/*.css',
    '/*.png',
    '/*.jpg',
    '/*.jpeg',
    '/*.webp',
    '/*.svg',
    '/*.ico',
    '/*.mp4',
    '/*.woff2'
  ]
};
