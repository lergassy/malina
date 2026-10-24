#!/usr/bin/env python3
"""Собрать страницу блога Malina Visa из существующей как шаблона.

Вся обвязка (шапка, стили, футер, модалка, скрипты) берётся из образца без изменений —
меняются только мета-теги, три блока разметки schema.org, hreflang, хлебные крошки,
герой и тело статьи. Так новая статья гарантированно совпадает с остальными по вёрстке.

  python3 .tools/make-article.py spec.json
"""
import json, re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))

def build(lang):
    s = spec[lang]
    src = ROOT / ('blog' if lang == 'ru' else 'en/blog') / (spec['template'] + '.html')
    html = src.read_text(encoding='utf-8')
    slug = spec['slug']
    base = 'https://www.malinavisa.com'
    url = f"{base}/blog/{slug}" if lang == 'ru' else f"{base}/en/blog/{slug}"

    def sub(pat, rep, n=1):
        nonlocal html
        html, k = re.subn(pat, lambda _m: rep, html, count=n, flags=re.S)
        if k != n: raise SystemExit(f'[{lang}] не заменилось: {pat[:70]}')

    sub(r'<meta name="build" content="[^"]*">', f'<meta name="build" content="{spec["build"]}">')
    sub(r'<title>[^<]*</title>', f'<title>{s["title"]}</title>')
    sub(r'<meta name="description" content="[^"]*">', f'<meta name="description" content="{s["description"]}">')
    sub(r'<link rel="canonical" href="[^"]*">', f'<link rel="canonical" href="{url}">')
    sub(r'<meta property="og:url" content="[^"]*">', f'<meta property="og:url" content="{url}">')
    sub(r'<meta property="og:title" content="[^"]*">', f'<meta property="og:title" content="{s["title"]}">')
    sub(r'<meta property="og:description" content="[^"]*">', f'<meta property="og:description" content="{s["description"]}">')

    article = {"@context":"https://schema.org","@type":"Article","headline":s["headline"],
        "description":s["description"],"datePublished":spec["date"],"dateModified":spec["date"],
        "inLanguage":lang,"image":f"{base}/og-banner.jpg",
        "author":{"@type":"Organization","name":"Malina Visa","url":base},
        "publisher":{"@type":"Organization","name":"Malina Visa",
                     "logo":{"@type":"ImageObject","url":f"{base}/logo-surf.png"}},
        "mainEntityOfPage":url}
    faq = {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[
        {"@type":"Question","name":q,"acceptedAnswer":{"@type":"Answer","text":a}} for q,a in s["faq"]]}
    home = f"{base}/" if lang == 'ru' else f"{base}/en/"
    bl   = f"{base}/blog" if lang == 'ru' else f"{base}/en/blog"
    crumbs = {"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[
        {"@type":"ListItem","position":1,"name":s["home"],"item":home},
        {"@type":"ListItem","position":2,"name":s["blog"],"item":bl},
        {"@type":"ListItem","position":3,"name":s["crumb"],"item":url}]}
    j = lambda o: '<script type="application/ld+json">' + json.dumps(o, ensure_ascii=False) + '</script>'
    blocks = re.findall(r'<script type="application/ld\+json">.*?</script>', html, re.S)
    if len(blocks) != 3: raise SystemExit(f'[{lang}] ожидала 3 блока schema.org, нашла {len(blocks)}')
    for old, new in zip(blocks, [j(article), j(faq), j(crumbs)]):
        html = html.replace(old, new, 1)

    sub(r'<link rel="alternate" hreflang="ru" href="[^"]*">', f'<link rel="alternate" hreflang="ru" href="{base}/blog/{slug}">')
    sub(r'<link rel="alternate" hreflang="en" href="[^"]*">', f'<link rel="alternate" hreflang="en" href="{base}/en/blog/{slug}">')
    sub(r'<link rel="alternate" hreflang="x-default" href="[^"]*">', f'<link rel="alternate" hreflang="x-default" href="{base}/en/blog/{slug}">')

    hero = f'''<section class="page-hero"><div class="container">
    <div class="crumbs"><a href="{'/' if lang=='ru' else '/en/'}">{s["home"]}</a><span>/</span><a href="{'/blog' if lang=='ru' else '/en/blog'}">{s["blog"]}</a><span>/</span><span>{s["crumb"]}</span></div>
    <span class="eyebrow">{s["eyebrow"]}</span>
    <h1 style="margin-top:18px">{s["h1"]}</h1>
    <p style="color:var(--muted);margin-top:16px;max-width:660px;font-size:16.5px;line-height:1.65">{s["lede"]}</p>
    <p style="color:var(--muted);margin-top:12px;font-size:13.5px">{s["updated"]}</p>
  </div></section>'''
    sub(r'<section class="page-hero">.*?</div></section>', hero)

    start = html.index('<div class="page container">') + len('<div class="page container">')
    end = html.index('\n  </div>\n</main>')
    html = html[:start] + '\n\n' + s["body"].strip() + '\n' + html[end:]
    return html

for lang, folder in (('ru', 'blog'), ('en', 'en/blog')):
    out = ROOT / folder / (spec['slug'] + '.html')
    out.write_text(build(lang), encoding='utf-8')
    print('записано', out.relative_to(ROOT), len(out.read_text(encoding='utf-8')), 'байт')
