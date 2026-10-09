import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium-min';

const DEFAULT_CHROMIUM_PACK_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v153.0.0/chromium-v153.0.0-pack.x64.tar';

const PAPER_FORMATS = new Set(['a4', 'letter']);

function createPhaseError(phase, error) {
  const wrapped = new Error(
    error instanceof Error ? error.message : String(error)
  );
  wrapped.phase = phase;
  if (error instanceof Error && error.stack) wrapped.causeStack = error.stack;
  return wrapped;
}

export async function renderPdf(html, paperSize = 'a4') {
  const format = PAPER_FORMATS.has(paperSize) ? paperSize.toUpperCase() : 'A4';
  const packUrl = process.env.CHROMIUM_PACK_URL || DEFAULT_CHROMIUM_PACK_URL;
  let browser;

  try {
    let phase = 'chromium-startup';
    const executablePath = await chromium.executablePath(packUrl);

    try {
      browser = await puppeteer.launch({
        args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
        defaultViewport: chromium.defaultViewport,
        executablePath,
        headless: 'shell'
      });
    } catch (error) {
      throw createPhaseError(phase, error);
    }

    phase = 'page-setup';
    let page;
    try {
      page = await browser.newPage();
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);

      const diagnosticUrl = (rawUrl) => {
        try {
          const parsed = new URL(rawUrl);
          return parsed.protocol === 'data:' ? 'data:[embedded asset]' : parsed.origin + parsed.pathname;
        } catch {
          return '[unparseable URL]';
        }
      };

      page.on('console', (message) => {
        if (message.type() === 'error' || message.type() === 'warning') {
          console.error('[PDF Chromium console]', { type: message.type(), message: message.text() });
        }
      });
      page.on('pageerror', (error) => {
        console.error('[PDF Chromium page error]', { message: error.message, stack: error.stack });
      });
      page.on('requestfailed', (request) => {
        console.error('[PDF Chromium request failed]', {
          url: diagnosticUrl(request.url()),
          resourceType: request.resourceType(),
          failure: request.failure()?.errorText
        });
      });
      page.on('response', (response) => {
        if (response.status() >= 400) {
          console.error('[PDF Chromium HTTP error]', {
            status: response.status(),
            url: diagnosticUrl(response.url())
          });
        }
      });

      page.on('request', (request) => {
        const url = request.url();
        const type = request.resourceType();
        let parsedUrl;

        try {
          parsedUrl = new URL(url);
        } catch {
          request.abort();
          return;
        }

        const isInlineAsset =
          parsedUrl.protocol === 'data:' ||
          parsedUrl.protocol === 'blob:' ||
          (parsedUrl.protocol === 'about:' && url === 'about:blank');

        const isFontRequest = type === 'font';
        const isHttp = parsedUrl.protocol === 'https:' || parsedUrl.protocol === 'http:';
        const hostname = parsedUrl.hostname.toLowerCase();
        const isLocalHost =
          hostname === 'localhost' ||
          hostname === '127.0.0.1' ||
          hostname === '::1' ||
          hostname.endsWith('.localhost');

        // Preserve fonts and linked assets referenced by the supplied HTML/CSS,
        // including live .com/.net asset hosts used by existing invoice templates.
        // Do not let an arbitrary invoice HTML request reach local/private hosts.
        const isLiveDomainAsset =
          isHttp &&
          !isLocalHost &&
          !hostname.endsWith('.local') &&
          (hostname.endsWith('.com') || hostname === 'com' ||
           hostname.endsWith('.net') || hostname === 'net');

        if (isInlineAsset || isFontRequest || isLiveDomainAsset) {
          request.continue();
        } else {
          request.abort();
        }
      });
    } catch (error) {
      throw createPhaseError(phase, error);
    }

    phase = 'html-rendering';
    try {
      await page.setContent(html, {
        waitUntil: 'networkidle0',
        timeout: 10000
      });
      await page.emulateMediaType('print');

      // Load only fonts that the supplied document actually embeds or declares.
      // Generic API callers and smoke tests may intentionally use system fonts
      // (e.g. Arial); they must not fail merely because Inter/JetBrains Mono are
      // not part of that HTML. The frontend's self-contained invoice HTML embeds
      // these families as data URLs, so those faces are still explicitly checked.
      const fontStatus = await page.evaluate(async () => {
        const declaredFamilies = new Set(
          Array.from(document.querySelectorAll('style'))
            .flatMap(style => Array.from(style.sheet?.cssRules || []))
            .filter(rule => rule.type === CSSRule.FONT_FACE_RULE)
            .map(rule => (rule.style.getPropertyValue('font-family') || '')
              .replace(/^[\"']|[\"']$/g, '').trim().toLowerCase())
        );

        const checks = [
          { family: 'Inter', weights: [400, 500, 600, 700, 800] },
          { family: 'JetBrains Mono', weights: [400, 600] }
        ];
        const required = checks.filter(font => declaredFamilies.has(font.family.toLowerCase()));

        await Promise.all(required.flatMap(font =>
          font.weights.map(weight => document.fonts.load(weight + ' 16px "' + font.family + '"').catch(() => []))
        ));
        await document.fonts.ready;

        const loadedFamilies = new Set(
          Array.from(document.fonts)
            .filter(font => font.status === 'loaded')
            .map(font => font.family.replace(/["']/g, '').trim().toLowerCase())
        );

        const missing = required
          .map(font => font.family)
          .filter(family => !loadedFamilies.has(family.toLowerCase()));

        return {
          checked: required.map(font => font.family),
          loaded: Array.from(loadedFamilies),
          missing
        };
      });

      if (fontStatus.missing.length) {
        console.error('[PDF font fallback] Embedded font failed to load; continuing with sans-serif fallback.', {
          missing: fontStatus.missing,
          checked: fontStatus.checked,
          loaded: fontStatus.loaded
        });
      } else {
        console.log('[PDF font status]', fontStatus);
      }
    } catch (error) {
      throw createPhaseError(phase, error);
    }

    phase = 'pdf-generation';
    try {
      const pdf = await page.pdf({
        format,
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' }
      });

      // Puppeteer 25 returns a Uint8Array. Vercel's response layer must receive
      // a real Buffer or it can serialize the binary PDF as JSON.
      return Buffer.from(pdf);
    } catch (error) {
      throw createPhaseError(phase, error);
    }
  } catch (error) {
    if (error?.phase) throw error;
    throw createPhaseError('chromium-startup', error);
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (error) {
        console.error('pdf-renderer browser-close:', error);
      }
    }
  }
}
