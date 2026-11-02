import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const snapshot = {boardLabel:'لوحة اختبار صريحة، ليست مهام المستخدم',now:1767268800,columns:
 ['triage','todo','ready','running','review','blocked','done'].map(name => ({name,tasks:name==='running'?[{id:'fixture-1',title:'مهمة اختبار الاتصال',status:name,assignee:'test-worker',latest_summary:'بيانات اختبار فقط'}]:[]}))}
let mode = 'full'
let releaseHeld
let heldStarted = false
const server = createServer(async(req,res) => {
  if(req.url === '/test-api/snapshot') {
    const requestMode = mode
    const source = req.headers['x-test-source']
    const payload = {...snapshot, boardLabel: `${snapshot.boardLabel} / source-${source}`}
    if(requestMode==='error') {res.writeHead(503);res.end('{}');return}
    if(requestMode==='held') {heldStarted = true; await new Promise(resolve => {releaseHeld = resolve})}
    if(requestMode==='delayed') await new Promise(resolve=>setTimeout(resolve,700))
    res.setHeader('content-type','application/json');res.end(JSON.stringify(requestMode==='empty'?{...payload,columns:payload.columns.map(c=>({...c,tasks:[]}))}:payload));return
  }
  if(req.url.startsWith('/test-api/executions?')) {
    if(mode==='malformed-executions') {res.setHeader('content-type','application/json');res.end(JSON.stringify({running:[],history:{rows:[],page:0,limit:25,total:0},opencode:[],opencode_history:{total:0,page:0,limit:25,status:'available'}}));return}
    const requestMode = mode;
    const source = req.headers['x-test-source'];
    const page = Number(new URL(req.url,'http://fixture').searchParams.get('page'));
    if(requestMode==='error') {res.writeHead(503);res.end('{}');return}
    if(requestMode==='held-executions') {heldStarted=true;await new Promise(resolve => {releaseHeld=resolve})}
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify({board:'fixture',boardLabel:'Explicit execution test fixture',now:1767268800,running:[],history:{rows:[{run_id:`fixture-run-${page}`,task_id:'fixture-task',task_title:`Execution fixture source-${source} page-${page}`,profile:'fixture-profile',status:'done',harness:'Hermes',agent:null,session:null}],total:26,page,limit:25},opencode:[],opencode_history:{total:null,page,limit:25,status:'disabled'}}));return;
  }
  if(req.url === '/test-api/models') {
    res.setHeader('content-type','application/json')
    res.end(JSON.stringify({source:'كتالوج اختبار فقط، ليس أسعار المستخدم',fetched_at:1767268800,stale:false,models:[
      {id:'example/test-model',name:'Example model',provider:'example',description:'Published test description only',prices:{input:0.000001,output:0.000002,input_cache_read:null},context_length:32000,capabilities:['tools','image_input']},
      {id:'example/unknown-price',name:'Unknown price model',provider:'example',description:'Test fixture missing pricing',prices:{input:null,output:null,input_cache_read:null},context_length:null,capabilities:[]}
    ]}));return
  }
  const name=req.url==='/'?'index.html':req.url==='/app.js'?'app.js':null
  if(!name){res.writeHead(404);res.end();return}
  res.setHeader('content-type',name.endsWith('.js')?'text/javascript':'text/html');res.end(await readFile(new URL('../preview/'+name,import.meta.url)))
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/opt/hermes/tools/chromium-1208/chrome-linux64/chrome',args:['--no-sandbox']})
try {
  const page=await browser.newPage({viewport:{width:1440,height:900}})
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByRole('region',{name:'Welcome to Hermes Dashbord',exact:true}).waitFor()
  await page.waitForTimeout(1850)
  await mkdir('artifacts',{recursive:true});await page.screenshot({path:'artifacts/welcome.png'})
  await page.getByRole('heading',{name:'A7M Dashbord',exact:true}).waitFor()
  assert.equal(await page.locator('.a7m-column').count(),7)
  assert.deepEqual(await page.locator('.a7m-metric dd').allTextContents(),['1','0','1','1'])
  assert.ok((await page.locator('.a7m-task-preview').innerText()).startsWith('آخر ملخص تشغيل متاح'))
  assert.deepEqual(await page.locator('.a7m-task-detail dt').allTextContents(),['آخر ملخص تشغيل متاح','آخر ملخص تشغيل متاح'])
  assert.equal(await page.locator('.a7m-task-updated').count(),0,'native Task has no updated_at')
  assert.equal(await page.getByText('سبب التوقف',{exact:true}).count(),0,'native Task has no blocked_reason')
  assert.ok((await page.locator('#tabpanel-tasks .a7m-context').innerText()).includes('٢٠٢٦')===false) // display intentionally omits year
  await page.screenshot({path:'artifacts/dashboard-test-data.png'})
  await page.getByRole('button',{name:'فتح Kanban الأصلي'}).first().click()
  assert.equal(await page.evaluate(()=>window.__navigation),'/kanban')
  mode='error';await page.getByRole('button',{name:'تحديث البيانات',exact:true}).click()
  await page.getByRole('alert').waitFor();assert.ok((await page.getByRole('alert').innerText()).includes('قديمة'))
  await page.evaluate(()=>window.__host.state.profile.set('different-profile'))
  await page.waitForFunction(()=>document.querySelectorAll('.a7m-column').length===0)
  assert.deepEqual(await page.locator('.a7m-metric dd').allTextContents(),['—','—','—','—'])
  mode='empty';await page.getByRole('button',{name:'تحديث البيانات',exact:true}).click()
  await page.getByRole('heading',{name:'لا توجد مهام في هذه اللوحة'}).waitFor()
  await page.screenshot({path:'artifacts/dashboard-empty.png'})
  for(const width of [375,640,1100,1920]){
    await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  }
  await page.emulateMedia({reducedMotion:'reduce'});mode='delayed';await page.reload()
  await page.locator('#tabpanel-tasks .a7m-loading').waitFor();assert.equal(await page.locator('.a7m-welcome').count(),0)
  await page.locator('.a7m-column').first().waitFor()
  assert.ok((await page.evaluate(()=>window.__calls)).every(c=>c.options.method==='GET'&&(c.path==='/snapshot'||c.path==='/models')))
  assert.equal(await page.evaluate(()=>window.__calls.filter(c=>c.path==='/models').length),0,'catalog is lazy')
  await page.getByRole('tab',{name:'المهام',exact:true}).focus()
  await page.keyboard.press('ArrowLeft')
  await page.locator('.a7m-catalog-count').filter({hasText:'نتائج 2 من 2 موديل'}).waitFor()
  assert.equal(await page.getByRole('tab',{name:'دليل الموديلات'}).getAttribute('aria-selected'),'true')
  assert.ok((await page.locator('.a7m-model-row').first().innerText()).includes('$1.000000'))
  await page.getByRole('searchbox').fill('unknown-price')
  await page.locator('.a7m-catalog-count').filter({hasText:'نتائج 1 من 2 موديل'}).waitFor()
  assert.ok((await page.locator('.a7m-model-row').innerText()).includes('غير متاح'))
  await page.getByRole('searchbox').fill('')
  await page.screenshot({path:'artifacts/models-test-data.png'})
  assert.equal(await page.evaluate(()=>window.__calls.filter(c=>c.path.startsWith('/executions')).length),0,'executions are lazy')
  await page.getByRole('tab',{name:'دليل الموديلات',exact:true}).focus()
  await page.keyboard.press('End')
  await page.getByRole('heading',{name:'التنفيذ والسجل',exact:true}).waitFor()
  await page.getByText('Execution fixture source-A page-1',{exact:true}).waitFor()
  assert.equal(await page.getByRole('tab',{name:'التنفيذ والسجل',exact:true}).getAttribute('aria-selected'),'true')
  await page.getByRole('button',{name:'صفحة السجل التالية'}).click()
  await page.getByText('Execution fixture source-A page-2',{exact:true}).waitFor()
  await page.keyboard.press('Tab')
  for(const width of [375,640,1100]) {
    await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  }
  mode='error';await page.getByRole('button',{name:'تحديث سجل التنفيذ'}).click()
  await page.locator('#tabpanel-executions [role="alert"]').filter({hasText:'قديمة'}).waitFor()
  await page.getByRole('tab',{name:'التنفيذ والسجل',exact:true}).focus()
  await page.keyboard.press('Home')
  assert.equal(await page.getByRole('tab',{name:'المهام',exact:true}).getAttribute('aria-selected'),'true')
  await page.keyboard.press('ArrowRight')
  assert.equal(await page.getByRole('tab',{name:'التنفيذ والسجل',exact:true}).getAttribute('aria-selected'),'true','RTL Right wraps to last tab')
  await page.getByRole('tab',{name:'المهام',exact:true}).click()
  const scoped = await browser.newPage({reducedMotion:'reduce'})
  scoped.on('pageerror', e => errors.push(e.message))
  mode='full'
  await scoped.goto(`http://127.0.0.1:${server.address().port}`)
  await scoped.getByText(/source-A/).waitFor()
  mode='held'
  await scoped.getByRole('button',{name:'تحديث البيانات',exact:true}).click()
  for (let attempt=0; !heldStarted && attempt<100; attempt++) await new Promise(resolve => setTimeout(resolve,10))
  assert.equal(heldStarted,true,'old-scope request is outstanding before activation')
  mode='error'
  await scoped.evaluate(() => window.__activate('B')) // profile and socket unchanged
  await scoped.waitForFunction(() => document.querySelectorAll('.a7m-column').length === 0, null, {timeout:1500})
  await scoped.getByRole('alert').waitFor()
  assert.deepEqual(await scoped.locator('.a7m-metric dd').allTextContents(),['—','—','—','—'])
  assert.equal((await scoped.getByRole('alert').innerText()).includes('قديمة'),false)
  console.log('PASS: same-profile activation clears cached data promptly; failed new-source read stays unknown.')
  const beforeRelease = await scoped.evaluate(() => window.__settled.length)
  releaseHeld()
  await scoped.waitForFunction(n => window.__settled.length > n, beforeRelease)
  assert.equal(await scoped.evaluate(() => window.__settled.at(-1).result),'error','outstanding old-scope response must be rejected, not cached')
  assert.equal(await scoped.locator('.a7m-column').count(),0)
  console.log('PASS: outstanding old-source response rejected.')
  await scoped.evaluate(() => window.__activate('A'))
  await scoped.waitForFunction(() => window.__calls.some(c => c.epoch === 2))
  await scoped.getByRole('alert').waitFor()
  assert.equal(await scoped.locator('.a7m-column').count(),0,'A B A cannot restore prior A cache after failed read')
  mode='full'
  await scoped.getByRole('button',{name:'تحديث البيانات',exact:true}).click()
  await scoped.getByText(/source-A/).waitFor()
  mode='error'
  await scoped.evaluate(() => {window.__activate('B');window.__activate('A')})
  await scoped.waitForFunction(() => document.querySelectorAll('.a7m-column').length === 0, null, {timeout:1500})
  await scoped.waitForFunction(() => window.__calls.some(c => c.epoch === 4))
  await scoped.getByRole('alert').waitFor()
  assert.equal(await scoped.locator('.a7m-task').count(),0)
  const callCount = await scoped.evaluate(() => window.__calls.length)
  await scoped.waitForTimeout(250)
  assert.equal(await scoped.evaluate(() => window.__calls.length),callCount,'epoch watcher must not poll the network')
  console.log('PASS: A B A, including both activations between frames, never reuses prior activation data; no network loop.')
  mode='full'
  await scoped.getByRole('button',{name:'تحديث البيانات',exact:true}).click()
  await scoped.getByText(/source-A/).waitFor()
  await scoped.evaluate(() => {
    const query = window.__queryClient.getQueryCache().findAll({queryKey:['a7m-dashboard']}).find(q => q.getObserversCount())
    window.__activeKey = query.queryKey
    window.__activeData = query.state.data
    window.__queryClient.setQueryData(query.queryKey,{...query.state.data,epoch:0})
  })
  await scoped.waitForFunction(() => document.querySelectorAll('.a7m-column').length === 0)
  await scoped.evaluate(() => window.__queryClient.setQueryData(window.__activeKey,{...window.__activeData,profile:'other-profile'}))
  assert.equal(await scoped.locator('.a7m-column').count(),0)
  await scoped.evaluate(() => window.__queryClient.setQueryData(window.__activeKey,window.__activeData))
  await scoped.getByText(/source-A/).waitFor()
  console.log('PASS: rendered cache data must match both canonical epoch and profile tags.')
  mode='full'
  await scoped.getByRole('tab',{name:'التنفيذ والسجل',exact:true}).click()
  await scoped.getByText('Execution fixture source-A page-1',{exact:true}).waitFor()
  await scoped.getByRole('button',{name:'صفحة السجل التالية'}).click()
  await scoped.getByText('Execution fixture source-A page-2',{exact:true}).waitFor()
  mode='held-executions';heldStarted=false
  await scoped.getByRole('button',{name:'تحديث سجل التنفيذ'}).click()
  for(let attempt=0; !heldStarted && attempt<100; attempt++) await new Promise(resolve=>setTimeout(resolve,10))
  assert.equal(heldStarted,true)
  mode='error'
  await scoped.evaluate(()=>window.__activate('B'))
  await scoped.waitForFunction(()=>document.querySelectorAll('.a7m-execution-row').length===0,null,{timeout:1500})
  await scoped.locator('#tabpanel-executions [role="alert"]').waitFor()
  assert.equal(await scoped.locator('#tabpanel-executions [role="alert"]').getByText(/قديمة/).count(),0)
  const executionSettled = await scoped.evaluate(()=>window.__settled.length)
  releaseHeld()
  await scoped.waitForFunction(n=>window.__settled.length>n,executionSettled)
  assert.equal(await scoped.evaluate(()=>window.__settled.at(-1).result),'error')
  assert.equal(await scoped.locator('.a7m-execution-row').count(),0)
  mode='full';await scoped.getByRole('button',{name:'تحديث سجل التنفيذ'}).click()
  await scoped.getByText('Execution fixture source-B page-1',{exact:true}).waitFor()
  mode='malformed-executions'
  await scoped.evaluate(()=>window.__host.state.profile.set('execution-other-profile'))
  await scoped.locator('#tabpanel-executions [role="alert"]').waitFor()
  assert.equal(await scoped.locator('.a7m-execution-row').count(),0,'malformed page response is not a false empty history')
  mode='full';await scoped.getByRole('button',{name:'تحديث سجل التنفيذ'}).click()
  await scoped.getByText('Execution fixture source-B page-1',{exact:true}).waitFor()
  await scoped.reload()
  await scoped.getByRole('tab',{name:'التنفيذ والسجل',exact:true}).click()
  await scoped.getByText('Execution fixture source-A page-1',{exact:true}).waitFor()
  assert.ok((await scoped.evaluate(()=>window.__calls)).every(c=>c.options.method==='GET'))
  console.log('PASS: executions lazy query, keyboard tabs, paging, reload, malformed response, profile/epoch isolation and outstanding response rejection.')
  await scoped.close()
  assert.deepEqual(errors,[])
  console.log('PASS: bundled plugin registration, intro auto-transition, real-shaped fixture binding, GET-only, stale warning, profile isolation, empty/loading/error, reduced motion, responsive widths, no JS errors.')
} finally {releaseHeld?.();await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
