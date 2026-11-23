import { useEffect, useMemo, useState } from 'react'
import { ScopeContext } from './lib/scope'
import { useNavigate } from 'react-router-dom'
import './App.css'

import { adminMenuItems, menuParent, pageDescriptions, superAdminMenuItems, tabLabels } from './data/dashboardData'

import type {
  AccountAction,
  AccountFilter,
  MenuKey,
  Resident,
  Status,
} from './types/dashboard'

import { AppHeader } from './components/AppHeader'
import { Sidebar } from './components/Sidebar'
import { OperationBar } from './components/OperationBar'
import { useOperationStatus } from './lib/useOperationStatus'
import { PageTitle } from './components/PageTitle'

import { HomePage } from './pages/HomePage'
import { VerificationPage } from './pages/VerificationPage'
import { GeoMapPage } from './pages/GeoMapPage'
import { DisasterEventsPage } from './pages/DisasterEventsPage'
import { RescueReconciliationPage } from './pages/RescueReconciliationPage'
import { DispatchPage } from './pages/DispatchPage'
import { ReportsPage } from './pages/ReportsPage'
import { PopulationPage } from './pages/PopulationPage'
import { SubTabs } from './components/SubTabs'
import { EvacCentersPage } from './pages/EvacCentersPage'
import { ResponderAccountsPage } from './pages/ResponderAccountsPage'
import { PreemptiveEvacuationPage } from './pages/PreemptiveEvacuationPage'
import { DataMiningPage } from './pages/DataMiningPage'
import { EditResidentModal } from './components/EditResidentModal'
import { RegisterResidentModal } from './components/RegisterResidentModal'
import { AuditTrailPanel } from './components/AuditTrailPanel'
import { SuperAdminSection } from './pages/SuperAdminDashboard'

import { exportReport } from './utils/exportReport'

import {
  ALL_BARANGAYS,
  fetchDashboardDataFromSupabase,
  rejectResidentUser,
  setResidentAccountState,
  verifyResidentUser,
  type DashboardData,
} from './api/dashboardApi'
import { resetLogin, saveResidentProfile, type ResidentProfileInput } from './api/residentProfileApi'

