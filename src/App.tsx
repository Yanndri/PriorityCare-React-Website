import { useMemo, useState } from 'react'
import './App.css'

import { alerts, evacuationCenters, menuItems, residents } from './data/dashboardData'
import type { MenuKey, Resident, Status } from './types/dashboard'

import { AppHeader } from './components/AppHeader'
import { Sidebar } from './components/Sidebar'
import { PageTitle } from './components/PageTitle'

import { HomePage } from './pages/HomePage'
import { VerificationPage } from './pages/VerificationPage'
import { GeoMapPage } from './pages/GeoMapPage'
import { ReportsPage } from './pages/ReportsPage'
import { EvacCentersPage } from './pages/EvacCentersPage'
import { exportReport } from './utils/exportReport'

function App() {
  // Stores which sidebar page is currently selected.
  const [activeMenu, setActiveMenu] = useState<MenuKey>('home')

  // Stores the text typed into the resident search box.
  const [searchTerm, setSearchTerm] = useState('')

  // Stores the selected status filter for the resident table.
  const [statusFilter, setStatusFilter] = useState<'All' | Status>('All')

  // Recalculates the visible residents only when the search/filter changes.
  const filteredResidents = useMemo(() => {
    return residents.filter((resident) => {
      return matchesSearch(resident, searchTerm) && matchesStatus(resident.status, statusFilter)
    })
  }, [searchTerm, statusFilter])

  // Builds the dashboard stat cards from the residents data.
  const stats = useMemo(() => {
    const pending = residents.filter((resident) => resident.status === 'Pending').length
    const verified = residents.filter((resident) => resident.status === 'Verified').length
    const floodZone = residents.filter((resident) => resident.floodZone).length

    return [
      { label: 'Total Registered', value: residents.length, note: '+3 this week', tone: 'black' },
      { label: 'Pending Verification', value: pending, note: 'Needs review', tone: 'orange' },
      { label: 'Verified Residents', value: verified, note: 'Plotted on geo map', tone: 'green' },
      { label: 'In Flood-Prone Zones', value: floodZone, note: 'High priority', tone: 'red' },
    ]
  }, [])

  // Counts residents by constraint type for the small bar chart.
  const constraintStats = useMemo(() => {
    return getConstraintStats(residents)
  }, [])

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
                residents,
                alerts,
                evacuationCenters,
              })
            }
          />

          {/* Home page with stats, recent registrations, alerts, and chart. */}
          {activeMenu === 'home' && (
            <HomePage
              stats={stats}
              residents={filteredResidents}
              alerts={alerts}
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
          {activeMenu === 'geoMap' && <GeoMapPage residents={residents} />}

          {/* Report cards page. */}
          {activeMenu === 'reports' && <ReportsPage stats={stats} />}

          {/* Evacuation center capacity page. */}
          {activeMenu === 'evacCenters' && <EvacCentersPage centers={evacuationCenters} />}
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
