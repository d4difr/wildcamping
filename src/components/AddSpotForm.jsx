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
        status: 'pending'
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
      <input
        type="text"
        placeholder="Spot name (e.g. Preikestolen ridge)"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <textarea
        rows={2}
        placeholder="Why is it worth visiting?"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <input
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
      <p className="hint" style={{ marginTop: '0.5rem' }}>
        Submitted spots are reviewed before they appear publicly.
      </p>
    </div>
  )
}
