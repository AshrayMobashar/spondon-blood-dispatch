/** Browser GPS capture, wrapped so callers get a real error instead of a
 *  silent no-op.
 *
 *  Why this exists: the original signup flow called
 *  `navigator.geolocation.getCurrentPosition(success, () => {})` with an
 *  empty error callback and a swallowed `.catch(() => {})` on the save
 *  request. Any failure — permission denied, a 10s timeout on a weak fix,
 *  an insecure (non-localhost, non-HTTPS) origin, or Safari dropping the
 *  "user gesture" after an `await` — left the donor's `current_location`
 *  permanently null with zero indication anything went wrong. Downstream,
 *  dispatch.py treats an unknown location as "keep them in the pool"
 *  (see dispatch.py's `_distances`), so a silently-failed capture doesn't
 *  just mean one missing donor — it means the ripple radius stops actually
 *  filtering by distance for that donor at all.
 */

/** Human-readable reason for a GeolocationPositionError. */
function describeGeoError(err) {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return 'Location permission was denied. Enable it in your browser/site settings and try again.'
    case err.POSITION_UNAVAILABLE:
      return 'Your device could not determine a location right now.'
    case err.TIMEOUT:
      return 'Getting a GPS fix took too long. Try again somewhere with a clearer signal.'
    default:
      return err.message || 'Could not get your location.'
  }
}

/**
 * Resolves with `{ lat, lng }` or rejects with a message safe to show the
 * user. Call this directly from a click handler (not after an `await`) —
 * Safari/iOS treats geolocation as gesture-gated and silently refuses the
 * prompt once that gesture context is gone.
 */
export function captureLocation({ timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('This browser does not support location services.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(new Error(describeGeoError(err))),
      { enableHighAccuracy: true, timeout, maximumAge: 0 }
    )
  })
}
