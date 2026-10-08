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
      page.on('request', (request) => {
        const url = request.url();
        const isLocal = url.startsWith('data:') || url.startsWith('blob:') || url === 'about:blank';
        const isGoogleFont = url.startsWith('https://fonts.googleapis.com/') || url.startsWith('https://fonts.gstatic.com/');

        // The invoice preview uses the same Inter/JetBrains Mono font stack as the app.
        // Allow only the Google Fonts endpoints required to reproduce that typography;
        // all other external requests remain blocked so PDFs stay deterministic.
        if (isLocal || isGoogleFont) {
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
        waitUntil: 'domcontentloaded',
        timeout: 10000
      });
      await page.emulateMediaType('print');

      // Explicitly request the invoice fonts before the snapshot. Waiting on
      // document.fonts.ready alone only waits for fonts that Chromium considers
      // used; an explicit load prevents a transient fallback to Arial/Times.
      await page.evaluate(async () => {
        await Promise.all([
          document.fonts.load('400 16px "Inter"'),
          document.fonts.load('500 16px "Inter"'),
          document.fonts.load('600 16px "Inter"'),
          document.fonts.load('700 16px "Inter"'),
          document.fonts.load('800 16px "Inter"'),
          document.fonts.load('400 16px "JetBrains Mono"'),
          document.fonts.load('600 16px "JetBrains Mono"')
        ]);
        await document.fonts.ready;

        const interLoaded = document.fonts.check('400 16px "Inter"');
        const monoLoaded = document.fonts.check('400 16px "JetBrains Mono"');
        if (!interLoaded || !monoLoaded) {
          throw new Error('Invoice fonts failed to load before PDF rendering.');
        }
      });
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
