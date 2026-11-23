import type { OperationStatus } from '../lib/useOperationStatus'
import { Icon } from './Icon'

const time = (iso: string) => new Date(iso).toLocaleString('en-PH', {
  timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
})

// The red bar under the header while a disaster is declared, on every page,
// so staff always know an operation is running and can get back to it.
export function OperationBar({ active, onOpen }: { active: OperationStatus['active']; onOpen: () => void }) {
  if (!active.length) return null
  const first = active[0]
  return (
    <div className="operation-bar" role="status">
      <Icon name="siren-on" className="operation-bar-icon" />
      <strong className="operation-bar-text">
        {active.length === 1
          ? `${first.name}${first.barangay_name && !first.name.includes(first.barangay_name) ? ` in ${first.barangay_name}` : ''} is active · declared ${time(first.declared_at)}`
          : `${active.length} disasters are active: ${active.map((e) => e.name).join(', ')}`}
      </strong>
      <button type="button" className="operation-bar-button" onClick={onOpen}>
        Open operation <Icon name="arrow-small-right" />
      </button>
    </div>
  )
}
