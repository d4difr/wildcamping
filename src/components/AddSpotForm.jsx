import { useState } from 'react'
import { supabase } from '../supabaseClient'

export default function AddSpotForm({ position, onCancel, onSaved }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [photoFile, setPhotoFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    setError('')

    let photo_url = null
    try {
      if (photoFile) {
        const fileExt = photoFile.name.split('.').pop()
        const filePath = `${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`
        const { error: uploadError } = await supabase.storage
          .from('spot-photos')
          .upload(filePath, photoFile)
        if (uploadError) throw uploadError
        const { data } = supabase.storage.from('spot-photos').getPublicUrl(filePath)
        photo_url = data.publicUrl
      }

      const { error: insertError } = await supabase.from('spots').insert({
        name: name.trim(),
        description: description.trim(),
        latitude: position.lat,
        longitude: position.lng,
        photo_url,
        status: 'approved'
      })
      if (insertError) throw insertError

      onSaved()
    } catch (err) {
      setError(err.message || 'Something went wrong saving this spot.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="panel">
      <label htmlFor="spot-name">Spot name</label>
      <input
        id="spot-name"
        type="text"
        placeholder="e.g. Preikestolen ridge"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <label htmlFor="spot-desc">Why is it worth visiting?</label>
      <textarea
        id="spot-desc"
        rows={2}
        placeholder="Flat tent spots, sweeping views, near fresh water…"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <label htmlFor="spot-photo">Photo (optional)</label>
      <input
        id="spot-photo"
        type="file"
        accept="image/*"
        onChange={(e) => setPhotoFile(e.target.files?.[0] || null)}
      />
      {error && <p style={{ color: '#a32d2d', fontSize: '0.85rem' }}>{error}</p>}
      <div className="actions">
        <button className="primary" onClick={handleSave} disabled={saving || !name.trim()}>
          {saving ? 'Saving…' : 'Save spot'}
        </button>
        <button onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
      <p className="hint" style={{ marginTop: '0.6rem' }}>
        Your spot will appear on the map right away.
      </p>
    </div>
  )
}
