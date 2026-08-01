import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Map, { Marker, Source, Layer, useMap, AttributionControl } from 'react-map-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { supabase } from '../supabaseClient'
import AddSpotForm from './AddSpotForm'

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

const ACCESS_LABELS = {
  'road': '🚗 Bilvei',
  'short-hike': '🥾 Kort tur',
  'day-hike': '⛰ Dagstur',
  'remote': '🏔 Avsidesliggende',
}

const SPOT_COLORS = { tent: '#1b4332', hammock: '#5c4a1e' }

const TENT_SVG = `<svg width="17" height="17" viewBox="0 0 24 19" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M10 0L14 3M14 0L10 3" stroke="#fff" stroke-width="1.5" stroke-linecap="round" />
  <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2.2L22.4 17.8H1.6L12 2.2ZM12 10.6L16.5 17.8H7.4L12 10.6Z" fill="#fff" />
  <rect x="0" y="17.8" width="24" height="1" fill="#fff" />
</svg>`

const HAMMOCK_SVG = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <line x1="4" y1="3" x2="4" y2="21" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>
  <line x1="20" y1="3" x2="20" y2="21" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M4 9 Q12 18 20 9" stroke="#fff" stroke-width="2" fill="#fff" fill-opacity="0.25" stroke-linecap="round"/>
  <line x1="4" y1="7.5" x2="8" y2="9.5" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="20" y1="7.5" x2="16" y2="9.5" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>
</svg>`

function SpotMarker({ spot, active, onClick }) {
  const bg = SPOT_COLORS[spot.spot_type] ?? SPOT_COLORS.tent
  const svg = spot.spot_type === 'hammock' ? HAMMOCK_SVG : TENT_SVG
  const size = active ? 36 : 28
  return (
    <Marker longitude={spot.longitude} latitude={spot.latitude} anchor="center" onClick={e => { e.originalEvent.stopPropagation(); onClick(spot) }}>
      <span
        className={`spot-badge${active ? ' spot-badge--active' : ''}`}
        style={{ background: bg, width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', cursor: 'pointer' }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </Marker>
  )
}

function SpotBadges({ spot }) {
  return (
    <div className="badge-row">
      <span className={`access-badge access-badge--type-${spot.spot_type || 'tent'}`}>
        {spot.spot_type === 'hammock' ? '🪢 Hengekøye' : '⛺ Telt'}
      </span>
      {spot.access && <span className={`access-badge access-badge--${spot.access}`}>{ACCESS_LABELS[spot.access]}</span>}
      {spot.region && <span className="access-badge access-badge--region">📍 {spot.region}</span>}
    </div>
  )
}

function Lightbox({ photos, startIndex, onClose }) {
  const [index, setIndex] = useState(startIndex)
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') setIndex((i) => (i + 1) % photos.length)
      if (e.key === 'ArrowLeft') setIndex((i) => (i - 1 + photos.length) % photos.length)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [photos.length, onClose])
  return createPortal(
    <div className="lightbox-overlay" onClick={onClose}>
      <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
        <button className="lightbox-close" onClick={onClose}>✕</button>
        <img src={photos[index]} alt="" className="lightbox-img" />
        {photos.length > 1 && (
          <>
            <button className="lightbox-arrow lightbox-arrow--prev" onClick={() => setIndex((i) => (i - 1 + photos.length) % photos.length)}>‹</button>
            <button className="lightbox-arrow lightbox-arrow--next" onClick={() => setIndex((i) => (i + 1) % photos.length)}>›</button>
            <div className="lightbox-dots">
              {photos.map((_, i) => <span key={i} className={`lightbox-dot${i === index ? ' lightbox-dot--active' : ''}`} onClick={() => setIndex(i)} />)}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  )
}

const FLAG_REASONS = [
  'Privat eiendom',
  'Feil plassering på kartet',
  'Stedet er stengt eller utilgjengelig',
  'Feil eller misvisende informasjon',
  'Annet',
]

function ReportModal({ spot, onSubmit, onClose }) {
  const [reason, setReason] = useState('')
  const [comment, setComment] = useState('')
  function handleSubmit(e) {
    e.preventDefault()
    if (!reason) return
    onSubmit(spot, reason, comment.trim())
  }
  return createPortal(
    <div className="about-overlay" onClick={onClose}>
      <div className="about-modal report-modal" onClick={(e) => e.stopPropagation()}>
        <button className="about-close" onClick={onClose}>✕</button>
        <h2 style={{ marginBottom: '1rem' }}>Rapporter innhold</h2>
        <form onSubmit={handleSubmit}>
          <p style={{ marginBottom: '0.75rem', fontSize: '0.9rem', color: '#555' }}>Hva er problemet med <strong>{spot.name}</strong>?</p>
          <div className="report-reasons">
            {FLAG_REASONS.map((r) => (
              <label key={r} className={`report-reason${reason === r ? ' report-reason--selected' : ''}`}>
                <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} />
                {r}
              </label>
            ))}
          </div>
          {reason === 'Annet' && (
            <textarea
              className="report-comment"
              placeholder="Beskriv problemet kort..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={300}
              rows={3}
            />
          )}
          <button type="submit" className="report-submit" disabled={!reason}>Send rapport</button>
        </form>
      </div>
    </div>,
    document.body
  )
}

function SpotDetail({ spot, onBack, onReport, alreadyReported }) {
  const photos = spot.photo_urls?.length ? spot.photo_urls : spot.photo_url ? [spot.photo_url] : []
  const [lightboxIndex, setLightboxIndex] = useState(null)
  const [showReportModal, setShowReportModal] = useState(false)
  const staticMap = `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/static/pin-s+d98e04(${spot.longitude},${spot.latitude})/${spot.longitude},${spot.latitude},13,0/600x240@2x?access_token=${TOKEN}`
  function handleReportSubmit(spot, reason, comment) {
    setShowReportModal(false)
    onReport(spot, reason, comment)
  }
  return (
    <div className="spot-detail">
      {lightboxIndex !== null && <Lightbox photos={photos} startIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} />}
      {showReportModal && <ReportModal spot={spot} onSubmit={handleReportSubmit} onClose={() => setShowReportModal(false)} />}
      <button className="go-back-btn" onClick={onBack}>← Gå tilbake</button>
      <h2 className="spot-detail-name">{spot.name}</h2>
      <SpotBadges spot={spot} />
      {photos.length === 1 ? (
        <img src={photos[0]} alt={spot.name} className="spot-detail-static-map" style={{ cursor: 'pointer' }} onClick={() => setLightboxIndex(0)} />
      ) : photos.length > 1 ? (
        <div className="detail-photo-strip">
          {photos.map((url, i) => <img key={i} src={url} alt={`${spot.name} ${i + 1}`} className="detail-photo" onClick={() => setLightboxIndex(i)} />)}
        </div>
      ) : (
        <img src={staticMap} alt="Kart" className="spot-detail-static-map" />
      )}
      {spot.description && <p className="spot-detail-desc">{spot.description}</p>}
      <p className="spot-detail-coords">
        {spot.latitude.toFixed(5)}, {spot.longitude.toFixed(5)}
        {' · '}
        <a href={`https://www.google.com/maps?q=${spot.latitude},${spot.longitude}`} target="_blank" rel="noopener noreferrer">Åpne i Google Maps</a>
      </p>
      <button
        className={`report-btn${alreadyReported ? ' report-btn--done' : ''}`}
        onClick={() => !alreadyReported && setShowReportModal(true)}
        disabled={alreadyReported}
      >
        {alreadyReported ? 'Rapportert' : 'Rapporter innhold'}
      </button>
    </div>
  )
}

