#!/usr/bin/env python3
"""Fetch the Google Scholar profile and write data/scholar.js.

Run weekly by .github/workflows/update-scholar.yml. Google Scholar blocks most
requests coming from cloud servers, so when the SERPAPI_KEY environment variable
is set the profile is read through SerpAPI (https://serpapi.com); otherwise the
Scholar page is fetched directly. The data file is only overwritten when the new
data passes sanity checks; otherwise the site keeps the last good data.
"""

import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

SCHOLAR_ID = "WHdCNq0AAAAJ"
BASE = "https://scholar.google.com"
PROFILE_URL = f"{BASE}/citations?user={SCHOLAR_ID}&hl=en"
SERPAPI_URL = "https://serpapi.com/search.json"
PAGE_SIZE = 100
MAX_PAGES = 10
MAX_DROP = 0.20  # refuse updates that lose more than 20% of publications

OUT = Path(__file__).resolve().parent.parent / "data" / "scholar.js"
PREFIX = "window.SCHOLAR = "

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/129.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}


class Blocked(Exception):
    pass


def clean(text):
    return re.sub(r"\s+", " ", text or "").strip()


# --- SerpAPI ---------------------------------------------------------------

def serpapi_page(session, key, start):
    params = {
        "engine": "google_scholar_author",
        "author_id": SCHOLAR_ID,
        "hl": "en",
        "num": PAGE_SIZE,
        "start": start,
        "api_key": key,
    }
    resp = session.get(SERPAPI_URL, params=params, timeout=60)
    if resp.status_code != 200:
        raise Blocked(f"SerpAPI HTTP {resp.status_code}")
    data = resp.json()
    if data.get("error"):
        raise Blocked(f"SerpAPI error: {data['error']}")
    return data


def serpapi_article(a):
    cited = a.get("cited_by") or {}
    value = cited.get("value")
    year = str(a.get("year") or "")
    venue = clean(a.get("publication"))
    if year:
        venue = re.sub(r",\s*" + re.escape(year) + r"$", "", venue)  # SerpAPI appends ", <year>"
    return {
        "title": clean(a.get("title")),
        "authors": clean(a.get("authors")),
        "venue": venue,
        "year": int(year) if year.isdigit() else None,
        "citations": int(value) if isinstance(value, int) or str(value or "").isdigit() else 0,
        "url": a.get("link") or PROFILE_URL,
        "cites_url": cited.get("link") if value else None,
    }


def fetch_serpapi(key):
    session = requests.Session()
    first = serpapi_page(session, key, 0)
    articles = first.get("articles") or []
    for page in range(1, MAX_PAGES):
        if len(articles) < page * PAGE_SIZE:
            break
        more = serpapi_page(session, key, page * PAGE_SIZE).get("articles") or []
        if not more:
            break
        articles.extend(more)

    table = (first.get("cited_by") or {}).get("table") or []
    metrics, since = {}, None
    for row in table:
        for name, values in row.items():
            recent_key = next((k for k in values if k.startswith("since_")), None)
            if recent_key:
                since = int(recent_key.split("_")[1])
            metrics[name] = {"all": int(values.get("all", 0)), "recent": int(values.get(recent_key, 0)) if recent_key else 0}
    if not all(k in metrics for k in ("citations", "h_index", "i10_index")):
        raise Blocked("SerpAPI response has no citation metrics")
    metrics["since_year"] = since

    graph = (first.get("cited_by") or {}).get("graph") or []
    counts = {int(g["year"]): int(g.get("citations", 0)) for g in graph if str(g.get("year", "")).isdigit()}
    years = range(min(counts), max(counts) + 1) if counts else []
    hist = [{"year": y, "count": counts.get(y, 0)} for y in years]

    interests = [clean(i.get("title")) for i in (first.get("author") or {}).get("interests") or []]
    return [serpapi_article(a) for a in articles], metrics, hist, interests


# --- Direct Scholar page (fallback) -----------------------------------------

def fetch_page(session, cstart):
    url = f"{PROFILE_URL}&cstart={cstart}&pagesize={PAGE_SIZE}"
    resp = session.get(url, headers=HEADERS, timeout=30)
    if resp.status_code != 200:
        raise Blocked(f"HTTP {resp.status_code} for {url}")
    text = resp.text
    if "gsc_a_t" not in text or re.search(r"captcha|unusual traffic", text, re.I):
        raise Blocked("Scholar returned a CAPTCHA or an unexpected page")
    return BeautifulSoup(text, "html.parser")


