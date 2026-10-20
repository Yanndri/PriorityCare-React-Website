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
import { ResponderAccountsPage } from './pages/ResponderAccountsPage'
import { PreemptiveEvacuationPage } from './pages/PreemptiveEvacuationPage'
import { EditResidentModal } from './components/EditResidentModal'
import { AuditTrailPanel } from './components/AuditTrailPanel'
import { SuperAdminSection } from './pages/SuperAdminDashboard'

import { exportReport } from './utils/exportReport'

import {
  ALL_BARANGAYS,
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

type BarangayOption = { barangay_id: number; barangay_name: string }

// One dashboard shell for both staff roles.
// Admin: the assigned barangay only; the scope cannot be changed.
// Super Admin: all barangays by default, or one barangay picked in the scope
// selector, plus the Super Admin management tabs.
function App({ profile }: AppProps) {
  const navigate = useNavigate()
  const isSuperAdmin = profile.role === 'super_admin'
  const menuItems = isSuperAdmin ? superAdminMenuItems : adminMenuItems

  const [activeMenu, setActiveMenu] = useState<MenuKey>('home')
  const [scope, setScope] = useState<string>(
    isSuperAdmin ? ALL_BARANGAYS : String(profile.assignedBarangayId ?? ''),
  )
  const [barangayOptions, setBarangayOptions] = useState<BarangayOption[]>([])
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

  const [assignedBarangayId, setAssignedBarangayId] =
    useState<string | null>(null)

  const [assignedBarangayName, setAssignedBarangayName] =
    useState('')

  const [verifyingResidentId, setVerifyingResidentId] =
    useState<number | string | null>(null)

  const [editingResident, setEditingResident] =
    useState<Resident | null>(null)

  const [savingResidentId, setSavingResidentId] =
    useState<number | string | null>(null)

  // Super Admin scope selector: every barangay.
  useEffect(() => {
    if (!isSuperAdmin || !hasSupabaseConfig) return
    let cancelled = false

    supabase
      .from('barangays')
      .select('barangay_id, barangay_name')
      .order('barangay_name')
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) console.error('Failed to load barangays:', error)
        else setBarangayOptions((data ?? []) as BarangayOption[])
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
        const barangayId = isSuperAdmin
          ? scope
          : String(profile.assignedBarangayId ?? '')

        const allBarangays = isSuperAdmin && barangayId === ALL_BARANGAYS

        if (!allBarangays && !/^[1-9][0-9]*$/.test(barangayId)) {
          throw new Error(
            isSuperAdmin
              ? 'Choose a barangay from the scope selector.'
              : 'Your account has no assigned barangay. Contact the Super Admin.',
          )
        }

        let barangayName = 'All barangays'

        if (!allBarangays) {
          const { data: barangay, error: barangayError } =
            await supabase
              .from('barangays')
              .select('barangay_id, barangay_name')
              .eq('barangay_id', barangayId)
              .maybeSingle()

          if (barangayError) throw barangayError

          if (!barangay) {
            throw new Error(
              isSuperAdmin
                ? 'This barangay could not be found.'
                : 'Your assigned barangay could not be found.',
            )
          }

          barangayName = String(barangay.barangay_name ?? 'Assigned Barangay')
        }

        const data =
          await fetchDashboardDataFromSupabase(barangayId)

        if (cancelled) return

        setAssignedBarangayId(barangayId)
        setAssignedBarangayName(barangayName)
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
  }, [isSuperAdmin, profile.assignedBarangayId, scope])

  function changeScope(next: string) {
    if (!isSuperAdmin || next === scope) return
    setIsLoadingDatabase(true)
    setScope(next)
  }

  async function handleSignOut() {
    await signOutStaff()
    navigate(LOGIN_PATH, { replace: true })
  }

  // Always refresh the scope already loaded (an Admin's assigned barangay).
  async function reloadDashboardData() {
    if (!assignedBarangayId) {
      throw new Error(
        'No assigned barangay is available. Please log in again.',
      )
    }

    const data =
      await fetchDashboardDataFromSupabase(assignedBarangayId)

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
        error instanceof Error ? error.message : 'Unable to delete this resident.',
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

  // Location filter options: the barangays actually present in the data.
  const locationOptions = useMemo(
    () => [...new Set(liveResidents.map((resident) => resident.barangay).filter(Boolean))].sort(),
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
          ? assignedBarangayId === ALL_BARANGAYS ? 'All barangays' : 'Selected barangay'
          : 'Assigned barangay',
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
  }, [liveResidents, isSuperAdmin, assignedBarangayId])

  const constraintStats = useMemo(() => {
    return getConstraintStats(liveResidents)
  }, [liveResidents])

  const activeTitle =
    menuItems.find((item) => item.key === activeMenu)?.label ??
    'Dashboard'

  const scopeLabel = isSuperAdmin
    ? assignedBarangayId === ALL_BARANGAYS ? 'All barangays' : assignedBarangayName
    : assignedBarangayName
  const generatedBy = `${profile.fullName || profile.email} (${isSuperAdmin ? 'Super Admin' : 'Admin'})`

  // Super Admin management tabs do not depend on the barangay data.
  const isManagementTab =
    isSuperAdmin &&
    (activeMenu === 'barangayOverview' ||
      activeMenu === 'adminAccounts' ||
      activeMenu === 'responderAccounts' ||
      activeMenu === 'activityLogs')

  function openBarangay(barangayId: number) {
    changeScope(String(barangayId))
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
          <div className="admin-barangay-banner">
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
                  <option value={ALL_BARANGAYS}>All barangays</option>
                  {barangayOptions.map((barangay) => (
                    <option key={barangay.barangay_id} value={String(barangay.barangay_id)}>
                      {barangay.barangay_name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="barangay-status">
                Assigned Barangay
              </span>
            )}
          </div>

          {isManagementTab ? (
            <>
              {activeMenu === 'barangayOverview' && (
                <SuperAdminSection view="barangays" onOpenBarangay={openBarangay} />
              )}
              {activeMenu === 'adminAccounts' && (
                <SuperAdminSection view="accounts" onOpenBarangay={openBarangay} />
              )}
              {activeMenu === 'responderAccounts' && <ResponderAccountsPage />}
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
                  : 'Confirm that you are logged in with an active Admin account and that your assigned barangay is configured.'}
              </p>
            </div>
          ) : (
          <>
          {isSuperAdmin && activeMenu === 'home' && (
            <SuperAdminSection view="overview" onOpenBarangay={openBarangay} />
          )}

          <PageTitle
            title={activeTitle}
            index={menuItems.findIndex((item) => item.key === activeMenu)}
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
            <GeoMapPage residents={liveResidents} centers={liveEvacuationCenters} />
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

          {activeMenu === 'preemptiveEvacuation' && (
            <PreemptiveEvacuationPage
              scopeBarangayId={
                assignedBarangayId && assignedBarangayId !== ALL_BARANGAYS ? Number(assignedBarangayId) : null
              }
            />
          )}

          {activeMenu === 'evacCenters' && (
            <EvacCentersPage
              onReload={reloadDashboardData}
              centers={liveEvacuationCenters}
              barangayOptions={isSuperAdmin ? barangayOptions : undefined}
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
    resident.barangay.toLowerCase().includes(search) ||
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
