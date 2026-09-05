#!/usr/bin/env python3
"""
Сканер блогов конкурентов Malina Visa.

Собирает ТОЛЬКО метаданные публикаций: ссылка, заголовок, дата, источник.
Тела статей не загружает и не хранит — это структурная гарантия того,
что чужой текст физически не может попасть в нашу статью.
Имена авторов из лент вырезаются: персональные данные нам не нужны.

Использование:
    python3 scan.py            # показать, что нового с прошлого запуска
    python3 scan.py --days 30  # окно вручную (по умолчанию — с прошлого запуска)
    python3 scan.py --commit   # записать состояние (метка «просмотрено»)
"""
import argparse, html, json, os, re, subprocess, sys
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

STATE = os.path.expanduser("~/Desktop/claud/store/blog-radar/state.json")

# Источники подтверждены по датам публикаций 3 сентября 2026.
# Порог живого блога: между постами не больше 14 дней.
FEEDS = {
    "Cekindo (InCorp Indonesia)": "https://cekindo.com/feed/",
    "InvestInAsia":               "https://investinasia.id/blog/feed/",
    "Bizindo":                    "https://bizindo.com/feed/",
    "LetsMoveIndonesia":          "https://letsmoveindonesia.com/feed/",
    "Seven Stones Indonesia":     "https://sevenstonesindonesia.com/feed/",
    "ILA Global Consulting":      "https://ilaglobalconsulting.com/feed/",
    "IndoService":                "https://indoservice.co.id/feed/",
}
# Без RSS, но страница списка отдаётся сервером — разбираем HTML.
# Legal Indonesia: карточки <div class="post-card"> c датой ДД/ММ/ГГГГ,
# заголовком в .post-card__title и ссылкой на корневой слаг; список
# листается ?page=N. Проверено 4 сентября 2026.
HTML_SOURCES = {
    "Legal Indonesia": {"url": "https://legalindonesia.id/blog/", "parser": "legalindonesia", "pages": 2},
}
# Без RSS и без стабильной разметки — обойти браузером, см. SKILL.md
NO_FEED = {
    "Emerhub": "https://emerhub.com/blog/",
}

def fetch(url):
    try:
        r = subprocess.run(["curl", "-sL", "--max-time", "25", "-A", "Mozilla/5.0", url],
                           capture_output=True, text=True, timeout=40)
        return r.stdout
    except Exception:
        return ""

def clean(s):
    s = re.sub(r"<!\[CDATA\[(.*?)\]\]>", r"\1", s, flags=re.S)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s)
    return re.sub(r"\s+", " ", s).strip()

def parse_legalindonesia(page_html, base="https://legalindonesia.id"):
    """Карточки блога Legal Indonesia из серверного HTML."""
    out = []
    for card in re.findall(r'<div class="post-card">(.*?)</div><!--\]--></a></div>', page_html, re.S):
        href = re.search(r'href="([^"]+)"', card)
        date = re.search(r'<span>(\d{2})/(\d{2})/(\d{4})</span>', card)
        title = re.search(r'<span class="post-card__title">(.*?)</span>', card, re.S)
        if not (href and date and title):
            continue
        d, m, y = date.groups()
        out.append({"title": clean(title.group(1)),
                    "url": href.group(1) if href.group(1).startswith("http") else base + href.group(1),
                    "date": f"{y}-{m}-{d}"})
    return out

PARSERS = {"legalindonesia": parse_legalindonesia}

def parse_feed(xml):
    items = re.findall(r"<item>(.*?)</item>", xml, re.S) or re.findall(r"<entry>(.*?)</entry>", xml, re.S)
    out = []
    for it in items:
        t = re.search(r"<title>(.*?)</title>", it, re.S)
        l = re.search(r"<link[^>]*>(.*?)</link>", it, re.S) or re.search(r'<link[^>]*href="(.*?)"', it, re.S)
        d = (re.search(r"<pubDate>(.*?)</pubDate>", it, re.S)
             or re.search(r"<updated>(.*?)</updated>", it, re.S)
             or re.search(r"<published>(.*?)</published>", it, re.S))
        if not (t and d):
            continue
        raw = clean(d.group(1))
        try:
            dt = parsedate_to_datetime(raw)
        except Exception:
            try:
                dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            except Exception:
                continue
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        out.append({"title": clean(t.group(1)),
                    "url": clean(l.group(1)) if l else "",
                    "date": dt.astimezone(timezone.utc).strftime("%Y-%m-%d")})
    return out

def load_state():
    try:
        with open(STATE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"last_run": None, "seen_urls": [], "seen_titles": [], "written": []}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=None)
    ap.add_argument("--commit", action="store_true")
    ap.add_argument("--ignore-seen", action="store_true",
                    help="показать всё окно заново, не отфильтровывая уже просмотренное")
    a = ap.parse_args()

    st = load_state()
    seen = set() if a.ignore_seen else set(st.get("seen_urls", []))
    if a.days:
        since = datetime.now(timezone.utc) - timedelta(days=a.days)
    elif st.get("last_run"):
        since = datetime.fromisoformat(st["last_run"]) - timedelta(days=3)
    else:
        since = datetime.now(timezone.utc) - timedelta(days=14)
    since_s = since.strftime("%Y-%m-%d")

    fresh, all_urls, all_titles, dead = [], [], [], []
    sources = [(n, ("feed", u)) for n, u in FEEDS.items()] + \
              [(n, ("html", cfg)) for n, cfg in HTML_SOURCES.items()]
    for name, (kind, cfg) in sources:
        if kind == "feed":
            items = parse_feed(fetch(cfg))
        else:
            items = []
            for page in range(1, cfg.get("pages", 1) + 1):
                url = cfg["url"] if page == 1 else f"{cfg['url']}?page={page}"
                items += PARSERS[cfg["parser"]](fetch(url))
        if not items:
            dead.append(name)
            continue
        for it in items:
            all_urls.append(it["url"])
            all_titles.append(it["title"])
            if it["date"] >= since_s and it["url"] not in seen:
                fresh.append({**it, "source": name})

    fresh.sort(key=lambda x: x["date"], reverse=True)

    print(f"# Радар блогов конкурентов — с {since_s}\n")
    if dead:
        print(f"Ленты не ответили: {', '.join(dead)} — проверить вручную.\n")
    print(f"Новых публикаций: {len(fresh)}\n")
    for it in fresh:
        print(f"{it['date']}  [{it['source']}]  {it['title']}\n            {it['url']}")
    print("\n## Без RSS — обойти браузером:")
    for n, u in NO_FEED.items():
        print(f"  {n}: {u}")
    if st.get("written"):
        print("\n## Уже написано нами (не повторять):")
        for w in st["written"][-15:]:
            print(f"  {w}")

    if a.commit:
        os.makedirs(os.path.dirname(STATE), exist_ok=True)
        st["last_run"] = datetime.now(timezone.utc).isoformat()
        st["seen_urls"] = sorted(set(list(seen) + all_urls))[-1500:]
        st["seen_titles"] = sorted(set(st.get("seen_titles", []) + all_titles))[-1500:]
        with open(STATE, "w", encoding="utf-8") as f:
            json.dump(st, f, ensure_ascii=False, indent=2)
        print(f"\nСостояние записано: {STATE}")

if __name__ == "__main__":
    main()