def parse_rows(soup):
    pubs = []
    for row in soup.select("tr.gsc_a_tr"):
        link = row.select_one("a.gsc_a_at")
        if not link:
            continue
        gray = row.select("div.gs_gray")
        venue_div = gray[1] if len(gray) > 1 else None
        if venue_div:
            for span in venue_div.select("span.gs_oph"):
                span.decompose()
        cites = row.select_one("a.gsc_a_ac")
        year = row.select_one("span.gsc_a_h")
        cites_text = clean(cites.get_text()) if cites else ""
        year_text = clean(year.get_text()) if year else ""
        pubs.append({
            "title": clean(link.get_text()),
            "authors": clean(gray[0].get_text()) if gray else "",
            "venue": clean(venue_div.get_text()) if venue_div else "",
            "year": int(year_text) if year_text.isdigit() else None,
            "citations": int(cites_text) if cites_text.isdigit() else 0,
            "url": urljoin(BASE, link.get("href", "")),
            "cites_url": cites.get("href") if cites and cites_text else None,
        })
    return pubs


def parse_metrics(soup):
    values = [int(td.get_text()) for td in soup.select("#gsc_rsb_st td.gsc_rsb_std")]
    if len(values) != 6:
        raise Blocked("Could not read the citation metrics table")
    since = None
    for th in soup.select("#gsc_rsb_st th.gsc_rsb_sth"):
        m = re.search(r"Since (\d{4})", th.get_text())
        if m:
            since = int(m.group(1))
    return {
        "since_year": since,
        "citations": {"all": values[0], "recent": values[1]},
        "h_index": {"all": values[2], "recent": values[3]},
        "i10_index": {"all": values[4], "recent": values[5]},
    }


def right_px(tag):
    m = re.search(r"right:(\d+)px", tag.get("style", ""))
    return int(m.group(1)) if m else None


def parse_histogram(soup):
    # Year labels and bars are positioned by their "right" offset; years with
    # zero citations have no bar, so match each bar to the nearest label.
    labels = {}
    for span in soup.select(".gsc_md_hist_b .gsc_g_t"):
        px = right_px(span)
        if px is not None and clean(span.get_text()).isdigit():
            labels[int(clean(span.get_text()))] = px
    counts = {}
    for bar in soup.select(".gsc_md_hist_b .gsc_g_a"):
        px, value = right_px(bar), bar.select_one(".gsc_g_al")
        if px is None or value is None or not labels:
            continue
        year = min(labels, key=lambda y: abs(labels[y] - (px - 5)))
        counts[year] = int(clean(value.get_text()))
    return [{"year": y, "count": counts.get(y, 0)} for y in sorted(labels)]


def fetch_direct():
    session = requests.Session()
    first = fetch_page(session, 0)
    pubs = parse_rows(first)
    for page in range(1, MAX_PAGES):
        if len(pubs) < page * PAGE_SIZE:
            break
        time.sleep(5)
        more = parse_rows(fetch_page(session, page * PAGE_SIZE))
        if not more:
            break
        pubs.extend(more)
    interests = [clean(a.get_text()) for a in first.select("#gsc_prf_int a")]
    return pubs, parse_metrics(first), parse_histogram(first), interests


# --- Output -----------------------------------------------------------------

def load_previous():
    if not OUT.exists():
        return None
    text = OUT.read_text(encoding="utf-8")
    start = text.find(PREFIX)
    if start < 0:
        return None
    body = text[start + len(PREFIX):].strip().rstrip(";")
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return None


def main():
    key = os.environ.get("SERPAPI_KEY", "").strip()
    pubs, metrics, hist, interests = fetch_serpapi(key) if key else fetch_direct()
    print(f"Source: {'SerpAPI' if key else 'Google Scholar page'}")

    seen, unique = set(), []
    for p in pubs:
        if p["url"] not in seen:
            seen.add(p["url"])
            unique.append(p)

    if not unique:
        raise Blocked("No publications parsed")

    previous = load_previous()
    if previous and previous.get("publications"):
        old = len(previous["publications"])
        if len(unique) < old * (1 - MAX_DROP):
            raise Blocked(f"Publication count dropped from {old} to {len(unique)}")

    data = {
        "source": "Google Scholar",
        "scholar_id": SCHOLAR_ID,
        "profile_url": PROFILE_URL,
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "interests": interests or (previous or {}).get("interests", []),
        "metrics": metrics,
        "citations_per_year": hist,
        "publications": unique,
    }

    payload = json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True)
    OUT.write_text(
        "// Generated automatically from Google Scholar. Do not edit by hand.\n"
        f"{PREFIX}{payload};\n",
        encoding="utf-8",
    )
    print(f"Updated: {len(unique)} publications, {metrics['citations']['all']} citations, "
          f"h-index {metrics['h_index']['all']}.")


if __name__ == "__main__":
    try:
        main()
    except (Blocked, requests.RequestException, ValueError, KeyError) as exc:
        # Keep the last good data; the workflow still succeeds.
        print(f"::warning::Scholar update skipped: {exc}")
        sys.exit(0)
