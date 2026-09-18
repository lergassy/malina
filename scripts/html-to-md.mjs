#!/usr/bin/env node
// Собирает markdown-зеркало сайта в папку _md/.
// Нужно для согласования типа контента: агент просит Accept: text/markdown,
// пограничная функция netlify/edge-functions/markdown.js отдаёт готовый файл отсюда.
// Запускается на сборке Netlify, зависимостей нет.

import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const ROOT = process.argv[2] || '.';
const OUT = join(ROOT, '_md');
const SITE = 'https://www.malinavisa.com';

const SKIP_DIRS = new Set(['.git', '_md', 'netlify', 'node_modules', 'media', 'scripts', 'api']);
const SKIP_FILES = /^(google[0-9a-f]+|yandex_[0-9a-f]+)\.html$/;

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const DROP = new Set(['script', 'style', 'noscript', 'svg', 'template', 'iframe', 'canvas', 'form', 'select', 'option']);
const BLOCK = new Set(['address', 'article', 'aside', 'blockquote', 'details', 'div', 'dd', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul']);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', mdash: '—', ndash: '–', hellip: '…', middot: '·', deg: '°', times: '×', rarr: '→', bull: '•' };

function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

// --- разбор тегов -----------------------------------------------------------

function* tokens(html) {
  const re = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>])*)>/g;
  let last = 0, m;
  while ((m = re.exec(html))) {
    if (m.index > last) yield { type: 'text', value: html.slice(last, m.index) };
    last = re.lastIndex;
    if (m[0].startsWith('<!--')) continue;
    const name = m[1].toLowerCase();
    const closing = m[0][1] === '/';
    const selfClosing = m[0].endsWith('/>') || VOID.has(name);
    yield { type: closing ? 'close' : 'open', name, attrs: m[2] || '', selfClosing };
  }
  if (last < html.length) yield { type: 'text', value: html.slice(last) };
}

function attr(attrs, name) {
  const m = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs);
  if (!m) return null;
  return decode(m[2] ?? m[3] ?? m[4] ?? '');
}

