import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient'
import { useLiveSignal } from '../lib/useLiveSignal'
import type { EvacuationCenter, Resident } from '../types/dashboard'
import { HazardPinsLayer } from '../components/HazardPinsLayer'
import { DisasterEventMarkers } from '../components/DisasterEventMarkers'
import { SpatialHeatmapLayer } from '../components/SpatialHeatmapLayer'
import { TriagePinsLayer } from '../components/TriagePinsLayer'
import { Icon } from '../components/Icon'
import { MapFocus } from '../components/MapFocus'
import { useBarangayView } from '../lib/barangayCenters'
import { buildTriagePins, TRIAGE_LEVELS, TRIAGE_ORDER } from '../utils/triagePins'
import type { TriageLevel } from '../utils/triagePins'
import { HEAT_RAMPS } from '../utils/spatialHeatmap'

// The Map page: the map on the left, and one panel on the right that
// says what is on the map and lets staff turn each thing on or off.
// A second tab shows the live weather map (Windy) over Cordova.

type GeoMapPageProps = {
  residents?: Resident[]
  centers?: EvacuationCenter[]
  focusBarangayId?: number | null // the barangay in scope; null = all of Cordova
}

type SosAlert = {
  alert_id: string
  resident_uid?: string | null
  alert_type?: string | null
  alert_level?: number | null
  latitude?: number | string | null
  longitude?: number | string | null
  headcount?: number | null
  note?: string | null
  created_at?: string | null
}

const SOS_TYPES: Record<string, { label: string; icon: string }> = {
  FLOOD: { label: 'Flood', icon: 'water' },
  FIRE: { label: 'Fire', icon: 'flame' },
  MEDICAL: { label: 'Medical emergency', icon: 'heart-rate' },
  TRAPPED: { label: 'Trapped', icon: 'exclamation' },
  OTHER: { label: 'Other emergency', icon: 'siren-on' },
}
const SOS_LEVELS: Record<number, string> = { 3: 'Critical', 2: 'High', 1: 'Moderate' }

// Leaflet's default marker images live on a CDN.
delete (L.Icon.Default.prototype as L.Icon.Default & { _getIconUrl?: unknown })._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const centerIcon = L.divIcon({
  className: 'map-center-icon',
  html: '<span class="map-center-pin"><i class="fi fi-rs-building" aria-hidden="true"></i></span>',
  iconSize: [32, 32],
  iconAnchor: [16, 16],
  popupAnchor: [0, -16],
})