function AboutModal({ onClose }) {
  const [contactStatus, setContactStatus] = useState('idle')
  async function handleContactSubmit(e) {
    e.preventDefault()
    setContactStatus('sending')
    const form = e.target
    try {
      const res = await fetch('https://formspree.io/f/mykrpyjj', { method: 'POST', headers: { 'Accept': 'application/json' }, body: new FormData(form) })
      if (res.ok) { setContactStatus('sent'); form.reset() } else setContactStatus('error')
    } catch { setContactStatus('error') }
  }
  return createPortal(
    <div className="about-overlay" onClick={onClose}>
      <div className="about-modal" onClick={(e) => e.stopPropagation()}>
        <button className="about-close" onClick={onClose}>✕</button>
        <h1 className="about-title">Om Vildakart</h1>
        <section className="about-section">
          <h2>Hvorfor Vildakart?</h2>
          <p>Vildakart er laget av friluftsfolk, for friluftsfolk. Del steder du har funnet på tur med andre som ferdes i norsk natur. Norge har noe av den vakreste naturen i verden, og allemannsretten gir oss alle rett til å ferdes og overnatte i den. Men gode leirplasser er spredt rundt i forum, Facebook-grupper og muntlige tips. Vildakart er laget for å samle dem på ett sted, slik at alle som elsker friluftsliv enkelt kan dele og oppdage nye steder.</p>
        </section>
        <section className="about-section">
          <h2>Slik fungerer kartet</h2>
          <p>Alle kan legge til en leirplass uten å opprette konto. Klikk på «Legg til leirplass», plasser en pin på kartet og fyll inn det du vet. Leirplassen knyttes til enheten du brukte, så du kan redigere eller slette den igjen fra samme telefon eller datamaskin.</p>
          <p>Når du plasserer en pin sjekker kartet automatisk om området er klassifisert som innmark i NIBIOs arealkart, som dyrket mark, bebyggelse eller åpen fastmark i tettbygd strøk. Steder i slike områder kan ikke legges til. Alle nye leirplasser gjennomgås av en administrator før de vises på kartet.</p>
        </section>
        <section className="about-section about-section--contact">
          <h2>Kontakt</h2>
          <p>Spørsmål, tilbakemeldinger eller forslag? Fyll ut skjemaet under.</p>
          {contactStatus === 'sent' ? (
            <p className="contact-success">Takk for meldingen, vi svarer så fort vi kan.</p>
          ) : (
            <form className="contact-form" onSubmit={handleContactSubmit}>
              <input type="text" name="name" placeholder="Navn" required />
              <input type="email" name="email" placeholder="E-post" required />
              <textarea name="message" rows={3} placeholder="Melding" required />
              {contactStatus === 'error' && <p className="contact-error">Noe gikk galt, prøv igjen.</p>}
              <button type="submit" className="primary" disabled={contactStatus === 'sending'}>{contactStatus === 'sending' ? 'Sender…' : 'Send melding'}</button>
            </form>
          )}
        </section>
      </div>
    </div>,
    document.body
  )
}

function RespektModal({ onClose }) {
  return createPortal(
    <div className="about-overlay" onClick={onClose}>
      <div className="about-modal" onClick={(e) => e.stopPropagation()}>
        <button className="about-close" onClick={onClose}>✕</button>
        <h1 className="about-title">Respekt for naturen</h1>
        <section className="about-section">
          <h2>Kjenn allemannsretten</h2>
          <p>Allemannsretten gir alle rett til å ferdes og overnatte i utmark, uansett hvem som eier landet. Utmark er udyrket mark og omfatter det meste av skog, fjell, myr, innsjøer og strender.</p>
          <p style={{ marginTop: '0.65rem' }}>Allemannsretten gjelder <strong>ikke</strong> på innmark: dyrket jord, beite i aktiv bruk, gårdsplasser, hus- og hyttetomter eller industriareal. Du kan likevel ferdes på frossen eller snødekt innmark.</p>
          <p style={{ marginTop: '0.65rem' }}>Du kan slå opp telt i utmark så lenge du holder minst <strong>150 meter fra nærmeste bebodde hus eller hytte</strong>. Du kan bli på samme sted i inntil to netter uten å spørre grunneier. På høyfjellet eller langt fra bebyggelse kan du bli lenger.</p>
        </section>
        <section className="about-section">
          <h2>Motorisert ferdsel</h2>
          <p>Allemannsretten gjelder til fots, på sykkel, til hest og med ikke-motorisert fartøy. <strong>Det er ikke tillatt å kjøre bil, motorsykkel, ATV eller bobil inn i utmark</strong> for å nå en leirplass. Kjøretøy skal stå på lovlig parkering ved vei.</p>
        </section>
        <section className="about-section">
          <h2>Legg ingen spor</h2>
          <p>Ta med deg alt søppel ut igjen. Grav ned menneskelig avfall minst 60 meter fra vann og stier. Telt på stein eller gress der det er mulig, ikke på sårbar vegetasjon. En god tommelfingerregel: neste person som kommer dit skal ikke se at du har vært der.</p>
          <p style={{ marginTop: '0.65rem' }}><strong>Bålforbudet gjelder fra 15. april til 15. september</strong> i og nær skog over hele landet. Bål er likevel tillatt der det er opplagt at det ikke kan starte brann, for eksempel på en godkjent bålplass eller når det ligger snø på bakken. Bruk alltid eksisterende ildsteder der det finnes, og aldri levende trær eller røtter som brensel.</p>
          <p style={{ marginTop: '0.65rem' }}>Mange av de vakreste plassene er vakre nettopp fordi de er ukjente. Gjentatte besøk kan ødelegge vegetasjon og gjøre stier til gjørmehull. Tenk deg om før du deler sårbare plasser videre.</p>
        </section>
        <section className="about-section">
          <h2>Vis hensyn til dyrelivet</h2>
          <p>I hekke- og yngletiden (april–juli) er mange fugler og pattedyr svært sårbare for forstyrrelser. Hold avstand til reirplasser og unger. <strong>Hunder skal holdes i bånd fra 1. april til 20. august.</strong> Respekter beitedyr og hold deg unna områder med sau eller storfe.</p>
        </section>
        <section className="about-section">
          <h2>Vis hensyn til andre og grunneier</h2>
          <p>Opptre hensynsfullt ovenfor folk du møter på tur. Unngå unødvendig støy. Lukk porter etter deg og unngå skade på gjerder og skogplantefelt. Unngå skade på steder med kulturhistorisk verdi, som arkeologiske kulturminner og fredede byggverk.</p>
          <p style={{ marginTop: '0.65rem' }}>Hus og hytter nær utmark har rett til en privat sone. Vurder avstand, vegetasjon og lydnivå, og vis alltid skjønn.</p>
        </section>
        <section className="about-section">
          <h2>Den uskrevne regelen</h2>
          <p>Allemannsretten er et privilegium vi deler, ikke en rettighet vi kan ta for gitt. Jo bedre vi tar vare på naturen og respekterer grunneierne, jo lenger kan vi beholde denne friheten. Bruk naturen, men behandle den som om den tilhører alle, fordi det gjør den.</p>
        </section>
        <section className="about-section">
          <h2>Ansvarsfraskrivelse</h2>
          <p>Vildakart er en plattform der brukere deler leirplasser basert på egne erfaringer. Vi kontrollerer ikke innholdet og kan ikke garantere at informasjonen er oppdatert eller nøyaktig.</p>
          <p style={{ marginTop: '0.65rem' }}>Du er selv ansvarlig for å følge allemannsretten og lokale ferdselsforbud, sjekke om området er vernet (naturreservat, nasjonalpark) og overholde eventuelle restriksjoner, respektere grunneiere og andre friluftsfolk, og etterlate naturen slik du fant den.</p>
          <p style={{ marginTop: '0.65rem' }}>Vildakart er ikke ansvarlig for skader, ulykker eller regelbrudd som oppstår som følge av besøk på steder delt på kartet.</p>
        </section>
        <section className="about-section respekt-sources">
          <h2>Kilder</h2>
          <ul>
            <li><a href="https://www.dnt.no/turtips/turvett/allemannsretten/" target="_blank" rel="noopener noreferrer">Allemannsretten, DNT</a></li>
            <li><a href="https://www.dnt.no/turtips/turvett/allemannsretten/allemannspliktene/" target="_blank" rel="noopener noreferrer">Allemannspliktene, DNT</a></li>
            <li><a href="https://www.miljodirektoratet.no/ansvarsomrader/friluftsliv/friluftsliv-og-allemannsretten/allemannsretten/" target="_blank" rel="noopener noreferrer">Allemannsretten, Miljødirektoratet</a></li>
            <li><a href="https://www.miljodirektoratet.no/ansvarsomrader/friluftsliv/friluftsliv-og-allemannsretten/telt-og-hengekoye/" target="_blank" rel="noopener noreferrer">Telt og hengekøye, Miljødirektoratet</a></li>
            <li><a href="https://lovdata.no/dokument/NL/lov/1957-06-28-16" target="_blank" rel="noopener noreferrer">Friluftsloven, Lovdata</a></li>
          </ul>
        </section>
      </div>
    </div>,
    document.body
  )
}

