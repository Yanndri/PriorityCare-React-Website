import { useEffect, useMemo, useState } from 'react'
import './App.css'

import { menuItems } from './data/dashboardData'

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
import { ReportsPage } from './pages/ReportsPage'
import { EvacCentersPage } from './pages/EvacCentersPage'

import { exportReport } from './utils/exportReport'

import {
  fetchDashboardDataFromSupabase,
  type DashboardData,
} from './api/dashboardApi'

function App() {
  const [activeMenu, setActiveMenu] =
    useState<MenuKey>('home')

  const [searchTerm, setSearchTerm] =
    useState('')

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
    useState(true)

  const [databaseError, setDatabaseError] =
    useState<string | null>(null)

  useEffect(() => {
    fetchDashboardDataFromSupabase()
      .then((data) => {
        setDashboardData(data)
        setDatabaseError(null)
      })
      .catch((error) => {
        console.error(
          'Failed to load Supabase data:',
          error
        )

        setDatabaseError(
          'Unable to load Supabase data.'
        )
      })
      .finally(() => {
        setIsLoadingDatabase(false)
      })
  }, [])

  // All dashboard data now comes from Supabase.
  const liveResidents =
    dashboardData.residents

  const liveAlerts =
    dashboardData.alerts

  const liveEvacuationCenters =
    dashboardData.evacuationCenters

  const filteredResidents = useMemo(() => {
    return liveResidents.filter((resident) => {
      return (
        matchesSearch(
          resident,
          searchTerm
        ) &&
        matchesStatus(
          resident.status,
          statusFilter
        )
      )
    })
  }, [
    liveResidents,
    searchTerm,
    statusFilter,
  ])

  const stats = useMemo(() => {
    const pending =
      liveResidents.filter(
        (resident) =>
          resident.status === 'Pending'
      ).length

    const verified =
      liveResidents.filter(
        (resident) =>
          resident.status === 'Verified'
      ).length

    const floodZone =
      liveResidents.filter(
        (resident) =>
          resident.floodZone
      ).length

    return [
      {
        label: 'Total Registered',
        value: liveResidents.length,
        note: 'From current data',
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
        note: 'Plotted on geo map',
        tone: 'green',
      },

      {
        label: 'Flood-Prone Residents',
        value: floodZone,
        note: 'High risk areas',
        tone: 'blue',
      },
    ]
  }, [liveResidents])

  const constraintStats = useMemo(() => {
    return getConstraintStats(
      liveResidents
    )
  }, [liveResidents])

  const activeTitle =
    menuItems.find(
      (item) =>
        item.key === activeMenu
    )?.label ?? 'Dashboard'

  if (isLoadingDatabase) {
    return (
      <div
        style={{
          color: 'white',
          padding: '40px',
          fontSize: '20px',
        }}
      >
        Loading database...
      </div>
    )
  }

  if (databaseError) {
    return (
      <div
        style={{
          color: 'red',
          padding: '40px',
          fontSize: '18px',
        }}
      >
        {databaseError}
      </div>
    )
  }

  return (
    <div className="app">

      <AppHeader />

      <div className="app-layout">

        <Sidebar
          activeMenu={activeMenu}
          onMenuChange={setActiveMenu}
        />

        <main className="page-content">

          <PageTitle
            title={activeTitle}
            onExportReport={() =>
              exportReport({
                stats,
                residents: liveResidents,
                alerts: liveAlerts,
                evacuationCenters:
                  liveEvacuationCenters,
              })
            }
          />

          {activeMenu === 'home' && (
            <HomePage
              stats={stats}
              residents={filteredResidents}
              alerts={liveAlerts}
              constraintStats={
                constraintStats
              }
              searchTerm={searchTerm}
              statusFilter={statusFilter}
              onSearchChange={
                setSearchTerm
              }
              onStatusFilterChange={
                setStatusFilter
              }
            />
          )}

          {activeMenu === 'verification' && (
            <VerificationPage
              residents={filteredResidents}
              searchTerm={searchTerm}
              statusFilter={statusFilter}
              onSearchChange={
                setSearchTerm
              }
              onStatusFilterChange={
                setStatusFilter
              }
            />
          )}

          {activeMenu === 'geoMap' && (
            <GeoMapPage />
          )}

          {activeMenu === 'reports' && (
            <ReportsPage
              stats={stats}
            />
          )}

          {activeMenu === 'evacCenters' && (
            <EvacCentersPage
              centers={
                liveEvacuationCenters
              }
            />
          )}

        </main>
      </div>
    </div>
  )
}

function matchesSearch(
  resident: Resident,
  searchTerm: string
) {
  const search =
    searchTerm
      .toLowerCase()
      .trim()

  if (!search) {
    return true
  }

  return (
    resident.name
      .toLowerCase()
      .includes(search) ||

    resident.sitio
      .toLowerCase()
      .includes(search) ||

    resident.constraint
      .toLowerCase()
      .includes(search)
  )
}

function matchesStatus(
  residentStatus: Status,
  selectedStatus:
    | 'All'
    | Status
) {
  return (
    selectedStatus === 'All' ||
    residentStatus === selectedStatus
  )
}

function getConstraintStats(
  allResidents: Resident[]
) {
  if (
    allResidents.length === 0
  ) {
    return []
  }

  const counts =
    allResidents.reduce<
      Record<string, number>
    >(
      (totals, resident) => {
        totals[
          resident.constraint
        ] =
          (totals[
            resident.constraint
          ] ?? 0) + 1

        return totals
      },
      {}
    )

  return Object.entries(
    counts
  ).map(([label, value]) => ({
    label,
    value,
    percent: Math.round(
      (
        value /
        allResidents.length
      ) * 100
    ),
  }))
}

export default App