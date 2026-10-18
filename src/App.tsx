import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './App.css'

import { adminMenuItems, superAdminMenuItems } from './data/dashboardData'

import type {
  MenuKey,
  Resident,
  Status,
} from './types/dashboard'

import { AppHeader } from './components/AppHeader'
import { Sidebar } from './components/Sidebar'
import { PageTitle } from './components/PageTitle'

import { HomePage } from './pages/HomePage'
import { VerificationPage } from './pages/VerificationPage'
import { GeoMapPage } from './pages/GeoMapPage'
import { DisasterEventsPage } from './pages/DisasterEventsPage'
import { RescueReconciliationPage } from './pages/RescueReconciliationPage'
import { FamilyReunificationPage } from './pages/FamilyReunificationPage'
import { DispatchPage } from './pages/DispatchPage'
import { ReportsPage } from './pages/ReportsPage'
import { DataMiningPage } from './pages/DataMiningPage'
import { EvacCentersPage } from './pages/EvacCentersPage'
import { EditResidentModal } from './components/EditResidentModal'
import { AuditTrailPanel } from './components/AuditTrailPanel'
import { SuperAdminSection } from './pages/SuperAdminDashboard'

import { exportReport } from './utils/exportReport'

import {
  ALL_SITIOS,
  deleteResidentProfile,
  fetchDashboardDataFromSupabase,
  rejectResidentUser,
  verifyResidentUser,
  type DashboardData,
} from './api/dashboardApi'
import { saveResidentProfile, type ResidentProfileInput } from './api/residentProfileApi'

import {
  hasSupabaseConfig,
  supabase,
} from './lib/supabaseClient'
import {
  LOGIN_PATH,
  signOutStaff,
  type StaffProfile,
} from './lib/staffProfile'

type AppProps = {
  // Verified by RequireStaffRole from public.users before App renders.
  profile: StaffProfile
}

type SitioOption = { sitio_id: number; sitio_name: string }

