import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

// Favourites, held as a Set of spot ids.
//
// Signed-out visitors simply have none. There is deliberately no localStorage
// fallback: a favourite that silently vanishes when you clear your browser is
// worse than one you were told requires an account, and merging an anonymous
// list into an account later is the kind of edge case that goes wrong quietly.
export function useFavourites(userId) {
  const [ids, setIds] = useState(() => new Set())
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!userId) { setIds(new Set()); setLoaded(true); return }
    let cancelled = false
    setLoaded(false)
    supabase
      .from('favourites')
      .select('spot_id')
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) console.warn('favourites unavailable:', error.message)
        setIds(new Set((data ?? []).map((r) => r.spot_id)))
        setLoaded(true)
      })
    return () => { cancelled = true }
  }, [userId])

  // Optimistic: the Set updates first so the heart responds immediately, and
  // reverts if the write fails. RLS is what actually enforces ownership, so a
  // rejected write is a genuine failure rather than something to paper over.
  const toggle = useCallback(async (spotId) => {
    if (!userId) return { error: 'not-signed-in' }
    const had = ids.has(spotId)

    setIds((prev) => {
      const next = new Set(prev)
      if (had) next.delete(spotId); else next.add(spotId)
      return next
    })

    const { error } = had
      ? await supabase.from('favourites').delete().eq('spot_id', spotId).eq('user_id', userId)
      : await supabase.from('favourites').insert({ spot_id: spotId, user_id: userId })

    if (error) {
      setIds((prev) => {
        const next = new Set(prev)
        if (had) next.add(spotId); else next.delete(spotId)
        return next
      })
      return { error: error.message }
    }
    return {}
  }, [userId, ids])

  return { favouriteIds: ids, favouritesLoaded: loaded, toggleFavourite: toggle }
}
