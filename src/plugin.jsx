import { useState, useSyncExternalStore } from 'react'
import { host, gatewayActivationEpoch, useQuery, useValue, ROUTES_AREA, SIDEBAR_NAV_AREA } from '@hermes/plugin-sdk'
import { DashboardView, Welcome } from './ui.jsx'
import { normalizeBoard } from './data.mjs'
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
  const connection = useValue(host.state.gateway)
  const profile = useValue(host.state.profile)
  const model = useValue(host.state.model)
  // profileRoutes() lists routes, not the selected one; epoch identifies its activation.
  const epoch = useSyncExternalStore(subscribeActivation, gatewayActivationEpoch)
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
  const snapshot = query.data?.epoch === gatewayActivationEpoch() && query.data?.profile === host.state.profile.get()
    ? query.data.snapshot : undefined
  return <>
    <style>{css}</style>
    {intro ? <Welcome onDone={() => setIntro(false)} /> :
      <DashboardView snapshot={snapshot} loading={query.isPending} refreshing={query.isFetching}
        error={query.error ? 'تعذر قراءة Kanban. تحقق من الاتصال وتفعيل إضافة a7m-dashboard على الخادم، ثم أعد المحاولة.' : null}
        connection={connection} model={typeof model === 'string' ? model : model?.name}
        profile={typeof profile === 'string' ? profile : profile?.name}
        onRefresh={() => query.refetch()} onOpenKanban={() => host.navigate('/kanban')} />}
  </>
}

export default {
  id: 'a7m-dashboard', name: 'A7M Dashbord', defaultEnabled: true,
  register(ctx) {
    ctx.register({ id: 'page', area: ROUTES_AREA, data: { path: '/a7m-dashboard' }, render: () => <Dashboard ctx={ctx} /> })
    ctx.register({ id: 'nav', area: SIDEBAR_NAV_AREA, data: { path: '/a7m-dashboard', label: 'A7M Dashbord', codicon: 'dashboard' } })
  }
}
