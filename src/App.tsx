import { useEffect, useMemo, useState } from 'react'
import './App.css'

import { menuItems } from './data/dashboardData'
import type { MenuKey, Resident, Status } from './types/dashboard'

import { AppHeader } from './components/AppHeader'
import { Sidebar } from './components/Sidebar'
import { PageTitle } from './components/PageTitle'
import { EditResidentModal } from './components/EditResidentModal'

import { HomePage } from './pages/HomePage'
import { VerificationPage } from './pages/VerificationPage'
import { GeoMapPage } from './pages/GeoMapPage'
import { ReportsPage } from './pages/ReportsPage'
import { DataMiningPage } from './pages/DataMiningPage'
import { EvacCentersPage } from './pages/EvacCentersPage'
import { exportReport } from './utils/exportReport'
import { deleteResidentProfile, fetchDashboardDataFromSupabase, rejectResidentUser, updateResidentProfile, verifyResidentUser, type DashboardData } from './api/dashboardApi'

function App() {
  // Stores which sidebar page is currently selected.
  const [activeMenu, setActiveMenu] = useState<MenuKey>('home')

  // Stores the text typed into the resident search box.
  const [searchTerm, setSearchTerm] = useState('')

  // Stores the selected status filter for the resident table.
  const [statusFilter, setStatusFilter] = useState<'All' | Status>('All')

  // All dashboard records are loaded from Supabase.
  // No static sample resident, alert, center, or evacuation-history data is used.
  const [dashboardData, setDashboardData] = useState<DashboardData>({
    residents: [],
    alerts: [],
    evacuationCenters: [],
    evacuationHistory: [],
  })

  const [isLoadingDatabase, setIsLoadingDatabase] = useState(true)
  const [databaseError, setDatabaseError] = useState<string | null>(null)
  const [verifyingResidentId, setVerifyingResidentId] = useState<number | string | null>(null)
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null)
  const [editingResident, setEditingResident] = useState<Resident | null>(null)
  const [isSavingResident, setIsSavingResident] = useState(false)

  useEffect(() => {
    fetchDashboardDataFromSupabase()
      .then((data) => {
        setDashboardData(data)
        setDatabaseError(null)
      })
      .catch((error) => {
        console.error('Failed to load Supabase data:', error)
        setDatabaseError('Unable to load Supabase data. Please check the database connection, table names, and permissions.')
      })
      .finally(() => {
        setIsLoadingDatabase(false)
      })
  }, [])

  const liveResidents = dashboardData.residents
  const liveAlerts = dashboardData.alerts
  const liveEvacuationCenters = dashboardData.evacuationCenters
  const liveEvacuationHistory = dashboardData.evacuationHistory

  // Recalculates the visible residents only when the search/filter/database data changes.
  const filteredResidents = useMemo(() => {
    return liveResidents.filter((resident) => {
      return matchesSearch(resident, searchTerm) && matchesStatus(resident.status, statusFilter)
    })
  }, [liveResidents, searchTerm, statusFilter])

  // Builds the dashboard stat cards from the residents data.
  const stats = useMemo(() => {
    const pending = liveResidents.filter((resident) => resident.status === 'Pending').length
    const verified = liveResidents.filter((resident) => resident.status === 'Verified').length
    return [
      { label: 'Total Registered', value: liveResidents.length, note: 'From current data', tone: 'black' },
      { label: 'Pending Verification', value: pending, note: 'Needs review', tone: 'orange' },
      { label: 'Verified Residents', value: verified, note: 'Plotted on geo map', tone: 'green' },
    ]
  }, [liveResidents])

  // Counts residents by constraint type for the small bar chart.
  const constraintStats = useMemo(() => {
    return getConstraintStats(liveResidents)
  }, [liveResidents])

  const activeTitle = menuItems.find((item) => item.key === activeMenu)?.label ?? 'Dashboard'

  async function handleVerifyResident(residentId: number | string) {
    try {
      setVerifyingResidentId(residentId)
      setVerifyMessage(null)
      setDatabaseError(null)

      await verifyResidentUser(residentId)

      setDashboardData((currentData) => ({
        ...currentData,
        residents: currentData.residents.map((resident) =>
          resident.id === residentId
            ? {
                ...resident,
                status: 'Verified',
                documents: resident.documents?.map((document) => ({
                  ...document,
                  reviewStatus: 'Approved',
                })),
              }
            : resident,
        ),
      }))

      setVerifyMessage('Resident account verified successfully.')
    } catch (error) {
      console.error('Failed to verify resident:', error)
      setDatabaseError('Unable to verify resident. Please check Supabase update permissions.')
    } finally {
      setVerifyingResidentId(null)
    }
  }

  async function handleRejectResident(residentId: number | string, reason: string) {
    try {
      setVerifyingResidentId(residentId)
      setVerifyMessage(null)
      setDatabaseError(null)

      await rejectResidentUser(residentId, reason)

      setDashboardData((currentData) => ({
        ...currentData,
        residents: currentData.residents.map((resident) =>
          resident.id === residentId
            ? {
                ...resident,
                status: 'Rejected',
                documents: resident.documents?.map((document) => ({
                  ...document,
                  reviewStatus: 'Rejected',
                  rejectionReason: reason,
                })),
              }
            : resident,
        ),
      }))

      setVerifyMessage(`Resident verification request rejected. Reason: ${reason}`)
    } catch (error) {
      console.error('Failed to reject resident:', error)
      setDatabaseError('Unable to reject resident. Please check Supabase update permissions.')
    } finally {
      setVerifyingResidentId(null)
    }
  }

  async function handleSaveResident(
    residentId: number | string,
    updates: { name: string; constraint: Resident['constraint']; status: Resident['status'] },
  ) {
    try {
      setIsSavingResident(true)
      setVerifyMessage(null)
      setDatabaseError(null)

      await updateResidentProfile(residentId, updates)

      setDashboardData((currentData) => ({
        ...currentData,
        residents: currentData.residents.map((resident) =>
          resident.id === residentId ? { ...resident, ...updates } : resident,
        ),
      }))

      setEditingResident(null)
      setVerifyMessage('Resident record updated successfully.')
    } catch (error) {
      console.error('Failed to update resident:', error)
      setDatabaseError('Unable to update resident. Please check Supabase update permissions.')
    } finally {
      setIsSavingResident(false)
    }
  }

  async function handleDeleteResident(resident: Resident) {
    const confirmed = window.confirm(`Delete ${resident.name}? This action cannot be undone.`)

    if (!confirmed) {
      return
    }

    try {
      setVerifyMessage(null)
      setDatabaseError(null)

      await deleteResidentProfile(resident.id)

      setDashboardData((currentData) => ({
        ...currentData,
        residents: currentData.residents.filter((item) => item.id !== resident.id),
        evacuationHistory: currentData.evacuationHistory.filter(
          (record) => record.residentName !== resident.name,
        ),
      }))

      setVerifyMessage('Resident record deleted successfully.')
    } catch (error) {
      console.error('Failed to delete resident:', error)
      setDatabaseError('Unable to delete resident. Please check Supabase delete permissions.')
    }
  }

  return (
    <div className="app">
      <AppHeader />

      <div className="app-layout">
        <Sidebar activeMenu={activeMenu} onMenuChange={setActiveMenu} />

        <main className="page-content">
          <PageTitle
            title={activeTitle}
            onExportReport={() =>
              exportReport({
                stats,
                residents: liveResidents,
                alerts: liveAlerts,
                evacuationCenters: liveEvacuationCenters,
                evacuationHistory: liveEvacuationHistory,
              })
            }
          />

          {isLoadingDatabase && (
            <div className="database-status">Loading Supabase database...</div>
          )}

          {databaseError && (
            <div className="database-status error">{databaseError}</div>
          )}

          {verifyMessage && (
            <div className="database-status success">{verifyMessage}</div>
          )}

          {/* Home page with stats, recent registrations, alerts, and chart. */}
          {activeMenu === 'home' && (
            <HomePage
              stats={stats}
              residents={filteredResidents}
              alerts={liveAlerts}
              constraintStats={constraintStats}
              searchTerm={searchTerm}
              statusFilter={statusFilter}
              onSearchChange={setSearchTerm}
              onStatusFilterChange={setStatusFilter}
            />
          )}

          {/* Full verification table page. */}
          {activeMenu === 'verification' && (
            <VerificationPage
              residents={filteredResidents}
              searchTerm={searchTerm}
              statusFilter={statusFilter}
              verifyingResidentId={verifyingResidentId}
              onSearchChange={setSearchTerm}
              onStatusFilterChange={setStatusFilter}
              onVerifyResident={handleVerifyResident}
              onRejectResident={handleRejectResident}
              onEditResident={setEditingResident}
              onDeleteResident={handleDeleteResident}
            />
          )}

          {/* Simple visual map page. */}
          {activeMenu === 'geoMap' && <GeoMapPage residents={liveResidents} />}

          {/* Report cards page. */}
          {activeMenu === 'reports' && <ReportsPage stats={stats} />}

          {/* Data mining and historical analytics page. */}
          {activeMenu === 'dataMining' && <DataMiningPage records={liveEvacuationHistory} />}

          {/* Evacuation center capacity page. */}
          {activeMenu === 'evacCenters' && <EvacCentersPage centers={liveEvacuationCenters} />}
          <EditResidentModal
            resident={editingResident}
            isSaving={isSavingResident}
            onClose={() => setEditingResident(null)}
            onSave={handleSaveResident}
          />

        </main>
      </div>
    </div>
  )
}

// Checks if a resident matches the current search text.
function matchesSearch(resident: Resident, searchTerm: string) {
  const search = searchTerm.toLowerCase().trim()

  if (!search) {
    return true
  }

  return (
    resident.name.toLowerCase().includes(search) ||
    resident.sitio.toLowerCase().includes(search) ||
    resident.constraint.toLowerCase().includes(search)
  )
}

// Checks if a resident matches the selected status dropdown.
function matchesStatus(residentStatus: Status, selectedStatus: 'All' | Status) {
  return selectedStatus === 'All' || residentStatus === selectedStatus
}

// Converts the residents array into chart-friendly data.
function getConstraintStats(allResidents: Resident[]) {
  if (allResidents.length === 0) {
    return []
  }

  const counts = allResidents.reduce<Record<string, number>>((totals, resident) => {
    totals[resident.constraint] = (totals[resident.constraint] ?? 0) + 1
    return totals
  }, {})

  return Object.entries(counts).map(([label, value]) => ({
    label,
    value,
    percent: Math.round((value / allResidents.length) * 100),
  }))
}

export default App
