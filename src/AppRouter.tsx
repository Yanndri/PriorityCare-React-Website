
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from 'react-router-dom'

import { LoginPage } from './pages/LoginPage'
import { SuperAdminDashboard } from './pages/SuperAdminDashboard'
import {
  SuperAdminAdminAccounts,
  SuperAdminCreateAdmin,
  SuperAdminOverview,
  SuperAdminSitioOverview,
} from './pages/SuperAdminViews'
import App from './App'

export default function AppRouter() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        {/* Default page */}
        <Route
          path="/"
          element={<Navigate to="/admin/login" replace />}
        />

        {/* Admin login */}
        <Route
          path="/admin/login"
          element={<LoginPage role="admin" />}
        />

        {/* Super Admin login */}
        <Route
          path="/super-admin/login"
          element={<LoginPage role="super_admin" />}
        />

        {/* Existing Admin dashboard */}
        <Route
          path="/admin"
          element={<App />}
        />

        {/* Super Admin: shared layout + sidebar, one view per page */}
        <Route
          path="/super-admin"
          element={<SuperAdminDashboard />}
        >
          <Route index element={<SuperAdminOverview />} />
          <Route
            path="create-admin"
            element={<SuperAdminCreateAdmin />}
          />
          <Route
            path="admins"
            element={<SuperAdminAdminAccounts />}
          />
          <Route
            path="sitios"
            element={<SuperAdminSitioOverview />}
          />
          <Route
            path="*"
            element={<Navigate to="/super-admin" replace />}
          />
        </Route>

        {/* Unknown URL */}
        <Route
          path="*"
          element={<Navigate to="/admin/login" replace />}
        />
      </Routes>
    </BrowserRouter>
  )
}
