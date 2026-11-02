import React, { useEffect, useRef, useState } from 'react';
import { filterByProvider, filterByCapability, searchModels, sortByPrice, calculateCost, formatUsd, formatPricePerMillion, getUniqueProviders, getUniqueCapabilities, getCapabilityLabel } from './models.mjs';

export function glyphFrame(elapsed, index, count) {
  const stagger = (index / Math.max(1, count - 1)) * 440;
  const linear = Math.max(0, Math.min(1, (elapsed - stagger) / 1360));
  return { progress: 1 - Math.pow(1 - linear, 3), done: elapsed >= 2400 };
}

export function Welcome({ onDone }) {
  const canvasRef = useRef(null);
  const callback = useRef(onDone);
  callback.current = onDone;
  const [painted, setPainted] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let disposed = false;
    let completed = false;
    let raf = 0;
    let timer = 0;
    let observer;
    const finish = () => {
      if (disposed || completed) return;
      completed = true;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      callback.current?.();
    };
    if (media.matches) {
      timer = window.setTimeout(finish, 0);
      return () => { disposed = true; clearTimeout(timer); };
    }
    const context = canvas?.getContext('2d');
    if (!context) {
      timer = window.setTimeout(finish, 0);
      return () => { disposed = true; clearTimeout(timer); };
    }
    const started = performance.now();
    let points = [];
    let width = 0;
    let height = 0;
    let cell = 0;
    let ink = '';
    let accent = '';
    let font = '';
    const glyphs = 'HermesDashbord01:+*';

    const draw = (elapsed) => {
      context.clearRect(0, 0, width, height);
      context.font = `500 ${cell * 1.35}px ${font}`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      for (let i = 0; i < points.length; i++) {
        const point = points[i];
        const { progress } = glyphFrame(elapsed, i, points.length);
        const scatter = 1 - progress;
        context.globalAlpha = 0.18 + 0.82 * progress;
        context.fillStyle = progress > 0.96 ? ink : accent;
        const letter = progress > 0.96 ? point.letter : glyphs[(i + Math.floor(elapsed / 100)) % glyphs.length];
        context.fillText(letter, point.x + point.dx * scatter, point.y + point.dy * scatter);
      }
      context.globalAlpha = 1;
    };
    const resize = () => {
      if (disposed || completed) return;
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      const styles = getComputedStyle(canvas);
      accent = styles.getPropertyValue('--color-accent').trim();
      ink = accent;
      font = styles.getPropertyValue('--font-mono').trim();
      const mask = document.createElement('canvas');
      mask.width = width;
      mask.height = height;
      const pen = mask.getContext('2d', { willReadFrequently: true });
      if (!pen) { finish(); return; }
      const size = Math.min(width / 9.5, height / 3.5, 156);
      pen.font = `700 ${size}px ${font}`;
      pen.textAlign = 'center';
      pen.textBaseline = 'middle';
      pen.fillStyle = ink;
      pen.fillText('Welcome to', width / 2, height / 2 - size * 0.65, width * 0.93);
      pen.fillText('Hermes Dashbord', width / 2, height / 2 + size * 0.65, width * 0.93);
      const pixels = pen.getImageData(0, 0, width, height).data;
      cell = Math.max(2.3, size / 23);
      points = [];
      for (let y = cell / 2; y < height; y += cell * 1.25) {
        for (let x = cell / 2; x < width; x += cell) {
          if (pixels[(Math.floor(y) * width + Math.floor(x)) * 4 + 3] < 96) continue;
          const index = points.length;
          points.push({ x, y, dx: Math.sin(index * 127.1) * width * 0.3,
            dy: Math.cos(index * 311.7) * height * 0.45, letter: glyphs[index % glyphs.length] });
        }
      }
      draw(performance.now() - started);
      setPainted(true);
    };
    const animate = (now) => {
      if (disposed || completed) return;
      draw(now - started);
      if (now - started < 1800) raf = requestAnimationFrame(animate);
    };
    const motionChanged = () => { if (media.matches) finish(); };
    resize();
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(resize);
      observer.observe(canvas);
    }
    window.addEventListener('resize', resize);
    media.addEventListener('change', motionChanged);
    raf = requestAnimationFrame(animate);
    timer = window.setTimeout(finish, 2400);
    return () => {
      disposed = true;
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      media.removeEventListener('change', motionChanged);
    };
  }, []);

  return <section className="a7m-dashboard a7m-welcome" data-theme="a7m-terminal" lang="en" dir="ltr" aria-label="Welcome to Hermes Dashbord">
    <div className={`a7m-welcome-art${painted ? ' is-painted' : ''}`}>
      <h1 className="a7m-welcome-text">Welcome to<br />Hermes Dashbord</h1>
      <canvas ref={canvasRef} aria-hidden="true" />
    </div>
  </section>;
}