const sosIcons = new Map<string, L.DivIcon>()
function sosIcon(level: number, type: string) {
  const key = `${level}-${type}`
  let icon = sosIcons.get(key)
  if (!icon) {
    const size = level >= 3 ? 46 : 38
    icon = L.divIcon({
      className: 'sos-marker-icon',
      html: `<span class="sos-marker sos-level-${level}" style="width:${size}px;height:${size}px">`
        + `<i class="fi fi-rs-${(SOS_TYPES[type] ?? SOS_TYPES.OTHER).icon}" aria-hidden="true"></i></span>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      popupAnchor: [0, -size / 2],
    })
    sosIcons.set(key, icon)
  }
  return icon
}

function timeAgo(iso?: string | null) {
  if (!iso) return null
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`
}

async function loadActiveSos(): Promise<SosAlert[]> {
  if (!hasSupabaseConfig) return []
  const { data, error } = await supabase
    .from('sos_alerts')
    .select('alert_id, resident_uid, alert_type, alert_level, latitude, longitude, headcount, note, created_at')
    .eq('status', 'active')
  if (error) throw error
  return data ?? []
}

const WINDY_URL = 'https://embed.windy.com/embed2.html?lat=10.25&lon=123.95&detailLat=10.25&detailLon=123.95'
  + '&zoom=9&level=surface&overlay=rain&product=ecmwf&menu=&message=&marker=true&calendar=now&pressure='
  + '&type=map&location=coordinates&detail=&metricWind=default&metricTemp=default&radarRange=-1'

export function GeoMapPage({ residents = [], centers = [], focusBarangayId = null }: GeoMapPageProps) {
  const view = useBarangayView(focusBarangayId)
  const [tab, setTab] = useState<'map' | 'weather'>('map')
  const [sos, setSos] = useState<SosAlert[]>([])

  // What is switched on. Everything starts on except the heatmap.
  const [levels, setLevels] = useState<Record<TriageLevel, boolean>>({ red: true, yellow: true, green: true })
  const [show, setShow] = useState({ sos: true, centers: true, hazards: true, disasters: true })
  const [heat, setHeat] = useState<'off' | 'vulnerability' | 'incidents'>('off')
  const toggle = (key: keyof typeof show) => setShow(s => ({ ...s, [key]: !s[key] }))

  useEffect(() => {
    let active = true
    loadActiveSos().then(rows => { if (active) setSos(rows) }).catch(() => undefined)
    return () => { active = false }
  }, [])
  useLiveSignal(['sos', 'tickets'], () => { loadActiveSos().then(setSos).catch(() => undefined) })

  // Make the map fill the window below where it starts, so the page does not scroll.
  const fitRef = useRef<HTMLDivElement | null>(null)
  const [height, setHeight] = useState(500)
  useEffect(() => {
    const fit = () => {
      const top = fitRef.current?.getBoundingClientRect().top ?? 0
      setHeight(Math.max(380, window.innerHeight - top - window.scrollY - 24))
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [tab])

  const triage = useMemo(() => buildTriagePins(residents), [residents])
  const openCenters = centers.filter(c => Number.isFinite(c.gpsLat) && Number.isFinite(c.gpsLong) && c.status.toLowerCase() !== 'closed')
  const sosOnMap = sos.filter(r => r.latitude != null && r.longitude != null
    && Number.isFinite(Number(r.latitude)) && Number.isFinite(Number(r.longitude)))

  return (
    <section className="map-page">
      <div className="analytics-tabs" role="tablist" aria-label="Map type">
        <button type="button" role="tab" aria-selected={tab === 'map'} className={`analytics-tab ${tab === 'map' ? 'active' : ''}`} onClick={() => setTab('map')}>
          <Icon name="map" /> Map
        </button>
        <button type="button" role="tab" aria-selected={tab === 'weather'} className={`analytics-tab ${tab === 'weather' ? 'active' : ''}`} onClick={() => setTab('weather')}>
          <Icon name="cloud-rain" /> Weather
        </button>
      </div>

      {tab === 'weather' ? (
        <div className="map-frame" ref={fitRef} style={{ height }}>
          <iframe title="Live weather over Cordova (Windy)" src={WINDY_URL} />
        </div>
      ) : (
        <div className="map-layout" ref={fitRef} style={{ height }}>
          <div className="map-frame">
            <MapContainer center={view.center} zoom={view.zoom} scrollWheelZoom style={{ width: '100%', height: '100%' }}>
              <MapFocus center={view.center} zoom={view.zoom} />
              <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

              {heat !== 'off' && <SpatialHeatmapLayer residents={residents} kind={heat} />}
              {show.disasters && <DisasterEventMarkers />}
              {show.hazards && <HazardPinsLayer />}
              <TriagePinsLayer pins={triage.pins.filter(p => levels[p.triage])} />

              {show.centers && openCenters.map(center => (
                <Marker key={`center-${center.id ?? center.name}`} position={[center.gpsLat!, center.gpsLong!]} icon={centerIcon}>
                  <Popup>
                    <strong>{center.name}</strong><br />
                    {center.occupancyKnown ? `${center.occupied} / ${center.capacity} people` : 'Evacuation center'}
                  </Popup>
                </Marker>
              ))}

              {show.sos && sosOnMap.map(request => {
                const type = (request.alert_type ?? 'OTHER').toUpperCase()
                const level = request.alert_level ?? 1
                const typeInfo = SOS_TYPES[type] ?? SOS_TYPES.OTHER
                const resident = residents.find(r => String(r.id) === String(request.resident_uid))
                const sent = timeAgo(request.created_at)
                return (
                  <Marker key={request.alert_id} position={[Number(request.latitude), Number(request.longitude)]}
                    icon={sosIcon(level, type)} zIndexOffset={1000 + level * 100}>
                    <Popup className="sos-popup">
                      <div className="sos-popup-banner"><Icon name="siren-on" /> EMERGENCY SOS</div>
                      <div className="sos-popup-body">
                        <strong className="sos-popup-type"><Icon name={typeInfo.icon} /> {typeInfo.label}</strong>
                        <span className={`sos-popup-level sos-level-${level}`}>{SOS_LEVELS[level] ?? `Level ${level}`} priority</span>
                        <p><Icon name="user" /> {resident?.name ?? 'Resident outside your loaded barangay'}</p>
                        {request.headcount != null && <p><Icon name="users" /> {request.headcount} {request.headcount === 1 ? 'person' : 'people'} need help</p>}
                        {request.note && <p><Icon name="comment" /> {request.note}</p>}
                        {sent && <p><Icon name="clock" /> Sent {sent}</p>}
                      </div>
                    </Popup>
                  </Marker>
                )
              })}
            </MapContainer>
          </div>

          <aside className="map-side" aria-label="What the map shows">
            <h2>Households</h2>
            <p className="map-side-note">Coloured by household VPI. The number on a pin is how many people live there.</p>
            {TRIAGE_ORDER.map(level => (
              <label key={level} className="map-toggle">
                <input type="checkbox" checked={levels[level]} onChange={() => setLevels(s => ({ ...s, [level]: !s[level] }))} />
                <span className="triage-swatch" style={{ background: TRIAGE_LEVELS[level].color, color: level === 'yellow' ? '#1f2937' : '#fff' }}>{TRIAGE_LEVELS[level].short}</span>
                <span>{TRIAGE_LEVELS[level].label}</span>
                <strong>{triage.counts[level]}</strong>
              </label>
            ))}
            {triage.unmappedHouseholds > 0 && <p className="map-side-note">{triage.unmappedHouseholds} household(s) have no home pin yet.</p>}

            <h2>Also show</h2>
            <label className="map-toggle">
              <input type="checkbox" checked={show.sos} onChange={() => toggle('sos')} />
              <span className="map-key map-key-sos" /><span>SOS calls</span><strong>{sosOnMap.length}</strong>
            </label>
            <label className="map-toggle">
              <input type="checkbox" checked={show.centers} onChange={() => toggle('centers')} />
              <span className="map-key map-key-center" /><span>Evacuation centers</span><strong>{openCenters.length}</strong>
            </label>
            <label className="map-toggle">
              <input type="checkbox" checked={show.hazards} onChange={() => toggle('hazards')} />
              <span className="map-key map-key-hazard" /><span>Hazard reports</span>
            </label>
            <label className="map-toggle">
              <input type="checkbox" checked={show.disasters} onChange={() => toggle('disasters')} />
              <span className="map-key map-key-disaster" /><span>Declared disasters</span>
            </label>

            <h2>Heatmap</h2>
            <select className="map-select" value={heat} onChange={e => setHeat(e.target.value as typeof heat)} aria-label="Heatmap">
              <option value="off">Off</option>
              <option value="vulnerability">Where vulnerable residents live</option>
              <option value="incidents">Where incidents happened (48 h)</option>
            </select>
            {heat !== 'off' && (
              <div className="map-ramp">
                <span style={{ background: `linear-gradient(90deg, ${HEAT_RAMPS[heat].join(', ')})` }} />
                <small><span>Fewer</span><span>More</span></small>
              </div>
            )}
          </aside>
        </div>
      )}
    </section>
  )
}
