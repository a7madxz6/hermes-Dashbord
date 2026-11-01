import React from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import plugin from '../plugin.js'
import { ROUTES_AREA, rest } from './sdk.jsx'

let Page
plugin.register({rest, register(c) { if(c.area === ROUTES_AREA) Page = c.render }, onDispose() {}})
const queryClient = new QueryClient({defaultOptions:{queries:{retry:false}}})
createRoot(document.getElementById('root')).render(<QueryClientProvider client={queryClient}>{Page()}</QueryClientProvider>)
