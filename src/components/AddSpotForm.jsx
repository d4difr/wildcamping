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
  { value: '', label: 'Velg tilgangstype…' },
  { value: 'road', label: '🚗 Bilvei' },
  { value: 'short-hike', label: '🥾 Kort tur (< 1 t)' },
  { value: 'day-hike', label: '⛰ Dagstur (1–3 t)' },
  { value: 'remote', label: '🏔 Avsidesliggende (3 t+)' },
]

const MAX_PHOTOS = 3
const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

async function detectRegion(lat, lng) {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?types=region&country=no&access_token=${TOKEN}`
  const res = await fetch(url)
  const data = await res.json()
  return data.features?.[0]?.text || null
}

// position: { lat, lng } — required for new camps, optional for edits
// camp: existing camp object — set when editing
// ownerToken: the device's localStorage token
export default function AddSpotForm({ position, camp, ownerToken, onCancel, onSaved }) {
  const isEditing = !!camp

  const [name, setName] = useState(camp?.name || '')
  const [description, setDescription] = useState(camp?.description || '')
  const [spotType, setSpotType] = useState(camp?.spot_type || 'tent')
  const [access, setAccess] = useState(camp?.access || '')
  const [region, setRegion] = useState(camp?.region || '')
  const [regionLoading, setRegionLoading] = useState(false)
  const [existingPhotoUrls, setExistingPhotoUrls] = useState(camp?.photo_urls || [])
  const [photoFiles, setPhotoFiles] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (isEditing) return // region already set from camp data
    setRegionLoading(true)
    detectRegion(position.lat, position.lng)
      .then((detected) => {
        if (!detected) return
        const match = REGIONS.find((r) => r.toLowerCase() === detected.toLowerCase())
          || REGIONS.find((r) => r.toLowerCase().includes(detected.toLowerCase()))
          || REGIONS.find((r) => detected.toLowerCase().includes(r.toLowerCase()))
        setRegion(match || '')
      })
      .catch(() => setRegion(''))
      .finally(() => setRegionLoading(false))
  }, [position?.lat, position?.lng, isEditing])

  function handleFileChange(e) {
    const incoming = Array.from(e.target.files || [])
    const totalAllowed = MAX_PHOTOS - existingPhotoUrls.length
    setPhotoFiles((prev) => [...prev, ...incoming].slice(0, totalAllowed))
    e.target.value = ''
  }

  function removeNewPhoto(index) {
    setPhotoFiles((prev) => prev.filter((_, i) => i !== index))
  }

  function removeExistingPhoto(index) {
    setExistingPhotoUrls((prev) => prev.filter((_, i) => i !== index))
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
    if (name.trim().length < 5) { setError('Navnet må være minst 5 tegn.'); return }
    if (!access) { setError('Velg en tilgangstype.'); return }
    if (!isEditing) {
      const { lat, lng } = position
      if (lat < 57 || lat > 71.5 || lng < 4 || lng > 31.5) {
        setError('Koordinatene er utenfor Norge. Vildakart er kun for norske leirplasser.')
        return
      }
    }
    setSaving(true)
    setError('')
    try {
      const newUrls = photoFiles.length ? await Promise.all(photoFiles.map(uploadPhoto)) : []
      const photo_urls = [...existingPhotoUrls, ...newUrls]

      if (isEditing) {
        const { error: updateError } = await supabase
          .from('spots')
          .update({
            name: name.trim(),
            description: description.trim(),
            photo_url: photo_urls[0] || null,
            photo_urls,
            spot_type: spotType,
            access: access || null,
            region: region || null,
          })
          .eq('id', camp.id)
          .eq('owner_token', ownerToken)
        if (updateError) throw updateError
      } else {
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
          status: 'approved',
          owner_token: ownerToken,
        })
        if (insertError) throw insertError
      }
      onSaved()
    } catch (err) {
      setError(err.message || 'Noe gikk galt ved lagring av leirplassen.')
    } finally {
      setSaving(false)
    }
  }

  const totalPhotos = existingPhotoUrls.length + photoFiles.length

  return (
    <div className="panel">
      {isEditing && <p className="hint" style={{ marginBottom: '0.6rem' }}>Redigerer: <strong>{camp.name}</strong></p>}

      <div className="spot-type-toggle">
        <button type="button" className={`spot-type-btn${spotType === 'tent' ? ' spot-type-btn--active' : ''}`} onClick={() => setSpotType('tent')}>
          ⛺ Telt
        </button>
        <button type="button" className={`spot-type-btn${spotType === 'hammock' ? ' spot-type-btn--active hammock' : ''}`} onClick={() => setSpotType('hammock')}>
          🪢 Hengekøye
        </button>
      </div>

      <label htmlFor="spot-name">Leirplassnavn</label>
      <input id="spot-name" type="text" placeholder="f.eks. Preikestolen-ryggen" value={name} onChange={(e) => setName(e.target.value)} />

      <label htmlFor="spot-desc">Hvorfor er det verdt å besøke?</label>
      <textarea id="spot-desc" rows={2} placeholder="Flate teltplasser, vid utsikt, nær ferskvann…" value={description} onChange={(e) => setDescription(e.target.value)} />

      <label htmlFor="spot-access">Tilgang</label>
      <select id="spot-access" value={access} onChange={(e) => setAccess(e.target.value)}>
        {ACCESS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      <label htmlFor="spot-region">Fylke</label>
      <select id="spot-region" value={region} onChange={(e) => setRegion(e.target.value)} disabled={regionLoading}>
        <option value="">{regionLoading ? 'Oppdager…' : 'Velg fylke…'}</option>
        {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>

      <label>Bilder (valgfritt, opptil {MAX_PHOTOS})</label>

      {/* Existing photos (edit mode) */}
      {existingPhotoUrls.length > 0 && (
        <div className="photo-preview-strip">
          {existingPhotoUrls.map((url, i) => (
            <div key={url} className="photo-preview-item">
              <img src={url} alt="" />
              <button type="button" className="photo-remove-btn" onClick={() => removeExistingPhoto(i)} aria-label="Remove photo">✕</button>
            </div>
          ))}
        </div>
      )}

      {/* New photos being added */}
      {photoFiles.length > 0 && (
        <div className="photo-preview-strip">
          {photoFiles.map((file, i) => (
            <div key={i} className="photo-preview-item">
              <img src={URL.createObjectURL(file)} alt="" />
              <button type="button" className="photo-remove-btn" onClick={() => removeNewPhoto(i)} aria-label="Remove photo">✕</button>
            </div>
          ))}
        </div>
      )}

      {totalPhotos < MAX_PHOTOS && (
        <label className="photo-upload-btn">
          + Legg til bilde
          <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleFileChange} />
        </label>
      )}

      {error && <p style={{ color: '#a32d2d', fontSize: '0.85rem' }}>{error}</p>}
      <div className="actions">
        <button className="primary" onClick={handleSave} disabled={saving || !name.trim()}>
          {saving ? 'Lagrer…' : isEditing ? 'Oppdater leirplass' : 'Lagre leirplass'}
        </button>
        <button onClick={onCancel} disabled={saving}>Avbryt</button>
      </div>
      {!isEditing && <p className="hint" style={{ marginTop: '0.6rem' }}>Din leirplass vil vises på kartet umiddelbart.</p>}
    </div>
  )
}
