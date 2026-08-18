import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

// Sign-in state, plus the profile row that carries the display name.
//
// A profile row exists only once someone chooses a username. No row means no
// display name, which is exactly what posting anonymously needs — so anonymity
// is the default rather than a setting to remember. `needsUsername` is therefore
// "signed in but hasn't chosen", not an error state.

export function useAuth() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
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
    if (!userId) { setProfile(null); return }
    let cancelled = false
    supabase
      .from('profiles')
      .select('user_id, username')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled) setProfile(data ?? null) })
    return () => { cancelled = true }
  }, [userId])

  return {
    session,
    user: session?.user ?? null,
    profile,
    loading,
    // Signed in, but has not picked a display name yet.
    needsUsername: !!userId && profile === null,
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
