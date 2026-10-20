
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from 'react-router-dom'

import { LoginPage } from './pages/LoginPage'
import { RequireStaffRole } from './components/RequireStaffRole'
import { LOGIN_PATH } from './lib/staffProfile'
import App from './App'

// One login URL for every staff role. After sign-in the role is read from
// public.users and the user is sent to /admin or /super-admin. The guards
// below only steer navigation; the backend and RLS enforce permissions.
export default function AppRouter() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/" element={<Navigate to={LOGIN_PATH} replace />} />

        {/* The shared login page */}
        <Route path={LOGIN_PATH} element={<LoginPage />} />

        {/* Old login URLs: no separate pages, same login */}
        <Route path="/admin/login" element={<Navigate to={LOGIN_PATH} replace />} />
        <Route path="/super-admin/login" element={<Navigate to={LOGIN_PATH} replace />} />

        {/* Admin: assigned barangay only */}
        <Route
          path="/admin"
          element={
            <RequireStaffRole role="admin">
              {(profile) => <App profile={profile} />}
            </RequireStaffRole>
          }
        />

        {/* Super Admin: same dashboard shell with system-wide scope and
            extra tabs. Old /super-admin/... links land here too. */}
        <Route
          path="/super-admin/*"
          element={
            <RequireStaffRole role="super_admin">
              {(profile) => <App profile={profile} />}
            </RequireStaffRole>
          }
        />

        <Route path="*" element={<Navigate to={LOGIN_PATH} replace />} />
      </Routes>
    </BrowserRouter>
  )
}
