import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

// Sign-in state, plus the profile row that carries the display name.
//
// A profile row exists only once someone chooses a username. No row means no
// display name, which is exactly what posting anonymously needs — so anonymity
// is the default rather than a setting to remember, and never having a profile
// is a perfectly normal end state rather than something to be nagged about.

export function useAuth() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  // Distinct from `profile === null`, which cannot tell "no profile exists" from
  // "not fetched yet". Without this the username prompt flashes on every reload:
  // the session restores immediately, the profile arrives a moment later, and in
  // between the app believes the user has no name.
  const [profileLoaded, setProfileLoaded] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setSession(data.session ?? null)
      setLoading(false)
    })

    // Fires on sign-in, sign-out, token refresh, and when the magic link lands
    // back on the page with a session in the URL fragment.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next ?? null)
    })

    return () => { cancelled = true; sub.subscription.unsubscribe() }
  }, [])

  const userId = session?.user?.id ?? null

  useEffect(() => {
    if (!userId) { setProfile(null); setProfileLoaded(true); return }
    let cancelled = false
    setProfileLoaded(false)
    supabase
      .from('profiles')
      .select('user_id, username')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setProfile(data ?? null)
        setProfileLoaded(true)
      })
    return () => { cancelled = true }
  }, [userId])

  return {
    session,
    user: session?.user ?? null,
    profile,
    loading,
    refreshProfile: async () => {
      if (!userId) return
      const { data } = await supabase
        .from('profiles').select('user_id, username').eq('user_id', userId).maybeSingle()
      setProfile(data ?? null)
    },
  }
}

// Magic link only. Nothing to leak, nothing to reset, and no password for a
// user to reuse from somewhere else.
//
// emailRedirectTo must be on the allowlist in Supabase's URL Configuration —
// without that allowlist an attacker can send a link that redirects to their own
// site carrying the token.
export async function sendMagicLink(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  })
  return error
}

export async function signOut() {
  await supabase.auth.signOut()
}

// Headers for our own /api endpoints, carrying the session when there is one.
// Read from the client rather than passed down, so a caller can never send a
// stale token from an earlier render — supabase-js refreshes it in the
// background and the fresh one is what must go out.
export async function authHeaders() {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    : { 'Content-Type': 'application/json' }
}
