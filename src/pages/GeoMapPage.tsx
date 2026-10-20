import {
  useState,
  useEffect,
  useRef,
} from 'react'

import { hasSupabaseConfig, supabase } from '../lib/supabaseClient'

import type {
  MouseEvent as ReactMouseEvent,
  TouchEvent as ReactTouchEvent,
} from 'react'
import type { EvacuationCenter, Resident } from '../types/dashboard'

import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Circle,
} from 'react-leaflet'

import * as L from 'leaflet'

import 'leaflet/dist/leaflet.css'
import { DisasterEventMarkers } from '../components/DisasterEventMarkers'
import { SpatialHeatmapLayer } from '../components/SpatialHeatmapLayer'
import { TriagePinsLayer } from '../components/TriagePinsLayer'
import { CatchmentLinesLayer } from '../components/CatchmentLinesLayer'
import { Icon } from '../components/Icon'

// ======================================================
// 🌍 SUPABASE
// ======================================================

// ======================================================
// 🌦️ WEATHER API
// ======================================================

const WEATHER_API_KEY =
  import.meta.env.VITE_OPENWEATHER_API_KEY

// ======================================================
// 🌍 CEBU CENTER
// ======================================================

const CEBU_CENTER: [number, number] = [
  10.3157,
  123.8854,
]

// ======================================================
// 📍 BARANGAYS
// ======================================================

const barangays = [
  {
    name: 'San Roque',

    position: [
      10.300,
      123.890,
    ] as [number, number],

    lowElevation: true,
  },

  {
    name: 'Mabolo',

    position: [
      10.320,
      123.910,
    ] as [number, number],

    lowElevation: false,
  },

  {
    name: 'Suba',

    position: [
      10.285,
      123.880,
    ] as [number, number],

    lowElevation: true,
  },
]

// ======================================================
// 🔧 FIX LEAFLET DEFAULT ICON
// ======================================================

delete (
  L.Icon.Default.prototype as L.Icon.Default & {
    _getIconUrl?: unknown
  }
)._getIconUrl

L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',

  iconUrl:
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',

  shadowUrl:
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

// ======================================================
// 🌊 FLOOD ICON
// ======================================================

const floodIcon = new L.Icon({
  iconUrl:
    'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-blue.png',

  shadowUrl:
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',

  iconSize: [30, 48],

  iconAnchor: [15, 48],
})

// ======================================================
// 🔥 FIRE ICON
// ======================================================

const fireIcon = new L.Icon({
  iconUrl:
    'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',

  shadowUrl:
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',

  iconSize: [30, 48],

  iconAnchor: [15, 48],
})

// ======================================================
// 🌎 EARTHQUAKE ICON
// ======================================================

const earthquakeIcon = new L.Icon({
  iconUrl:
    'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-orange.png',

  shadowUrl:
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',

  iconSize: [30, 48],

  iconAnchor: [15, 48],
})

// ======================================================
// 🟢 EVACUATION ICON
// ======================================================

const evacuationIcon = new L.Icon({
  iconUrl:
    'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png',

  shadowUrl:
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',

  iconSize: [30, 48],

  iconAnchor: [15, 48],
})

// ======================================================
// 🗺️ COMPONENT
// ======================================================

type GeoMapPageProps = {
  residents?: Resident[]
  centers?: EvacuationCenter[]
}

// ======================================================
// 🚨 EMERGENCY REQUESTS / 🌦️ WEATHER LOADERS
// These only fetch and return data; the component sets state.
// ======================================================

type FloodArea = (typeof barangays)[number]

type EmergencyRequest = {
  id: string | number
  disaster_type?: string | null
  latitude?: number | string | null
  longitude?: number | string | null
  resident_name?: string | null
  status?: string | null
}

async function loadEmergencyRequests(): Promise<
  EmergencyRequest[] | null
