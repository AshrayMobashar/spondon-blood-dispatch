/** City-Wide Radar — the family's live view of a rare-blood broadcast.
 *
 *  Privacy is the design constraint, not a caveat: a donor is never a dot at
 *  their own position. Every donor is generalised server-side into one of the
 *  published city zones, and this map draws zones only. Nothing here can be
 *  read back to an address, and the browser is never sent the coordinates in
 *  the first place — see `app/zones.py`.
 *
 *  Rendered as inline SVG rather than Mapbox GL: a tile provider needs an
 *  access token this deployment does not have, and the radar's job is to show
 *  *coverage and reach*, which zone geometry conveys without one. The zone
 *  centroids come from `GET /api/zones`, so swapping in a real tile layer later
 *  means replacing the backdrop, not the data flow.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { DARK_MAP_STYLE, loadGoogleMaps, mapsKeyPresent } from '../lib/googleMaps.js'

const SIZE = 480
const C = SIZE / 2

/** Project a lat/lng onto the square, given the bounds of all zones. */
function projector(zones) {
  const lats = zones.map((z) => z.lat)
  const lngs = zones.map((z) => z.lng)
  const pad = 0.012
  const minLat = Math.min(...lats) - pad
  const maxLat = Math.max(...lats) + pad
  const minLng = Math.min(...lngs) - pad
  const maxLng = Math.max(...lngs) + pad
  return (lat, lng) => ({
    x: ((lng - minLng) / (maxLng - minLng)) * SIZE,
    y: SIZE - ((lat - minLat) / (maxLat - minLat)) * SIZE,
  })
}

export default function CityRadar(props) {
  // Prefer the real city map; fall back to the SVG the moment Google refuses.
  const [mapFailed, setMapFailed] = useState(!mapsKeyPresent())
  if (mapFailed) return <SvgRadar {...props} note={typeof mapFailed === 'string' ? mapFailed : null} />
  return <GoogleRadar {...props} onFail={setMapFailed} />
}

