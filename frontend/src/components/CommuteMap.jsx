/** CommuteMap — the donor's live view of their saved route and the emergencies
 *  sitting on it, drawn on a real street map.
 *
 *  Free-tier only, no API key: OpenStreetMap data rendered through CARTO's dark
 *  basemap tiles so the map sits inside the app's palette instead of glowing
 *  white. Leaflet is driven imperatively from a couple of effects — React owns
 *  the data, Leaflet owns the canvas — which is far more robust across tab
 *  switches than a wrapper library.
 *
 *  Two interaction modes, chosen by the parent through `editing`:
 *    • view  — click a waypoint (or anywhere on the road) to report "my live
 *              GPS is here now", the gesture the proactive commute ping needs.
 *    • draw  — click the map to drop the next waypoint of a new route; drag a
 *              waypoint to nudge it. Naming happens in the list beside the map,
 *              because the segment *name* is what the engine actually matches on.
 */
import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const DHAKA = [23.78, 90.39]

/* Custom marker styling + the live-GPS pulse. Injected once, globally, so every
   map instance shares it without re-adding the tag. */
const STYLE_ID = 'commute-map-style'
if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = `
  .cm-pin{display:grid;place-items:center;border-radius:9999px;font-weight:700;
    color:#fff;box-shadow:0 1px 4px rgba(0,0,0,.5);border:2px solid rgba(255,255,255,.85)}
  .cm-wp{width:26px;height:26px;font-size:11px}
  .cm-ping{width:30px;height:30px;font-size:13px;cursor:pointer}
  .cm-live{width:20px;height:20px}
  .cm-live-wrap{position:relative}
  .cm-live-wrap::before{content:"";position:absolute;inset:-9px;border-radius:9999px;
    background:currentColor;opacity:.35;animation:cm-pulse 1.8s ease-out infinite}
  @keyframes cm-pulse{0%{transform:scale(.6);opacity:.5}100%{transform:scale(1.9);opacity:0}}
  .leaflet-container{background:#0d111a;font-family:inherit}
  .leaflet-popup-content-wrapper,.leaflet-popup-tip{background:#161b26;color:#e5e7eb;
    border:1px solid #263041}
  .leaflet-popup-content{margin:10px 12px;font-size:11px;line-height:1.5}
  .leaflet-bar a{background:#161b26;color:#cbd5e1;border-color:#263041}
  .leaflet-bar a:hover{background:#1f2635}
  .cm-ping-on{animation:cm-ring 1.4s ease-out infinite}
  @keyframes cm-ring{0%{box-shadow:0 0 0 0 rgba(239,68,68,.55)}100%{box-shadow:0 0 0 12px rgba(239,68,68,0)}}
  `
  document.head.appendChild(el)
}

/* Popups are built as HTML strings, so every interpolated value must be escaped
   — a blood request's hospital / road-segment fields are attacker-controllable
   (a requester types them) and render in another donor's browser. */
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  )

