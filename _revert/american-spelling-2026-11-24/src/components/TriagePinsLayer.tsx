import { Marker, Popup } from 'react-leaflet'
import * as L from 'leaflet'
import { TRIAGE_LEVELS } from '../utils/triagePins'
import type { TriagePin } from '../utils/triagePins'
import './TriagePinsLayer.css'
import { Icon } from './Icon'

// One cached DivIcon per colour / people-count / incomplete combination.
const iconCache = new Map<string, L.DivIcon>()
function pinIcon(pin: TriagePin) {
  const people = pin.members.length
  const key = `${pin.triage}:${people}`
  let icon = iconCache.get(key)
  if (!icon) {
    const level = TRIAGE_LEVELS[pin.triage]
    icon = L.divIcon({
      className: 'triage-pin-icon',
      html: `<div class="triage-pin triage-${pin.triage}" style="--pin:${level.color};--ring:${level.ring}">`
        + `<span class="triage-pin-letter">${level.short}</span>`
        + (people > 1 ? `<span class="triage-pin-count">${people}</span>` : '')
        + '</div>',
      iconSize: [30, 40],
      iconAnchor: [15, 40],
      popupAnchor: [0, -36],
    })
    iconCache.set(key, icon)
  }
  return icon
}

// One pin per household, coloured by household VPI. The page decides which pins to pass.
export function TriagePinsLayer({ pins }: { pins: TriagePin[] }) {
  return <>
    {pins.map(pin => <Marker key={pin.key} position={pin.position} icon={pinIcon(pin)}
      zIndexOffset={pin.triage === 'red' ? 1000 : pin.triage === 'yellow' ? 500 : 0}
      title={`${pin.householdName ?? pin.members[0]?.name ?? 'Household'} — ${TRIAGE_LEVELS[pin.triage].label}`}>
      <Popup maxWidth={320}>
        <div className="triage-popup">
          <div className="triage-popup-head">
            <span className="triage-swatch" style={{ background: TRIAGE_LEVELS[pin.triage].color, color: pin.triage === 'yellow' ? '#1f2937' : '#fff' }}>{TRIAGE_LEVELS[pin.triage].short}</span>
            <div>
              <strong>{pin.householdName ?? pin.members[0]?.name}</strong>
              <div className="triage-muted">{TRIAGE_LEVELS[pin.triage].label} · VPI {pin.score}/100</div>
            </div>
          </div>
          <div className="triage-muted">{pin.barangay}{pin.floodZone ? ' · Flood zone' : ''} · {pin.members.length} {pin.members.length === 1 ? 'person' : 'people'}</div>
          {pin.factors.length > 0 && <div className="triage-muted">{pin.factors.map(f => `${f.label} +${f.points}`).join(' · ')}</div>}
          <ul className="triage-members">
            {pin.members.map(m => <li key={m.id}>
              <div><strong>{m.name}</strong>{!m.hasAccount && <span className="triage-muted"> (household member, no account)</span>}</div>
              {m.tags.length > 0 && <div className="triage-muted">{m.tags.join(' · ')}</div>}
            </li>)}
          </ul>
          {pin.unmappedMembers > 0 && <div className="triage-muted">{pin.unmappedMembers} member(s) have no GPS of their own.</div>}
          <div className="triage-muted"><Icon name="marker" /> {pin.position[0].toFixed(5)}, {pin.position[1].toFixed(5)} ({pin.positionSource === 'head' ? 'household head' : 'member'} location)</div>
          {pin.contact && <div className="triage-muted"><Icon name="phone-call" /> {pin.contact}</div>}
          <div className="triage-muted">Household VPI — supports, not replaces, responder judgement.</div>
        </div>
      </Popup>
    </Marker>)}
  </>
}
