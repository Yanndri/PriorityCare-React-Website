import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import AppRouter from './AppRouter'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import 'leaflet/dist/leaflet.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <AppRouter />
    </AppErrorBoundary>
  </StrictMode>,
)
