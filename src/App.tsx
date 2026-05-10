import { useEffect, useMemo, useState } from 'react'
import './App.css'

import { alerts, evacuationCenters, evacuationHistory, menuItems, residents } from './data/dashboardData'
import type { MenuKey, Resident, Status } from './types/dashboard'

import { AppHeader } from './components/AppHeader'
import { Sidebar } from './components/Sidebar'
import { PageTitle } from './components/PageTitle'

import { HomePage } from './pages/HomePage'
import { VerificationPage } from './pages/VerificationPage'
import { GeoMapPage } from './pages/GeoMapPage'
import { ReportsPage } from './pages/ReportsPage'
import { DataMiningPage } from './pages/DataMiningPage'
import { EvacCentersPage } from './pages/EvacCentersPage'
import { exportReport } from './utils/exportReport'
import { fetchDashboardDataFromSupabase } from './api/dashboardApi'

function App() {
  // Stores which sidebar page is currently selected.
  const [activeMenu, setActiveMenu] = useState<MenuKey>('home')

  // Stores the text typed into the resident search box.
  const [searchTerm, setSearchTerm] = useState('')

  // Stores the selected status filter for the resident table.
  const [statusFilter, setStatusFilter] = useState<'All' | Status>('All')

  // This state starts with local sample data, then updates with Supabase data when available.
  const [dashboardData, setDashboardData] = useState({
    residents,
    alerts,
    evacuationCenters,
    evacuationHistory,
  })

  const [isLoadingDatabase, setIsLoadingDatabase] = useState(true)
  const [databaseError, setDatabaseError] = useState<string | null>(null)

  useEffect(() => {
    fetchDashboardDataFromSupabase()
      .then((data) => {
        setDashboardData(data)
        setDatabaseError(null)
      })
      .catch((error) => {
        console.error('Failed to load Supabase data. Using sample fallback data:', error)
        setDatabaseError('Unable to load Supabase data. Showing sample data.')
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
    const floodZone = liveResidents.filter((resident) => resident.floodZone).length

    return [
      { label: 'Total Registered', value: liveResidents.length, note: 'From current data', tone: 'black' },
      { label: 'Pending Verification', value: pending, note: 'Needs review', tone: 'orange' },
      { label: 'Verified Residents', value: verified, note: 'Plotted on geo map', tone: 'green' },
      { label: 'In Flood-Prone Zones', value: floodZone, note: 'High priority', tone: 'red' },
    ]
  }, [liveResidents])

  // Counts residents by constraint type for the small bar chart.
  const constraintStats = useMemo(() => {
    return getConstraintStats(liveResidents)
  }, [liveResidents])

  const activeTitle = menuItems.find((item) => item.key === activeMenu)?.label ?? 'Dashboard'

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
              onSearchChange={setSearchTerm}
              onStatusFilterChange={setStatusFilter}
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