import {
  hasSupabaseConfig,
  supabase,
} from './lib/supabaseClient'
import {
  LOGIN_PATH,
  signOutStaff,
  type StaffProfile,
} from './lib/staffProfile'
import { useLiveSignal } from './lib/useLiveSignal'
import { ShowOnMapContext, type MapPin } from './lib/showOnMap'

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
  // Set by a "See on map" button; cleared when another menu item is chosen.
  const [mapPin, setMapPin] = useState<MapPin | null>(null)
  const [scope, setScope] = useState<string>(
    isSuperAdmin ? ALL_BARANGAYS : String(profile.assignedBarangayId ?? ''),
  )
  const [barangayOptions, setBarangayOptions] = useState<BarangayOption[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] =
    useState<'All' | Status>('All')
  const [accountFilter, setAccountFilter] =
    useState<AccountFilter>('Current')

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

  const [registeringResident, setRegisteringResident] = useState(false)

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

  // Residents, centers and check-ins changed elsewhere (the app, a rescuer, another admin):
  // reload the same scope quietly so lists, occupancy and the verification queue stay current.
  useLiveSignal(['residents', 'accounts', 'centers', 'evacuation', 'shelter_plans'], () => {
    if (assignedBarangayId) void reloadDashboardData().catch(() => { /* keep what is shown */ })
  }, !isLoadingDatabase)

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

  // Barangays a staff member can register residents in.
  const registrationBarangays = useMemo<BarangayOption[]>(() => {
    if (isSuperAdmin) return barangayOptions
    const id = Number(assignedBarangayId)
    return Number.isInteger(id) && id > 0 ? [{ barangay_id: id, barangay_name: assignedBarangayName }] : []
  }, [isSuperAdmin, barangayOptions, assignedBarangayId, assignedBarangayName])

  async function handleResidentRegistered(uid: string, markVerified: boolean) {
    setRegisteringResident(false)
    if (markVerified) {
      try {
        await verifyResidentUser(uid)
      } catch (error) {
        console.error('Failed to verify new resident:', error)
        window.alert('The resident was registered but could not be marked verified. Verify them from the list.')
      }
    }
    await reloadDashboardData()
  }

  // Archived residents only appear in the Verification list when its account
  // filter asks for them; every other view works with current residents.
  const allResidents = dashboardData.residents
  const liveResidents = useMemo(
    () => allResidents.filter((resident) => resident.accountState !== 'Archived'),
    [allResidents],
  )
  async function handleResidentAccountState(resident: Resident, action: AccountAction) {
    let reason: string | undefined

    if (action === 'deactivate' || action === 'archive') {
      const effect = action === 'deactivate'
        ? 'Their account stops working until it is reactivated.'
        : 'Their account stops working and they are hidden from the current resident lists.'
      const answer = window.prompt(
        `${action === 'deactivate' ? 'Deactivate' : 'Archive'} ${resident.name}? ${effect} All their records are kept.\n\nReason (required):`,
      )
      if (answer === null) return
      if (!answer.trim()) {
        window.alert('Please give a reason.')
        return
      }
      reason = answer.trim()
    } else if (
      !window.confirm(
        `${action === 'restore' ? 'Restore' : 'Reactivate'} ${resident.name}? Their account will work again.`,
      )
    ) {
      return
    }

    try {
      await setResidentAccountState(resident.id, action, reason)
      await reloadDashboardData()
    } catch (error) {
      console.error('Failed to change resident account:', error)

      window.alert(
        error instanceof Error ? error.message : 'Unable to change this resident account.',
      )
    }
  }

  // Forgot PIN: the admin checks the resident's ID first, then gives them the new PIN in person.
  async function handleResetPin(resident: Resident) {
    if (!window.confirm(
      `Reset the PIN for ${resident.name}?\n\nCheck their valid ID first. Their old PIN stops working right away, `
      + 'and you will see the new 6-digit PIN once to give to them in person.',
    )) return
    try {
      const { secret } = await resetLogin(String(resident.id))
      window.alert(
        `New PIN for ${resident.name}: ${secret}\n\nGive it to them in person or by a call to their registered number. `
        + 'It is not shown again. They can change it in the app under Profile > Change PIN.',
      )
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Unable to reset this PIN.')
    }
  }

  const liveAlerts = dashboardData.alerts
  const liveEvacuationCenters =
    dashboardData.evacuationCenters

  const filteredResidents = useMemo(() => {
    return allResidents.filter((resident) => {
      return (
        matchesSearch(resident, searchTerm) &&
        matchesStatus(resident.status, statusFilter) &&
        matchesAccount(resident, accountFilter)
      )
    })
  }, [allResidents, searchTerm, statusFilter, accountFilter])
  // How many residents each status tab holds (same search and account filter).
  const residentStatusCounts = useMemo(() => {
    const counts = { All: 0, Pending: 0, Verified: 0, Rejected: 0 }
    allResidents.forEach((resident) => {
      if (!matchesSearch(resident, searchTerm) || !matchesAccount(resident, accountFilter)) return
      counts.All += 1
      counts[resident.status] += 1
    })
    return counts
  }, [allResidents, searchTerm, accountFilter])


  const stats = useMemo(() => {
    const pending = liveResidents.filter(
      (resident) => resident.status === 'Pending',
    ).length

    const verified = liveResidents.filter(
      (resident) => resident.status === 'Verified',
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
    ]
  }, [liveResidents, isSuperAdmin, assignedBarangayId])

  const constraintStats = useMemo(() => {
    return getConstraintStats(liveResidents)
  }, [liveResidents])

  // A tab of a merged page (e.g. Missing persons) takes its parent's title and sentence.
  const pageKey = menuParent[activeMenu] ?? activeMenu
  const activeTitle =
    menuItems.find((item) => item.key === pageKey)?.label ??
    'Dashboard'
  const scopeBarangayId =
    assignedBarangayId && assignedBarangayId !== ALL_BARANGAYS ? Number(assignedBarangayId) : null
  // Active disasters and hazard reports waiting for Yes/No: red bar and sidebar counts.
  const operation = useOperationStatus(scopeBarangayId)

  const scopeLabel = isSuperAdmin
    ? assignedBarangayId === ALL_BARANGAYS ? 'All barangays' : assignedBarangayName
    : assignedBarangayName
  const generatedBy = `${profile.fullName || profile.email} (${isSuperAdmin ? 'Super Admin' : 'Admin'})`

  // Super Admin management tabs do not depend on the barangay data.
  const isManagementTab =
    isSuperAdmin &&
    (activeMenu === 'barangayOverview' ||
      activeMenu === 'adminAccounts' ||
      activeMenu === 'responderAccounts')

  // Tabs of the merged pages: switching a tab is the same as choosing that page.
  const tabsOf = () => ({
    active: activeMenu,
    onChange: (key: string) => setActiveMenu(key as MenuKey),
    label: activeTitle,
  })

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
        scope={isSuperAdmin ? (
          <label className="scope-select header-scope">
            <span>Viewing</span>
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
          <span className="header-scope">Barangay <strong>{scopeLabel || '…'}</strong></span>
        )}
      />
      <OperationBar active={operation.active} onOpen={() => setActiveMenu('dispatch')} />

      <div className="app-layout">
        <Sidebar
          items={menuItems}
          subtitle={isSuperAdmin ? 'Super Admin' : 'Admin Dashboard'}
          activeMenu={activeMenu}
          onMenuChange={(menu) => { setMapPin(null); setActiveMenu(menu) }}
          badges={{
            ...(operation.waitingAlarms ? { disasterEvents: { text: String(operation.waitingAlarms), tone: 'urgent' as const } } : {}),
            dispatch: operation.active.length
              ? { text: 'Active', tone: 'urgent' as const }
              : { text: 'None', tone: 'quiet' as const },
          }}
        />

        <main className="page-content">
          {isManagementTab ? (
            <>
              {activeMenu === 'adminAccounts' && (
                <SubTabs
                  label="Accounts and barangays"
                  parts={[
                    { key: 'barangays', label: 'Barangays', content: <SuperAdminSection view="barangays" onOpenBarangay={openBarangay} /> },
                    { key: 'admins', label: 'Admin accounts', content: <SuperAdminSection view="accounts" onOpenBarangay={openBarangay} /> },
                    { key: 'rescuers', label: 'Responder accounts', content: <ResponderAccountsPage /> },
                  ]}
                />
              )}
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
          <ScopeContext.Provider value={assignedBarangayId && assignedBarangayId !== ALL_BARANGAYS ? Number(assignedBarangayId) : null}>
          <ShowOnMapContext.Provider value={(pin) => { setMapPin(pin); setActiveMenu('geoMap') }}>
          {/* The Map page has no title block: the sidebar already says where you are, and the map gets the room. */}
          {activeMenu !== 'geoMap' && <PageTitle
            title={activeTitle}
            description={pageDescriptions[pageKey]}
            onExportReport={activeMenu !== 'home' ? undefined : () =>
              exportReport({
                stats,
                residents: liveResidents,
                alerts: liveAlerts,
                evacuationCenters: liveEvacuationCenters,
                scopeLabel,
                generatedBy,
              })
            }
          />}

          {activeMenu === 'home' && (
            <HomePage
              stats={stats}
              evacuationCenters={liveEvacuationCenters}
              scopeBarangayId={assignedBarangayId && assignedBarangayId !== ALL_BARANGAYS ? Number(assignedBarangayId) : null}
              allResidents={liveResidents}
              onOpen={setActiveMenu}
              waitingAlarms={operation.waitingAlarms}
            />
          )}

          {/* Account numbers come after the To do list: what needs attention first. */}
          {isSuperAdmin && activeMenu === 'home' && (
            <SuperAdminSection view="overview" onOpenBarangay={openBarangay} />
          )}

          {(activeMenu === 'verification' || activeMenu === 'population') && (() => {
            const t = tabsOf()
            return <SubTabs label={t.label} active={t.active} onChange={t.onChange} parts={[
              { key: 'verification', label: tabLabels.verification!, content: (
                <VerificationPage
                  residents={filteredResidents}
                  statusCounts={residentStatusCounts}
                  searchTerm={searchTerm}
                  statusFilter={statusFilter}
                  onSearchChange={setSearchTerm}
                  onStatusFilterChange={setStatusFilter}
                  verifyingResidentId={verifyingResidentId}
                  onVerifyResident={handleVerifyResident}
                  onRejectResident={handleRejectResident}
                  onEditResident={setEditingResident}
                  onChangeAccountState={handleResidentAccountState}
                  onResetPin={handleResetPin}
                  accountFilter={accountFilter}
                  onAccountFilterChange={setAccountFilter}
                  onRegisterResident={registrationBarangays.length > 0 ? () => setRegisteringResident(true) : undefined}
                />
              ) },
              { key: 'population', label: tabLabels.population!, content: (
                <PopulationPage key={assignedBarangayId ?? 'all'} residents={liveResidents} constraintStats={constraintStats}
                  barangayId={assignedBarangayId && assignedBarangayId !== ALL_BARANGAYS ? Number(assignedBarangayId) : null}
                  barangayName={assignedBarangayName} />
              ) },
            ]} />
          })()}

          {activeMenu === 'geoMap' && (
            <GeoMapPage key={`${assignedBarangayId || 'none'}-${mapPin ? `${mapPin.lat},${mapPin.lng}` : ''}`} pin={mapPin} residents={liveResidents} centers={liveEvacuationCenters}
              focusBarangayId={assignedBarangayId && assignedBarangayId !== ALL_BARANGAYS ? Number(assignedBarangayId) : null}
              isSuperAdmin={isSuperAdmin} assignedBarangayName={assignedBarangayName} />
          )}

          {activeMenu === 'disasterEvents' && <DisasterEventsPage />}

          {(activeMenu === 'dispatch' || activeMenu === 'preemptiveEvacuation' || activeMenu === 'rescueReconciliation') && (() => {
            const t = tabsOf()
            return <>
              {!operation.active.length && (
                <p className="operation-idle" role="note">
                  No disaster is declared right now. Rescue requests can still come in from SOS calls; to start an operation, answer a report on the Alarms page.
                </p>
              )}
              <SubTabs label={t.label} active={t.active} onChange={t.onChange} parts={[
                { key: 'dispatch', label: tabLabels.dispatch!, content: <DispatchPage residents={liveResidents} onOpenMissing={() => setActiveMenu('rescueReconciliation')} /> },
                { key: 'preemptiveEvacuation', label: tabLabels.preemptiveEvacuation!, content: <PreemptiveEvacuationPage scopeBarangayId={scopeBarangayId} /> },
                { key: 'rescueReconciliation', label: tabLabels.rescueReconciliation!, content: <RescueReconciliationPage onOpenRequests={() => setActiveMenu('dispatch')} /> },
              ]} />
            </>
          })()}

          {activeMenu === 'responderTeams' && <DispatchPage view="units" residents={liveResidents} />}

          {activeMenu === 'reports' && (
            <ReportsPage />
          )}

          {activeMenu === 'dataMining' && <DataMiningPage residents={liveResidents} centers={liveEvacuationCenters} />}

          {activeMenu === 'activityLogs' && <AuditTrailPanel key={assignedBarangayId ?? 'all'} />}


          {activeMenu === 'evacCenters' && (
            <EvacCentersPage
              onReload={reloadDashboardData}
              centers={liveEvacuationCenters}
              barangayOptions={isSuperAdmin ? barangayOptions : undefined}
              scopeBarangayId={assignedBarangayId && assignedBarangayId !== ALL_BARANGAYS ? Number(assignedBarangayId) : null}
            />
          )}
          </ShowOnMapContext.Provider>
          </ScopeContext.Provider>
          </>
          )}
        </main>
      </div>

      <RegisterResidentModal
        open={registeringResident}
        barangays={registrationBarangays}
        defaultBarangayId={
          assignedBarangayId && assignedBarangayId !== ALL_BARANGAYS ? Number(assignedBarangayId) : null
        }
        onClose={() => setRegisteringResident(false)}
        onRegistered={handleResidentRegistered}
      />

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

function matchesAccount(resident: Resident, filter: AccountFilter) {
  const state = resident.accountState ?? 'Active'
  if (filter === 'All') return true
  if (filter === 'Current') return state !== 'Archived'
  return state === filter
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
