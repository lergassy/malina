#!/usr/bin/env node
// Пересобирает llms-full.txt из markdown-зеркала /_md, чтобы файл всегда был
// свежим. Запускается на сборке Netlify сразу после scripts/html-to-md.mjs.

import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.argv[2] || '.';
const MD = join(ROOT, '_md');
const OUT = join(ROOT, 'llms-full.txt');
const RULE = '='.repeat(70);

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const today = new Date();
const stamp = `${today.getDate()} ${MONTHS[today.getMonth()]} ${today.getFullYear()}`;

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (entry.endsWith('.md')) acc.push(p);
  }
  return acc;
}

function parse(file) {
  const raw = readFileSync(file, 'utf8');
  const m = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  if (!m) return null;
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = /^(\w+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let value = kv[2].trim();
    if (value.startsWith('"')) { try { value = JSON.parse(value); } catch { /* оставляем как есть */ } }
    meta[kv[1]] = value;
  }
  // тело без служебной приписки в конце
  let body = raw.slice(m[0].length).trim();
  const tail = body.lastIndexOf('\n---\n');
  if (tail > 0 && /Markdown[- ]version|Markdown-версия/.test(body.slice(tail))) body = body.slice(0, tail).trim();
  return { meta, body };
}

const pages = walk(MD)
  .map(parse)
  .filter((p) => p && p.meta.url && p.body)
  .sort((a, b) => a.meta.url.localeCompare(b.meta.url));

const header = [
  '# Malina Visa — полный текстовый индекс сайта / full text index',
  '> PT SOLUSI VISA MUDAH PRIMA (бренд Malina Visa, NPWP 10.000.000.9-755.604).',
  '> Визовое агентство на Бали: оформление и продление виз, КИТАС, PT PMA, визы в третьи страны.',
  '> Офис: Jl. Karang Mas, Bhuana Gubug, Джимбаран, Бали. WhatsApp +62 819-5838-6755.',
  '> Цены под ключ; государственная пошлина всегда указана отдельно от комиссии агентства.',
  `> Обновлено: ${stamp}. Собрано автоматически из ${pages.length} страниц. Источник: https://www.malinavisa.com/sitemap.xml`,
  '> Когда обращаться и как нас позвать: https://www.malinavisa.com/llms.txt',
  '> Любую страницу можно получить в markdown с заголовком Accept: text/markdown.',
  '',
  ''
].join('\n');

const body = pages
  .map((p) => [RULE, `URL: ${p.meta.url}`, `TITLE: ${p.meta.title || ''}`, RULE, '', p.body, '', ''].join('\n'))
  .join('\n');

writeFileSync(OUT, header + '\n' + body);
console.log(`build-llms-full: ${pages.length} страниц -> ${OUT}`);