const statusLabels = {
  triage: 'فرز', todo: 'للعمل', scheduled: 'مجدولة', ready: 'جاهزة', running: 'قيد التنفيذ',
  review: 'مراجعة', blocked: 'متوقفة', done: 'مكتملة', archived: 'مؤرشفة',
};

function valueText(value) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '—';
}

function dateText(value) {
  if (value === null || value === undefined || value === '') return '—';
  const date = new Date(typeof value === 'number' ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? valueText(value) : new Intl.DateTimeFormat('ar', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function StateLabel({ status }) {
  return <span className="a7m-state" data-state={status}>
    {statusLabels[status] || <bdi dir="auto">{valueText(status)}</bdi>}
    {statusLabels[status] && <bdi className="a7m-state-code" dir="ltr">{status}</bdi>}
  </span>;
}

function Task({ task, columnName, compact = false }) {
  const status = task.status || columnName;
  return <details className={`a7m-task${compact ? ' a7m-task-compact' : ''}`}>
    <summary>
      <span className="a7m-task-meta"><bdi dir="ltr">{task.id == null ? '—' : `#${task.id}`}</bdi><span className="a7m-disclosure" aria-hidden="true">+</span></span>
      <span className="a7m-task-title" dir="auto">{valueText(task.title)}</span>
      <span className="a7m-task-assignee"><span>المسؤول</span><bdi dir="auto">{valueText(task.assignee)}</bdi></span>
      <StateLabel status={status} />
      {compact && task.latest_summary && <span className="a7m-task-preview">آخر ملخص تشغيل متاح: <bdi dir="auto">{valueText(task.latest_summary)}</bdi></span>}
    </summary>
    <div className="a7m-task-detail">
      <dl>
        <div><dt>آخر ملخص تشغيل متاح</dt><dd dir="auto">{valueText(task.latest_summary)}</dd></div>
        {task.body && <div><dt>التفاصيل</dt><dd className="a7m-task-body" dir="auto">{valueText(task.body)}</dd></div>}
      </dl>
    </div>
  </details>;
}

function Metric({ label, value, note, state }) {
  return <div className="a7m-metric" data-state={state}>
    <dt>{label}</dt><dd dir="ltr">{value ?? '—'}</dd>
    {note && <span className="a7m-metric-note">{note}</span>}
  </div>;
}

function LoadingBoard() {
  return <div className="a7m-loading" role="status">
    <p>جارٍ قراءة لوحة Hermes…</p>
    <div className="a7m-skeleton-grid" aria-hidden="true">
      {[0, 1, 2].map(index => <div className="a7m-skeleton-column" key={index}>
        <span /><span /><span />
      </div>)}
    </div>
  </div>;
}

export function DashboardView({ snapshot, loading, error, refreshing, onRefresh, connection, model, profile, onOpenKanban }) {
  const available = Array.isArray(snapshot?.columns);
  const columns = available ? snapshot.columns : [];
  const allTasks = columns.flatMap(column => (column.tasks || []).map(task => ({ ...task, status: task.status || column.name })));
  const tasks = allTasks.filter(task => task.status !== 'archived');
  const running = tasks.filter(task => task.status === 'running');
  const blocked = tasks.filter(task => task.status === 'blocked');
  const assigned = running.filter(task => typeof task.assignee === 'string' && task.assignee.trim());
  const assignees = available && (!running.length || assigned.length) ? new Set(assigned.map(task => task.assignee)).size : null;
  const connectionValue = typeof connection === 'object' && connection !== null ? connection.status : connection;
  const connectionLabels = { open: 'متصل', idle: 'غير متصل', closed: 'غير متصل', connected: 'متصل', online: 'متصل', disconnected: 'غير متصل', offline: 'غير متصل', connecting: 'جارٍ الاتصال', reconnecting: 'إعادة الاتصال', error: 'تعذر الاتصال' };
  const connectionLabel = connectionValue === true ? 'متصل' : connectionValue === false ? 'غير متصل' : connectionLabels[connectionValue] || valueText(connectionValue);
  const errorMessage = typeof error === 'string' ? error : error?.message;
  const openKanban = <button type="button" className="a7m-button a7m-button-secondary" onClick={onOpenKanban} disabled={!onOpenKanban}>فتح Kanban الأصلي</button>;

  return <div className="a7m-dashboard" data-theme="a7m-terminal" lang="ar" dir="rtl">
    <div className="a7m-shell">
      <header className="a7m-topbar">
        <div className="a7m-brand"><h1 dir="ltr" lang="en">A7M Dashbord</h1><span className="a7m-readonly">عرض فقط</span></div>
        <div className="a7m-toolbar">
          {openKanban}
          <button type="button" className="a7m-button a7m-button-primary" onClick={onRefresh} disabled={refreshing || loading || !onRefresh} aria-busy={Boolean(refreshing)}>
            {refreshing ? 'جارٍ التحديث…' : 'تحديث البيانات'}
          </button>
        </div>
      </header>
      <dl className="a7m-context">
        <div><dt>الاتصال</dt><dd role="status"><bdi>{connectionLabel}</bdi></dd></div>
        <div><dt>النموذج</dt><dd><bdi dir="ltr">{valueText(model)}</bdi></dd></div>
        <div><dt>الملف الشخصي</dt><dd><bdi dir="ltr">{valueText(profile)}</bdi></dd></div>
        <div><dt>آخر قراءة</dt><dd><bdi>{dateText(snapshot?.now)}</bdi></dd></div>
      </dl>
      {error && <div className="a7m-notice" role="alert">
        <strong>{available ? 'تعذر التحديث. البيانات المعروضة قديمة.' : 'تعذر تحميل بيانات اللوحة.'}</strong>
        <span>{errorMessage ? <bdi dir="auto">{errorMessage}</bdi> : 'تحقق من الاتصال ثم أعد المحاولة باستخدام تحديث البيانات.'}</span>
      </div>}
      <dl className="a7m-metrics" aria-label="ملخص المهام">
        <Metric label="قيد التنفيذ" value={available ? running.length : null} state="running" />
        <Metric label="مهام متوقفة" value={available ? blocked.length : null} />
        <Metric label="إجمالي المهام" value={available ? tasks.length : null} note="باستثناء المؤرشفة" />
        <Metric label="وكلاء مهام قيد التنفيذ" value={assignees} note={assigned.length < running.length ? 'بحسب الإسناد المتاح' : 'من إسناد المهام، لا حالة الاتصال'} />
      </dl>
      <main className="a7m-workspace">
        <section className="a7m-board-section" aria-label="لوحة المهام">
          <div className="a7m-section-head">
            <div><h2>لوحة المهام</h2><p><bdi dir="auto">{valueText(snapshot?.boardLabel)}</bdi></p></div>
            <span className="a7m-section-note">الحالات من Kanban</span>
          </div>
          {!available ? (loading ? <LoadingBoard /> : <div className="a7m-empty">
            <h3>{error ? 'اللوحة غير متاحة الآن' : 'لم تصل بيانات اللوحة بعد'}</h3>
            <p>أعد تحميل البيانات أو افتح لوحة Hermes الأصلية.</p>{openKanban}
          </div>) : <>
            {allTasks.length === 0 && <div className="a7m-empty a7m-empty-board">
              <h3>لا توجد مهام في هذه اللوحة</h3><p>تظهر المهام هنا عند إضافتها في Kanban الأصلي.</p>{openKanban}
            </div>}
            {columns.length > 0 && <div className="a7m-board" role="region" aria-label="أعمدة Kanban، قابلة للتمرير أفقيًا" tabIndex={0}>
              {columns.map((column, index) => <section className="a7m-column" key={`${column.name}-${index}`} aria-label={valueText(column.name)}>
                <header className="a7m-column-head"><h3><StateLabel status={column.name} /></h3><span className="a7m-column-count">{column.tasks?.length ?? '—'}</span></header>
                <div className="a7m-column-tasks">
                  {(column.tasks || []).map((task, taskIndex) => <Task task={task} columnName={column.name} key={task.id ?? taskIndex} />)}
                  {column.tasks?.length === 0 && <p className="a7m-column-empty">لا توجد مهام</p>}
                </div>
              </section>)}
            </div>}
          </>}
        </section>
        <aside className="a7m-running" aria-label="المهام قيد التنفيذ">
          <div className="a7m-section-head"><h2>يجري الآن</h2><span className="a7m-running-count">{available ? running.length : '—'}</span></div>
          {!available ? <p className="a7m-aside-empty">{loading ? 'بانتظار بيانات المهام…' : 'بيانات التنفيذ غير متاحة.'}</p> : running.length ? <div className="a7m-running-list">
            {running.map((task, index) => <Task key={task.id ?? index} task={task} compact />)}
          </div> : <p className="a7m-aside-empty">لا توجد مهام قيد التنفيذ.</p>}
          <p className="a7m-aside-note">نشاط المهام من Kanban، وليس قائمة الوكلاء المتصلين.</p>
        </aside>
      </main>
      <footer className="a7m-footer"><span>مصدر البيانات <bdi dir="ltr">Hermes Kanban</bdi></span><span>للتعديل، استخدم اللوحة الأصلية.</span></footer>
    </div>
  </div>;
}

function ModelRow({ model }) {
  const prices = model.prices || {}
  return <details className="a7m-model-row">
    <summary>
      <span className="a7m-model-name"><bdi dir="ltr">{model.name}</bdi></span>
      <span className="a7m-model-id" dir="ltr">{model.id}</span>
      <span className="a7m-model-provider" dir="ltr">{model.provider || '—'}</span>
      <span className="a7m-model-price" dir="ltr">{formatPricePerMillion(prices.input)}</span>
      <span className="a7m-model-price" dir="ltr">{formatPricePerMillion(prices.output)}</span>
      <span className="a7m-model-context" dir="ltr">{model.context_length?.toLocaleString('ar') ?? 'غير متاح'}</span>
    </summary>
    <div className="a7m-model-detail">
      {model.description && <div><strong>وصف المزوّد (كما نُشر)</strong><p className="a7m-model-desc" dir="auto">{model.description}</p></div>}
      {model.capabilities?.length > 0 && <div className="a7m-model-caps">{model.capabilities.map(cap => <span className="a7m-model-cap" key={cap}>{getCapabilityLabel(cap)}</span>)}</div>}
    </div>
  </details>;
}

export function ModelCatalog({ models, meta, loading, error, onRefresh }) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [provider, setProvider] = useState('')
  const [capability, setCapability] = useState('')
  const [sortField, setSortField] = useState('input')
  const [sortDir, setSortDir] = useState('asc')
  const [showCalc, setShowCalc] = useState(false)
  const [calcInput, setCalcInput] = useState('1000')
  const [calcOutput, setCalcOutput] = useState('500')
  const [calcCache, setCalcCache] = useState('0')
  const [selectedModel, setSelectedModel] = useState(null)

  const allModels = Array.isArray(models) ? models : []
  const providers = getUniqueProviders(allModels)
  const capabilities = getUniqueCapabilities(allModels)
  let filtered = searchModels(allModels, query)
  filtered = filterByProvider(filtered, provider || null)
  filtered = filterByCapability(filtered, capability || null)
  filtered = sortByPrice(filtered, sortField, sortDir)
  const total = allModels.length
  const shown = filtered.length
  const pageCount = Math.max(1, Math.ceil(shown / 50))
  const currentPage = Math.min(page, pageCount)
  const visible = filtered.slice((currentPage - 1) * 50, currentPage * 50)

  let costResult = null
  let costError = null
  if (showCalc && selectedModel) {
    try {
      const m = allModels.find(m => m.id === selectedModel)
      if (m) {
        costResult = calculateCost(m.prices, calcInput, calcOutput, calcCache)
      }
    } catch (error) {
      costError = error.message.includes('rate')
        ? 'التكلفة غير متاحة: سعر أحد أنواع الرموز المستخدمة غير منشور.'
        : 'أدخل أعداد رموز صحيحة غير سالبة من 0 إلى 1,000,000,000 في جميع الحقول.'
    }
  }

  const stale = meta?.stale
  const fetchedAt = typeof meta?.fetched_at === 'number' ? new Date(meta.fetched_at * 1000) : null
  const fetchedAtStr = fetchedAt ? new Intl.DateTimeFormat('ar', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(fetchedAt) : null

  return <>
    <div className="a7m-catalog">
      <div className="a7m-topbar">
        <div className="a7m-brand"><h1 dir="ltr" lang="en">A7M Dashbord</h1><span className="a7m-readonly">عرض فقط</span></div>
        <div className="a7m-toolbar">
          <button type="button" className="a7m-button a7m-button-primary" onClick={onRefresh} disabled={loading || !onRefresh} aria-busy={Boolean(loading)}>
            {loading ? 'جارٍ التحميل…' : 'تحديث الموديلات'}
          </button>
        </div>
      </div>
      <dl className="a7m-context">
        <div><dt>المصدر</dt><dd><bdi>{meta?.source || '—'}</bdi></dd></div>
        <div><dt>آخر تحديث</dt><dd><bdi>{fetchedAtStr || '—'}</bdi></dd></div>
        {stale && <div><dt>ملاحظة</dt><dd><bdi>البيانات المخزنة قديمة بسبب تعذر التحديث.</bdi></dd></div>}
      </dl>
      {error && <div className="a7m-notice" role="alert"><bdi>{error}</bdi></div>}
      {loading && allModels.length === 0 && <div className="a7m-loading" role="status"><p>جارٍ تحميل دليل الموديلات…</p></div>}
      {!loading && allModels.length === 0 && !error && <div className="a7m-empty"><h3>لم تصل بيانات الموديلات بعد</h3><p>أعد تحميل البيانات أو تحقق من الاتصال.</p></div>}
      {allModels.length > 0 && <>
        <div className="a7m-catalog-tools">
          <div className="a7m-catalog-filters">
            <label><span>بحث</span><input type="search" className="a7m-catalog-input" dir="ltr" placeholder="اسم الموديل…" value={query} onInput={e => { setQuery(e.target.value); setPage(1) }} /></label>
            <label><span>المزوّد</span><select aria-label="المزوّد" className="a7m-catalog-select" value={provider} onChange={e => { setProvider(e.target.value); setPage(1) }}>
              <option value="">الكل</option>
              {providers.map(p => <option key={p} value={p}>{p}</option>)}
            </select></label>
            <label><span>الإمكانيات</span><select aria-label="الإمكانيات" className="a7m-catalog-select" value={capability} onChange={e => { setCapability(e.target.value); setPage(1) }}>
              <option value="">الكل</option>
              {capabilities.map(c => <option key={c} value={c}>{getCapabilityLabel(c)}</option>)}
            </select></label>
          </div>
          <div className="a7m-catalog-sort">
            <label htmlFor="a7m-price-sort">ترتيب حسب</label>
            <select id="a7m-price-sort" className="a7m-catalog-select" value={sortField} onChange={e => { setSortField(e.target.value); setPage(1) }}>
              <option value="input">سعر الإدخال</option>
              <option value="output">سعر الإخراج</option>
            </select>
            <button type="button" className="a7m-button a7m-button-sort" aria-label="عكس ترتيب السعر" onClick={() => { setSortDir(sortDir === 'asc' ? 'desc' : 'asc'); setPage(1) }}>
              {sortDir === 'asc' ? '↑' : '↓'}
            </button>
          </div>
        </div>
        <div className="a7m-catalog-count"><span>نتائج {shown} من {total} موديل · عرض {shown ? (currentPage - 1) * 50 + 1 : 0}–{Math.min(currentPage * 50, shown)}</span></div>
        <div className="a7m-catalog-table" role="region" aria-label="جدول الموديلات" tabIndex={0}>
          <div className="a7m-catalog-header">
            <span>الاسم</span><span>المعرّف</span><span>المزوّد</span><span>الإدخال $ / مليون</span><span>الإخراج $ / مليون</span><span>السياق</span>
          </div>
          {filtered.length === 0 ? <div className="a7m-catalog-empty">لا توجد نتائج تطابق البحث.</div> :
            visible.map(m => <ModelRow key={m.id} model={m} />)}
        </div>
        <nav className="a7m-catalog-pagination" aria-label="صفحات الموديلات">
          <button type="button" className="a7m-button a7m-button-secondary" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} aria-label="الصفحة السابقة">السابق</button>
          <span role="status">صفحة {currentPage} من {pageCount}</span>
          <button type="button" className="a7m-button a7m-button-secondary" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)} aria-label="الصفحة التالية">التالي</button>
        </nav>
        <details className="a7m-calc-section" onToggle={e => { setShowCalc(e.target.open); if (!e.target.open) setSelectedModel(null) }}>
          <summary className="a7m-calc-head"><h3>حاسبة التكلفة</h3></summary>
          <div className="a7m-calc-body">
            <div className="a7m-calc-fields">
              <label><span>الموديل</span>
                <select aria-label="الموديل" className="a7m-catalog-select" value={selectedModel || ''} onChange={e => setSelectedModel(e.target.value)}>
                  <option value="">اختر موديل…</option>
                  {allModels.map(m => <option key={m.id} value={m.id}>{m.name} ({m.id})</option>)}
                </select>
              </label>
              <label><span>رموز الإدخال</span><input type="number" className="a7m-catalog-input" dir="ltr" value={calcInput} onInput={e => setCalcInput(e.target.value)} min="0" /></label>
              <label><span>رموز الإخراج</span><input type="number" className="a7m-catalog-input" dir="ltr" value={calcOutput} onInput={e => setCalcOutput(e.target.value)} min="0" /></label>
              <label><span>رموز ذاكرة التخزين</span><input type="number" className="a7m-catalog-input" dir="ltr" value={calcCache} onInput={e => setCalcCache(e.target.value)} min="0" /></label>
            </div>
            {costError && <p className="a7m-calc-error a7m-notice" role="alert">{costError}</p>}
            {costResult && <div className="a7m-calc-result">
              <p>التكلفة المقدرة: <bdi dir="ltr">{formatUsd(costResult.total)} USD</bdi></p>
              <p className="a7m-calc-detail">الإدخال: <bdi dir="ltr">{formatUsd(costResult.inputCost)}</bdi> | الإخراج: <bdi dir="ltr">{formatUsd(costResult.outputCost)}</bdi>{costResult.inputCacheCost > 0 && <> | ذاكرة تخزين: <bdi dir="ltr">{formatUsd(costResult.inputCacheCost)}</bdi></>}</p>
              <p className="a7m-calc-note">تقدير لتكلفة الرموز فقط باستخدام الأسعار الخام لكل رمز. الإدخال غير المخزن منفصل عن رموز قراءة التخزين، ولا تجمع الرموز نفسها مرتين. لا تشمل رسوم الطلبات أو الوسائط أو الأدوات.</p>
            </div>}
          </div>
        </details>
        <footer className="a7m-footer"><span>مصدر البيانات: {meta?.source || 'دليل عام'}</span><span>الأسعار المعروضة USD لكل مليون رمز؛ الحاسبة تستخدم السعر الخام لكل رمز.</span></footer>
      </>}
    </div>
  </>;
}