function absolute(href) {
  if (!href) return null;
  if (/^(https?:|mailto:|tel:)/i.test(href)) return href;
  if (href.startsWith('#') || href.startsWith('javascript:')) return null;
  if (href.startsWith('/')) return SITE + href;
  return SITE + '/' + href.replace(/^\.\//, '');
}

// --- конвертация ------------------------------------------------------------

function extractMain(html) {
  const open = /<main\b[^>]*>/i.exec(html);
  if (!open) return null;
  let depth = 0, i = open.index;
  const re = /<\/?main\b[^>]*>/gi;
  re.lastIndex = open.index;
  let m;
  while ((m = re.exec(html))) {
    depth += m[0][1] === '/' ? -1 : 1;
    if (depth === 0) return html.slice(open.index + open[0].length, m.index);
    i = re.lastIndex;
  }
  return html.slice(open.index + open[0].length, i);
}

function convert(main) {
  const out = [];
  let inline = '';
  let listStack = [];
  let dropDepth = 0;
  let headingLevel = 0;
  let linkHref = null, linkStart = 0, linkBlock = false;
  let cellBuffer = null, rowBuffer = null, tableRows = null;

  const flush = () => {
    let text = inline.replace(/\s+/g, ' ').replace(/\u00a0/g, ' ').trim();
    inline = '';
    if (linkHref) { linkBlock = true; linkStart = 0; }
    if (!text) return;
    if (cellBuffer !== null) { cellBuffer = text; return; }
    if (headingLevel) { out.push('#'.repeat(headingLevel) + ' ' + text); return; }
    if (listStack.length) {
      const marker = listStack[listStack.length - 1] === 'ol' ? '1. ' : '- ';
      out.push('  '.repeat(listStack.length - 1) + marker + text);
      return;
    }
    out.push(text);
  };

  for (const t of tokens(main)) {
    if (t.type === 'text') {
      if (dropDepth) continue;
      inline += decode(t.value);
      continue;
    }
    const n = t.name;
    // Внутри отброшенного поддерева считаем вложенность, чтобы выйти на его закрытии.
    if (dropDepth) {
      if (t.type === 'open' && !t.selfClosing) dropDepth++;
      else if (t.type === 'close' && !VOID.has(n)) dropDepth--;
      continue;
    }
    if (DROP.has(n)) { if (t.type === 'open' && !t.selfClosing) dropDepth = 1; continue; }

    if (t.type === 'open') {
      if (attr(t.attrs, 'aria-hidden') === 'true' && !t.selfClosing) { dropDepth = 1; continue; }
      if (n === 'br') { flush(); continue; }
      if (n === 'img') {
        const src = absolute(attr(t.attrs, 'src'));
        const alt = attr(t.attrs, 'alt');
        if (src && alt) { flush(); out.push(`![${alt}](${src})`); }
        continue;
      }
      if (n === 'hr') { flush(); out.push('---'); continue; }
      if (BLOCK.has(n)) flush();
      if (/^h[1-6]$/.test(n)) headingLevel = Number(n[1]);
      else if (n === 'ul' || n === 'ol') listStack.push(n);
      else if (n === 'table') { tableRows = []; }
      else if (n === 'tr' && tableRows) rowBuffer = [];
      else if ((n === 'td' || n === 'th') && rowBuffer) cellBuffer = '';
      else if (n === 'a') { linkHref = absolute(attr(t.attrs, 'href')); linkStart = inline.length; linkBlock = false; }
      else if (n === 'strong' || n === 'b') inline += '**';
      else if (n === 'em' || n === 'i') inline += '*';
      continue;
    }

    // close
    if (n === 'a') {
      if (linkHref && linkBlock) {
        // Ссылка обёрнута вокруг блочной карточки: отдаём её отдельной строкой.
        const text = inline.replace(/\s+/g, ' ').trim();
        inline = '';
        out.push(`[${text || 'Подробнее'}](${linkHref})`);
      } else if (linkHref) {
        const text = inline.slice(linkStart).trim();
        if (text) inline = inline.slice(0, linkStart) + `[${text}](${linkHref})`;
      }
      linkHref = null; linkBlock = false;
      continue;
    }
    if (n === 'strong' || n === 'b') { inline += '**'; continue; }
    if (n === 'em' || n === 'i') { inline += '*'; continue; }
    if (/^h[1-6]$/.test(n)) { flush(); headingLevel = 0; continue; }
    if (n === 'ul' || n === 'ol') { flush(); listStack.pop(); continue; }
    if (n === 'td' || n === 'th') { flush(); if (rowBuffer) rowBuffer.push(cellBuffer || ''); cellBuffer = null; continue; }
    if (n === 'tr') {
      if (tableRows && rowBuffer && rowBuffer.some(Boolean)) tableRows.push(rowBuffer);
      rowBuffer = null; continue;
    }
    if (n === 'table') {
      flush();
      if (tableRows && tableRows.length) {
        const width = Math.max(...tableRows.map((r) => r.length));
        const pad = (r) => Array.from({ length: width }, (_, i) => (r[i] || '').replace(/\|/g, '\\|'));
        const rows = ['| ' + pad(tableRows[0]).join(' | ') + ' |', '| ' + Array(width).fill('---').join(' | ') + ' |'];
        for (const r of tableRows.slice(1)) rows.push('| ' + pad(r).join(' | ') + ' |');
        out.push(rows.join('\n'));
      }
      tableRows = null; continue;
    }
    if (BLOCK.has(n)) flush();
  }
  flush();

  // схлопываем повторы и склеиваем в текст
  const lines = [];
  for (const line of out) {
    if (line === lines[lines.length - 1]) continue;
    lines.push(line);
  }
  return lines.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

// --- обход файлов -----------------------------------------------------------

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) walk(p, acc);
    } else if (entry.endsWith('.html') && !SKIP_FILES.test(entry)) acc.push(p);
  }
  return acc;
}

function urlPath(file) {
  let p = '/' + relative(ROOT, file).replace(/\\/g, '/');
  p = p.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
  if (p !== '/' && p.endsWith('/')) p = p.slice(0, -1);
  return p || '/';
}

function head(html, re) {
  const m = re.exec(html);
  return m ? decode(m[1]).trim() : '';
}

rmSync(OUT, { recursive: true, force: true });

const files = walk(ROOT).sort();
let written = 0;
for (const file of files) {
  const html = readFileSync(file, 'utf8');
  const main = extractMain(html);
  if (!main) continue;
  const path = urlPath(file);
  const lang = /<html[^>]*\blang="en"/i.test(html) ? 'en' : 'ru';
  const title = head(html, /<title>([\s\S]*?)<\/title>/i);
  const desc = head(html, /<meta\s+name="description"\s+content="([^"]*)"/i);
  const body = convert(main);
  if (process.env.MD_DEBUG) console.error(`debug ${file} -> ${path} main=${main.length} body=${body.length}`);
  if (body.length < 40) continue;

  const notice = lang === 'en'
    ? `Markdown version of ${SITE}${path}. Full site map: ${SITE}/sitemap.xml · agent guide: ${SITE}/llms.txt`
    : `Markdown-версия страницы ${SITE}${path}. Карта сайта: ${SITE}/sitemap.xml · инструкция для агентов: ${SITE}/llms.txt`;

  const md = [
    '---',
    `title: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(desc)}`,
    `url: ${SITE}${path}`,
    `language: ${lang}`,
    '---',
    '',
    /^#{1,2} /m.test(body) ? body : `# ${title}\n\n${body}`,
    '',
    '---',
    '',
    notice,
    ''
  ].join('\n');

  const rel = path === '/' ? '/index' : path;
  const outFile = join(OUT, rel + '.md');
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, md);
  written++;
}

console.log(`html-to-md: ${written} markdown files -> ${OUT}`);
