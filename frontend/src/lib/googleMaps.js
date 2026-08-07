/** Loader for the Google Maps JavaScript API.
 *
 *  Loaded once, lazily, and never allowed to break the page: if the key is
 *  missing, restricted, or the project has no billing, this rejects and the
 *  caller falls back to the built-in SVG radar. A blank grey box where the
 *  city map should be is worse than a diagram that always works.
 *
 *  Google reports auth and billing failures out-of-band through the global
 *  `gm_authFailure` hook rather than by rejecting the script load, so that is
 *  wired up too.
 */
const KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY

let pending = null

export const mapsKeyPresent = () => !!KEY

export function loadGoogleMaps() {
  if (!KEY) return Promise.reject(new Error('No VITE_GOOGLE_MAPS_API_KEY configured.'))
  // Check for the constructor, not just the namespace — the namespace exists
  // as an empty stub from the moment the bootstrap script runs.
  if (typeof window.google?.maps?.Map === 'function') {
    return Promise.resolve(window.google.maps)
  }
  if (pending) return pending

  pending = new Promise((resolve, reject) => {
    // Fired by Maps itself for an invalid key, a referrer the key does not
    // allow, or a project without billing — the three ways this realistically
    // fails in the wild.
    window.gm_authFailure = () => {
      pending = null
      reject(new Error(
        'Google rejected the Maps key — check that billing is enabled and that this '
        + 'origin is allowed under the key’s HTTP referrer restrictions.',
      ))
    }

    const script = document.createElement('script')
    // Deliberately NOT `loading=async`: that variant serves a ~13 KB bootstrap
    // stub where `google.maps` exists but `google.maps.Map` does not, so the
    // constructor is missing at script.onload. The standard URL serves the full
    // API (~310 KB) with the constructors present. Google logs a console notice
    // recommending the async loader; a map that reliably exists is worth it.
    script.src = `https://maps.googleapis.com/maps/api/js?key=${KEY}&v=weekly`
    script.async = true
    script.onerror = () => {
      pending = null
      reject(new Error('Could not reach the Google Maps API.'))
    }
    script.onload = async () => {
      // `loading=async` only bootstraps a stub: `google.maps` exists but
      // `google.maps.Map` does not until the library is pulled in. Resolving on
      // script load alone gives you "maps.Map is not a constructor".
      try {
        const g = window.google?.maps
        if (!g) throw new Error('Maps script loaded but exposed no API.')
        // Harmless on the full build (already loaded) and the recovery path if
        // Google ever serves the stub anyway.
        if (typeof g.Map !== 'function' && typeof g.importLibrary === 'function') {
          await g.importLibrary('maps')     // Map, Circle, Polyline, LatLngBounds
          await g.importLibrary('marker')   // Marker
        }
        if (typeof window.google.maps.Map !== 'function') {
          throw new Error('Maps library loaded without a Map constructor.')
        }
        resolve(window.google.maps)
      } catch (err) {
        pending = null
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    }
    document.head.appendChild(script)
  })

  return pending
}

/** Dark styling, so the map sits in the app's palette rather than glowing white. */
export const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#0d111a' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0d111a' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6b7280' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1f2937' }] },
  { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#374151' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0b1220' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#374151' }] },
]
