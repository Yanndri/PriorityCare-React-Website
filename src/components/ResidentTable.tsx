import type { Resident, Status } from '../types/dashboard'
import Select from 'react-select'

type ResidentTableProps = {
  title: string
  residents: Resident[]
  searchTerm: string
  statusFilter: 'All' | Status
  onSearchChange: (value: string) => void
  onStatusFilterChange: (value: 'All' | Status) => void
}

export function ResidentTable({
  title,
  residents,
  searchTerm,
  statusFilter,
  onSearchChange,
  onStatusFilterChange,
}: ResidentTableProps) {
  return (
    <section className="panel table-panel">
      <div className="section-header">
        <h3>{title}</h3>
        <span>{residents.length} shown</span>
      </div>

      {/* Search and filter controls update state stored in App.tsx. */}
      <div className="filters">
       <Select
  isClearable
  value={
    searchTerm
      ? { value: searchTerm, label: searchTerm }
      : { value: '', label: 'All Locations' }
  }
  options={[
    { value: '', label: 'All Locations' },
    { value: 'San Roque', label: 'Brgy. San Roque' },
    { value: 'Mabolo', label: 'Brgy. Mabolo' },
    { value: 'Lahug', label: 'Brgy. Lahug' },
    { value: 'Sitio Pag-asa', label: 'Sitio Pag-asa' },
    { value: 'Sitio Maligaya', label: 'Sitio Maligaya' },
    { value: 'Sitio Rizal', label: 'Sitio Rizal' },
    { value: 'Sitio Mabuhay', label: 'Sitio Mabuhay' },
  ]}
  placeholder="Search location..."
  onChange={(selected) => {
    onSearchChange(selected?.value || '')
  }}
/>

        <select
          value={statusFilter}
          onChange={(event) => onStatusFilterChange(event.target.value as 'All' | Status)}
        >
          <option value="All">All Statuses</option>
          <option value="Pending">Pending</option>
          <option value="Verified">Verified</option>
        </select>
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Sitio</th>
              <th>Constraint</th>
              <th>Status</th>
              <th>Flood Zone</th>
            </tr>
          </thead>

          <tbody>
            {residents.map((resident) => (
              <tr key={resident.id}>
                <td>{resident.name}</td>
                <td>{resident.sitio}</td>
                <td>
                  <span className={`badge ${getConstraintClassName(resident.constraint)}`}>
                    {resident.constraint}
                  </span>
                </td>
                <td>
                  <span className={`status ${resident.status.toLowerCase()}`}>{resident.status}</span>
                </td>
                <td>{resident.floodZone ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// Turns "Walk Assist" into "walk-assist" so CSS can style it.
function getConstraintClassName(constraint: Resident['constraint']) {
  return constraint.toLowerCase().replace(' ', '-')
}
