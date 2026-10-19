import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import AppRouter from './AppRouter'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import 'leaflet/dist/leaflet.css'
// Loaded last so the visual theme wins over older component styles.
import './styles/theme.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <AppRouter />
    </AppErrorBoundary>
  </StrictMode>,
)
