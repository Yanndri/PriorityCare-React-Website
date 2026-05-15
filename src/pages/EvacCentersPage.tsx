import { useMemo, useState } from 'react'
import Select from 'react-select'
import type { EvacuationCenter } from '../types/dashboard'

type EvacCentersPageProps = {
  centers: EvacuationCenter[]
}

export function EvacCentersPage({ centers }: EvacCentersPageProps) {
  const [searchTerm, setSearchTerm] = useState('')

  const searchOptions = useMemo(() => {
    const centerOptions = centers.map((center) => ({
      value: center.name,
      label: center.name,
    }))

    const residentOptions = centers.flatMap((center) =>
      (center.residents ?? []).map((resident) => ({
        value: resident.name,
        label: `${resident.name} — ${center.name}`,
      })),
    )

    return [{ value: '', label: 'All Evacuation Centers' }, ...centerOptions, ...residentOptions]
  }, [centers])

  const filteredCenters = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase()

    if (!normalizedSearch) {
      return centers
    }

    return centers.filter((center) => {
      const matchesCenter = center.name.toLowerCase().includes(normalizedSearch)
      const matchesStatus = center.status.toLowerCase().includes(normalizedSearch)
      const matchesResident = (center.residents ?? []).some((resident) => {
        return (
          resident.name.toLowerCase().includes(normalizedSearch) ||
          resident.sitio.toLowerCase().includes(normalizedSearch) ||
          resident.constraint.toLowerCase().includes(normalizedSearch) ||
          resident.evacuationStatus.toLowerCase().includes(normalizedSearch)
        )
      })

      return matchesCenter || matchesStatus || matchesResident
    })
  }, [centers, searchTerm])

  return (
    <section className="panel evac-centers-panel">
      <div className="section-header">
        <h3>Evacuation Centers</h3>
        <span>{filteredCenters.length} shown</span>
      </div>

      <div className="evac-center-search">
        <Select
          isClearable
          value={
            searchTerm
              ? { value: searchTerm, label: searchTerm }
              : { value: '', label: 'All Evacuation Centers' }
          }
          options={searchOptions}
          placeholder="Search evacuation center or resident..."
          onChange={(selected) => {
            setSearchTerm(selected?.value || '')
          }}
        />
      </div>

      <div className="evac-center-list">
        {filteredCenters.length === 0 ? (
          <p className="empty-documents">No evacuation centers or assigned residents found.</p>
        ) : (
          filteredCenters.map((center) => {
            const occupancyPercent =
              center.capacity === 0 ? 0 : Math.min(100, Math.round((center.occupied / center.capacity) * 100))

            return (
              <article className="evac-center-card" key={center.id ?? center.name}>
                <div className="evac-center-header">
                  <strong>{center.name}</strong>
                  <span>{center.status}</span>
                </div>

                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${occupancyPercent}%` }} />
                </div>

                <p>
                  {center.occupied} / {center.capacity} occupied
                </p>

                <section className="assigned-residents">
                  <div className="assigned-residents-header">
                    <h4>Assigned / Evacuated Residents</h4>
                    <span>{center.residents?.length ?? 0} resident(s)</span>
                  </div>

                  {center.residents && center.residents.length > 0 ? (
                    <div className="assigned-resident-list">
                      {center.residents.map((resident) => (
                        <div className="assigned-resident-card" key={`${center.id ?? center.name}-${resident.id}`}>
                          <div>
                            <strong>{resident.name}</strong>
                            <span>{resident.sitio}</span>
                          </div>

                          <div className="assigned-resident-tags">
                            <span className={`badge ${resident.constraint.toLowerCase().replace(' ', '-')}`}>
                              {resident.constraint}
                            </span>
                            <span className="status pending">
                              {formatEvacuationStatus(resident.evacuationStatus)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="no-assigned-residents">
                      No resident evacuation records are assigned to this center yet.
                    </p>
                  )}
                </section>
              </article>
            )
          })
        )}
      </div>
    </section>
  )
}

function formatEvacuationStatus(status: string) {
  return status.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}
