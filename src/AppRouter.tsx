
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from 'react-router-dom'

import { LoginPage } from './pages/LoginPage'
import { SuperAdminDashboard } from './pages/SuperAdminDashboard'
import App from './App'

export default function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Default page */}
        <Route
          path="/"
          element={
            <Navigate
              to="/admin/login"
              replace
            />
          }
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

        {/* Admin dashboard */}
        <Route
          path="/admin"
          element={<App />}
        />

        {/* Super Admin dashboard */}
        <Route
          path="/super-admin"
          element={<SuperAdminDashboard />}
        />

        {/* Unknown URL */}
        <Route
          path="*"
          element={
            <Navigate
              to="/admin/login"
              replace
            />
          }
        />
      </Routes>
    </BrowserRouter>
  )
}
