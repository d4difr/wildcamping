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

// Only these NIBIO arealtype values are legal utmark under allemannsretten
const UTMARK_LABELS = ['skog', 'åpen fastmark', 'myr', 'snø og is', 'ferskvann', 'hav']

async function checkNibioLandType(lat, lng) {
  const delta = 0.0005
  const minLat = lat - delta, maxLat = lat + delta
  const minLng = lng - delta, maxLng = lng + delta

  const url =
    `https://wms.nibio.no/cgi-bin/ar5?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo` +
    `&LAYERS=Arealtype&QUERY_LAYERS=Arealtype` +
    `&CRS=EPSG:4326&BBOX=${minLat},${minLng},${maxLat},${maxLng}` +
    `&WIDTH=100&HEIGHT=100&I=50&J=50` +
    `&INFO_FORMAT=text/html`

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    const html = await res.text()
    const match = html.match(/Arealtype<\/td>\s*<TD[^>]*>([^<]+)<\/td>/i)
    if (!match) return null // no data for this location — fail open
    const label = match[1].trim()
    const isUtmark = UTMARK_LABELS.some(l => label.toLowerCase().includes(l))
    return isUtmark ? null : label // null = allowed, label = blocked (shown in warning)
  } catch {
    return null // API unreachable — fail open
  }
}

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
  const [utmarkConfirmed, setUtmarkConfirmed] = useState(false)
  const [nibioWarning, setNibioWarning] = useState(null) // innmark land type string if detected
  const [nibioChecking, setNibioChecking] = useState(false)

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
      // NIBIO innmark check — hard block if innmark detected, no override possible
      if (nibioWarning) {
        setError('Denne plassen er registrert som innmark og kan ikke legges til.')
        return
      }
      if (!nibioChecking) {
        setNibioChecking(true)
        const innmarkType = await checkNibioLandType(lat, lng)
        setNibioChecking(false)
        if (innmarkType) {
          setNibioWarning(innmarkType)
          return // stop — hard block, shown in warning box
        }
      }
      if (!utmarkConfirmed) {
        setError('Du må bekrefte at plassen er i utmark (allemannsretten).')
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

      <label htmlFor="spot-name">Leirplassnavn <span className="required">*</span></label>
      <input id="spot-name" type="text" placeholder="f.eks. Preikestolen-ryggen" value={name} onChange={(e) => setName(e.target.value)} />

      <label htmlFor="spot-desc">Hvorfor er det verdt å besøke?</label>
      <textarea id="spot-desc" rows={2} placeholder="Flate teltplasser, vid utsikt, nær ferskvann…" value={description} onChange={(e) => setDescription(e.target.value)} />

      <label htmlFor="spot-access">Tilgang <span className="required">*</span></label>
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

      {!isEditing && nibioWarning && (
        <div className="innmark-warning">
          <span className="innmark-warning__icon">⚠️</span>
          <div>
            <strong>Ikke tillatt område — kan ikke legges til</strong>
            <p>NIBIO sitt kart viser at dette området er klassifisert som <em>{nibioWarning}</em>. Allemannsretten gjelder kun i utmark (skog, fjell, myr). Flytt pinnen til et naturområde for å fortsette.</p>
            <a href={`https://gardskart.nibio.no/?lat=${position.lat}&lon=${position.lng}&zoom=15`} target="_blank" rel="noopener noreferrer">
              Sjekk på gardskart.nibio.no →
            </a>
          </div>
        </div>
      )}

      {!isEditing && !nibioWarning && (
        <label className="utmark-confirm">
          <input
            type="checkbox"
            checked={utmarkConfirmed}
            onChange={(e) => { setUtmarkConfirmed(e.target.checked); setError('') }}
          />
          <span>Jeg bekrefter at denne plassen er i <strong><a href="https://no.wikipedia.org/wiki/Allemannsretten" target="_blank" rel="noopener noreferrer" className="utmark-link">utmark</a></strong> og lovlig å campe på under allemannsretten</span>
        </label>
      )}

      {error && <p style={{ color: '#a32d2d', fontSize: '0.85rem' }}>{error}</p>}
      <div className="actions">
        <button className="primary" onClick={handleSave} disabled={saving || !name.trim() || nibioChecking}>
          {nibioChecking ? 'Sjekker område…' : saving ? 'Lagrer…' : isEditing ? 'Oppdater leirplass' : 'Lagre leirplass'}
        </button>
        <button onClick={onCancel} disabled={saving}>Avbryt</button>
      </div>
      {!isEditing && <p className="hint" style={{ marginTop: '0.6rem' }}>Din leirplass vil vises på kartet umiddelbart.</p>}
    </div>
  )
}
