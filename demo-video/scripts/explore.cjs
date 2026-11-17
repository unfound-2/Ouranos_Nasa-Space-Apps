// Quick look at the hosted site: screenshots of a URL at several times.
const { chromium } = require('/Users/sriyanbodla/Organized/Projects/NASASPACEAPP26-dashboard/dashboard/node_modules/playwright');
(async () => {
  const url = process.argv[2] || 'https://useouranos.vercel.app/';
  const out = process.argv[3] || '/tmp/explore';
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('console', (m) => { if (m.type() === 'error') console.log('console error:', m.text().slice(0, 200)); });
  await page.goto(url, { waitUntil: 'load' });
  for (const t of [1000, 3000, 6000]) {
    await page.waitForTimeout(t === 1000 ? 1000 : t === 3000 ? 2000 : 3000);
    await page.screenshot({ path: `${out}-${t}.png` });
  }
  console.log('title:', await page.title(), 'url:', page.url());
  const text = await page.evaluate(() => document.body.innerText.slice(0, 1500));
  console.log(text);
  await browser.close();
})();
