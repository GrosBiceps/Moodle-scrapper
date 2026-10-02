#!/usr/bin/env python3
"""Scrape tous les fichiers de tous les cours Moodle auxquels tu es inscrit.

Usage:
    python moodle_scraper.py https://moodle.exemple.fr -u user -p pass
    python moodle_scraper.py https://moodle.exemple.fr --cookie MoodleSession_value   # SSO/CAS
    python moodle_scraper.py URL -u user --course 1234 --course 5678 -o downloads
"""
import argparse
import getpass
import json
import re
import sys
from pathlib import Path
from urllib.parse import unquote, urljoin, urlparse

import requests
from bs4 import BeautifulSoup

FILE_LINK = re.compile(r"/(pluginfile\.php|mod/(resource|folder)/view\.php)")


def safe(name: str) -> str:
    """Nom compatible Windows/Linux."""
    return re.sub(r'[<>:"/\|?*\x00-\x1f]', "_", name).strip(" .")[:120] or "_"


class Moodle:
    def __init__(self, base: str):
        self.base = base.rstrip("/")
        self.s = requests.Session()
        self.s.headers["User-Agent"] = "Mozilla/5.0 moodle-scraper"

    def url(self, path: str) -> str:
        return urljoin(self.base + "/", path)

    def soup(self, url: str) -> BeautifulSoup:
        r = self.s.get(url, timeout=60)
        r.raise_for_status()
        return BeautifulSoup(r.text, "html.parser")

    def login(self, user: str, password: str) -> None:
        page = self.soup(self.url("login/index.php"))
        data = {"username": user, "password": password}
        tok = page.find("input", {"name": "logintoken"})
        if tok:
            data["logintoken"] = tok["value"]
        r = self.s.post(self.url("login/index.php"), data=data, timeout=60)
        if "login/index.php" in r.url or "loginerrormessage" in r.text:
            sys.exit("Login échoué (SSO ? utilise --cookie).")

    def set_cookie(self, value: str) -> None:
        self.s.cookies.set("MoodleSession", value, domain=urlparse(self.base).hostname)

    def sesskey(self) -> str:
        r = self.s.get(self.url("my/"), timeout=60)
        m = re.search(r'"sesskey":"([^"]+)"', r.text)
        if not m:
            sys.exit("Pas connecté (sesskey introuvable).")
        return m.group(1)

    def courses(self) -> dict:
        """{id: nom} via l'API ajax interne, repli sur le scraping HTML."""
        key = self.sesskey()
        out = {}
        for cls in ("all", "inprogress", "past", "future"):
            payload = [{"index": 0, "methodname": "core_course_get_enrolled_courses_by_timeline_classification",
                        "args": {"offset": 0, "limit": 0, "classification": cls, "sort": "fullname"}}]
            try:
                r = self.s.post(self.url("lib/ajax/service.php"),
                                params={"sesskey": key, "info": payload[0]["methodname"]},
                                json=payload, timeout=60).json()
                for c in r[0]["data"]["courses"]:
                    out[int(c["id"])] = c["fullname"]
            except Exception:
                pass
        if not out:
            for a in self.soup(self.url("my/courses.php")).select('a[href*="course/view.php?id="]'):
                cid = int(re.search(r"id=(\d+)", a["href"]).group(1))
                out[cid] = a.get_text(strip=True) or f"course_{cid}"
        return out

    def download(self, url: str, folder: Path, seen: set) -> None:
        """Télécharge url; suit les pages intermédiaires (resource/folder)."""
        if url in seen:
            return
        seen.add(url)
        r = self.s.get(url, stream=True, timeout=60, allow_redirects=True)
        if r.status_code != 200:
            print(f"   ! {r.status_code} {url}")
            return
        ctype = r.headers.get("content-type", "")
        if "text/html" in ctype:  # page wrapper: chercher pluginfile dedans
            sp = BeautifulSoup(r.text, "html.parser")
            for a in sp.select('a[href*="pluginfile.php"]'):
                self.download(urljoin(r.url, a["href"].split("?forcedownload")[0] + ("?forcedownload=1" if "?" not in a["href"] else "")), folder, seen)
            return
        cd = r.headers.get("content-disposition", "")
        m = re.search(r"filename\*?=(?:UTF-8'')?\"?([^\";]+)", cd)
        name = unquote(m.group(1)) if m else unquote(Path(urlparse(r.url).path).name)
        dest = folder / safe(name)
        if dest.exists():
            print(f"   = {dest.name}")
            return
        folder.mkdir(parents=True, exist_ok=True)
        with open(dest, "wb") as f:
            for chunk in r.iter_content(1 << 16):
                f.write(chunk)
        print(f"   + {dest.name}")

    def scrape_course(self, cid: int, name: str, out: Path) -> None:
        print(f"\n== {name} ({cid})")
        sp = self.soup(self.url(f"course/view.php?id={cid}"))
        root = out / safe(name)
        seen: set = set()
        sections = sp.select("li.section, .course-section") or [sp]
        for sec in sections:
            title = sec.select_one(".sectionname, .section-title, h3")
            sdir = root / safe(title.get_text(strip=True) if title else "General")
            for a in sec.find_all("a", href=FILE_LINK):
                self.download(urljoin(self.base + "/", a["href"]), sdir, seen)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("url", help="URL de base Moodle")
    ap.add_argument("-u", "--user")
    ap.add_argument("-p", "--password")
    ap.add_argument("--cookie", help="valeur du cookie MoodleSession (SSO)")
    ap.add_argument("--course", type=int, action="append", help="ID de cours (répétable); défaut: tous")
    ap.add_argument("-o", "--out", default="downloads")
    a = ap.parse_args()

    m = Moodle(a.url)
    if a.cookie:
        m.set_cookie(a.cookie)
    else:
        user = a.user or input("Utilisateur: ")
        m.login(user, a.password or getpass.getpass("Mot de passe: "))

    courses = m.courses()
    if a.course:
        courses = {c: courses.get(c, f"course_{c}") for c in a.course}
    print(f"{len(courses)} cours")
    out = Path(a.out)
    out.mkdir(exist_ok=True)
    (out / "courses.json").write_text(json.dumps(courses, ensure_ascii=False, indent=1), encoding="utf-8")
    for cid, name in courses.items():
        try:
            m.scrape_course(cid, name, out)
        except Exception as e:
            print(f"   ! erreur cours {cid}: {e}")


if __name__ == "__main__":
    main()
