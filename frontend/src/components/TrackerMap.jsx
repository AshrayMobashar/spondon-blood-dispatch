/** TrackerMap — the family's live view of the donor coming towards them.
 *
 *  Same rendering approach as CommuteMap: OpenStreetMap data through CARTO's
 *  dark tiles (free, no API key, and it sits inside the app's palette), with
 *  Leaflet driven imperatively from effects. React owns the data, Leaflet owns
 *  the canvas.
 *
 *  The one thing this component must get right is the difference between a live
 *  position and a remembered one, and it says so three ways at once so the
 *  distinction survives a glance at a phone screen in a hospital corridor:
 *  the marker stops pulsing, it turns amber, and a dashed ring is drawn around
 *  it captioned "last known". A frozen icon that still looks live is the exact
 *  failure the corner case exists to prevent.
 */
import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const DHAKA = [23.78, 90.39]

const STYLE_ID = 'tracker-map-style'
if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = `
  .tm-pin{display:grid;place-items:center;border-radius:9999px;font-weight:700;color:#fff;
    box-shadow:0 1px 6px rgba(0,0,0,.55);border:2px solid rgba(255,255,255,.9)}
  .tm-hospital{width:30px;height:30px;font-size:14px;background:#e11d48}
  .tm-donor{width:28px;height:28px;font-size:13px;background:#22c55e}
  .tm-donor-stale{background:#f59e0b}
  /* The pulse is the visual claim that this position is current, so it is
     removed the moment the fix goes stale rather than merely recoloured. */
  .tm-live::before{content:"";position:absolute;inset:-10px;border-radius:9999px;
    background:#22c55e;opacity:.3;animation:tm-pulse 1.8s ease-out infinite}
  @keyframes tm-pulse{0%{transform:scale(.6);opacity:.45}100%{transform:scale(2);opacity:0}}
  .tm-wrap{position:relative}
  .leaflet-container{background:#0d111a;font-family:inherit}
  .leaflet-popup-content-wrapper,.leaflet-popup-tip{background:#161b26;color:#e5e7eb;
    border:1px solid #263041}
  .leaflet-popup-content{margin:10px 12px;font-size:11px;line-height:1.5}
  .leaflet-bar a{background:#161b26;color:#cbd5e1;border-color:#263041}
  .leaflet-bar a:hover{background:#1f2635}
  `
  document.head.appendChild(el)
}

const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  )

const pin = (cls, html, size, wrap = '') =>
  L.divIcon({
    className: '',
    html: `<div class="tm-wrap ${wrap}"><div class="tm-pin ${cls}">${html}</div></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })

/**
 * @param {{lat:number,lng:number}|null} donor      last known donor position
 * @param {{lat:number,lng:number}|null} hospital   destination
 * @param {Array<{lat:number,lng:number}>} trail    breadcrumb of the journey
 * @param {boolean} stale                           is the donor fix stale
 */
export default function TrackerMap({
  donor,
  hospital,
  trail = [],
  stale = false,
  arrived = false,
  className = '',
}) {
  const holder = useRef(null)
  const map = useRef(null)
  const layer = useRef(null)
  // Refit the view only when the *set* of drawn points changes meaningfully,
  // not on every fix — a map that re-centres every few seconds cannot be
  // panned or zoomed by the person trying to read it.
  const fitted = useRef(false)

  useEffect(() => {
    if (map.current || !holder.current) return
    map.current = L.map(holder.current, { zoomControl: true, attributionControl: true })
      .setView(DHAKA, 12)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      maxZoom: 19,
    }).addTo(map.current)
    layer.current = L.layerGroup().addTo(map.current)

    return () => {
      map.current?.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    const m = map.current
    if (!m || !layer.current) return
    layer.current.clearLayers()

    const points = []

    if (hospital) {
      L.marker([hospital.lat, hospital.lng], { icon: pin('tm-hospital', '✚', 30) })
        .bindPopup('<b>Hospital</b><br/>Where the donor is heading.')
        .addTo(layer.current)
      points.push([hospital.lat, hospital.lng])
    }

    if (trail.length > 1) {
      L.polyline(
        trail.map((p) => [p.lat, p.lng]),
        {
          color: stale ? '#f59e0b' : '#22c55e',
          weight: 3,
          opacity: 0.65,
          // A dashed trail reads as "this is history", which is exactly what it
          // is once the signal has dropped.
          dashArray: stale ? '6 8' : null,
        },
      ).addTo(layer.current)
    }

    if (donor) {
      const cls = `tm-donor${stale ? ' tm-donor-stale' : ''}`
      L.marker([donor.lat, donor.lng], {
        icon: pin(cls, arrived ? '✓' : '●', 28, stale || arrived ? '' : 'tm-live'),
      })
        .bindPopup(
          stale
            ? `<b>Last known location</b><br/>${esc(
                'The donor’s phone has lost its connection. This is where they were when it did.',
              )}`
            : '<b>Donor</b><br/>Live position.',
        )
        .addTo(layer.current)
      points.push([donor.lat, donor.lng])

      if (stale) {
        // A ring around a frozen icon: the position is a memory with an area of
        // uncertainty around it, not a point we still stand behind.
        L.circle([donor.lat, donor.lng], {
          radius: 350,
          color: '#f59e0b',
          weight: 1.5,
          dashArray: '4 6',
          fillColor: '#f59e0b',
          fillOpacity: 0.07,
        }).addTo(layer.current)
      }
    }

    if (points.length && !fitted.current) {
      m.fitBounds(L.latLngBounds(points).pad(0.35), { maxZoom: 15 })
      fitted.current = points.length > 1
    }
  }, [donor, hospital, trail, stale, arrived])

  return (
    <div
      ref={holder}
      className={`h-[340px] w-full overflow-hidden rounded-xl border border-line ${className}`}
    />
  )
}