> {
  if (!hasSupabaseConfig) {
    return null
  }

  try {
    const { data, error } =
      await supabase
        .from(
          'sos_alerts',
        )
        .select('*')

    if (error) {
      console.error(
        'Failed to fetch emergency requests:',
        error,
      )

      return null
    }

    return data ?? null
  } catch (error) {
    console.error(
      'Emergency request error:',
      error,
    )

    return null
  }
}

async function loadWeatherRisk(): Promise<{
  rain: number
  areas: FloodArea[]
} | null> {
  if (!WEATHER_API_KEY) {
    console.warn(
      'VITE_OPENWEATHER_API_KEY is not configured.',
    )

    return null
  }

  try {
    const response =
      await fetch(
        `https://api.openweathermap.org/data/2.5/weather?lat=10.3157&lon=123.8854&appid=${WEATHER_API_KEY}`,
      )

    if (!response.ok) {
      throw new Error(
        `Weather API returned ${response.status}`,
      )
    }

    const weatherData =
      await response.json()

    const rain: number =
      weatherData.clouds?.all || 0

    const areas =
      barangays.filter(
        (barangay) =>
          rain > 70 &&
          barangay.lowElevation,
      )

    return { rain, areas }
  } catch (error) {
    console.error(
      'Weather API error:',
      error,
    )

    return null
  }
}

