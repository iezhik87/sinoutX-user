"""One diagnostic request in a fresh browser; no application keys or raw page data."""
import argparse
import json
import os
import sys
import time
from pathlib import Path

# /app in the container; the local path supports checking with installed Edge.
sys.path.insert(0, str(Path('/app') if Path('/app/server.py').exists() else Path(__file__).resolve().parents[1] / 'search-browser'))
from server import EXTRACT, allowed_resource, error_code, search_url
from playwright.sync_api import sync_playwright, Error as PlaywrightError


DETAILS = r"""() => {
  const candidates = [...document.querySelectorAll('#b_results li.b_algo')].slice(0, 3).map(el => {
    const a = el.querySelector('h2 a');
    const hiddenBy = [];
    for (let node = a || el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const reasons = [];
      if (style.display === 'none') reasons.push('display:none');
      if (style.visibility !== 'visible') reasons.push('visibility:' + style.visibility);
      if (style.opacity === '0') reasons.push('opacity:0');
      if (node.hidden) reasons.push('hidden');
      if (node.getAttribute('aria-hidden') === 'true') reasons.push('aria-hidden');
      if (reasons.length) hiddenBy.push({tag: node.tagName, reasons});
    }
    return {hasAnchor: !!a, title: (a?.textContent || '').trim().slice(0, 180),
      rectangles: a?.getClientRects().length || 0, hiddenBy};
  });
  return {visibleText: (document.body?.innerText || '').slice(0, 1500), candidates};
}"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('engine', choices=['bing', 'google', 'duckduckgo'], default='bing', nargs='?')
    parser.add_argument('--filtered', action='store_true', help='Apply the production resource filter')
    parser.add_argument('--details', action='store_true', help='Include visible text and hidden-element reasons for the fixed public query')
    parser.add_argument('--screenshot', action='store_true', help='Save /tmp/sinout-search-probe.png in the container')
    args = parser.parse_args()
    started = time.monotonic()
    stats = dict(engine=args.engine, mode='filtered' if args.filtered else 'standard', documentResponses=0, failedDocuments=0, failedScripts=0, blockedScripts=0)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel=os.environ.get('BROWSER_TEST_CHANNEL', 'chromium'), timeout=8000)
        context = browser.new_context(locale='ru-RU', accept_downloads=False, service_workers='block')
        page = context.new_page()
        if args.filtered:
            def route(r):
                if r.request.resource_type in ('image', 'media', 'font') or not allowed_resource(r.request.url):
                    stats['blockedScripts'] += int(r.request.resource_type == 'script')
                    r.abort()
                else:
                    r.continue_()
            context.route('**/*', route)
        def response(r):
            if r.request.is_navigation_request() and r.frame == page.main_frame:
                stats['documentResponses'] += 1
                stats['httpStatus'] = r.status
                # Only fixed categories, never arbitrary header values or URLs.
                kind = r.headers.get('content-type', '').lower()
                stats['contentType'] = 'html' if 'text/html' in kind else 'other'
        def failed(request):
            if request.resource_type == 'document':
                stats['failedDocuments'] += 1
            elif request.resource_type == 'script':
                stats['failedScripts'] += 1
        page.on('response', response)
        page.on('requestfailed', failed)
        deadline = time.monotonic() + 18
        try:
            page.goto(search_url(args.engine, dict(query='погода Минск', language='ru', country='by')), wait_until='commit', timeout=12000)
        except PlaywrightError as error:
            stats['navigationError'] = error_code(error)
        while time.monotonic() < deadline:
            try:
                state = page.evaluate(EXTRACT, args.engine)
                stats.update({k: state[k] for k in ('pageKind', 'matchedRows', 'bodyChars')})
                stats['visibleRows'] = len(state['rows'])
                stats['htmlRows'] = len(state.get('hiddenRows', []))
                stats.update(page.evaluate('() => ({readyState: document.readyState, hasBody: !!document.body, domElements: document.getElementsByTagName("*").length})'))
                if state['rows'] or state.get('hiddenRows') or state['challenge'] or state['pageKind'] in ('consent', 'challenge'):
                    break
            except PlaywrightError as error:
                stats['extractionError'] = error_code(error)
                if stats['extractionError'] != 'navigation_changed':
                    break
            page.wait_for_timeout(250)
        if args.details:
            try:
                stats['details'] = page.evaluate(DETAILS)
            except PlaywrightError as error:
                stats['detailsError'] = error_code(error)
        if args.screenshot:
            try:
                page.screenshot(path='/tmp/sinout-search-probe.png', timeout=3000)
                stats['screenshot'] = '/tmp/sinout-search-probe.png'
            except PlaywrightError as error:
                stats['screenshotError'] = error_code(error)
        context.close()
        browser.close()
    stats['elapsedMs'] = round((time.monotonic() - started) * 1000)
    print(json.dumps(stats, ensure_ascii=True), flush=True)


if __name__ == '__main__':
    main()
