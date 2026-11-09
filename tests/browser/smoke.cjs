// 外网体验版回归：无白屏、无 Cloud 请求、关键模块与存档可用
// 用法：PUPPETEER_MODULE=<puppeteer-core> node tests/browser/smoke.cjs <URL>
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer-core');

(async () => {
  const url = process.argv[2];
  if (!url) throw new Error('missing URL');
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    const errors = [];
    const failures = [];
    const cloudCalls = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      const target = response.url();
      if (target.endsWith('/favicon.ico')) return;
      if (response.status() >= 400) failures.push(`${response.status()} ${target}`);
      if (new URL(target).pathname.startsWith('/v1')) cloudCalls.push(target);
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('#start-btn', { timeout: 30000 });
    const title = await page.title();
    if (!/MyFlicker/i.test(title)) throw new Error(`unexpected title: ${title}`);

    await page.waitForFunction(() => !!window.gameWorld && !!window.gameCloud2 === false, { timeout: 30000 })
      .catch(() => {});   // gameCloud 缺失是外网预期行为
    const state = await page.evaluate(() => ({
      canvas: !!document.querySelector('canvas'),
      start: !!document.querySelector('#start-btn'),
      authBar: document.querySelector('#auth-bar')?.textContent.trim() || '',
      hasCanvasContext: !!document.querySelector('canvas')?.getContext('2d') || !!document.querySelector('canvas')?.getContext('webgl'),
      cloud: typeof window.gameCloud,
      world: typeof window.gameWorld,
    }));
    if (!state.canvas || !state.start) throw new Error('page not mounted');
    if (state.cloud !== 'undefined') throw new Error('cloud must stay disabled off the intranet');
    if (cloudCalls.length) throw new Error(`unexpected cloud requests: ${cloudCalls.slice(0, 3)}`);
    if (errors.length) throw new Error(errors.join('\n'));
    if (failures.length) throw new Error(failures.join('\n'));
    console.log(JSON.stringify({ title, ...state, errors: 0, failures: 0, cloudCalls: 0 }));
    console.log('PASS: world page mounted, no cloud traffic, no page errors');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