/* ── Google Maps rendering ────────────────────────────────────────── */
function GoogleRadar({ zones = [], summary, live, hospitalZone, bloodType, onFail }) {
  const boxRef = useRef(null)
  const mapRef = useRef(null)
  const overlaysRef = useRef([])
  const routeRef = useRef(null)
  const [ready, setReady] = useState(false)

  // Create the map once.
  useEffect(() => {
    let cancelled = false
    loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !boxRef.current) return
        mapRef.current = new maps.Map(boxRef.current, {
          center: { lat: 23.78, lng: 90.39 },
          zoom: 11,
          styles: DARK_MAP_STYLE,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: 'cooperative',
        })
        setReady(true)
      })
      .catch((err) => !cancelled && onFail(err.message))
    return () => { cancelled = true }
  }, [onFail])

  // Redraw zone overlays whenever the pool or the live counts change.
  useEffect(() => {
    const maps = window.google?.maps
    if (!ready || !maps || !mapRef.current) return

    overlaysRef.current.forEach((o) => o.setMap(null))
    overlaysRef.current = []

    const byZone = new Map((summary?.zones ?? []).map((z) => [z.zone, z]))
    const maxEligible = Math.max(1, ...(summary?.zones ?? []).map((z) => z.eligible))
    const bounds = new maps.LatLngBounds()

    zones.forEach((z) => {
      const stats = byZone.get(z.name)
      const eligible = stats?.eligible ?? 0
      const reached = live?.zones?.[z.name] ?? 0
      const isHospital = z.name === hospitalZone
      if (!eligible && !isHospital) return

      const center = { lat: z.lat, lng: z.lng }
      bounds.extend(center)

      if (eligible > 0) {
        // Radius encodes how many donors that zone holds — a coverage blob,
        // never a pin on a person. 900 m minimum so a single-donor zone still
        // reads as an area rather than a point.
        const radius = 900 + (eligible / maxEligible) * 2600
        overlaysRef.current.push(
          new maps.Circle({
            map: mapRef.current,
            center,
            radius,
            strokeColor: reached ? '#22c55e' : '#4b5563',
            strokeOpacity: reached ? 0.9 : 0.5,
            strokeWeight: reached ? 2 : 1,
            fillColor: reached ? '#22c55e' : '#374151',
            fillOpacity: reached ? 0.22 : 0.1,
            clickable: false,
          }),
        )
      }

      overlaysRef.current.push(
        new maps.Marker({
          map: mapRef.current,
          position: center,
          label: {
            text: `${z.name}${eligible ? ` ${reached ? `${reached}/` : ''}${eligible}` : ''}`,
            color: isHospital ? '#ef4444' : reached ? '#22c55e' : '#9ca3af',
            fontSize: '11px',
            fontWeight: '600',
          },
          icon: {
            path: maps.SymbolPath.CIRCLE,
            scale: isHospital ? 7 : 4,
            fillColor: isHospital ? '#ef4444' : reached ? '#22c55e' : '#4b5563',
            fillOpacity: 1,
            strokeWeight: 0,
            labelOrigin: new maps.Point(0, -2.4),
          },
          title: isHospital ? `${z.name} — hospital zone` : `${z.name} — ${eligible} eligible`,
        }),
      )
    })

    if (!bounds.isEmpty()) mapRef.current.fitBounds(bounds, 48)
  }, [ready, zones, summary, live?.zones, hospitalZone])

  // The accepted donor's route — zone centroid to hospital zone, nothing finer.
  useEffect(() => {
    const maps = window.google?.maps
    if (!ready || !maps || !mapRef.current) return
    routeRef.current?.setMap(null)
    routeRef.current = null

    const from = zones.find((z) => z.name === live?.secured?.zone)
    const to = zones.find((z) => z.name === hospitalZone)
    if (!from || !to) return

    routeRef.current = new maps.Polyline({
      map: mapRef.current,
      path: [{ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng }],
      strokeColor: '#22c55e',
      strokeOpacity: 0,
      icons: [{
        icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, strokeColor: '#22c55e', scale: 3 },
        offset: '0',
        repeat: '14px',
      }],
    })
  }, [ready, zones, live?.secured, hospitalZone])

  return (
    <div>
      <div
        ref={boxRef}
        className="h-[420px] w-full overflow-hidden rounded-xl border border-line bg-[#0d111a]"
      />
      {!ready && (
        <p className="mt-2 text-center text-[11px] text-text-faint">Loading the city map…</p>
      )}
      <Legend bloodType={bloodType} live={live} provider="Google Maps" />
    </div>
  )
}

function Legend({ bloodType, live, provider }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-line pt-3 text-[10px] text-text-faint">
      <span className="flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-primary" /> hospital zone
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-[#4b5563]" /> {bloodType} donors available
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-success" /> pinged in this broadcast
        {live?.reached ? ` (${live.reached})` : ''}
      </span>
      <span className="ml-auto text-[#4b5563]">
        {provider} · blob size = donors in that zone; positions are zone centroids, never a
        donor's own
      </span>
    </div>
  )
}