function AdminPanel({ isAdmin, adminKey, onLogin, onLogout, onClose, onViewSpot, onRefreshPending }) {
  const [password, setPassword] = useState('')
  const [spots, setSpots] = useState([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('all')
  const [stats, setStats] = useState(null)

  useEffect(() => {
    if (isAdmin) { fetchAll(); fetchStats() }
  }, [isAdmin])

  function handleLogin(e) {
    e.preventDefault()
    onLogin(password)
  }

  async function fetchAll() {
    setLoading(true)
    try {
      const { data } = await supabase.from('spots').select('*').order('created_at', { ascending: false })
      if (data) setSpots(data)
    } finally {
      setLoading(false)
    }
  }

  async function fetchStats() {
    const { data } = await supabase.from('page_views').select('visited_at')
    if (!data) return
    const now = new Date()
    const todayStr = now.toISOString().slice(0, 10)
    const weekAgo = new Date(now - 7 * 864e5)
    const today = data.filter(v => v.visited_at.slice(0, 10) === todayStr).length
    const week = data.filter(v => new Date(v.visited_at) >= weekAgo).length
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now - i * 864e5)
      const key = d.toISOString().slice(0, 10)
      const label = d.toLocaleDateString('no', { weekday: 'short', day: 'numeric' })
      const count = data.filter(v => v.visited_at.slice(0, 10) === key).length
      return { label, count }
    }).reverse()
    setStats({ total: data.length, today, week, days })
  }

  async function adminAction(action, id) {
    await fetch('/api/admin-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, id, admin_key: adminKey }),
    })
  }

  async function handleDelete(id) {
    if (!window.confirm('Slette denne leirplassen?')) return
    await adminAction('delete', id)
    setSpots((s) => s.filter((x) => x.id !== id))
    onRefreshPending?.()
  }

  async function handleClearFlags(id) {
    await adminAction('clear-flags', id)
    setSpots((s) => s.map((x) => x.id === id ? { ...x, flags: 0, flag_reports: [] } : x))
  }

  async function handleApprove(id) {
    await adminAction('approve', id)
    setSpots((s) => s.filter((x) => x.id !== id))
    onRefreshPending?.()
  }

  const flagged = spots.filter((s) => s.flags > 0)
  const pending = spots.filter((s) => s.status === 'pending')
  const displayed = filter === 'flagged' ? flagged : filter === 'pending' ? pending : spots

  return createPortal(
    <div className="admin-overlay">
      <div className={`admin-panel${!isAdmin ? ' admin-panel--login' : ''}`}>
        {!isAdmin ? (
          <>
            <button className="about-close" style={{ position: 'absolute', top: '1rem', right: '1rem' }} onClick={onClose}>✕</button>
            <div className="admin-login-inner">
              <h2>Admin</h2>
              <form onSubmit={handleLogin}>
                <input type="password" placeholder="Passord" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
                <button type="submit" className="primary">Logg inn</button>
              </form>
            </div>
          </>
        ) : (
          <>
        <div className="admin-header">
          <div>
            <h2>Admin</h2>
            <span className="admin-subtitle">{spots.length} leirplasser totalt</span>
          </div>
          <div className="admin-header-right">
            <div className="admin-tabs">
              <button className={`admin-tab${filter === 'all' ? ' admin-tab--active' : ''}`} onClick={() => setFilter('all')}>Alle</button>
              <button className={`admin-tab${filter === 'pending' ? ' admin-tab--active' : ''}`} onClick={() => setFilter('pending')}>
                Til godkjenning {pending.length > 0 && <span className="admin-flag-badge admin-flag-badge--pending">{pending.length}</span>}
              </button>
              <button className={`admin-tab${filter === 'flagged' ? ' admin-tab--active' : ''}`} onClick={() => setFilter('flagged')}>
                Flagget {flagged.length > 0 && <span className="admin-flag-badge">{flagged.length}</span>}
              </button>
            </div>
            <button className="about-close" style={{ position: 'static' }} onClick={onClose}>✕</button>
          </div>
        </div>
        {stats && (
          <div className="admin-stats">
            <div className="admin-stat-cards">
              <div className="admin-stat-card"><span className="admin-stat-value">{stats.total}</span><span className="admin-stat-label">Totalt</span></div>
              <div className="admin-stat-card"><span className="admin-stat-value">{stats.week}</span><span className="admin-stat-label">Siste 7 dager</span></div>
              <div className="admin-stat-card"><span className="admin-stat-value">{stats.today}</span><span className="admin-stat-label">I dag</span></div>
            </div>
            <div className="admin-chart">
              {(() => {
                const max = Math.max(...stats.days.map(d => d.count), 1)
                return stats.days.map((d, i) => (
                  <div key={i} className="admin-chart-col">
                    <span className="admin-chart-count">{d.count || ''}</span>
                    <div className="admin-chart-bar-wrap"><div className="admin-chart-bar" style={{ height: `${(d.count / max) * 100}%` }} /></div>
                    <span className="admin-chart-label">{d.label}</span>
                  </div>
                ))
              })()}
            </div>
          </div>
        )}
        {loading ? <p style={{ padding: '1rem' }}>Laster...</p> : (
          <div className="admin-list">
            {displayed.map((spot) => (
              <div key={spot.id} className={`admin-spot${spot.flags >= 3 ? ' admin-spot--flagged' : ''}`}>
                <div className="admin-spot-info">
                  <strong>{spot.name}</strong>
                  <span className="admin-spot-meta">
                    {spot.region && `${spot.region} · `}
                    {spot.created_at ? new Date(spot.created_at).toLocaleDateString('no') : ''}
                    {spot.flags > 0 && <span className="admin-flag-count"> · {spot.flags} flagg</span>}
                  </span>
                  {filter === 'flagged' && spot.flag_reports?.length > 0 && (
                    <div className="admin-flag-reports">
                      {spot.flag_reports.map((r, i) => (
                        <div key={i} className="admin-flag-report">
                          <span className="admin-flag-report-reason">{r.reason}</span>
                          {r.comment && <span className="admin-flag-report-comment">"{r.comment}"</span>}
                          <span className="admin-flag-report-date">{new Date(r.flagged_at).toLocaleDateString('no')}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="admin-spot-actions">
                  <button className="admin-btn admin-btn--goto" onClick={() => onViewSpot(spot)}>📍 Gå til</button>
                  {spot.status === 'pending' && <button className="admin-btn admin-btn--approve" onClick={() => handleApprove(spot.id)}>Godkjenn</button>}
                  {spot.flags > 0 && <button className="admin-btn" onClick={() => handleClearFlags(spot.id)}>Fjern flagg</button>}
                  <button className="admin-btn admin-btn--delete" onClick={() => handleDelete(spot.id)}>Slett</button>
                </div>
              </div>
            ))}
            {displayed.length === 0 && <p style={{ padding: '1rem', color: '#999' }}>Ingen leirplasser her.</p>}
          </div>
        )}
          </>
        )}
      </div>
    </div>,
    document.body
  )
}

function SidebarContent({
  editingCamp, activeSpot, activePendingSpot, activeAdminPendingSpot, ownerToken,
  filters, hasFilters, allRegions, filteredSpots, loading, spots, onBack, onEdit,
  onDelete, onSeeMore, onFilterChange, onToggleFilter, loadSpots, onReport,
  flaggedSpots, onAdminApprove, onAdminDelete,
}) {
  if (editingCamp) {
    return (
      <div className="spot-detail" style={{ padding: '0.75rem' }}>
        <AddSpotForm
          position={{ lat: editingCamp.latitude, lng: editingCamp.longitude }}
          camp={editingCamp}
          ownerToken={ownerToken}
          onCancel={() => onEdit(null)}
          onSaved={() => { onEdit(null); loadSpots() }}
        />
      </div>
    )
  }
  if (activePendingSpot) {
    return (
      <>
        <div className="pending-notice">
          <span className="pending-notice__icon">⏳</span>
          <div>
            <strong>Under godkjenning</strong>
            <p>Denne leirplassen er kun synlig for deg inntil den er godkjent av en administrator.</p>
          </div>
        </div>
        <SpotDetail spot={activePendingSpot} onBack={onBack} onReport={() => {}} alreadyReported={false} />
        <div className="owner-actions">
          <button className="owner-btn owner-btn--edit" onClick={() => onEdit(activePendingSpot)}>✏️ Rediger</button>
          <button className="owner-btn owner-btn--delete" onClick={() => onDelete(activePendingSpot)}>🗑 Slett</button>
        </div>
      </>
    )
  }
  if (activeAdminPendingSpot) {
    return (
      <>
        <div className="pending-notice" style={{ background: '#fff8e1', borderColor: '#f0c040' }}>
          <span className="pending-notice__icon">⏳</span>
          <div>
            <strong>Venter på godkjenning</strong>
            <p>Kun synlig for deg som admin og brukeren som la det inn.</p>
          </div>
        </div>
        <SpotDetail spot={activeAdminPendingSpot} onBack={onBack} onReport={() => {}} alreadyReported={false} />
        <div className="owner-actions">
          <button className="owner-btn owner-btn--approve" onClick={() => onAdminApprove(activeAdminPendingSpot)}>✓ Godkjenn</button>
          <button className="owner-btn owner-btn--delete" onClick={() => onAdminDelete(activeAdminPendingSpot)}>🗑 Slett</button>
        </div>
      </>
    )
  }
  if (activeSpot) {
    return (
      <>
        <SpotDetail spot={activeSpot} onBack={onBack} onReport={onReport} alreadyReported={flaggedSpots.includes(activeSpot.id)} />
        {activeSpot.owner_token === ownerToken && (
          <div className="owner-actions">
            <button className="owner-btn owner-btn--edit" onClick={() => onEdit(activeSpot)}>✏️ Rediger</button>
            <button className="owner-btn owner-btn--delete" onClick={() => onDelete(activeSpot)}>🗑 Slett</button>
          </div>
        )}
      </>
    )
  }
  return (
    <>
      <div className="filter-panel">
        <div className="filter-panel-header">
          <span className="filter-panel-title">Filtre</span>
          {hasFilters && <button className="filter-clear" onClick={() => onFilterChange({ types: [], access: [], regions: [] })}>Fjern alle</button>}
        </div>
        <div className="filter-group">
          <span className="filter-label">Type</span>
          <div className="filter-pills">
            {['tent', 'hammock'].map((t) => (
              <button key={t} className={`filter-pill${filters.types.includes(t) ? ' filter-pill--on' : ''}`} onClick={() => onToggleFilter('types', t)}>
                {t === 'tent' ? '⛺ Telt' : '🪢 Hengekøye'}
              </button>
            ))}
          </div>
        </div>
        <div className="filter-group">
          <span className="filter-label">Tilgang</span>
          <div className="filter-pills">
            {['road', 'short-hike', 'day-hike', 'remote'].map((a) => (
              <button key={a} className={`filter-pill${filters.access.includes(a) ? ' filter-pill--on' : ''}`} onClick={() => onToggleFilter('access', a)}>
                {ACCESS_LABELS[a]}
              </button>
            ))}
          </div>
        </div>
        <div className="filter-group">
          <span className="filter-label">Fylke</span>
          <select
            className="filter-region-select"
            value={filters.regions[0] || ''}
            onChange={(e) => onFilterChange((f) => ({ ...f, regions: e.target.value ? [e.target.value] : [] }))}
          >
            <option value="">Alle regioner</option>
            {allRegions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>
      <div className="sidebar-body">
        {!loading && filteredSpots.length === 0 && (
          <p className="empty-state">{spots.length === 0 ? 'Ingen leirplasser enda. Legg til den første!' : 'Ingen leirplasser matcher filtrene dine.'}</p>
        )}
        {filteredSpots.map((spot) => {
          const thumb = spot.photo_urls?.[0] || spot.photo_url ||
            `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/static/pin-s+d98e04(${spot.longitude},${spot.latitude})/${spot.longitude},${spot.latitude},12,0/400x200@2x?access_token=${TOKEN}`
          return (
            <div key={spot.id} className="spot-card" onClick={() => onSeeMore(spot)} style={{ cursor: 'pointer' }}>
              <img className="spot-card-thumb" src={thumb} alt="" loading="lazy" />
              <div className="spot-card-body">
                <h3>{spot.name}</h3>
                <SpotBadges spot={spot} />
                {spot.owner_token === ownerToken && (
                  <div className="spot-card-footer">
                    <button className="owner-btn owner-btn--edit" onClick={(e) => { e.stopPropagation(); onEdit(spot) }}>✏️</button>
                    <button className="owner-btn owner-btn--delete" onClick={(e) => { e.stopPropagation(); onDelete(spot) }}>🗑</button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

export default function CampingMap() {
  const mapRef = useRef(null)
  const nativeMap = useRef(null)
  const terrain3DRef = useRef(false)
  const [viewState, setViewState] = useState({ longitude: 9.5, latitude: 62.0, zoom: 5, pitch: 0, bearing: 0 })
  const [terrain3D, setTerrain3D] = useState(false)
  const [spots, setSpots] = useState([])
  const [ownPendingSpots, setOwnPendingSpots] = useState([])
  const [adminPendingSpots, setAdminPendingSpots] = useState([])
  const [pendingPosition, setPendingPosition] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeId, setActiveId] = useState(() => { const p = new URLSearchParams(window.location.search); return p.get('spot') || null })
  const [mapStyle, setMapStyle] = useState('mapbox://styles/mapbox/outdoors-v12')
  const [filters, setFilters] = useState({ types: [], access: [], regions: [] })
  const [dropMode, setDropMode] = useState(false)
  const [locationChecking, setLocationChecking] = useState(false)
  const [locationError, setLocationError] = useState('')
  const [coordInput, setCoordInput] = useState({ lat: '', lng: '' })
  const [coordError, setCoordError] = useState('')
  const [coordExpanded, setCoordExpanded] = useState(false)
  const [userPosition, setUserPosition] = useState(null)
  const [locating, setLocating] = useState(false)
  const [locateError, setLocateError] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 768)
  const [editingCamp, setEditingCamp] = useState(null)
  const [sheetState, setSheetState] = useState('peek')
  const [aboutOpen, setAboutOpen] = useState(false)
  const [savedToast, setSavedToast] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchFocused, setSearchFocused] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchHighlight, setSearchHighlight] = useState(-1)
  const [spotMatches, setSpotMatches] = useState([])
  const [searchMarker, setSearchMarker] = useState(null)
  const searchMarkerTimeout = useRef(null)
  const searchRef = useRef(null)
  const searchTimeout = useRef(null)
  const ADMIN_KEY = import.meta.env.VITE_ADMIN_KEY || 'vilda-admin'
  const [respektOpen, setRespektOpen] = useState(false)
  const [isAdmin, setIsAdmin] = useState(() => localStorage.getItem('vilda_admin') === 'true')
  const [adminPanelOpen, setAdminPanelOpen] = useState(() => new URLSearchParams(window.location.search).get('v') === 'hvk0209X' || localStorage.getItem('vilda_admin') === 'true')
  const [flaggedSpots] = useState(() => JSON.parse(localStorage.getItem('vilda_flagged') || '[]'))
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  const sheetRef = useRef(null)
  const dragStartY = useRef(null)
  const dragStartTranslateY = useRef(0)
  const isSatellite = mapStyle.includes('satellite')

  useEffect(() => {
    function onResize() { setIsMobile(window.innerWidth < 768) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const el = sheetRef.current
    if (!el) return
    el.style.transition = 'transform 0.32s cubic-bezier(0.32, 0.72, 0, 1)'
    el.style.transform = sheetState === 'open' ? 'translateY(0)' : 'translateY(calc(100% - 28px))'
  }, [sheetState])

  function onHandleTouchStart(e) {
    const el = sheetRef.current
    const matrix = new DOMMatrix(getComputedStyle(el).transform)
    dragStartTranslateY.current = matrix.m42
    dragStartY.current = e.touches[0].clientY
    el.style.transition = 'none'
  }

  function onHandleTouchMove(e) {
    if (dragStartY.current === null) return
    e.preventDefault()
    const delta = e.touches[0].clientY - dragStartY.current
    const newY = Math.max(0, dragStartTranslateY.current + delta)
    sheetRef.current.style.transform = `translateY(${newY}px)`
  }

  function onHandleTouchEnd(e) {
    if (dragStartY.current === null) return
    const delta = e.changedTouches[0].clientY - dragStartY.current
    const el = sheetRef.current
    el.style.transition = 'transform 0.32s cubic-bezier(0.32, 0.72, 0, 1)'
    if (delta < -40) { setSheetState('open'); el.style.transform = 'translateY(0)' }
    else if (delta > 40) { setSheetState('peek'); el.style.transform = 'translateY(calc(100% - 28px))' }
    else { el.style.transform = sheetState === 'open' ? 'translateY(0)' : 'translateY(calc(100% - 28px))' }
    dragStartY.current = null
  }

  const [ownerToken] = useState(() => {
    let token = localStorage.getItem('vilda_owner_token')
    if (!token) { token = crypto.randomUUID(); localStorage.setItem('vilda_owner_token', token) }
    return token
  })

  async function loadSpots() {
    setLoading(true)
    const [{ data, error }, { data: ownPending }] = await Promise.all([
      supabase.from('spots').select('*').eq('status', 'approved').lt('flags', 3),
      supabase.from('spots').select('*').eq('status', 'pending').eq('owner_token', ownerToken),
    ])
    if (!error && data) {
      setSpots(data)
      const params = new URLSearchParams(window.location.search)
      const spotId = params.get('spot')
      if (spotId) { const spot = data.find((s) => String(s.id) === spotId); if (spot) setActiveId(spot.id) }
    }
    if (ownPending) setOwnPendingSpots(ownPending)
    setLoading(false)
  }

  async function loadAdminPending() {
    const { data } = await supabase.from('spots').select('*').eq('status', 'pending')
    if (data) setAdminPendingSpots(data)
  }

  useEffect(() => { loadSpots() }, [])
  useEffect(() => { if (isAdmin) loadAdminPending(); else setAdminPendingSpots([]) }, [isAdmin])

  useEffect(() => {
    if (sessionStorage.getItem('vilda_tracked')) return
    sessionStorage.setItem('vilda_tracked', '1')
    supabase.from('page_views').insert({ screen_width: window.innerWidth, visited_at: new Date().toISOString() }).then(({ error }) => {
      if (error) console.error('page_views insert failed:', error)
      else console.log('page_views insert ok')
    })
  }, [])

  useEffect(() => {
    const url = new URL(window.location)
    if (activeId) url.searchParams.set('spot', activeId)
    else url.searchParams.delete('spot')
    window.history.replaceState({}, '', url)
  }, [activeId])

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') { setDropMode(false); setPendingPosition(null) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    function onClickOutside(e) {
      if (searchRef.current && !searchRef.current.contains(e.target)) { setSearchFocused(false); setSearchOpen(false) }
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('touchstart', onClickOutside)
    return () => { document.removeEventListener('mousedown', onClickOutside); document.removeEventListener('touchstart', onClickOutside) }
  }, [])

  const isPendingActive = typeof activeId === 'string' && activeId.startsWith('pending:')
  const isAdminPendingActive = typeof activeId === 'string' && activeId.startsWith('adminPending:')
  const activePendingSpot = isPendingActive ? ownPendingSpots.find(s => `pending:${s.id}` === activeId) || null : null
  const activeAdminPendingSpot = isAdminPendingActive ? adminPendingSpots.find(s => `adminPending:${s.id}` === activeId) || null : null
  const activeSpot = (isPendingActive || isAdminPendingActive) ? null : spots.find((s) => s.id === activeId) || null
  const isSatelliteStyle = mapStyle.includes('satellite')

  const allRegions = useMemo(() => {
    const set = new Set(spots.map((s) => s.region).filter(Boolean))
    return [...set].sort()
  }, [spots])

  const filteredSpots = useMemo(() => {
    return spots.filter((s) => {
      if (filters.types.length && !filters.types.includes(s.spot_type || 'tent')) return false
      if (filters.access.length && !filters.access.includes(s.access)) return false
      if (filters.regions.length && !filters.regions.includes(s.region)) return false
      return true
    })
  }, [spots, filters])

  function toggleFilter(key, value) {
    setFilters((f) => { const arr = f[key]; return { ...f, [key]: arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value] } })
  }

  const hasFilters = filters.types.length || filters.access.length || filters.regions.length

  function toggle3D() {
    const map = nativeMap.current
    if (!map) return
    const next = !terrain3D
    setTerrain3D(next)
    terrain3DRef.current = next
    if (next) {
      map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.2 })
      map.easeTo({ pitch: 60, duration: 600 })
    } else {
      map.setTerrain(null)
      map.setFog(null)
      map.easeTo({ pitch: 0, bearing: 0, duration: 600 })
    }
  }

  function flyTo(lng, lat, zoom = null, bottomPadding = 0) {
    const map = nativeMap.current
    if (!map) return
    map.flyTo({
      center: [lng, lat],
      zoom: zoom ?? Math.max(map.getZoom(), 11),
      duration: 800,
      essential: true,
      padding: { top: 0, bottom: bottomPadding, left: 0, right: 0 },
    })
  }

  function openSpot(spot, fly = false) {
    setActiveId(spot.id)
    if (fly) flyTo(spot.longitude, spot.latitude)
  }

  function handleMapMarkerClick(spot) {
    const mobile = window.innerWidth < 768
    setActiveId(spot.id)
    if (mobile) {
      setSheetState('open')
      // Wait one frame for the sheet to render at its open height, then measure
      requestAnimationFrame(() => {
        const sheetHeight = sheetRef.current?.offsetHeight ?? 0
        flyTo(spot.longitude, spot.latitude, null, sheetHeight)
      })
    }
  }

  function handleSeeMore(spot) { openSpot(spot, true) }

  function handleBack() {
    setActiveId(null)
    setEditingCamp(null)
    if (isMobile) setSheetState('peek')
  }

  async function handleReport(spot, reason, comment) {
    const updated = [...flaggedSpots, spot.id]
    localStorage.setItem('vilda_flagged', JSON.stringify(updated))
    const { data: current } = await supabase.from('spots').select('flags, flag_reports').eq('id', spot.id).single()
    const existingReports = current?.flag_reports || []
    const newReport = { reason, comment: comment || '', flagged_at: new Date().toISOString() }
    await supabase.from('spots').update({
      flags: (current?.flags || 0) + 1,
      flag_reports: [...existingReports, newReport],
    }).eq('id', spot.id)
    setActiveId(null)
    loadSpots()
  }

  async function handleDelete(camp) {
    if (!window.confirm(`Slette "${camp.name}"? Dette kan ikke angres.`)) return
    await fetch('/api/spot-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: camp.id, owner_token: ownerToken }),
    })
    setActiveId(null)
    loadSpots()
  }

  async function handleAdminApprove(spot) {
    await fetch('/api/admin-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve', id: spot.id, admin_key: ADMIN_KEY }),
    })
    setActiveId(null)
    loadAdminPending()
    loadSpots()
  }

  async function handleAdminDelete(spot) {
    if (!window.confirm(`Slette "${spot.name}"?`)) return
    await fetch('/api/admin-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id: spot.id, admin_key: ADMIN_KEY }),
    })
    setActiveId(null)
    loadAdminPending()
  }

  async function placePin(lat, lng) {
    setLocationChecking(true)
    setLocationError('')
    try {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?types=country&access_token=${TOKEN}`,
        { signal: AbortSignal.timeout(5000) }
      )
      const data = await res.json()
      const country = data.features?.[0]?.properties?.short_code
      if (country !== 'no') {
        setLocationError('Pins kan kun plasseres i Norge.')
        setTimeout(() => setLocationError(''), 5000)
        return
      }
    } catch {
      // Geocoding failed — fail open and allow the pin
    }
    setPendingPosition({ lat, lng })
    setDropMode(false)
    setLocationError('')
    setLocationChecking(false)
  }

  function handleMapClick(e) {
    if (!dropMode) return
    placePin(e.lngLat.lat, e.lngLat.lng).finally(() => setLocationChecking(false))
  }

  function handleCancel() { setPendingPosition(null); setDropMode(false); setCoordInput({ lat: '', lng: '' }); setCoordError(''); setCoordExpanded(false); setLocationError('') }

  function handleLocate() {
    if (!navigator.geolocation) { setLocateError('Nettleseren din støtter ikke posisjon.'); return }
    setLocating(true)
    setLocateError('')
    navigator.geolocation.getCurrentPosition(
      (pos) => { setUserPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setLocating(false); flyTo(pos.coords.longitude, pos.coords.latitude, 14) },
      (err) => { setLocating(false); setLocateError(err.code === err.PERMISSION_DENIED ? 'Posisjonstilgang nektet.' : 'Kunne ikke hente posisjonen din.') },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  function handleCoordSubmit(e) {
    e.preventDefault()
    const lat = parseFloat(coordInput.lat)
    const lng = parseFloat(coordInput.lng)
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) { setCoordError('Skriv inn gyldige koordinater (bredde −90→90, lengde −180→180)'); return }
    setCoordInput({ lat: '', lng: '' })
    setCoordError('')
    placePin(lat, lng).finally(() => setLocationChecking(false))
  }

  function placeIcon(types = []) {
    if (types.includes('poi')) return '📍'
    if (types.includes('address')) return '🏠'
    if (types.includes('place') || types.includes('locality')) return '🏙'
    if (types.includes('district') || types.includes('region')) return '🗺'
    if (types.includes('postcode')) return '📮'
    return '📌'
  }

  function handleSearch(q) {
    setSearchQuery(q)
    setSearchOpen(true)
    clearTimeout(searchTimeout.current)
    if (!q.trim()) { setSearchResults([]); setSpotMatches([]); setSearchLoading(false); return }
    const lower = q.toLowerCase()
    setSpotMatches(spots.filter(s => s.name.toLowerCase().includes(lower)).slice(0, 3))
    setSearchLoading(true)
    searchTimeout.current = setTimeout(async () => {
      const map = nativeMap.current
      const center = map ? map.getCenter() : { lng: 9.5, lat: 62 }
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?country=no&language=no&limit=5&proximity=${center.lng},${center.lat}&access_token=${TOKEN}`
      const res = await fetch(url)
      const data = await res.json()
      setSearchResults(data.features || [])
      setSearchHighlight(-1)
      setSearchLoading(false)
    }, 300)
  }

  function handleSpotMatchSelect(spot) {
    setSearchQuery(spot.name)
    setSpotMatches([])
    setSearchResults([])
    setSearchOpen(false)
    setSearchFocused(false)
    const mobile = window.innerWidth < 768
    openSpot(spot, true)
    if (mobile) setSheetState('open')
  }

  function handleSearchSelect(feature) {
    const [lng, lat] = feature.center
    flyTo(lng, lat)
    setSearchQuery(feature.text)
    setSearchResults([])
    setSearchOpen(false)
    clearTimeout(searchMarkerTimeout.current)
    setSearchMarker({ lat, lng })
    searchMarkerTimeout.current = setTimeout(() => setSearchMarker(null), 4000)
  }

  const cursor = dropMode ? 'crosshair' : 'grab'

  return (
    <div className="app-root">
      <header className="topnav">
        <div className={`topnav-left${searchFocused ? ' topnav-left--expanded' : ''}`} ref={searchRef}>
          <div className="search-box">
            <input
              className="search-input"
              type="text"
              placeholder="Søk etter sted…"
              value={searchQuery}
              onChange={e => handleSearch(e.target.value)}
              onFocus={() => { setSearchFocused(true); searchResults.length > 0 && setSearchOpen(true) }}
              onKeyDown={e => {
                if (!searchOpen || searchResults.length === 0) return
                if (e.key === 'ArrowDown') { e.preventDefault(); setSearchHighlight(h => Math.min(h + 1, searchResults.length - 1)) }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setSearchHighlight(h => Math.max(h - 1, 0)) }
                else if (e.key === 'Enter' && searchHighlight >= 0) { e.preventDefault(); handleSearchSelect(searchResults[searchHighlight]) }
              }}
            />
            {searchLoading && <span className="search-spinner" />}
            {searchQuery && !searchLoading && (
              <button className="search-clear" onClick={() => { setSearchQuery(''); setSearchResults([]); setSpotMatches([]); setSearchOpen(false); setSearchLoading(false) }}>✕</button>
            )}
            {searchOpen && searchQuery && !searchLoading && spotMatches.length === 0 && searchResults.length === 0 && (
              <ul className="search-results"><li className="search-no-results">Ingen steder funnet</li></ul>
            )}
            {searchOpen && (spotMatches.length > 0 || searchResults.length > 0) && (
              <ul className="search-results">
                {spotMatches.map(s => (
                  <li key={`spot-${s.id}`} onClick={() => handleSpotMatchSelect(s)}>
                    <span className="search-result-icon">⛺</span>
                    <span className="search-result-name">{s.name}</span>
                  </li>
                ))}
                {spotMatches.length > 0 && searchResults.length > 0 && <li className="search-divider" aria-hidden="true" />}
                {searchResults.map((f, i) => (
                  <li key={f.id} className={i === searchHighlight ? 'search-result--active' : ''} onClick={() => handleSearchSelect(f)}>
                    <span className="search-result-icon">{placeIcon(f.place_type)}</span>
                    <span>
                      <span className="search-result-name">{f.text}</span>
                      {f.context?.length > 0 && <span className="search-result-sub">{f.context.slice(0, 2).map(c => c.text).join(', ')}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {searchFocused && (
            <button className="search-cancel-btn" onClick={() => { setSearchFocused(false); setSearchQuery(''); setSearchResults([]); setSpotMatches([]); setSearchOpen(false) }}>Avbryt</button>
          )}
        </div>

        <svg className="topnav-logo" width="126" height="34" viewBox="0 0 210 56" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Vilda">
          <circle cx="34" cy="10" r="9" fill="#d98e04" />
          <polygon points="22,2  42,26   2,26" fill="#f4f1ea" />
          <polygon points="22,14 46,40  -2,40" fill="#f4f1ea" />
          <polygon points="22,26 48,54  -4,54" fill="#f4f1ea" />
          <text x="58" y="46" fontFamily="Georgia, 'Times New Roman', serif" fontSize="46" fontWeight="700" fill="#f4f1ea" letterSpacing="-1.5">Vilda</text>
        </svg>

        <div className="topnav-right">
          <button className="about-btn" onClick={() => setAboutOpen(true)}>Om</button>
          <button className="respekt-btn" onClick={() => setRespektOpen(true)}>
            <span className="respekt-btn__full">Respekt for naturen</span>
            <span className="respekt-btn__short">Respekt</span>
          </button>
          {isAdmin && (
            <div className="admin-nav-indicator">
              <button className="admin-nav-btn" onClick={() => setAdminPanelOpen(true)}>⚙ Admin</button>
              <button className="admin-nav-logout" onClick={() => { setIsAdmin(false); localStorage.removeItem('vilda_admin'); setAdminPendingSpots([]) }}>Logg ut</button>
            </div>
          )}
        </div>

        <button className={`hamburger-btn${searchFocused ? ' hamburger-btn--hidden' : ''}`} onClick={() => setMenuOpen(o => !o)} aria-label="Meny">
          <span /><span /><span />
        </button>
        {menuOpen && (
          <div className="hamburger-menu" onClick={() => setMenuOpen(false)}>
            <button onClick={() => setAboutOpen(true)}>Om</button>
            <button onClick={() => setRespektOpen(true)}>Respekt for naturen</button>
          </div>
        )}
      </header>

      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
      {respektOpen && <RespektModal onClose={() => setRespektOpen(false)} />}
      {adminPanelOpen && (
        <AdminPanel
          isAdmin={isAdmin}
          adminKey={ADMIN_KEY}
          onLogin={(pw) => {
            if (pw === ADMIN_KEY) {
              setIsAdmin(true)
              localStorage.setItem('vilda_admin', 'true')
            } else {
              alert('Feil passord')
            }
          }}
          onLogout={() => { setIsAdmin(false); localStorage.removeItem('vilda_admin'); setAdminPendingSpots([]) }}
          onClose={() => setAdminPanelOpen(false)}
          onViewSpot={(spot) => {
            const prefix = spot.status === 'pending' ? 'adminPending' : 'spot'
            setActiveId(spot.status === 'pending' ? `adminPending:${spot.id}` : spot.id)
            flyTo(spot.longitude, spot.latitude, 13)
          }}
          onRefreshPending={loadAdminPending}
        />
      )}

      <div className="main-area">
        {!isMobile && (
          <button
            className={`sidebar-collapse-btn${sidebarOpen ? '' : ' sidebar-collapse-btn--collapsed'}`}
            style={{ left: sidebarOpen ? 300 : 0 }}
            onClick={() => { setSidebarOpen((o) => !o); setTimeout(() => nativeMap.current?.resize(), 210) }}
            aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            {sidebarOpen
              ? <svg width="10" height="16" viewBox="0 0 10 16" fill="none"><polyline points="8,2 2,8 8,14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              : <svg width="10" height="16" viewBox="0 0 10 16" fill="none"><polyline points="2,2 8,8 2,14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            }
          </button>
        )}

        {!isMobile && (
          <aside className={`left-sidebar${sidebarOpen ? '' : ' left-sidebar--collapsed'}`}>
            <div className="sidebar-inner">
              <SidebarContent
                editingCamp={editingCamp} activeSpot={activeSpot} activePendingSpot={activePendingSpot}
                activeAdminPendingSpot={activeAdminPendingSpot} ownerToken={ownerToken}
                filters={filters} hasFilters={hasFilters} allRegions={allRegions}
                filteredSpots={filteredSpots} loading={loading} spots={spots}
                onBack={handleBack} onEdit={setEditingCamp} onDelete={handleDelete}
                onSeeMore={handleSeeMore} onFilterChange={setFilters} onToggleFilter={toggleFilter}
                loadSpots={loadSpots} onReport={handleReport} flaggedSpots={flaggedSpots}
                onAdminApprove={handleAdminApprove} onAdminDelete={handleAdminDelete}
              />
            </div>
          </aside>
        )}

        <div className="map-root">
          <Map
            ref={mapRef}
            {...viewState}
            onMove={e => setViewState(e.viewState)}
            mapStyle={mapStyle}
            mapboxAccessToken={TOKEN}
            projection={terrain3D ? 'globe' : 'mercator'}
            maxPitch={terrain3D ? 85 : 0}
            attributionControl={false}
            style={{ width: '100%', height: '100%' }}
            cursor={cursor}
            onClick={handleMapClick}
            onLoad={e => {
              const map = e.target
              nativeMap.current = map

              function initTerrainLayers() {
                if (!map.getSource('mapbox-dem')) {
                  map.addSource('mapbox-dem', {
                    type: 'raster-dem',
                    url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
                    tileSize: 256,
                    maxzoom: 14,
                  })
                }
                // Re-apply terrain if 3D was active before the style swap
                if (terrain3DRef.current) {
                  map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.2 })
                }
              }

              initTerrainLayers()
              map.on('style.load', initTerrainLayers)

              function onVisibilityChange() {
                if (document.visibilityState === 'visible') map.resize()
              }
              document.addEventListener('visibilitychange', onVisibilityChange)
              map.once('remove', () => document.removeEventListener('visibilitychange', onVisibilityChange))
            }}
          >
            <AttributionControl compact={false} position="bottom-right" />

            {filteredSpots.map((spot) => (
              <SpotMarker key={spot.id} spot={spot} active={spot.id === activeId} onClick={handleMapMarkerClick} />
            ))}

            {ownPendingSpots.map((spot) => (
              <Marker key={`own-pending-${spot.id}`} longitude={spot.longitude} latitude={spot.latitude} anchor="center" onClick={e => { e.originalEvent.stopPropagation(); setActiveId(`pending:${spot.id}`) }}>
                <span className={`spot-badge spot-badge--pending${activeId === `pending:${spot.id}` ? ' spot-badge--active' : ''}`} style={{ width: activeId === `pending:${spot.id}` ? 36 : 28, height: activeId === `pending:${spot.id}` ? 36 : 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', background: '#9a9a9a', border: '2px dashed #777', cursor: 'pointer', opacity: 0.9 }} dangerouslySetInnerHTML={{ __html: TENT_SVG }} />
              </Marker>
            ))}

            {adminPendingSpots.map((spot) => (
              <Marker key={`adminPending-${spot.id}`} longitude={spot.longitude} latitude={spot.latitude} anchor="center" onClick={e => { e.originalEvent.stopPropagation(); setActiveId(`adminPending:${spot.id}`) }}>
                <span style={{ width: activeId === `adminPending:${spot.id}` ? 36 : 28, height: activeId === `adminPending:${spot.id}` ? 36 : 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', background: '#9a9a9a', border: '2px dashed #666', opacity: 0.85, cursor: 'pointer', transition: 'width 0.15s, height 0.15s' }} dangerouslySetInnerHTML={{ __html: TENT_SVG }} />
              </Marker>
            ))}

            {pendingPosition && (
              <Marker longitude={pendingPosition.lng} latitude={pendingPosition.lat} anchor="center">
                <span className="spot-badge" style={{ background: '#d98e04', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%' }} dangerouslySetInnerHTML={{ __html: TENT_SVG }} />
              </Marker>
            )}

            {userPosition && (
              <Marker longitude={userPosition.lng} latitude={userPosition.lat} anchor="center">
                <span className="user-location-dot"><span className="user-location-dot-pulse" /><span className="user-location-dot-core" /></span>
              </Marker>
            )}

            {searchMarker && (
              <Marker longitude={searchMarker.lng} latitude={searchMarker.lat} anchor="center">
                <div className="search-marker-pin" />
              </Marker>
            )}
          </Map>

          <div className="controls">
            <button className={`layer-toggle${terrain3D ? ' layer-toggle--active' : ''}`} onClick={toggle3D}>
              {terrain3D ? '🏔 3D på' : '🏔 3D'}
            </button>
            <button className="layer-toggle" onClick={() => setMapStyle(isSatelliteStyle ? 'mapbox://styles/mapbox/outdoors-v12' : 'mapbox://styles/mapbox/satellite-streets-v12')}>
              {isSatelliteStyle ? '🗺 Outdoors' : '🛰 Satellite'}
            </button>
            <button
              className={`submit-btn${dropMode ? ' submit-btn--active' : ''}`}
              onClick={() => { setDropMode((d) => !d); setPendingPosition(null); setCoordExpanded(false) }}
            >
              {dropMode ? '✕ Avbryt' : '＋ Legg til leirplass'}
            </button>
          </div>

          {terrain3D && (
            <div className="hint-3d">
              <span className="hint-3d-desktop">🖱 Høyreklikk + dra for å vippe og rotere</span>
              <span className="hint-3d-mobile">👆 To fingre for å vippe og rotere</span>
            </div>
          )}

          {!dropMode && !pendingPosition && (
            <div className="locate-wrap">
              {locateError && <p className="locate-error">{locateError}</p>}
              <button className="locate-btn" onClick={handleLocate} disabled={locating} aria-label="Show my location">
                {locating ? '…' : '⌖'}
              </button>
            </div>
          )}

          {locationChecking && (
            <div className="drop-panel">
              <p className="drop-panel-hint">Sjekker plassering…</p>
            </div>
          )}

          {locationError && !locationChecking && (
            <div className="drop-panel">
              <p className="drop-panel-hint" style={{ color: '#a32d2d' }}>⚠ {locationError}</p>
              <p className="drop-panel-hint" style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>Klikk et annet sted i Norge.</p>
            </div>
          )}

          {dropMode && !pendingPosition && !locationChecking && !locationError && (
            <div className="drop-panel">
              <p className="drop-panel-hint">Klikk på kartet for å plassere leirplassen</p>
              <button type="button" className="coord-toggle" onClick={() => setCoordExpanded((e) => !e)}>
                <span>eller skriv inn koordinater</span>
                <span className={`coord-toggle-chevron${coordExpanded ? ' coord-toggle-chevron--open' : ''}`}>⌄</span>
              </button>
              {coordExpanded && (
                <form className="coord-form" onSubmit={handleCoordSubmit}>
                  <input type="text" placeholder="Breddegrad (f.eks. 61.234)" value={coordInput.lat} onChange={(e) => { setCoordInput((c) => ({ ...c, lat: e.target.value })); setCoordError('') }} />
                  <input type="text" placeholder="Lengdegrad (f.eks. 8.567)" value={coordInput.lng} onChange={(e) => { setCoordInput((c) => ({ ...c, lng: e.target.value })); setCoordError('') }} />
                  {coordError && <p className="coord-error">{coordError}</p>}
                  <button type="submit" className="primary">Plasser pin</button>
                </form>
              )}
            </div>
          )}

          {pendingPosition && (
            <div className="floating-form">
              <p className="hint">Pin ved {pendingPosition.lat.toFixed(3)}, {pendingPosition.lng.toFixed(3)}</p>
              <AddSpotForm
                position={pendingPosition}
                ownerToken={ownerToken}
                onCancel={handleCancel}
                onSaved={() => { setPendingPosition(null); loadSpots(); setSavedToast(true); setTimeout(() => setSavedToast(false), 5000) }}
              />
            </div>
          )}
        </div>

        {savedToast && <div className="saved-toast">✓ Leirplassen er sendt til godkjenning.</div>}

        {isMobile && (
          <div className="bottom-sheet" ref={sheetRef}>
            <div
              className="bottom-sheet-handle"
              onClick={() => setSheetState((s) => s === 'peek' ? 'open' : 'peek')}
              onTouchStart={onHandleTouchStart}
              onTouchMove={onHandleTouchMove}
              onTouchEnd={onHandleTouchEnd}
            />
            <div className="bottom-sheet-body">
              <SidebarContent
                editingCamp={editingCamp} activeSpot={activeSpot} activePendingSpot={activePendingSpot}
                activeAdminPendingSpot={activeAdminPendingSpot} ownerToken={ownerToken}
                filters={filters} hasFilters={hasFilters} allRegions={allRegions}
                filteredSpots={filteredSpots} loading={loading} spots={spots}
                onBack={handleBack} onEdit={setEditingCamp} onDelete={handleDelete}
                onSeeMore={(spot) => { handleSeeMore(spot); setSheetState('open') }}
                onFilterChange={setFilters} onToggleFilter={toggleFilter}
                loadSpots={loadSpots} onReport={handleReport} flaggedSpots={flaggedSpots}
                onAdminApprove={handleAdminApprove} onAdminDelete={handleAdminDelete}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
