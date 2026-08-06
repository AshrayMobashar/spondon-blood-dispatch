/** Signed-in end-user session for the donor and patient screens.
 *
 *  Every donor page needs the same three things: who is signed in, a redirect
 *  to /login when nobody is, and a way to refresh the account after a change.
 *  Doing that once here keeps each page from inventing its own variant.
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi, getUser, setUserSession, getUserToken, clearUserSession } from './api.js'

/**
 * @param {object}  options
 * @param {boolean} options.require   redirect to /login when signed out
 * @param {string}  options.role      require this role, else send them to their own home
 */
export function useSession({ require: required = true, role = null } = {}) {
  // Seed from localStorage so the first paint already has a name to show,
  // then confirm against the server.
  const [account, setAccount] = useState(() => getUser())
  const [eligibility, setEligibility] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const navigate = useNavigate()

  const refresh = useCallback(async () => {
    if (!getUserToken()) {
      setAccount(null)
      setLoading(false)
      return null
    }
    try {
      const res = await authApi.me()
      setAccount(res.account)
      setEligibility(res.eligibility)
      setUserSession(getUserToken(), res.account)
      return res
    } catch (err) {
      // A dead token is indistinguishable from being signed out.
      if (err.status === 401) {
        clearUserSession()
        setAccount(null)
      }
      setError(err.message)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (loading) return
    if (!account) {
      if (required) navigate('/login', { replace: true })
      return
    }
    if (role && account.role !== role) navigate(account.home, { replace: true })
  }, [loading, account, required, role, navigate])

  const signOut = useCallback(() => {
    clearUserSession()
    setAccount(null)
    navigate('/login', { replace: true })
  }, [navigate])

  return { account, eligibility, setEligibility, loading, error, refresh, signOut }
}

/** Read a File as a data: URI — used for slip and certificate uploads. */
export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.readAsDataURL(file)
  })
}
