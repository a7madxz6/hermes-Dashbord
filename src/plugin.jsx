import { useState, useSyncExternalStore } from 'react'
import { host, gatewayActivationEpoch, useQuery, useValue, ROUTES_AREA, SIDEBAR_NAV_AREA } from '@hermes/plugin-sdk'
import { DashboardView, ModelCatalog, ExecutionHistory, Welcome } from './ui.jsx'
import { normalizeBoard } from './data.mjs'
import { normalizeModels } from './models.mjs'
import css from './style.css'

// Only observe the SDK's local scalar; network polling stays in useQuery.
function subscribeActivation(onChange) {
  let epoch = gatewayActivationEpoch()
  let frame
  let disposed = false
  const check = () => {
    if (disposed) return
    const next = gatewayActivationEpoch()
    if (next !== epoch) { epoch = next; onChange() }
    if (!disposed) frame = requestAnimationFrame(check)
  }
  frame = requestAnimationFrame(check)
  return () => { disposed = true; cancelAnimationFrame(frame) }
}

function Dashboard({ ctx }) {
  const [intro, setIntro] = useState(true)
  const [tab, setTab] = useState('tasks')
  const [executionPage, setExecutionPage] = useState({profile: null, epoch: null, page: 1})
  const connection = useValue(host.state.gateway)
  const profile = useValue(host.state.profile)
  const model = useValue(host.state.model)
  const epoch = useSyncExternalStore(subscribeActivation, gatewayActivationEpoch)
  const page = executionPage.profile === profile && executionPage.epoch === epoch ? executionPage.page : 1
  const query = useQuery({
    queryKey: ['a7m-dashboard', profile, epoch],
    queryFn: async () => {
      const scope = { epoch: gatewayActivationEpoch(), profile: host.state.profile.get() }
      const isCurrent = () => scope.epoch === gatewayActivationEpoch() && scope.profile === host.state.profile.get()
      if (scope.epoch !== epoch || scope.profile !== profile) throw new Error('Gateway selection changed')
      const snapshot = normalizeBoard(await ctx.rest('/snapshot', { method: 'GET', timeoutMs: 12000 }))
      if (!isCurrent()) throw new Error('Gateway selection changed')
      return { ...scope, snapshot }
    },
    refetchInterval: 10000,
    refetchIntervalInBackground: false,
    staleTime: 5000,
    retry: false
  })
  const modelQuery = useQuery({
    queryKey: ['a7m-dashboard-models', profile, epoch],
    queryFn: async () => {
      const scope = { epoch: gatewayActivationEpoch(), profile: host.state.profile.get() }
      const isCurrent = () => scope.epoch === gatewayActivationEpoch() && scope.profile === host.state.profile.get()
      if (scope.epoch !== epoch || scope.profile !== profile) throw new Error('Gateway selection changed')
      const raw = await ctx.rest('/models', { method: 'GET', timeoutMs: 25000 })
      if (!isCurrent()) throw new Error('Gateway selection changed')
      return { ...scope, models: normalizeModels(raw.models || raw), meta: { source: raw.source, fetched_at: raw.fetched_at, stale: raw.stale } }
    },
    enabled: tab === 'models' && !intro,
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
    staleTime: 30000,
    retry: false
  })
  const executionQuery = useQuery({
    queryKey: ['a7m-dashboard-executions', profile, epoch, page],
    queryFn: async () => {
      const scope = { epoch: gatewayActivationEpoch(), profile: host.state.profile.get(), page }
      const isCurrent = () => scope.epoch === gatewayActivationEpoch() && scope.profile === host.state.profile.get()
      if (scope.epoch !== epoch || scope.profile !== profile) throw new Error('Gateway selection changed')
      const data = await ctx.rest(`/executions?page=${page}&limit=25`, { method: 'GET', timeoutMs: 12000 })
      if (!isCurrent()) throw new Error('Gateway selection changed')
      const external = data.opencode_history
      const externalCountValid = Number.isSafeInteger(external?.total) && external.total >= 0 || external?.total === null && ['unavailable', 'disabled'].includes(external.status)
      if (!Array.isArray(data.running) || !Array.isArray(data.history?.rows) || !Array.isArray(data.opencode) || data.history.page !== page || data.history.limit !== 25 || !Number.isSafeInteger(data.history.total) || data.history.total < 0 || !externalCountValid || external.page !== page || external.limit !== 25 || !['available', 'unavailable', 'disabled'].includes(external.status)) throw new Error('Invalid execution history response')
      return { ...scope, data }
    },
    enabled: tab === 'executions' && !intro,
    refetchInterval: tab === 'executions' && !intro ? 10000 : false,
    refetchIntervalInBackground: false,
    staleTime: 5000,
    retry: false
  })
  const executionsData = executionQuery.data?.epoch === gatewayActivationEpoch() && executionQuery.data?.profile === host.state.profile.get() && executionQuery.data?.page === page
    ? executionQuery.data.data : undefined
  const snapshot = query.data?.epoch === gatewayActivationEpoch() && query.data?.profile === host.state.profile.get()
    ? query.data.snapshot : undefined
  const modelsData = modelQuery.data?.epoch === gatewayActivationEpoch() && modelQuery.data?.profile === host.state.profile.get()
    ? modelQuery.data : undefined
  const activeTab = !intro ? tab : 'tasks'
  return <>
    <style>{css}</style>
    {intro ? <Welcome onDone={() => setIntro(false)} /> :
      <div className="a7m-dashboard" data-theme="a7m-terminal" lang="ar" dir="rtl">
        <div className="a7m-shell">
          <nav className="a7m-tabs" role="tablist" aria-label="أقسام لوحة التحكم" onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const tabs = ['tasks', 'models', 'executions']
            const index = tabs.indexOf(tab)
            const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowLeft' ? 1 : 2)) % 3
            const next = tabs[nextIndex]
            setTab(next)
            event.currentTarget.querySelectorAll('[role="tab"]')[nextIndex].focus()
          }}>
            <button role="tab" aria-selected={activeTab === 'tasks'} aria-controls="tabpanel-tasks" className="a7m-tab" onClick={() => setTab('tasks')} tabIndex={activeTab === 'tasks' ? 0 : -1}>المهام</button>
            <button role="tab" aria-selected={activeTab === 'models'} aria-controls="tabpanel-models" className="a7m-tab" onClick={() => setTab('models')} tabIndex={activeTab === 'models' ? 0 : -1}>دليل الموديلات</button>
            <button role="tab" aria-selected={activeTab === 'executions'} aria-controls="tabpanel-executions" className="a7m-tab" onClick={() => setTab('executions')} tabIndex={activeTab === 'executions' ? 0 : -1}>التنفيذ والسجل</button>
          </nav>
          <div role="tabpanel" id="tabpanel-tasks" aria-label="المهام" hidden={activeTab !== 'tasks'}>
            <DashboardView snapshot={snapshot} loading={query.isPending} refreshing={query.isFetching}
              error={query.error ? 'تعذر قراءة Kanban. تحقق من الاتصال وتفعيل إضافة a7m-dashboard على الخادم، ثم أعد المحاولة.' : null}
              connection={connection} model={typeof model === 'string' ? model : model?.name}
              profile={typeof profile === 'string' ? profile : profile?.name}
              onRefresh={() => query.refetch()} onOpenKanban={() => host.navigate('/kanban')} />
          </div>
          <div role="tabpanel" id="tabpanel-models" aria-label="دليل الموديلات" hidden={activeTab !== 'models'}>
            <ModelCatalog models={modelsData?.models} meta={modelsData?.meta} loading={modelQuery.isPending}
              error={modelQuery.error ? 'تعذر تحميل دليل الموديلات العام. تحقق من الاتصال ثم أعد المحاولة.' : null}
              onRefresh={() => modelQuery.refetch()} />
          </div>
          <div role="tabpanel" id="tabpanel-executions" aria-label="التنفيذ والسجل" hidden={activeTab !== 'executions'}>
            <ExecutionHistory data={executionsData} loading={executionQuery.isPending} refreshing={executionQuery.isFetching} page={page}
              error={executionQuery.error ? 'تعذر قراءة سجل التنفيذ. تحقق من الاتصال ثم أعد المحاولة.' : null}
              onPage={page => setExecutionPage({profile, epoch, page})} onRefresh={() => executionQuery.refetch()} />
          </div>
        </div>
      </div>}
  </>
}

export default {
  id: 'a7m-dashboard', name: 'A7M Dashbord', defaultEnabled: true,
  register(ctx) {
    ctx.register({ id: 'page', area: ROUTES_AREA, data: { path: '/a7m-dashboard' }, render: () => <Dashboard ctx={ctx} /> })
    ctx.register({ id: 'nav', area: SIDEBAR_NAV_AREA, data: { path: '/a7m-dashboard', label: 'A7M Dashbord', codicon: 'dashboard' } })
  }
}