const haversineKm = (a, b) => {
  const R = 6371
  const dLat = ((b[0] - a[0]) * Math.PI) / 180
  const dLng = ((b[1] - a[1]) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a[0] * Math.PI) / 180) *
      Math.cos((b[0] * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

const pin = (cls, html, size) =>
  L.divIcon({
    className: '',
    html: `<div class="cm-pin ${cls}">${html}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })

/** Colour a ping by the strongest actionable thing true about it. The route
 *  highlights only apply to a request the donor could actually answer — a
 *  request on their road that needs a blood type they don't have is real
 *  situational context, not a call to them, so it stays neutral grey. */
function pingLook(p, donorBloodType) {
  const match = p.blood_type === donorBloodType || p.blood_type_match
  if (match && p.on_route_now) return { color: '#ef4444', ring: true, label: 'On your route now' }
  if (match && p.on_saved_route) return { color: '#6366f1', ring: false, label: 'On a saved segment' }
  if (match) return { color: '#f43f5e', ring: false, label: `${p.blood_type} — you match` }
  return { color: '#6b7280', ring: false, label: `${p.blood_type} (not your type)` }
}

export default function CommuteMap({
  route,
  draftPoints = [],
  editing = false,
  location,
  staleAfter = 15,
  pings = [],
  donorBloodType,
  onAddPoint,
  onMovePoint,
  onPickLocation,
}) {
  const boxRef = useRef(null)
  const mapRef = useRef(null)
  const layersRef = useRef(null)
  // Auto-frame the map only once; after that the donor's own pan/zoom is theirs
  // to keep — a background ping poll must never snap the view back.
  const framedRef = useRef(false)
  // Keep the freshest handlers without re-binding the map click listener.
  const handlers = useRef({})
  handlers.current = { editing, onAddPoint, onPickLocation, points: editing ? draftPoints : route?.points ?? [] }

  /* Create the map once. */
  useEffect(() => {
    if (!boxRef.current || mapRef.current) return
    const map = L.map(boxRef.current, {
      center: DHAKA,
      zoom: 12,
      zoomControl: true,
      attributionControl: true,
    })
    L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      {
        subdomains: 'abcd',
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      },
    ).addTo(map)

    layersRef.current = {
      route: L.layerGroup().addTo(map),
      pings: L.layerGroup().addTo(map),
      live: L.layerGroup().addTo(map),
    }

    map.on('click', (e) => {
      const { editing: ed, onAddPoint: add, onPickLocation: pick, points } = handlers.current
      const lat = e.latlng.lat
      const lng = e.latlng.lng
      if (ed) {
        add?.({ lat, lng })
        return
      }
      // View mode: report live GPS here, snapping the segment name to the
      // nearest saved waypoint so route matching still has a name to compare.
      let name = null
      let best = Infinity
      for (const pt of points) {
        const d = haversineKm([lat, lng], [pt.lat, pt.lng])
        if (d < best && d < 0.25) {
          best = d
          name = pt.name || null
        }
      }
      pick?.(lat, lng, name)
    })

    mapRef.current = map
    // The container often mounts hidden (behind a tab) or mid-resize; Leaflet
    // needs a nudge once it has real dimensions or the tiles grey out.
    const invalidate = () => map.invalidateSize()
    const t = setTimeout(invalidate, 60)
    const ro = new ResizeObserver(invalidate)
    ro.observe(boxRef.current)
    return () => {
      clearTimeout(t)
      ro.disconnect()
      map.remove()
      mapRef.current = null
    }
  }, [])

  /* Redraw the route line + waypoints. */
  useEffect(() => {
    const map = mapRef.current
    const layer = layersRef.current?.route
    if (!map || !layer) return
    layer.clearLayers()

    const points = editing ? draftPoints : route?.points ?? []
    const latlngs = points.map((p) => [p.lat, p.lng])
    const paused = !editing && route && route.enabled === false

    if (latlngs.length >= 2) {
      L.polyline(latlngs, {
        color: paused ? '#6b7280' : '#6366f1',
        weight: 4,
        opacity: paused ? 0.5 : 0.85,
        dashArray: editing ? '6 6' : null,
      }).addTo(layer)
    }

    points.forEach((p, i) => {
      const m = L.marker([p.lat, p.lng], {
        icon: pin('cm-wp', String(i + 1), 26),
        draggable: editing,
        title: p.name || `Waypoint ${i + 1}`,
      }).addTo(layer)
      if (editing) {
        m.on('dragend', (e) => {
          const ll = e.target.getLatLng()
          onMovePoint?.(i, { lat: ll.lat, lng: ll.lng })
        })
      } else {
        m.bindPopup(
          `<b>${esc(p.name || `Waypoint ${i + 1}`)}</b><br/>Click to set this as your live location.`,
        )
        m.on('click', () => onPickLocation?.(p.lat, p.lng, p.name || null))
      }
    })

    // Frame the whole picture — route + pings — once, on the first draw that
    // has anything to show. Never again, so a poll can't steal the donor's view.
    if (!editing && !framedRef.current) {
      const pts = [...latlngs, ...pings.map((p) => [p.lat, p.lng])]
      if (location) pts.push([location.lat, location.lng])
      if (pts.length === 1) {
        map.setView(pts[0], 14)
        framedRef.current = true
      } else if (pts.length > 1) {
        map.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 15 })
        framedRef.current = true
      }
    }
  }, [route, draftPoints, editing, pings, location, onMovePoint, onPickLocation])

  /* Redraw the active-ping markers. */
  useEffect(() => {
    const layer = layersRef.current?.pings
    if (!layer) return
    layer.clearLayers()
    pings.forEach((p) => {
      const look = pingLook(p, donorBloodType)
      const m = L.marker([p.lat, p.lng], {
        icon: pin(
          `cm-ping${look.ring ? ' cm-ping-on' : ''}`,
          '🩸',
          30,
        ),
        title: `${p.blood_type} · ${p.hospital}`,
      }).addTo(layer)
      // Tint the pin body to the look colour.
      const node = m.getElement?.() || m._icon
      const body = node?.querySelector?.('.cm-pin')
      if (body) body.style.background = look.color
      const dist = p.distance_km != null ? `${p.distance_km} km away` : 'distance unknown'
      m.bindPopup(
        `<b>${esc(p.blood_type)} needed</b> · ${esc(p.severity.replace(/_/g, ' ').toLowerCase())}<br/>` +
          `${esc(p.hospital)}${p.road_segment ? ` · ${esc(p.road_segment)}` : ''}<br/>` +
          `<span style="color:#9ca3af">${esc(look.label)} · ${esc(dist)}</span>`,
      )
    })
  }, [pings, donorBloodType])

  /* Redraw the donor's live GPS position. */
  useEffect(() => {
    const map = mapRef.current
    const layer = layersRef.current?.live
    if (!map || !layer) return
    layer.clearLayers()
    if (!location) return
    const ageMin = location.updated_at
      ? (Date.now() - new Date(location.updated_at).getTime()) / 60000
      : Infinity
    const stale = ageMin > staleAfter
    const color = stale ? '#f59e0b' : '#22c55e'
    const icon = L.divIcon({
      className: '',
      html: `<div class="cm-live-wrap" style="color:${color}"><div class="cm-pin cm-live" style="background:${color}"></div></div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    })
    L.marker([location.lat, location.lng], { icon, zIndexOffset: 1000 })
      .bindPopup(
        stale
          ? `Last GPS fix on ${esc(location.road_segment || 'your route')} is over ${staleAfter} min old — treated as "left".`
          : `You are here${location.road_segment ? ` — on ${esc(location.road_segment)}` : ''}.`,
      )
      .addTo(layer)
  }, [location, staleAfter])

  return (
    <div
      ref={boxRef}
      className="h-[420px] w-full overflow-hidden rounded-xl border border-line"
      style={{ cursor: editing ? 'crosshair' : 'grab' }}
    />
  )
}
