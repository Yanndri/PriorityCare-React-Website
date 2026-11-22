import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Icons are bundled (not loaded from a CDN) so they still show on a weak connection.
import './assets/uicons/uicons-regular-straight.css'
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
