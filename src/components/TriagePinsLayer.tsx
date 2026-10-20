import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Marker, Popup, useMap } from 'react-leaflet'
import * as L from 'leaflet'
import type { Resident } from '../types/dashboard'
import { buildTriagePins, TRIAGE_LEVELS, TRIAGE_ORDER } from '../utils/triagePins'
import type { TriageLevel, TriagePin } from '../utils/triagePins'
import { DEFAULT_VPI_RULES } from '../utils/vpi'
import './TriagePinsLayer.css'
import { Icon } from './Icon'

// One cached DivIcon per colour / people-count / incomplete combination.
const iconCache = new Map<string, L.DivIcon>()
function pinIcon(pin: TriagePin) {
  const people = pin.members.length
  const key = `${pin.triage}:${people}:${pin.incomplete}`
  let icon = iconCache.get(key)
  if (!icon) {
    const level = TRIAGE_LEVELS[pin.triage]
    icon = L.divIcon({
      className: 'triage-pin-icon',
      html: `<div class="triage-pin triage-${pin.triage}${pin.incomplete ? ' triage-incomplete' : ''}" style="--pin:${level.color};--ring:${level.ring}">`
        + `<span class="triage-pin-letter">${level.short}</span>`
        + (people > 1 ? `<span class="triage-pin-count">${people}</span>` : '')
        + (pin.incomplete ? '<span class="triage-pin-q" title="Incomplete assessment">?</span>' : '')
        + '</div>',
      iconSize: [30, 40],
      iconAnchor: [15, 40],
      popupAnchor: [0, -36],
    })
    iconCache.set(key, icon)
  }
  return icon
}

function useControlHost(corner: string) {
  const map = useMap()
  const [host] = useState(() => {
    const div = L.DomUtil.create('div', 'leaflet-control triage-control') as HTMLDivElement
    L.DomEvent.disableClickPropagation(div)
    L.DomEvent.disableScrollPropagation(div)
    return div
  })
  useEffect(() => {
    const target = map.getContainer().querySelector(corner) ?? map.getContainer()
    target.appendChild(host)
    return () => { host.remove() }
  }, [map, host, corner])
  return host
}

export function TriagePinsLayer({ residents }: { residents: Resident[] }) {
  const host = useControlHost('.leaflet-bottom.leaflet-right')
  const [shown, setShown] = useState<Record<TriageLevel, boolean>>({ red: true, yellow: true, green: true })
  const [collapsed, setCollapsed] = useState(false)
  const result = useMemo(() => buildTriagePins(residents), [residents])
  const visible = result.pins.filter(p => shown[p.triage])

  const legend = createPortal(
    <div className="triage-legend" role="region" aria-label="Household triage pins">
      <div className="triage-legend-head">
        <strong>Household triage (VPI)</strong>
        <button type="button" onClick={() => setCollapsed(c => !c)} aria-expanded={!collapsed}>{collapsed ? 'Show' : 'Hide'}</button>
      </div>
      {!collapsed && <>
        {TRIAGE_ORDER.map(level => <label key={level} className="triage-legend-row">
          <input type="checkbox" checked={shown[level]} onChange={e => setShown(s => ({ ...s, [level]: e.target.checked }))} />
          <span className="triage-swatch" style={{ background: TRIAGE_LEVELS[level].color, color: level === 'yellow' ? '#1f2937' : '#fff' }}>{TRIAGE_LEVELS[level].short}</span>
          <span>{TRIAGE_LEVELS[level].label}</span>
          <strong>{result.counts[level]}</strong>
        </label>)}
        <p className="triage-note">
          Bands: High ≥ {DEFAULT_VPI_RULES.highAt}, Moderate ≥ {DEFAULT_VPI_RULES.moderateAt}. A pin is one household, coloured by its most urgent member; the number is people in it.
          {result.incomplete > 0 && ` “?” = ${result.incomplete} with incomplete assessments (colour is a minimum).`}
          {result.unmappedHouseholds > 0 && ` ${result.unmappedHouseholds} without GPS not shown.`}
        </p>
      </>}
    </div>,
    host,
  )

  return <>
    {legend}
    {visible.map(pin => <Marker key={pin.key} position={pin.position} icon={pinIcon(pin)}
      zIndexOffset={pin.triage === 'red' ? 1000 : pin.triage === 'yellow' ? 500 : 0}
      title={`${pin.householdName ?? pin.members[0]?.name ?? 'Household'} — ${TRIAGE_LEVELS[pin.triage].label}`}>
      <Popup maxWidth={320}>
        <div className="triage-popup">
          <div className="triage-popup-head">
            <span className="triage-swatch" style={{ background: TRIAGE_LEVELS[pin.triage].color, color: pin.triage === 'yellow' ? '#1f2937' : '#fff' }}>{TRIAGE_LEVELS[pin.triage].short}</span>
            <div>
              <strong>{pin.householdName ?? pin.members[0]?.name}</strong>
              <div className="triage-muted">{TRIAGE_LEVELS[pin.triage].label} · VPI {pin.score}/{pin.maxScore}{pin.incomplete ? ' (at least)' : ''}</div>
            </div>
          </div>
          <div className="triage-muted">{pin.barangay}{pin.floodZone ? ' · Flood zone' : ''} · {pin.members.length} {pin.members.length === 1 ? 'person' : 'people'}</div>
          <ul className="triage-members">
            {pin.members.map(m => <li key={m.id}>
              <div><strong>{m.name}</strong>{!m.hasAccount && <span className="triage-muted"> (dependent, no account)</span>}
                <span className={`triage-level triage-level-${m.level.toLowerCase()}`}>{m.level} · {m.score}</span></div>
              {m.factors.length > 0 && <div className="triage-muted">{m.factors.join(' · ')}</div>}
              {m.missing.length > 0 && <div className="triage-missing">Missing: {m.missing.join(', ')}</div>}
            </li>)}
          </ul>
          {pin.unmappedMembers > 0 && <div className="triage-muted">{pin.unmappedMembers} member(s) have no GPS of their own.</div>}
          <div className="triage-muted"><Icon name="marker" /> {pin.position[0].toFixed(5)}, {pin.position[1].toFixed(5)} ({pin.positionSource === 'head' ? 'household head' : 'member'} location)</div>
          {pin.contact && <div className="triage-muted"><Icon name="phone-call" /> {pin.contact}</div>}
          <div className="triage-muted">Prototype VPI — supports, not replaces, responder judgement.</div>
        </div>
      </Popup>
    </Marker>)}
  </>
}
