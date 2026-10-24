#!/usr/bin/env python3
"""Поставить карточку новой статьи первой в хабе блога и добавить её в карту сайта.

  python3 .tools/add-to-hub.py spec.json
"""
import json, re, sys, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
slug, date, build = spec['slug'], spec['date'], spec['build']

for lang, hub in (('ru', ROOT/'blog/index.html'), ('en', ROOT/'en/blog/index.html')):
    s = spec[lang]
    html = hub.read_text(encoding='utf-8')
    if f'/blog/{slug}"' in html:
        print(f'[{lang}] карточка уже есть, пропускаю'); continue
    href = f'/blog/{slug}' if lang == 'ru' else f'/en/blog/{slug}'
    card = (f'<a class="other-card" href="{href}">\n'
            f'  <span class="oc-tag">{s["card_tag"]}</span>\n'
            f'  <b>{s["card_title"]}</b>\n'
            f'  <span>{s["card_text"]}</span>\n'
            f'</a>\n')
    anchor = '<div class="other-grid" style="margin-top:34px">'
    if anchor not in html: raise SystemExit(f'[{lang}] не нашла сетку карточек')
    html = html.replace(anchor, anchor + card, 1)
    html = re.sub(r'<meta name="build" content="[^"]*">', f'<meta name="build" content="{build}">', html, count=1)
    hub.write_text(html, encoding='utf-8')
    print(f'[{lang}] карточка добавлена первой')

sm = ROOT/'sitemap.xml'
x = sm.read_text(encoding='utf-8')
added = 0
for u in (f'https://www.malinavisa.com/blog/{slug}', f'https://www.malinavisa.com/en/blog/{slug}'):
    if f'<loc>{u}</loc>' in x: continue
    row = f'<url><loc>{u}</loc><lastmod>{date}</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>\n'
    x = x.replace('</urlset>', row + '</urlset>', 1); added += 1
sm.write_text(x, encoding='utf-8')
print(f'карта сайта: добавлено адресов {added}')
