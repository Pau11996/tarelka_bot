"""Validate the deploy-time static render using only Python's standard library."""
import csv
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

LANDING = Path(__file__).resolve().parents[1]
ORIGIN = 'https://tarelkaa.by'

class Page(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.ids, self.links, self.assets, self.schemas = [], [], [], []
        self.canonicals, self.titles, self.descriptions = [], [], []
        self.h1s = 0
        self._schema = None
        self._title = None
        self.feed(html)
    def handle_starttag(self, tag, pairs):
        a = dict(pairs)
        if 'id' in a: self.ids.append(a['id'])
        if tag == 'h1': self.h1s += 1
        if tag == 'a': self.links.append(a.get('href', ''))
        if tag == 'img':
            assert 'alt' in a, 'Image is missing alt'
            self.assets.append(a.get('src', ''))
        if tag == 'script':
            if a.get('type') == 'application/ld+json': self._schema = ''
            if 'src' in a: self.assets.append(a['src'])
        if tag == 'title': self._title = ''
        if tag == 'meta' and a.get('name') == 'description': self.descriptions.append(a.get('content', ''))
        if tag == 'link':
            if a.get('rel') == 'canonical': self.canonicals.append(a['href'])
            if a.get('rel') in ('stylesheet', 'icon'): self.assets.append(a['href'])
    def handle_data(self, value):
        if self._schema is not None: self._schema += value
        if self._title is not None: self._title += value
    def handle_endtag(self, tag):
        if tag == 'script' and self._schema is not None:
            self.schemas.append(json.loads(self._schema)); self._schema = None
        if tag == 'title' and self._title is not None:
            self.titles.append(self._title); self._title = None

@unittest.skipUnless(shutil.which('envsubst'), 'Install gettext/envsubst to test the nginx template render')
class StaticSiteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.site = Path(cls.temp.name) / 'site'
        shutil.copytree(LANDING / 'public', cls.site)
        env = {**os.environ, 'LANDING_RENDER_ONLY':'1', 'LANDING_PUBLIC_DIR':str(cls.site),
               'LANDING_ORIGIN':ORIGIN, 'LANDING_TITLE':'ТАРЕЛКА', 'FREE_DAILY_LIMIT':'7',
               'TELEGRAM_BOT_USERNAME':'example_test_bot', 'LANDING_BOT_USERNAME':'example_public_bot',
               'TELEGRAM_FEEDBACK_CHAT':'example_support', 'GA_MEASUREMENT_ID':'G-TESTMEASURE1'}
        subprocess.run(['sh', str(LANDING / 'docker-entrypoint.sh')], env=env, check=True)
        cls.pages = {}
        for template in cls.site.rglob('*.template.html'):
            p = template.with_name(template.name.replace('.template.html', '.html'))
            cls.pages[p] = Page(p.read_text())
    @classmethod
    def tearDownClass(cls): cls.temp.cleanup()

    def test_canonicals_sitemap_and_unique_metadata(self):
        titles, descriptions, canonicals = [], [], []
        for path, page in self.pages.items():
            with self.subTest(path=path.relative_to(self.site)):
                self.assertEqual(page.h1s, 1)
                self.assertEqual(len(page.canonicals), 1)
                self.assertEqual(len(page.titles), 1)
                self.assertEqual(len(page.descriptions), 1)
                self.assertNotRegex(path.read_text(), r'\$\{[A-Z_]+\}')
                self.assertEqual(len(page.ids), len(set(page.ids)))
                titles += page.titles; descriptions += page.descriptions; canonicals += page.canonicals
        self.assertEqual(len(titles), len(set(titles)))
        self.assertEqual(len(descriptions), len(set(descriptions)))
        sitemap = ET.parse(self.site / 'sitemap.xml')
        urls = [el.text for el in sitemap.findall('.//{*}loc')]
        self.assertCountEqual(urls, canonicals)
        self.assertEqual(len(urls), 8)
        self.assertIn('Sitemap: '+ORIGIN+'/sitemap.xml', (self.site / 'robots.txt').read_text())

    def test_internal_links_fragments_and_assets_resolve(self):
        for source, page in self.pages.items():
            for href in page.links + page.assets:
                url = urlsplit(href)
                if url.scheme or url.netloc: continue
                target = self.site / url.path.lstrip('/') if url.path else source
                if target.is_dir(): target /= 'index.html'
                with self.subTest(source=source.relative_to(self.site), href=href):
                    self.assertTrue(target.is_file(), target)
                    if url.fragment:
                        self.assertIn(url.fragment, Page(target.read_text()).ids)

    def test_structured_data_matches_visible_page(self):
        for path, page in self.pages.items():
            if path.name in ('privacy.html', 'terms.html'): continue
            self.assertEqual(len(page.schemas), 1)
            graph = page.schemas[0]['@graph']
            self.assertEqual(page.schemas[0]['@context'], 'https://schema.org')
            self.assertNotIn('AggregateRating', json.dumps(graph))
            for entity in graph:
                if entity['@type'] == 'BlogPosting':
                    self.assertEqual(entity['url'], page.canonicals[0])
                    self.assertEqual(entity['author']['@type'], 'Organization')
                    self.assertIn(entity['headline'], path.read_text())
                    for image in entity['image']:
                        self.assertTrue((self.site / urlsplit(image).path.lstrip('/')).is_file())
        # No dependence on hard-coded host, bot name, or free tier values.
        home = (self.site / 'index.html').read_text()
        self.assertIn('https://t.me/example_public_bot?start=landing_hero', home)
        for path, page in self.pages.items():
            self.assertNotIn('example_test_bot', path.read_text())
            if page.schemas:
                self.assertIn('https://t.me/example_public_bot', json.dumps(page.schemas))
        self.assertIn('data-bot-username="example_test_bot"', (self.site / 'admin.html').read_text())
        self.assertIn('7 разборов в день', home)
        self.assertIn('https://t.me/example_support', home)

    def test_calculator_progressive_enhancement_and_diary_csv(self):
        recipe = (self.site / 'blog/kalorijnost-gotovogo-blyuda/index.html').read_text()
        self.assertIn('<fieldset disabled data-calculator-controls>', recipe)
        self.assertIn('<noscript>', recipe)
        with (self.site / 'downloads/dnevnik-pitaniya.csv').open(encoding='utf-8-sig', newline='') as stream:
            rows = list(csv.reader(stream, delimiter=';'))
        self.assertEqual(len(rows), 22)
        self.assertTrue(all(len(row) == 12 for row in rows))
        self.assertEqual(rows[0][10], 'Источник расчёта')
        self.assertTrue(all(not cell for row in rows[1:] for cell in row[1:]))

    def test_google_tag_on_public_pages_only(self):
        tag = 'data-measurement-id="G-TESTMEASURE1"'
        for path in self.pages:
            text = path.read_text()
            with self.subTest(path=path.relative_to(self.site)):
                self.assertIn(tag, text)
                self.assertIn('src="/analytics.js?v=20261013"', text)
                self.assertNotIn('src="https://www.googletagmanager.com', text)
        self.assertIn(tag, (self.site / '404.html').read_text())
        self.assertNotIn('analytics.js', (self.site / 'admin.html').read_text())
        nginx = (LANDING / 'nginx.conf.template').read_text()
        self.assertIn("script-src 'self' https://www.googletagmanager.com", nginx)
        self.assertIn('https://www.google-analytics.com', nginx)
        admin_csp = nginx.split('location = /admin.html', 1)[1]
        self.assertIn("script-src 'self'", admin_csp)
        self.assertNotIn('googletagmanager', admin_csp)

    def test_csp_compatible_homepage(self):
        html = (self.site / 'index.html').read_text()
        self.assertNotRegex(html, r'\sstyle=')
        self.assertNotRegex(html, r'\son(click|load)=')
        self.assertNotRegex(html, r'<script(?![^>]*(?:src=|application/ld\+json))')

if __name__ == '__main__': unittest.main()
