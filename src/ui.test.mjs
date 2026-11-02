import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const file = new URL('./ui.jsx', import.meta.url);
function loadGlyphFrame() {
  assert.ok(existsSync(file), 'ui.jsx must implement the glyph animation');
  const source = readFileSync(file, 'utf8');
  const start = source.indexOf('export function glyphFrame(');
  assert.ok(start >= 0, 'glyphFrame must be available for deterministic tests');
  const end = source.indexOf('\n}', start) + 2;
  return vm.runInNewContext(`(${source.slice(start, end).replace('export ', '')})`);
}

test('glyphs resolve once over 1.8 seconds and hold until 2.4 seconds', () => {
  const frame = loadGlyphFrame();
  for (const index of [0, 1, 50, 99]) {
    assert.equal(frame(-10, index, 100).progress, 0);
    assert.equal(frame(0, index, 100).progress, 0);
    assert.equal(frame(1800, index, 100).progress, 1);
    assert.equal(frame(2399, index, 100).done, false);
    assert.equal(frame(2400, index, 100).done, true);
    assert.equal(frame(9000, index, 100).progress, 1);
    let previous = 0;
    for (let time = 0; time <= 2400; time += 25) {
      const { progress } = frame(time, index, 100);
      assert.ok(progress >= previous && progress <= 1);
      previous = progress;
    }
  }
  assert.ok(frame(800, 0, 100).progress > frame(800, 99, 100).progress);
  assert.ok(Number.isFinite(frame(900, 0, 0).progress));
});

