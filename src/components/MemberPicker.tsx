import { useState } from 'react'

type Person = { uid: string; name: string }

// Team members: the chosen ones as a short list, and a search box to add more.
// Stays the same size however many responders the barangay has.
export function MemberPicker({ rescuers, value, onChange }: {
  rescuers: Person[]
  value: string[]
  onChange: (uids: string[]) => void
}) {
  const [query, setQuery] = useState('')
  const names = new Map(rescuers.map((r) => [r.uid, r.name]))
  const needle = query.trim().toLowerCase()
  const matches = needle
    ? rescuers.filter((r) => !value.includes(r.uid) && r.name.toLowerCase().includes(needle)).slice(0, 8)
    : []
  return <div className="wide member-picker">
    <span className="dispatch-label">Members ({value.length})</span>
    {value.length
      ? <ul className="member-list">{value.map((uid) => {
          const name = names.get(uid) ?? 'Responder from another barangay'
          return <li key={uid}><span>{name}</span>
            <button type="button" className="link-button" aria-label={`Remove ${name}`}
              onClick={() => onChange(value.filter((x) => x !== uid))}>Remove</button></li>
        })}</ul>
      : <p className="dispatch-muted">No members yet. Search below to add responders.</p>}
    {rescuers.length
      ? <label className="member-search"><span>Add a member</span>
          <input type="search" value={query} placeholder="Type a responder's name…" onChange={(e) => setQuery(e.target.value)} /></label>
      : <p className="dispatch-muted">No active responder accounts yet.</p>}
    {needle && <ul className="member-matches">
      {matches.map((r) => <li key={r.uid}>
        <button type="button" className="secondary-button" onClick={() => { onChange([...value, r.uid]); setQuery('') }}>+ {r.name}</button></li>)}
      {!matches.length && <li className="dispatch-muted">No one else matches "{query.trim()}".</li>}
    </ul>}
  </div>
}