// One dashboard shell for both staff roles.
// Admin: the assigned sitio only; the scope cannot be changed.
// Super Admin: all sitios by default, or one sitio picked in the scope
// selector, plus the Super Admin management tabs.
function App({ profile }: AppProps) {
  const navigate = useNavigate()
  const isSuperAdmin = profile.role === 'super_admin'
  const menuItems = isSuperAdmin ? superAdminMenuItems : adminMenuItems

  const [activeMenu, setActiveMenu] = useState<MenuKey>('home')
  const [scope, setScope] = useState<string>(
    isSuperAdmin ? ALL_SITIOS : String(profile.assignedSitioId ?? ''),
  )
  const [sitioOptions, setSitioOptions] = useState<SitioOption[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] =
    useState<'All' | Status>('All')

  const [dashboardData, setDashboardData] =
    useState<DashboardData>({
      residents: [],
      alerts: [],
      evacuationCenters: [],
      evacuationHistory: [],
    })

  const [isLoadingDatabase, setIsLoadingDatabase] =
    useState(hasSupabaseConfig)

  const [databaseError, setDatabaseError] =
    useState<string | null>(
      hasSupabaseConfig
        ? null
        : 'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local, then restart Vite.',
    )

  const [assignedSitioId, setAssignedSitioId] =
    useState<string | null>(null)

  const [assignedSitioName, setAssignedSitioName] =
    useState('')

  const [verifyingResidentId, setVerifyingResidentId] =
    useState<number | string | null>(null)

  const [editingResident, setEditingResident] =
    useState<Resident | null>(null)

  const [savingResidentId, setSavingResidentId] =
    useState<number | string | null>(null)

  // Super Admin scope selector: every sitio.
  useEffect(() => {
    if (!isSuperAdmin || !hasSupabaseConfig) return
    let cancelled = false

    supabase
      .from('sitios')
      .select('sitio_id, sitio_name')
      .order('sitio_name')
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) console.error('Failed to load sitios:', error)
        else setSitioOptions((data ?? []) as SitioOption[])
      })

    return () => {
      cancelled = true
    }
  }, [isSuperAdmin])

  // Load the dashboard data for the current scope.
  useEffect(() => {
    let cancelled = false

    async function loadAdminDashboard() {
      try {
        // An Admin's scope always comes from their verified profile.
        const sitioId = isSuperAdmin
          ? scope
          : String(profile.assignedSitioId ?? '')

        const allSitios = isSuperAdmin && sitioId === ALL_SITIOS

        if (!allSitios && !/^[1-9][0-9]*$/.test(sitioId)) {
          throw new Error(
            isSuperAdmin
              ? 'Choose a sitio from the scope selector.'
              : 'Your account has no assigned sitio. Contact the Super Admin.',
          )
        }

        let sitioName = 'All sitios'

        if (!allSitios) {
          const { data: sitio, error: sitioError } =
            await supabase
              .from('sitios')
              .select('sitio_id, sitio_name')
              .eq('sitio_id', sitioId)
              .maybeSingle()

          if (sitioError) throw sitioError

          if (!sitio) {
            throw new Error(
              isSuperAdmin
                ? 'This sitio could not be found.'
                : 'Your assigned sitio could not be found.',
            )
          }

          sitioName = String(sitio.sitio_name ?? 'Assigned Sitio')
        }

        const data =
          await fetchDashboardDataFromSupabase(sitioId)

        if (cancelled) return

        setAssignedSitioId(sitioId)
        setAssignedSitioName(sitioName)
        setDashboardData(data)
        setDatabaseError(null)
      } catch (error) {
        if (cancelled) return

        console.error(
          'Failed to load Admin Dashboard:',
          error,
        )

        setDatabaseError(
          error instanceof Error
            ? error.message
            : 'Unable to load the Admin Dashboard.',
        )
      } finally {
        if (!cancelled) {
          setIsLoadingDatabase(false)
        }
      }
    }

    // isLoadingDatabase starts as hasSupabaseConfig, so it is
    // already false here; there is nothing to load.
    if (!hasSupabaseConfig) {
      return
    }

    void loadAdminDashboard()

    return () => {
      cancelled = true
    }
  }, [isSuperAdmin, profile.assignedSitioId, scope])

  function changeScope(next: string) {
    if (!isSuperAdmin || next === scope) return
    setIsLoadingDatabase(true)
    setScope(next)
  }

  async function handleSignOut() {
    await signOutStaff()
    navigate(LOGIN_PATH, { replace: true })
  }

  // Always refresh the scope already loaded (an Admin's assigned sitio).
  async function reloadDashboardData() {
    if (!assignedSitioId) {
      throw new Error(
        'No assigned sitio is available. Please log in again.',
      )
    }

    const data =
      await fetchDashboardDataFromSupabase(assignedSitioId)

    setDashboardData(data)
    setDatabaseError(null)
  }

  async function handleVerifyResident(
    residentId: number | string,
  ) {
    setVerifyingResidentId(residentId)

    try {
      await verifyResidentUser(residentId)
      await reloadDashboardData()
    } catch (error) {
      console.error('Failed to verify resident:', error)

      window.alert(
        'Unable to verify this resident. Check your access permissions and try again.',
      )
    } finally {
      setVerifyingResidentId(null)
    }
  }

  async function handleRejectResident(
    residentId: number | string,
    reason: string,
  ) {
    setVerifyingResidentId(residentId)

    try {
      await rejectResidentUser(residentId, reason)
      await reloadDashboardData()
    } catch (error) {
      console.error('Failed to reject resident:', error)

      window.alert(
        'Unable to reject this resident. Check your access permissions and try again.',
      )
    } finally {
      setVerifyingResidentId(null)
    }
  }

  async function handleSaveResident(
    residentId: number | string,
    updates: ResidentProfileInput,
  ) {
    setSavingResidentId(residentId)

    try {
      await saveResidentProfile(residentId, updates)
      setEditingResident(null)
      await reloadDashboardData()
    } catch (error) {
      console.error('Failed to update resident:', error)

      throw error
    } finally {
      setSavingResidentId(null)
    }
  }

  async function handleDeleteResident(resident: Resident) {
    if (
      !window.confirm(
        `Delete ${resident.name} permanently? This action cannot be undone.`,
      )
    ) {
      return
    }

    try {
      await deleteResidentProfile(resident.id)
      await reloadDashboardData()
    } catch (error) {
      console.error('Failed to delete resident:', error)

      window.alert(
        'Unable to delete this resident. Check your access permissions and try again.',
      )
    }
  }

  const liveResidents = dashboardData.residents
  const liveAlerts = dashboardData.alerts
  const liveEvacuationCenters =
    dashboardData.evacuationCenters

  const filteredResidents = useMemo(() => {
    return liveResidents.filter((resident) => {
      return (
        matchesSearch(resident, searchTerm) &&
        matchesStatus(resident.status, statusFilter)
      )
    })
  }, [liveResidents, searchTerm, statusFilter])

  // Location filter options: the sitios actually present in the data.
  const locationOptions = useMemo(
    () => [...new Set(liveResidents.map((resident) => resident.sitio).filter(Boolean))].sort(),
    [liveResidents],
  )

  const stats = useMemo(() => {
    const pending = liveResidents.filter(
      (resident) => resident.status === 'Pending',
    ).length

    const verified = liveResidents.filter(
      (resident) => resident.status === 'Verified',
    ).length

    const floodZone = liveResidents.filter(
      (resident) => resident.floodZone,
    ).length

    return [
      {
        label: 'Total Registered',
        value: liveResidents.length,
        note: isSuperAdmin
          ? assignedSitioId === ALL_SITIOS ? 'All sitios' : 'Selected sitio'
          : 'Assigned sitio',
        tone: 'black',
      },
      {
        label: 'Pending Verification',
        value: pending,
        note: 'Needs review',
        tone: 'orange',
      },
      {
        label: 'Verified Residents',
        value: verified,
        note: 'Verified profiles',
        tone: 'green',
      },
      {
        label: 'Flood-Prone Residents',
        value: floodZone,
        note: 'Residents with mapped coordinates',
        tone: 'blue',
      },
    ]
  }, [liveResidents, isSuperAdmin, assignedSitioId])

  const constraintStats = useMemo(() => {
    return getConstraintStats(liveResidents)
  }, [liveResidents])

  const activeTitle =
    menuItems.find((item) => item.key === activeMenu)?.label ??
    'Dashboard'

  const scopeLabel = isSuperAdmin
    ? assignedSitioId === ALL_SITIOS ? 'All sitios' : assignedSitioName
    : assignedSitioName
  const generatedBy = `${profile.fullName || profile.email} (${isSuperAdmin ? 'Super Admin' : 'Admin'})`

  // Super Admin management tabs do not depend on the sitio data.
  const isManagementTab =
    isSuperAdmin &&
    (activeMenu === 'sitioOverview' ||
      activeMenu === 'adminAccounts' ||
      activeMenu === 'activityLogs')

  function openSitio(sitioId: number) {
    changeScope(String(sitioId))
    setActiveMenu('home')
  }

  return (
    <div className="app">
      <AppHeader
        name={profile.fullName || profile.email}
        roleLabel={isSuperAdmin ? 'Super Admin' : 'Admin'}
        onSignOut={() => void handleSignOut()}
      />

      <div className="app-layout">
        <Sidebar
          items={menuItems}
          subtitle={isSuperAdmin ? 'Super Admin' : 'Admin Dashboard'}
          activeMenu={activeMenu}
          onMenuChange={setActiveMenu}
        />

        <main className="page-content">
          <div className="admin-sitio-banner">
            <div>
              <span>
                {isSuperAdmin ? 'Super Admin · Viewing' : 'Admin Dashboard'}
              </span>
              <strong>{scopeLabel || '…'}</strong>
            </div>
            {isSuperAdmin ? (
              <label className="scope-select">
                <span>Scope</span>
                <select
                  value={scope}
                  disabled={isLoadingDatabase}
                  onChange={(event) => changeScope(event.target.value)}
                >
                  <option value={ALL_SITIOS}>All sitios</option>
                  {sitioOptions.map((sitio) => (
                    <option key={sitio.sitio_id} value={String(sitio.sitio_id)}>
                      {sitio.sitio_name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="sitio-status">
                Assigned Sitio
              </span>
            )}
          </div>

          {isManagementTab ? (
            <>
              {activeMenu === 'sitioOverview' && (
                <SuperAdminSection view="sitios" onOpenSitio={openSitio} />
              )}
              {activeMenu === 'adminAccounts' && (
                <SuperAdminSection view="accounts" onOpenSitio={openSitio} />
              )}
              {activeMenu === 'activityLogs' && <AuditTrailPanel />}
            </>
          ) : isLoadingDatabase ? (
            <div className="dashboard-message" role="status">
              Loading {scopeLabel || 'dashboard'} data…
            </div>
          ) : databaseError ? (
            <div className="dashboard-error" role="alert">
              <h2>Unable to load dashboard data</h2>
              <p>{databaseError}</p>
              <p>
                {isSuperAdmin
                  ? 'Choose another scope, or check the database connection.'
                  : 'Confirm that you are logged in with an active Admin account and that your assigned sitio is configured.'}
              </p>
            </div>
          ) : (
          <>
          {isSuperAdmin && activeMenu === 'home' && (
            <SuperAdminSection view="overview" onOpenSitio={openSitio} />
          )}

          <PageTitle
            title={activeTitle}
            onExportReport={() =>
              exportReport({
                stats,
                residents: liveResidents,
                alerts: liveAlerts,
                evacuationCenters: liveEvacuationCenters,
                scopeLabel,
                generatedBy,
              })
            }
          />

          {activeMenu === 'home' && (
            <HomePage
              stats={stats}
              residents={filteredResidents}
              alerts={liveAlerts}
              evacuationCenters={liveEvacuationCenters}
              constraintStats={constraintStats}
              searchTerm={searchTerm}
              statusFilter={statusFilter}
              onSearchChange={setSearchTerm}
              onStatusFilterChange={setStatusFilter}
              locationOptions={locationOptions}
            />
          )}

          {activeMenu === 'verification' && (
            <VerificationPage
              residents={filteredResidents}
              searchTerm={searchTerm}
              statusFilter={statusFilter}
              onSearchChange={setSearchTerm}
              onStatusFilterChange={setStatusFilter}
              locationOptions={locationOptions}
              verifyingResidentId={verifyingResidentId}
              onVerifyResident={handleVerifyResident}
              onRejectResident={handleRejectResident}
              onEditResident={setEditingResident}
              onDeleteResident={handleDeleteResident}
            />
          )}

          {activeMenu === 'geoMap' && (
            <GeoMapPage residents={liveResidents} />
          )}

          {activeMenu === 'disasterEvents' && <DisasterEventsPage />}

          {activeMenu === 'rescueReconciliation' && <RescueReconciliationPage />}

          {activeMenu === 'familyReunification' && <FamilyReunificationPage />}

          {activeMenu === 'dispatch' && <DispatchPage residents={liveResidents} />}

          {activeMenu === 'reports' && (
            <ReportsPage
              stats={stats}
              scopeLabel={scopeLabel}
              generatedBy={generatedBy}
            />
          )}

          {activeMenu === 'dataMining' && (
            <DataMiningPage residents={liveResidents} />
          )}

          {activeMenu === 'evacCenters' && (
            <EvacCentersPage
              onReload={reloadDashboardData}
              centers={liveEvacuationCenters}
            />
          )}
          </>
          )}
        </main>
      </div>

      <EditResidentModal
        resident={editingResident}
        isSaving={savingResidentId !== null}
        onClose={() => setEditingResident(null)}
        onSave={handleSaveResident}
      />
    </div>
  )
}

function matchesSearch(
  resident: Resident,
  searchTerm: string,
) {
  const search = searchTerm.toLowerCase().trim()

  if (!search) return true

  return (
    resident.name.toLowerCase().includes(search) ||
    resident.sitio.toLowerCase().includes(search) ||
    resident.constraint.toLowerCase().includes(search)
  )
}

function matchesStatus(
  residentStatus: Status,
  selectedStatus: 'All' | Status,
) {
  return (
    selectedStatus === 'All' ||
    residentStatus === selectedStatus
  )
}

function getConstraintStats(allResidents: Resident[]) {
  if (allResidents.length === 0) return []

  const counts = allResidents.reduce<Record<string, number>>(
    (totals, resident) => {
      totals[resident.constraint] =
        (totals[resident.constraint] ?? 0) + 1

      return totals
    },
    {},
  )

  return Object.entries(counts).map(([label, value]) => ({
    label,
    value,
    percent: Math.round(
      (value / allResidents.length) * 100,
    ),
  }))
}

export default App
