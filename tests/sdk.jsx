import { useSyncExternalStore } from 'react'
import { useQuery as useRealQuery, useQueryClient } from '@tanstack/react-query'
export { useQueryClient }
export function useQuery(options) {
  window.__queryClient = useQueryClient()
  return useRealQuery({...options, queryFn: async () => {
    const epoch = activationEpoch
    try {
      const data = await options.queryFn()
      ;(window.__settled ||= []).push({epoch, result:'success'})
      return data
    } catch(error) {
      ;(window.__settled ||= []).push({epoch, result:'error'})
      throw error
    }
  }})
}
let activationEpoch = 0
export const gatewayActivationEpoch = () => activationEpoch
window.__source = 'A'
// Route selection can change without any profile/socket atom notification.
window.__activate = source => { window.__source = source; activationEpoch++ }
export const ROUTES_AREA = 'routes'
export const SIDEBAR_NAV_AREA = 'sidebar.nav'
const listeners = new Set()
function atom(value) { return { get: () => value, set(v) { value = v; listeners.forEach(fn => fn()) } } }
export const host = {
  state: { gateway: atom('connected'), profile: atom('test-profile'), model: atom('test-model') },
  navigate(path) { window.__navigation = path }
}
export function useValue(atom) {
  return useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn) }, atom.get)
}
window.__host = host
export async function rest(path, options) {
  window.__calls ||= []
  window.__calls.push({path,options,source:window.__source,epoch:activationEpoch})
  const response = await fetch('/test-api' + path, {method: options.method, headers: {'x-test-source': window.__source}})
  if (!response.ok) throw new Error('test backend unavailable')
  return response.json()
}