test('dashboard preserves statuses, details, missing/error states and narrow containers', { timeout: 20000 }, async () => {
  const bundle = await build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {DashboardView, Welcome} from './ui.jsx';
        const root = createRoot(document.getElementById('root'));
        window.renderDashboard = (props) => root.render(React.createElement(DashboardView, {...props, onRefresh: () => window.refreshed = true, onOpenKanban: () => window.opened = true}));
        window.renderWelcome = () => root.render(React.createElement(Welcome, {onDone: () => window.finished = (window.finished || 0) + 1}));`,
      resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'jsx',
    }, bundle: true, write: false, format: 'iife', jsx: 'automatic',
  });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<div id="root"></div>');
    await page.addStyleTag({ content: readFileSync(new URL('./style.css', import.meta.url), 'utf8') });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const names = ['triage', 'todo', 'ready', 'running', 'review', 'blocked', 'done', 'custom-stage', 'archived'];
    const snapshot = { boardLabel: 'Test board', now: '2026-01-01T12:00:00Z', columns: names.map((name, i) => ({name, tasks: [{ id: i, title: `Task ${name}`, status: name, assignee: 'worker', latest_summary: '<script>unsafe</script>', body: 'Real body' }]})) };
    await page.evaluate(snapshot => window.renderDashboard({ snapshot, connection: 'connected', model: 'test-model', profile: 'test-profile' }), snapshot);
    await page.locator('.a7m-column').first().waitFor();
    await page.evaluate(snapshot => window.renderDashboard({snapshot: {...snapshot, now: 1767268800}}), snapshot);
    const expectedDate = new Intl.DateTimeFormat('ar', {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}).format(new Date(1767268800 * 1000));
    await page.waitForTimeout(50);
    assert.ok((await page.locator('.a7m-context').innerText()).includes(expectedDate), 'epoch seconds render as seconds, not milliseconds');
    assert.equal(await page.locator('.a7m-column').count(), names.length);
    assert.deepEqual(await page.locator('.a7m-metric dd').allTextContents(), ['1', '1', '8', '1']);
    await page.locator('.a7m-column').first().locator('summary').click();
    assert.equal(await page.locator('.a7m-column').first().locator('details').getAttribute('open'), '');
    assert.ok((await page.locator('.a7m-column').first().innerText()).includes('<script>unsafe</script>'));
    assert.equal(await page.locator('.a7m-task script').count(), 0);
    await page.getByRole('button', { name: 'تحديث البيانات', exact: true }).click();
    assert.equal(await page.evaluate(() => window.refreshed), true);
    await page.getByRole('button', { name: 'فتح Kanban الأصلي', exact: true }).first().click();
    assert.equal(await page.evaluate(() => window.opened), true);
    for (const width of [375, 640, 1100, 1920]) {
      await page.setViewportSize({width, height: 900});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `outer overflow at ${width}`);
    }
    await page.evaluate(snapshot => window.renderDashboard({snapshot, error: 'Network error'}), snapshot);
    await page.getByRole('alert').waitFor();
    assert.ok((await page.getByRole('alert').innerText()).includes('قديمة'));
    assert.equal(await page.locator('.a7m-column').count(), names.length);
    await page.evaluate(() => window.renderDashboard({error: 'Network error'}));
    await page.waitForFunction(() => document.querySelectorAll('.a7m-column').length === 0);
    assert.deepEqual(await page.locator('.a7m-metric dd').allTextContents(), ['—', '—', '—', '—']);
    await page.evaluate(() => window.renderDashboard({loading: true}));
    await page.locator('.a7m-loading').waitFor();
    assert.equal(await page.locator('.a7m-task').count(), 0);
    await page.evaluate(() => window.renderDashboard({snapshot: { columns: [] }}));
    await page.getByRole('heading', {name: 'لا توجد مهام في هذه اللوحة'}).waitFor();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => window.renderWelcome());
    await page.waitForFunction(() => window.finished === 1, null, { timeout: 1000 });
    await page.evaluate(() => window.renderDashboard({loading: true}));
    await page.locator('.a7m-loading').waitFor();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => { window.finished = 0; window.renderWelcome(); });
    await page.locator('.is-painted canvas').waitFor();
    await page.waitForFunction(() => window.finished === 1, null, { timeout: 4000 });
    const painted = await page.locator('canvas').evaluate(canvas => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      return pixels.some((v, i) => i % 4 === 3 && v > 0);
    });
    assert.equal(painted, true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('model catalog shows per-million prices and honest calculator validation', { timeout: 20000 }, async () => {
  const bundle = await build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {ModelCatalog} from './ui.jsx';
      import {normalizeModels} from './models.mjs';
      const root = createRoot(document.getElementById('root'));
      window.renderCatalog = (props) => root.render(React.createElement('div', {className:'a7m-dashboard', 'data-theme':'a7m-terminal', lang:'ar', dir:'rtl'}, React.createElement(ModelCatalog, {...props, models: normalizeModels(props.models), onRefresh: () => window.refreshed = true})));`,
      resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'jsx' },
    bundle: true, write: false, format: 'iife', jsx: 'automatic',
  });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    page.setDefaultTimeout(3000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<div id="root"></div>');
    await page.addStyleTag({ content: readFileSync(new URL('./style.css', import.meta.url), 'utf8') });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const models = [
      {id:'p/paid', name:'Paid', provider:'p', description:'Published provider description', prices:{input:0.000002, output:0.000004, input_cache_read:0.000001}, context_length:1000, capabilities:['image_input','tools']},
      {id:'q/unknown', name:'Unknown', provider:'q', prices:{input:null, output:0.000004, input_cache_read:null}, capabilities:['image_output','reasoning']},
      {id:'q/free', name:'Free', provider:'q', prices:{input:0, output:0, input_cache_read:0}, capabilities:[]},
    ];
    await page.evaluate(models => window.renderCatalog({models, meta:{source:'OpenRouter', fetched_at:1767268800, stale:true}}), models);
    const paidRow = page.locator('.a7m-model-row').filter({hasText:'p/paid'});
    await paidRow.waitFor();
    assert.deepEqual(await paidRow.locator('.a7m-model-price').allTextContents(), ['$2.000000', '$4.000000']);
    await paidRow.locator('summary').click();
    assert.ok((await paidRow.innerText()).includes('وصف المزوّد'));
    assert.ok((await page.locator('.a7m-context').innerText()).includes('قديمة'));
    await page.locator('.a7m-calc-section > summary').click();
    await page.getByLabel('الموديل', {exact:true}).selectOption('p/paid');
    await page.waitForFunction(() => document.querySelector('.a7m-calc-result')?.textContent.includes('$0.004000'));
    await page.getByLabel('رموز الإدخال', {exact:true}).fill('');
    await page.locator('.a7m-calc-error').waitFor();
    assert.equal(await page.locator('.a7m-calc-result').count(), 0);
    await page.getByLabel('رموز الإدخال', {exact:true}).fill('1.5');
    assert.equal(await page.locator('.a7m-calc-result').count(), 0);
    await page.getByLabel('رموز الإدخال', {exact:true}).fill('1000');
    await page.getByLabel('الموديل', {exact:true}).selectOption('q/unknown');
    await page.locator('.a7m-calc-error').waitFor();
    assert.equal(await page.locator('.a7m-calc-result').count(), 0);
    await page.getByLabel('رموز الإدخال', {exact:true}).fill('0');
    await page.locator('.a7m-calc-result').waitFor();
    await page.getByLabel('رموز ذاكرة التخزين', {exact:true}).fill('1');
    await page.locator('.a7m-calc-error').waitFor();
    await page.getByLabel('الموديل', {exact:true}).selectOption('q/free');
    await page.locator('.a7m-calc-result').waitFor();
    assert.ok((await page.locator('.a7m-calc-result').innerText()).includes('$0.000000'));
    const catalog = Array.from({length:123}, (_, index) => ({
      id:`${index % 2 ? 'odd' : 'even'}/model-${index}`, name:`Model ${index}`, provider:index % 2 ? 'odd' : 'even',
      prices:{input:index * 0.000001, output:(123 - index) * 0.000001},
      capabilities:index % 2 ? ['image_output', 'reasoning'] : ['image_input', 'tools'],
    }));
    await page.evaluate(models => window.renderCatalog({models, meta:{source:'fixture', fetched_at:1767268800}}), catalog);
    await page.waitForFunction(() => document.querySelector('.a7m-catalog-count')?.textContent.includes('123'));
    assert.equal(await page.locator('.a7m-model-row').count(), 50);
    const ids = [];
    for (let index = 0; index < 3; index++) {
      ids.push(...await page.locator('.a7m-model-id').allTextContents());
      if (index < 2) await page.getByRole('button', {name:'الصفحة التالية', exact:true}).click();
    }
    assert.equal(new Set(ids).size, catalog.length);
    assert.deepEqual([...new Set(ids)].sort(), catalog.map(model => model.id).sort());
    assert.equal(await page.getByRole('button', {name:'الصفحة التالية', exact:true}).isDisabled(), true);
    await page.getByLabel('بحث', {exact:true}).fill('model-122');
    await page.waitForFunction(() => document.querySelectorAll('.a7m-model-row').length === 1);
    assert.deepEqual(await page.locator('.a7m-model-id').allTextContents(), ['even/model-122']);
    await page.getByLabel('بحث', {exact:true}).fill('');
    await page.getByLabel('الإمكانيات', {exact:true}).selectOption('image_output');
    await page.waitForFunction(() => document.querySelector('.a7m-catalog-count')?.textContent.includes('61'));
    assert.ok((await page.locator('.a7m-model-id').allTextContents()).every(id => id.startsWith('odd/')));
    await page.getByLabel('المزوّد', {exact:true}).selectOption('even');
    await page.locator('.a7m-catalog-empty').waitFor();
    await page.getByLabel('الإمكانيات', {exact:true}).selectOption('');
    await page.waitForFunction(() => document.querySelectorAll('.a7m-model-row').length === 50);
    await page.getByRole('button', {name:'عكس ترتيب السعر', exact:true}).click();
    await page.waitForFunction(() => document.querySelector('.a7m-model-id')?.textContent === 'even/model-122');
    await page.getByLabel('ترتيب حسب', {exact:true}).selectOption('output');
    await page.waitForFunction(() => document.querySelector('.a7m-model-id')?.textContent === 'even/model-0');
    for (const width of [375, 640, 1100]) {
      await page.setViewportSize({width, height:900});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `catalog overflow at ${width}`);
      const scrollable = await page.locator('.a7m-catalog-table').evaluate(region => {
        region.scrollLeft = -region.scrollWidth;
        return region.scrollWidth <= region.clientWidth || (getComputedStyle(region).overflowX === 'auto' && Math.abs(region.scrollLeft) > 0);
      });
      assert.equal(scrollable, true, `all catalog columns accessible at ${width}`);
    }
    await page.getByRole('button', {name:'تحديث الموديلات', exact:true}).click();
    assert.equal(await page.evaluate(() => window.refreshed), true);
    await page.evaluate(() => window.renderCatalog({models:[], error:'Catalog unavailable'}));
    await page.getByRole('alert').waitFor();
    assert.equal(await page.locator('.a7m-model-row').count(), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
