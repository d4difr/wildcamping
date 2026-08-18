import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

// Private planning pins. Account only — see supabase/phase4-planning-pins.sql
// for why the device token cannot be the boundary here.
//
// No optimistic updates, unlike favourites. A favourite that briefly shows the
// wrong state is cosmetic; a planning pin that appears saved and is not means
// someone loses a spot they were relying on finding again. The list is
// refetched from the server after every change so what is on screen is what the
// database actually holds.
export function usePlanningPins(userId) {
  const [pins, setPins] = useState([])
  const [loaded, setLoaded] = useState(false)

  const reload = useCallback(async () => {
    if (!userId) { setPins([]); setLoaded(true); return }
    const { data, error } = await supabase
      .from('planning_pins')
      .select('id, name, note, latitude, longitude, created_at')
      .order('created_at', { ascending: false })
    if (error) console.warn('planning pins unavailable:', error.message)
    setPins(data ?? [])
    setLoaded(true)
  }, [userId])

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    reload().then(() => { if (cancelled) return })
    return () => { cancelled = true }
  }, [reload])

  const addPin = useCallback(async ({ name, note, latitude, longitude }) => {
    if (!userId) return { error: 'not-signed-in' }
    const { error } = await supabase.from('planning_pins').insert({
      user_id: userId,
      name: name.trim(),
      note: note?.trim() || null,
      latitude,
      longitude,
    })
    if (error) return { error: error.message }
    await reload()
    return {}
  }, [userId, reload])

  const removePin = useCallback(async (id) => {
    if (!userId) return { error: 'not-signed-in' }
    // user_id is redundant next to RLS, which already restricts this to the
    // owner. Kept as a second condition so a policy mistake cannot turn this
    // into "delete any pin by id".
    const { error } = await supabase
      .from('planning_pins').delete().eq('id', id).eq('user_id', userId)
    if (error) return { error: error.message }
    await reload()
    return {}
  }, [userId, reload])

  return { planningPins: pins, planningPinsLoaded: loaded, addPin, removePin, reloadPins: reload }
}
