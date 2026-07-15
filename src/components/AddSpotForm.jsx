import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

const REGIONS = [
  'Agder',
  'Akershus',
  'Buskerud',
  'Innlandet',
  'Møre og Romsdal',
  'Nordland',
  'Oslo',
  'Rogaland',
  'Telemark',
  'Troms og Finnmark',
  'Trøndelag',
  'Vestfold',
  'Vestland',
  'Østfold',
  'Øvrige Norge',
]

const ACCESS_OPTIONS = [
  { value: '', label: 'Select access type…' },
  { value: 'road', label: '🚗 Road access' },
  { value: 'short-hike', label: '🥾 Short hike (< 1 hr)' },
  { value: 'day-hike', label: '⛰ Day hike (1–3 hr)' },
  { value: 'remote', label: '🏔 Remote (3 hr+)' },
]

const MAX_PHOTOS = 3
const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

async function detectRegion(lat, lng) {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?types=region&country=no&access_token=${TOKEN}`
  const res = await fetch(url)
  const data = await res.json()
  return data.features?.[0]?.text || null
}

export default function AddSpotForm({ position, onCancel, onSaved }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [spotType, setSpotType] = useState('tent')
  const [access, setAccess] = useState('')
  const [region, setRegion] = useState('')
  const [regionLoading, setRegionLoading] = useState(false)
  const [photoFiles, setPhotoFiles] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setRegionLoading(true)
    detectRegion(position.lat, position.lng)
      .then((detected) => {
        if (!detected) return
        // Find closest match in our list (case-insensitive substring)
        const match = REGIONS.find((r) => r.toLowerCase() === detected.toLowerCase())
          || REGIONS.find((r) => r.toLowerCase().includes(detected.toLowerCase()))
          || REGIONS.find((r) => detected.toLowerCase().includes(r.toLowerCase()))
        setRegion(match || '')
      })
      .catch(() => setRegion(''))
      .finally(() => setRegionLoading(false))
  }, [position.lat, position.lng])

  function handleFileChange(e) {
    const incoming = Array.from(e.target.files || [])
    setPhotoFiles((prev) => [...prev, ...incoming].slice(0, MAX_PHOTOS))
    e.target.value = ''
  }

  function removePhoto(index) {
    setPhotoFiles((prev) => prev.filter((_, i) => i !== index))
  }

  async function uploadPhoto(file) {
    const fileExt = file.name.split('.').pop()
    const filePath = `${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`
    const { error: uploadError } = await supabase.storage.from('spot-photos').upload(filePath, file)
    if (uploadError) throw uploadError
    const { data } = supabase.storage.from('spot-photos').getPublicUrl(filePath)
    return data.publicUrl
  }

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    setError('')
    try {
      const photo_urls = photoFiles.length ? await Promise.all(photoFiles.map(uploadPhoto)) : []
      const { error: insertError } = await supabase.from('spots').insert({
        name: name.trim(),
        description: description.trim(),
        latitude: position.lat,
        longitude: position.lng,
        photo_url: photo_urls[0] || null,
        photo_urls,
        spot_type: spotType,
        access: access || null,
        region: region || null,
        status: 'approved'
      })
      if (insertError) throw insertError
      onSaved()
    } catch (err) {
      setError(err.message || 'Something went wrong saving this camp.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="panel">
      <div className="spot-type-toggle">
        <button type="button" className={`spot-type-btn${spotType === 'tent' ? ' spot-type-btn--active' : ''}`} onClick={() => setSpotType('tent')}>
          ⛺ Tent
        </button>
        <button type="button" className={`spot-type-btn${spotType === 'hammock' ? ' spot-type-btn--active hammock' : ''}`} onClick={() => setSpotType('hammock')}>
          🪢 Hammock
        </button>
      </div>

      <label htmlFor="spot-name">Camp name</label>
      <input id="spot-name" type="text" placeholder="e.g. Preikestolen ridge" value={name} onChange={(e) => setName(e.target.value)} />

      <label htmlFor="spot-desc">Why is it worth visiting?</label>
      <textarea id="spot-desc" rows={2} placeholder="Flat tent spots, sweeping views, near fresh water…" value={description} onChange={(e) => setDescription(e.target.value)} />

      <label htmlFor="spot-access">Access</label>
      <select id="spot-access" value={access} onChange={(e) => setAccess(e.target.value)}>
        {ACCESS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      <label htmlFor="spot-region">Region</label>
      <select
        id="spot-region"
        value={region}
        onChange={(e) => setRegion(e.target.value)}
        disabled={regionLoading}
      >
        <option value="">{regionLoading ? 'Detecting…' : 'Select region…'}</option>
        {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>

      <label>Photos (optional, up to {MAX_PHOTOS})</label>
      {photoFiles.length < MAX_PHOTOS && (
        <label className="photo-upload-btn">
          + Add photo
          <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleFileChange} />
        </label>
      )}
      {photoFiles.length > 0 && (
        <div className="photo-preview-strip">
          {photoFiles.map((file, i) => (
            <div key={i} className="photo-preview-item">
              <img src={URL.createObjectURL(file)} alt="" />
              <button type="button" className="photo-remove-btn" onClick={() => removePhoto(i)} aria-label="Remove photo">✕</button>
            </div>
          ))}
        </div>
      )}

      {error && <p style={{ color: '#a32d2d', fontSize: '0.85rem' }}>{error}</p>}
      <div className="actions">
        <button className="primary" onClick={handleSave} disabled={saving || !name.trim()}>{saving ? 'Saving…' : 'Save camp'}</button>
        <button onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
      <p className="hint" style={{ marginTop: '0.6rem' }}>Your camp will appear on the map right away.</p>
    </div>
  )
}