/* ── SVG fallback ─────────────────────────────────────────────────── */
function SvgRadar({
  zones = [],
  summary,
  live,
  hospitalZone,
  bloodType,
  note,
}) {
  const project = useMemo(() => (zones.length ? projector(zones) : null), [zones])

  // Which zones lit up most recently — drives the pulse animation.
  const [pulsing, setPulsing] = useState({})
  const seen = useRef({})
  useEffect(() => {
    const next = {}
    Object.entries(live?.zones ?? {}).forEach(([zone, count]) => {
      if (seen.current[zone] !== count) next[zone] = Date.now()
    })
    seen.current = { ...(live?.zones ?? {}) }
    if (Object.keys(next).length) {
      setPulsing((p) => ({ ...p, ...next }))
      const t = setTimeout(() => setPulsing({}), 2200)
      return () => clearTimeout(t)
    }
    return undefined
  }, [live?.zones])

  if (!project) {
    return (
      <div className="grid h-[300px] place-items-center text-[11px] text-text-faint">
        Loading the city map…
      </div>
    )
  }

  const eligibleByZone = new Map(
    (summary?.zones ?? []).map((z) => [z.zone, z]),
  )
  const hospital = zones.find((z) => z.name === hospitalZone)
  const hp = hospital ? project(hospital.lat, hospital.lng) : { x: C, y: C }
  const securedZone = live?.secured?.zone
  const secured = securedZone ? zones.find((z) => z.name === securedZone) : null

  const maxEligible = Math.max(
    1,
    ...(summary?.zones ?? []).map((z) => z.eligible),
  )

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="mx-auto h-auto w-full max-w-[480px]">
        <defs>
          <radialGradient id="radar-sweep">
            <stop offset="0%" stopColor="rgb(239 68 68)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="rgb(239 68 68)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* City-wide wash: the override's reach is the whole map, not a ring. */}
        <rect x="0" y="0" width={SIZE} height={SIZE} rx="14" className="fill-[#0d111a]" />
        {live?.status === 'broadcasting' && (
          <rect x="0" y="0" width={SIZE} height={SIZE} rx="14" fill="url(#radar-sweep)">
            <animate
              attributeName="opacity"
              values="0.35;1;0.35"
              dur="1.6s"
              repeatCount="indefinite"
            />
          </rect>
        )}

        {/* Route drawn only once a donor has accepted — zone to hospital. */}
        {secured && (
          <line
            x1={project(secured.lat, secured.lng).x}
            y1={project(secured.lat, secured.lng).y}
            x2={hp.x}
            y2={hp.y}
            className="stroke-success"
            strokeWidth="2"
            strokeDasharray="6 4"
          >
            <animate attributeName="stroke-dashoffset" values="20;0" dur="1s" repeatCount="indefinite" />
          </line>
        )}

        {/* Zones */}
        {zones.map((z) => {
          const { x, y } = project(z.lat, z.lng)
          const stats = eligibleByZone.get(z.name)
          const eligible = stats?.eligible ?? 0
          const reached = live?.zones?.[z.name] ?? 0
          const isHospital = z.name === hospitalZone
          const isPulsing = !!pulsing[z.name]
          // Area scales with how many donors the zone holds — a heat map, not
          // a set of individual pins.
          const r = 9 + (eligible / maxEligible) * 17

          return (
            <g key={z.name}>
              {eligible > 0 && (
                <circle
                  cx={x}
                  cy={y}
                  r={r}
                  className={reached ? 'fill-success/25 stroke-success/60' : 'fill-[#1f2937] stroke-[#374151]'}
                  strokeWidth="1"
                />
              )}
              {isPulsing && (
                <circle cx={x} cy={y} r={r} className="fill-none stroke-success" strokeWidth="2">
                  <animate attributeName="r" values={`${r};${r + 26}`} dur="1.4s" repeatCount="2" />
                  <animate attributeName="opacity" values="0.9;0" dur="1.4s" repeatCount="2" />
                </circle>
              )}
              <circle
                cx={x}
                cy={y}
                r={eligible > 0 ? 3.5 : 2}
                className={
                  reached ? 'fill-success' : eligible > 0 ? 'fill-[#4b5563]' : 'fill-[#374151]'
                }
              />
              <text
                x={x}
                y={y - r - 5}
                textAnchor="middle"
                className={`text-[9px] ${
                  reached ? 'fill-success' : eligible > 0 ? 'fill-text-muted' : 'fill-[#4b5563]'
                }`}
              >
                {z.name}
                {eligible > 0 && ` · ${reached ? `${reached}/` : ''}${eligible}`}
              </text>
              {isHospital && (
                <>
                  <circle cx={x} cy={y} r="7" className="fill-primary" />
                  <text
                    x={x}
                    y={y + 18}
                    textAnchor="middle"
                    className="fill-primary text-[9px] font-bold"
                  >
                    hospital
                  </text>
                </>
              )}
            </g>
          )
        })}
      </svg>

      {note && (
        <p className="mt-2 rounded-lg border border-warning/25 bg-warning/[0.07] px-3 py-2 text-[10px] text-warning">
          Falling back to the schematic radar — {note}
        </p>
      )}
      <Legend bloodType={bloodType} live={live} provider="Schematic" />
    </div>
  )
}