export function GeoMapPage({ residents = [], centers = [] }: GeoMapPageProps) {

  // ====================================================
  // 🌍 MAP MODES
  // ====================================================

  const [mapMode, setMapMode] =
    useState<
      | 'default'
      | 'weather'
    >('default')

  // ====================================================
  // 🚨 REALTIME REQUESTS
  // ====================================================

  const [requests, setRequests] =
    useState<EmergencyRequest[]>([])

  // ====================================================
  // 🌧️ WEATHER DATA
  // ====================================================

  const [rainfallLevel, setRainfallLevel] =
    useState(0)

  // ====================================================
  // 🌊 FLOOD RISK AREAS
  // ====================================================

  const [affectedAreas, setAffectedAreas] =
    useState<FloodArea[]>([])

  // ====================================================
  // 🪟 PANEL POBARANGAYN
  // ====================================================

  const mapSectionRef =
    useRef<HTMLElement | null>(null)

  const floodPanelRef =
    useRef<HTMLDivElement | null>(null)

  // Whether the Live Flood Prediction panel is shown (Weather mode).
  const [isFloodPanelOpen, setIsFloodPanelOpen] =
    useState(true)

  const [panelPosition, setPanelPosition] =
    useState({
      x: 18,
      y: 90,
    })

  // ====================================================
  // 🖱️ DOUBLE-TAP / DOUBLE-CLICK DRAG SYSTEM
  // ====================================================

  const [isDragging, setIsDragging] =
    useState(false)

  const [isArmed, setIsArmed] =
    useState(false)

  const lastPointerDown =
    useRef(0)

  const dragOffset =
    useRef({
      x: 0,
      y: 0,
    })

  const doubleTapDelay = 350

  // ====================================================
  // 🖱️ START / ARM DRAGGING
  // ====================================================

  function handlePanelPointerDown(
    event:
      | ReactMouseEvent<HTMLDivElement>
      | ReactTouchEvent<HTMLDivElement>,
  ) {

    const now =
      Date.now()

    const clientX =
      'touches' in event
        ? event.touches[0].clientX
        : event.clientX

    const clientY =
      'touches' in event
        ? event.touches[0].clientY
        : event.clientY

    const isSecondTap =
      now -
        lastPointerDown.current <
      doubleTapDelay

    lastPointerDown.current =
      now

    // First click/tap:
    // arm the panel but don't move it.
    if (!isSecondTap) {

      setIsArmed(false)

      return
    }

    // Second click/tap:
    // activate dragging.
    setIsArmed(true)

    setIsDragging(true)

    dragOffset.current = {
      x:
        clientX -
        panelPosition.x,

      y:
        clientY -
        panelPosition.y,
    }
  }

  // ====================================================
  // 🖱️ MOVE PANEL
  // ====================================================

  useEffect(() => {

    // Clamp the dragged panel inside the map section.
    function updatePanelPosition(
      clientX: number,
      clientY: number,
    ) {

      const section =
        mapSectionRef.current

      const panel =
        floodPanelRef.current

      if (!section || !panel) {
        return
      }

      const sectionRect =
        section.getBoundingClientRect()

      const panelRect =
        panel.getBoundingClientRect()

      let newX =
        clientX -
        sectionRect.left -
        dragOffset.current.x

      let newY =
        clientY -
        sectionRect.top -
        dragOffset.current.y

      const maxX =
        Math.max(
          10,
          sectionRect.width -
            panelRect.width -
            10,
        )

      const maxY =
        Math.max(
          10,
          sectionRect.height -
            panelRect.height -
            10,
        )

      newX = Math.max(
        10,
        Math.min(
          newX,
          maxX,
        ),
      )

      newY = Math.max(
        10,
        Math.min(
          newY,
          maxY,
        ),
      )

      setPanelPosition({
        x: newX,
        y: newY,
      })
    }

    function handleMouseMove(
      event: MouseEvent,
    ) {

      if (!isDragging) {
        return
      }

      updatePanelPosition(
        event.clientX,
        event.clientY,
      )
    }

    function handleTouchMove(
      event: TouchEvent,
    ) {

      if (!isDragging) {
        return
      }

      if (
        event.touches.length === 0
      ) {
        return
      }

      event.preventDefault()

      const touch =
        event.touches[0]

      updatePanelPosition(
        touch.clientX,
        touch.clientY,
      )
    }

    function stopDragging() {

      if (!isDragging) {
        return
      }

      setIsDragging(false)

      setIsArmed(false)
    }

    window.addEventListener(
      'mousemove',
      handleMouseMove,
    )

    window.addEventListener(
      'mouseup',
      stopDragging,
    )

    window.addEventListener(
      'touchmove',
      handleTouchMove,
      {
        passive: false,
      },
    )

    window.addEventListener(
      'touchend',
      stopDragging,
    )

    return () => {

      window.removeEventListener(
        'mousemove',
        handleMouseMove,
      )

      window.removeEventListener(
        'mouseup',
        stopDragging,
      )

      window.removeEventListener(
        'touchmove',
        handleTouchMove,
      )

      window.removeEventListener(
        'touchend',
        stopDragging,
      )
    }

  }, [
    isDragging,
    panelPosition,
  ])

  // ====================================================
  // 🔄 RESET PANEL
  // ====================================================

  function hideFloodPanel() {

    setIsFloodPanelOpen(false)

    setIsDragging(false)

    setIsArmed(false)
  }

  function resetPanelPosition() {

    setPanelPosition({
      x: 18,
      y: 90,
    })

    setIsDragging(false)

    setIsArmed(false)
  }

  // ====================================================
  // 🌍 REALTIME
  // ====================================================

  useEffect(() => {
    // Guards against setting state after the page unmounts.
    let active = true

    void loadWeatherRisk().then((weather) => {
      if (!active || !weather) {
        return
      }

      setRainfallLevel(weather.rain)
      setAffectedAreas(weather.areas)
    })

    if (!hasSupabaseConfig) {
      return () => {
        active = false
      }
    }

    function refreshRequests() {
      void loadEmergencyRequests().then((rows) => {
        if (active && rows) {
          setRequests(rows)
        }
      })
    }

    refreshRequests()

    const channel =
      supabase
        .channel(
          'sos_alerts',
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table:
              'sos_alerts',
          },
          () => {

            refreshRequests()
          },
        )
        .subscribe()

    return () => {
      active = false

      supabase.removeChannel(
        channel,
      )
    }

  }, [])

  // ====================================================
  // 🎨 UI
  // ====================================================

  return (

    <section
      ref={mapSectionRef}
      className="geo-map-page"
      style={{
        width: '100%',

        // Fill the screen below the sticky 82px header (+24px gap): close to
        // the original full-height map, but the whole map fits on screen
        // once scrolled to, instead of 100vh running past the bottom.
        height: 'calc(100vh - 106px)',

        minHeight: '480px',

        overflow: 'hidden',

        borderRadius: '20px',

        position: 'relative',

        // Own stacking context: keeps Leaflet panes/controls (z 400-1000)
        // and the map's floating panels (z 9999+) from painting over the
        // sticky header and sidebar.
        isolation: 'isolate',

        zIndex: 0,

        background: '#07111f',
      }}
    >

      {/* ==================================================
          🌍 MAP MODE BUTTONS
          ================================================== */}

      <div
        style={{
          position:
            'absolute',

          top:
            '18px',

          left:
            '18px',

          right:
            '18px',

          zIndex:
            10000,

          display:
            'flex',

          gap:
            '8px',

          flexWrap:
            'wrap',

          pointerEvents:
            'none',
        }}
      >
        <button
          onClick={() =>
            setMapMode(
              'default',
            )
          }

          style={{
            pointerEvents:
              'auto',
          }}
        >
          <Icon name="map" /> Default
        </button>

        <button
          onClick={() =>
            setMapMode(
              'weather',
            )
          }

          style={{
            pointerEvents:
              'auto',
          }}
        >
          <Icon name="wind" /> Weather
        </button>

        {mapMode === 'weather' &&
          !isFloodPanelOpen && (

          <button
            type="button"

            onClick={() =>
              setIsFloodPanelOpen(
                true,
              )
            }

            aria-expanded={false}

            aria-controls="flood-prediction-panel"

            style={{
              pointerEvents:
                'auto',

              background:
                '#b91c1c',
            }}
          >
            <Icon name="exclamation" /> Flood Prediction
          </button>

        )}

      </div>

      {/* ==================================================
          🌪️ WEATHER MODE
          ================================================== */}

      {mapMode === 'weather' ? (

        <>

          {/* 🌪️ WINDY */}

          <iframe
            title="Windy Weather Map"

            width="100%"

            height="100%"

            src="https://embed.windy.com/embed2.html?lat=12.8797&lon=121.7740&detailLat=10.3157&detailLon=123.8854&width=650&height=450&zoom=7&level=surface&overlay=wind&product=ecmwf&menu=false&message=false&marker=false&calendar=now&pressure=true&type=map&location=coordinates&detail=true&metricWind=default&metricTemp=default&radarRange=-1"

            frameBorder="0"

            style={{
              border:
                'none',

              display:
                'block',
            }}
          />

          {/* ==================================================
              🌊 FLOATING FLOOD PANEL
              ================================================== */}

          {isFloodPanelOpen && (

          <div
            ref={
              floodPanelRef
            }

            id="flood-prediction-panel"

            role="region"

            aria-label="Live Flood Prediction"

            style={{
              position:
                'absolute',

              // Clamp the saved position so the panel never spills
              // outside the map container (e.g. after a resize).
              left:
                `min(${panelPosition.x}px, calc(100% - min(320px, calc(100% - 36px)) - 10px))`,

              top:
                `min(${panelPosition.y}px, calc(100% - 140px))`,

              width:
                'min(320px, calc(100% - 36px))',

              maxHeight:
                `min(45vh, calc(100% - min(${panelPosition.y}px, calc(100% - 140px)) - 10px))`,

              overflowY:
                'auto',

              zIndex:
                9999,

              background:
                'rgba(15,23,42,0.94)',

              padding:
                '18px',

              borderRadius:
                '18px',

              color:
                'white',

              backdropFilter:
                'blur(10px)',

              boxSizing:
                'border-box',

              boxShadow:
                isDragging
                  ? '0 15px 40px rgba(0,0,0,0.55)'
                  : '0 10px 30px rgba(0,0,0,0.35)',
            }}
          >

            {/* ==================================================
                🖱️ DOUBLE CLICK + HOLD HEADER
                ================================================== */}

            <div
              onMouseDown={
                handlePanelPointerDown
              }

              onTouchStart={
                handlePanelPointerDown
              }

              style={{
                cursor:
                  isDragging
                    ? 'grabbing'
                    : 'grab',

                userSelect:
                  'none',

                touchAction:
                  'none',

                display:
                  'flex',

                alignItems:
                  'center',

                justifyContent:
                  'space-between',

                gap:
                  '10px',

                marginBottom:
                  '12px',

                padding:
                  '10px',

                borderRadius:
                  '10px',

                background:
                  isArmed
                    ? 'rgba(59,130,246,0.22)'
                    : 'rgba(255,255,255,0.06)',

                border:
                  isArmed
                    ? '1px solid rgba(59,130,246,0.5)'
                    : '1px solid rgba(255,255,255,0.08)',

                transition:
                  'background 0.15s, border 0.15s',
              }}
            >

              <div>

                <h2
                  style={{
                    margin:
                      0,

                    fontSize:
                      '20px',

                    lineHeight:
                      1.2,
                  }}
                >
                  <Icon name="exclamation" /> Live Flood Prediction
                </h2>

                <span
                  style={{
                    display:
                      'block',

                    marginTop:
                      '5px',

                    fontSize:
                      '11px',

                    opacity:
                      0.6,
                  }}
                >
                  {isDragging
                    ? 'Moving…'
                    : 'Double-click + hold to move'}
                </span>

              </div>

              <div
                style={{
                  display:
                    'flex',

                  alignItems:
                    'center',

                  gap:
                    '6px',
                }}
              >

                <span
                  style={{
                    fontSize:
                      '20px',

                    opacity:
                      0.55,
                  }}
                >
                  ⠿
                </span>

                <button
                  type="button"

                  onClick={
                    hideFloodPanel
                  }

                  // Don't start the drag gesture from the close button.
                  onMouseDown={(event: ReactMouseEvent<HTMLButtonElement>) =>
                    event.stopPropagation()
                  }

                  onTouchStart={(event: ReactTouchEvent<HTMLButtonElement>) =>
                    event.stopPropagation()
                  }

                  aria-label="Hide Live Flood Prediction panel"

                  aria-expanded={true}

                  aria-controls="flood-prediction-panel"

                  title="Hide panel"

                  style={{
                    padding:
                      '4px 9px',

                    fontSize:
                      '14px',

                    lineHeight:
                      1,
                  }}
                >
                  ✕
                </button>

              </div>

            </div>

            {/* ==================================================
                🌧️ WEATHER
                ================================================== */}

            <p>
              <Icon name="cloud-rain" /> Rainfall Level:{' '}
              <strong>
                {rainfallLevel}%
              </strong>
            </p>

            <p>
              <Icon name="wind" /> Weather system
              approaching Cebu.
            </p>

            <hr
              style={{
                borderColor:
                  'rgba(255,255,255,0.1)',

                margin:
                  '16px 0',
              }}
            />

            <h3
              style={{
                marginBottom:
                  '12px',
              }}
            >
              <Icon name="marker" /> Possible Affected Areas
            </h3>

            {affectedAreas.length === 0 && (

              <p>
                No flood risk detected.
              </p>

            )}

            {affectedAreas.map(
              (area) => (

                <div
                  key={
                    area.name
                  }

                  style={{
                    marginBottom:
                      '12px',

                    padding:
                      '12px',

                    borderRadius:
                      '12px',

                    background:
                      '#7f1d1d',
                  }}
                >

                  <strong>
                    <Icon name="water" />{' '}
                    {area.name}
                  </strong>

                  <br />

                  <br />

                  HIGH flood risk
                  due to heavy
                  rainfall and
                  low elevation.

                </div>

              ),
            )}

            {/* ==================================================
                🔄 RESET
                ================================================== */}

            <button
              onClick={
                resetPanelPosition
              }

              style={{
                width:
                  '100%',

                marginTop:
                  '8px',

                padding:
                  '9px 12px',

                fontSize:
                  '12px',
              }}
            >
              <Icon name="refresh" /> Reset Panel Position
            </button>

          </div>

          )}

        </>

      ) : (

        /* ==================================================
           🗺️ LEAFLET MAP
           ================================================== */

        <MapContainer
          center={
            CEBU_CENTER
          }

          zoom={
            13
          }

          scrollWheelZoom={
            true
          }

          style={{
            width:
              '100%',

            height:
              '100%',
          }}
        >

          <DisasterEventMarkers />
          <SpatialHeatmapLayer residents={residents} />
          {/* 🗺️ OPENSTREETMAP */}

          <TileLayer
            attribution="&copy; OpenStreetMap contributors"

            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {/* 🏠 HOUSEHOLD TRIAGE PINS (Module 4.3): one pin per household, coloured by VPI urgency */}
          {/* 🧭 BARANGAY → SHELTER CATCHMENT LINKS (Module 2.2) */}
          <CatchmentLinesLayer />
          <TriagePinsLayer residents={residents} />

          {/* 🟢 EVACUATION CENTER */}

          {centers
            .filter((center) => Number.isFinite(center.gpsLat) && Number.isFinite(center.gpsLong) && center.status.toLowerCase() !== 'closed')
            .map((center) => (
              <Marker key={`center-${center.id ?? center.name}`} position={[center.gpsLat!, center.gpsLong!]} icon={evacuationIcon}>
                <Popup>
                  <Icon name="building" /> {center.name}
                  <br />
                  {center.occupancyKnown ? `${center.occupied} / ${center.capacity} people` : 'Evacuation Center'}
                </Popup>
              </Marker>
            ))}

          {/* 🌊 FLOOD AREAS */}

          {affectedAreas.map(
            (area) => (

              <Circle
                key={
                  area.name
                }

                center={
                  area.position
                }

                radius={
                  700
                }

                pathOptions={{
                  color:
                    '#3b82f6',

                  fillColor:
                    '#3b82f6',

                  fillOpacity:
                    0.30,
                }}
              />

            ),
          )}

          {/* 🚨 EMERGENCY REQUESTS */}

          {requests.map(
            (request) => {

              let markerIcon =
                floodIcon

              if (
                request.disaster_type ===
                'fire'
              ) {

                markerIcon =
                  fireIcon
              }

              if (
                request.disaster_type ===
                'earthquake'
              ) {

                markerIcon =
                  earthquakeIcon
              }

              const latitude =
                Number(
                  request.latitude,
                )

              const longitude =
                Number(
                  request.longitude,
                )

              if (
                !Number.isFinite(
                  latitude,
                ) ||
                !Number.isFinite(
                  longitude,
                )
              ) {

                return null
              }

              return (

                <Marker
                  key={
                    request.id
                  }

                  position={[
                    latitude,
                    longitude,
                  ]}

                  icon={
                    markerIcon
                  }
                >

                  <Popup>

                    <Icon name="siren-on" /> Emergency Request

                    <br />

                    <Icon name="user" />{' '}
                    {request.resident_name ??
                      'Unknown resident'}

                    <br />

                    <Icon name="globe" />{' '}
                    {request.disaster_type ??
                      'Unknown disaster'}

                    <br />

                    <Icon name="info" /> Status:{' '}

                    {request.status ??
                      'Unknown'}

                  </Popup>

                </Marker>

              )
            },
          )}

        </MapContainer>

      )}

      {/* ==================================================
          ✨ BUTTON STYLE
          ================================================== */}

      <style>
        {`

          .geo-map-page button {
            background:
              rgba(15,23,42,0.90);

            color:
              white;

            border:
              none;

            padding:
              8px 10px;

            border-radius:
              10px;

            cursor:
              pointer;

            transition:
              0.2s;

            box-shadow:
              0 4px 12px
              rgba(0,0,0,0.20);
          }

          .geo-map-page button:hover {
            background:
              #1e293b;

            transform:
              translateY(-2px);
          }

          @media (max-width: 600px) {

            .geo-map-page button {
              font-size:
                11px !important;

              padding:
                7px 8px !important;
            }

          }

        `}
      </style>

    </section>
  )
}
