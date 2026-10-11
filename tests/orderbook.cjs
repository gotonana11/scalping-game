const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Expose internals only in the test document; the shipped page has no test hooks.
  const html = fs.readFileSync('index.html', 'utf8').replace('  // 初期化\n  init();', 'window.testMarket = {state, init, placeLimit, cancelLimit, matchLimitOrders, executeTrade, closeAll, updateUI, microStep};\n  // 初期化\n  init();');
  await page.setContent(html);
  const result = await page.evaluate(() => {
    const t = window.testMarket, s = t.state;
    function check(condition, message) { if (!condition) throw Error(message); }
    function reset() { t.init(); s.limitSide = 1; s.lot = 100; s.forming.o = s.forming.c = 1000; s.forming.h = s.forming.l = 1000; t.updateUI(); }
    reset();
    t.placeLimit(990); check(s.qty === 0 && s.limitOrders[0].status === '待機中', 'buy waits');
    s.lot = 200; s.forming.c = 989; t.matchLimitOrders();
    check(s.qty === 100 && s.avg === 989 && s.cash === 201100, 'fill uses frozen qty and better price');
    s.limitSide = -1; s.lot = 100; t.placeLimit(1010);
    s.forming.c = 1015; t.matchLimitOrders();
    check(s.qty === 0 && s.realized === 2600 && s.cash === 302600, 'sell closes and realizes profit');
    reset(); t.placeLimit(990); t.placeLimit(990); s.forming.c = 980; t.matchLimitOrders();
    check(s.qty === 0 && s.limitOrders[0].status === '取消', 'same-price cancellation');
    reset(); s.lot = 400; t.placeLimit(990); s.forming.c = 990; t.matchLimitOrders();
    check(s.qty === 0 && s.cash === 300000 && s.limitOrders[0].status === '資金不足で失効', 'insufficient funds');
    reset(); t.executeTrade(100, 1000); t.executeTrade(100, 1001);
    check(s.avg === 1000.5 && s.cash === 99900, 'weighted average preserves cash');
    t.executeTrade(-100, 1010); check(s.qty === 100 && s.realized === 950 && s.cash === 200900, 'partial close');
    t.executeTrade(-200, 1010); check(s.qty === -100 && s.avg === 1010 && s.realized === 1900 && s.cash === 200900, 'flip');
    s.forming.c = 1000; t.closeAll(); check(s.cash === 302900 && s.qty === 0 && s.realized === 2900, 'short close');
    reset(); t.executeTrade(100, 1000); const cash = s.cash;
    check(t.executeTrade(-1000, 1010) === false && s.qty === 100 && s.cash === cash && s.realized === 0, 'failed flip atomic');
    reset(); t.placeLimit(990); t.init(); check(s.limitOrders.length === 0, 'reset clears orders');
    reset(); t.placeLimit(1001); check(s.qty === 100 && s.avg === 1000, 'marketable limit immediate');
    reset(); t.placeLimit(990); s.forming.c = 500; s.seed = 1; t.microStep(); check(s.limitOrders[0].status === '約定', 'microstep matches orders: ' + JSON.stringify([s.forming.c,s.limitOrders]));
    reset(); return true;
  });
  assert.equal(result, true);
  assert.equal(await page.locator('.depth-price').count(), 21);
  const prices = await page.locator('.depth-price').evaluateAll(nodes => nodes.map(n => Number(n.dataset.price)));
  await page.locator(`[data-price="${prices.at(-1)}"]`).click();
  assert.match(await page.locator('#limitOrders').innerText(), /待機中/);
  await page.locator('[data-cancel]').click();
  assert.match(await page.locator('#limitOrders').innerText(), /取消/);
  await page.locator('#limitSell').click();
  assert.equal(await page.locator('#limitSell').getAttribute('aria-pressed'), 'true');
  await page.locator(`[data-price="${prices[0]}"]`).click();
  await page.locator('#cancelLimits').click();
  assert.equal(await page.locator('[data-cancel]').count(), 0);
  await page.setViewportSize({ width: 390, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: '/tmp/scalping-orderbook-mobile.png', fullPage: true });
  await browser.close();
  console.log('Order book UI and trading accounting checks passed.');
})().catch(error => { console.error(error); process.exit(1); });
