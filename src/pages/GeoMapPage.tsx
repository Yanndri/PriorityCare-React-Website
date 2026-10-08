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
import type { Resident } from '../types/dashboard'

import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Circle,
} from 'react-leaflet'

import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'

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
  L.Icon.Default.prototype as any
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

  iconSize: [25, 41],
  iconAnchor: [12, 41],
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

  iconSize: [25, 41],
  iconAnchor: [12, 41],
})

const residentIcon = new L.Icon({
  iconUrl:
    'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-violet.png',
  shadowUrl:
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
})

// ======================================================
// 🗺️ COMPONENT
// ======================================================

type GeoMapPageProps = {
  residents?: Resident[]
}

export function GeoMapPage({ residents = [] }: GeoMapPageProps) {

  // ====================================================
  // 🌍 MAP MODES
  // ====================================================

  const [mapMode, setMapMode] =
    useState<
      | 'default'
      | 'flood'
      | 'fire'
      | 'earthquake'
      | 'weather'
    >('default')

  // ====================================================
  // 🚨 REALTIME REQUESTS
  // ====================================================

  const [requests, setRequests] =
    useState<any[]>([])

  // ====================================================
  // 🌧️ WEATHER DATA
  // ====================================================

  const [rainfallLevel, setRainfallLevel] =
    useState(0)

  // ====================================================
  // 🌊 FLOOD RISK AREAS
  // ====================================================

  const [affectedAreas, setAffectedAreas] =
    useState<any[]>([])

  // ====================================================
  // 🖱️ DRAGGABLE FLOOD PANEL
  // ====================================================

  const mapSectionRef =
    useRef<HTMLElement | null>(null)

  const floodPanelRef =
    useRef<HTMLDivElement | null>(null)

  const [panelPosition, setPanelPosition] =
    useState({
      x: 18,
      y: 90,
    })

  const [isDragging, setIsDragging] =
    useState(false)

  const dragOffset =
    useRef({
      x: 0,
      y: 0,
    })

  // ====================================================
  // 🖱️ START DRAGGING
  // ====================================================

  function startDragging(
    event:
      | ReactMouseEvent<HTMLDivElement>
      | ReactTouchEvent<HTMLDivElement>,
  ) {

    const clientX =
      'touches' in event
        ? event.touches[0].clientX
        : event.clientX

    const clientY =
      'touches' in event
        ? event.touches[0].clientY
        : event.clientY

    dragOffset.current = {
      x:
        clientX -
        panelPosition.x,

      y:
        clientY -
        panelPosition.y,
    }

    setIsDragging(true)
  }

  // ====================================================
  // 🖱️ DRAGGING
  // ====================================================

  useEffect(() => {

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
      setIsDragging(false)
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
  // 📍 UPDATE PANEL POSITION
  // ====================================================

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

    const panelWidth =
      panelRect.width

    const panelHeight =
      panelRect.height

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
          panelWidth -
          10,
      )

    const maxY =
      Math.max(
        10,
        sectionRect.height -
          panelHeight -
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

  // ====================================================
  // 🔄 RESET PANEL POSITION
  // ====================================================

  function resetPanelPosition() {

    setPanelPosition({
      x: 18,
      y: 90,
    })
  }

  // ====================================================
  // 🚨 FETCH EMERGENCY REQUESTS
  // ====================================================

  async function fetchRequests() {
    if (!hasSupabaseConfig) {
      return
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

        return
      }

      if (data) {

        setRequests(data)
      }

    } catch (error) {

      console.error(
        'Emergency request error:',
        error,
      )
    }
  }

  // ====================================================
  // 🌦️ FETCH WEATHER
  // ====================================================

  async function fetchWeather() {

    if (!WEATHER_API_KEY) {

      console.warn(
        'VITE_OPENWEATHER_API_KEY is not configured.',
      )

      return
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

      const rain =
        weatherData.clouds?.all || 0

      setRainfallLevel(
        rain,
      )

      const riskyAreas =
        barangays.filter(
          (barangay) => {

            return (
              rain > 70 &&
              barangay.lowElevation
            )
          },
        )

      setAffectedAreas(
        riskyAreas,
      )

    } catch (error) {

      console.error(
        'Weather API error:',
        error,
      )
    }
  }

  // ====================================================
  // 🌍 REALTIME SUPABASE
  // ====================================================

  useEffect(() => {
    fetchWeather()

    if (!hasSupabaseConfig) {
      return
    }

    fetchRequests()

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

            fetchRequests()
          },
        )
        .subscribe()

    return () => {

      supabase.removeChannel(
        channel,
      )
    }

  }, [])

  const mappedResidents = residents.flatMap((resident) => {
    const latitude = Number(resident.gpsLat)
    const longitude = Number(resident.gpsLong)

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return []
    }

    return [{ resident, position: [latitude, longitude] as [number, number] }]
  })

  // ====================================================
  // 🎨 UI
  // ====================================================

  return (

    <section
      ref={mapSectionRef}
      style={{
        width: '100%',

        height: '100vh',

        overflow: 'hidden',

        borderRadius: '20px',

        position: 'relative',

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

          justifyContent:
            'flex-start',

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

            fontSize:
              '12px',

            padding:
              '8px 10px',

            whiteSpace:
              'nowrap',
          }}
        >
          🗺️ Default
        </button>

        <button
          onClick={() =>
            setMapMode(
              'flood',
            )
          }

          style={{
            pointerEvents:
              'auto',

            fontSize:
              '12px',

            padding:
              '8px 10px',

            whiteSpace:
              'nowrap',
          }}
        >
          🌊 Flood
        </button>

        <button
          onClick={() =>
            setMapMode(
              'fire',
            )
          }

          style={{
            pointerEvents:
              'auto',

            fontSize:
              '12px',

            padding:
              '8px 10px',

            whiteSpace:
              'nowrap',
          }}
        >
          🔥 Fire
        </button>

        <button
          onClick={() =>
            setMapMode(
              'earthquake',
            )
          }

          style={{
            pointerEvents:
              'auto',

            fontSize:
              '12px',

            padding:
              '8px 10px',

            whiteSpace:
              'nowrap',
          }}
        >
          🌎 Earthquake
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

            fontSize:
              '12px',

            padding:
              '8px 10px',

            whiteSpace:
              'nowrap',
          }}
        >
          🌪️ Weather
        </button>

      </div>

      {/* ==================================================
          🌪️ WEATHER MODE
          ================================================== */}

      {mapMode === 'weather' ? (

        <>

          {/* 🌪️ WINDY MAP */}

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
              🌊 DRAGGABLE LIVE FLOOD PREDICTION
              ================================================== */}

          <div
            ref={
              floodPanelRef
            }

            style={{
              position:
                'absolute',

              left:
                `${panelPosition.x}px`,

              top:
                `${panelPosition.y}px`,

              width:
                'min(320px, calc(100% - 36px))',

              maxHeight:
                '45vh',

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
                '0 10px 30px rgba(0,0,0,0.35)',

              transition:
                isDragging
                  ? 'none'
                  : 'box-shadow 0.2s',
            }}
          >

            {/* ==============================================
                🖱️ DRAG HEADER
                ============================================== */}

            <div
              onMouseDown={
                startDragging
              }

              onTouchStart={
                startDragging
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
                  '8px',

                borderRadius:
                  '10px',

                background:
                  'rgba(255,255,255,0.06)',

                border:
                  '1px solid rgba(255,255,255,0.08)',
              }}
            >

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
                ⚠️ Live Flood Prediction
              </h2>

              <span
                style={{
                  fontSize:
                    '11px',

                  opacity:
                    0.65,

                  whiteSpace:
                    'nowrap',
                }}
              >
                ⠿ Drag
              </span>

            </div>

            {/* ==============================================
                🌧️ WEATHER INFORMATION
                ============================================== */}

            <p>
              🌧️ Rainfall Level:{' '}
              <strong>
                {rainfallLevel}%
              </strong>
            </p>

            <p>
              🌪️ Weather system
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
              📍 Possible Affected Areas
            </h3>

            {/* 🌊 NO FLOOD RISK */}

            {affectedAreas.length === 0 && (

              <p
                style={{
                  marginBottom:
                    '10px',
                }}
              >
                No flood risk detected.
              </p>

            )}

            {/* 🌊 FLOOD RISK AREAS */}

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
                    🌊{' '}
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

            {/* ==============================================
                🔄 RESET POSITION
                ============================================== */}

            <button
              onClick={
                resetPanelPosition
              }

              style={{
                marginTop:
                  '8px',

                width:
                  '100%',

                fontSize:
                  '12px',

                padding:
                  '9px 12px',
              }}
            >
              ↩️ Reset Panel Position
            </button>

          </div>

        </>

      ) : (

        /* ==================================================
           🗺️ NORMAL LEAFLET MAP
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

          {/* 🗺️ OPENSTREETMAP */}

          <TileLayer
            attribution="&copy; OpenStreetMap contributors"

            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {mappedResidents.map(({ resident, position }) => (
            <Marker
              key={`resident-${resident.id}`}
              position={position}
              icon={resident.floodZone ? floodIcon : residentIcon}
            >
              <Popup>
                <strong>{resident.name}</strong>
                <br />
                {resident.status} · {resident.constraint}
                <br />
                {resident.sitio}
                <br />
                📍 {position[0]}, {position[1]}
                <br />
                ☎ {resident.emergencyContactName ?? 'No emergency contact'}
                {resident.emergencyContactNo ? ` · ${resident.emergencyContactNo}` : ''}
              </Popup>
            </Marker>
          ))}

          {/* 🟢 EVACUATION CENTER */}

          <Marker
            position={[
              10.315,
              123.885,
            ]}

            icon={
              evacuationIcon
            }
          >

            <Popup>

              🟢 Cebu City Gym

              <br />

              Evacuation Center

            </Popup>

          </Marker>

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

          {/* 🚨 REALTIME REQUESTS */}

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

                    🚨 Emergency Request

                    <br />

                    👤{' '}
                    {request.resident_name ??
                      'Unknown resident'}

                    <br />

                    🌍{' '}
                    {request.disaster_type ??
                      'Unknown disaster'}

                    <br />

                    📌 Status:{' '}

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
          ✨ BUTTON STYLES
          ================================================== */}

      <style>
        {`

          button {
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

          button:hover {
            background:
              #1e293b;

            transform:
              translateY(-2px);
          }

          @media (max-width: 600px) {

            button {
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
