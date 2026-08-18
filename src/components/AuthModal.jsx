import { useState } from 'react'
import { supabase } from '../supabaseClient'
import { sendMagicLink } from '../useAuth'

// Sign in: one email field, no password.
export function SignInModal({ onClose }) {
  const [email, setEmail] = useState('')
  const [state, setState] = useState('idle') // idle | sending | sent | error
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setState('sending')
    setError('')
    const err = await sendMagicLink(email.trim())
    if (err) {
      setError(err.message || 'Kunne ikke sende lenken. Prøv igjen.')
      setState('error')
    } else {
      setState('sent')
    }
  }

  return (
    <div className="about-overlay" onClick={onClose}>
      <div className="about-modal auth-modal" onClick={(e) => e.stopPropagation()}>
        <button className="about-close" onClick={onClose}>✕</button>

        {state === 'sent' ? (
          <>
            <h1 className="about-title">Sjekk e-posten din</h1>
            <p>Vi har sendt en innloggingslenke til <strong>{email}</strong>.</p>
            <p className="auth-hint">
              Lenken åpner Vilda og logger deg inn. Den varer i én time og kan bare brukes én gang.
              Finner du den ikke, se i søppelpost.
            </p>
          </>
        ) : (
          <>
            <h1 className="about-title">Logg inn</h1>
            <p>
              Skriv inn e-postadressen din, så sender vi deg en lenke. Ingen passord å huske.
            </p>
            <form onSubmit={handleSubmit} className="auth-form">
              <label htmlFor="auth-email">E-post</label>
              <input
                id="auth-email"
                type="email"
                required
                autoFocus
                placeholder="deg@eksempel.no"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <button type="submit" className="primary" disabled={state === 'sending'}>
                {state === 'sending' ? 'Sender…' : 'Send lenke'}
              </button>
              {error && <p className="coord-error">{error}</p>}
            </form>
            <p className="auth-hint">
              Du trenger ikke konto for å bruke kartet eller legge til leirplasser.
              Konto lar deg samle favoritter og se dine egne pinner på tvers av enheter.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

// Offered once after signing in on a device that already has spots against its
// token. "Ikke nå" must stay safe forever — the token keeps working whether or
// not the spots are ever claimed, so declining costs nothing.
export function ClaimModal({ count, onClaim, onSkip }) {
  const [claiming, setClaiming] = useState(false)
  const [error, setError] = useState('')

  async function handleClaim() {
    setClaiming(true)
    setError('')
    const err = await onClaim()
    setClaiming(false)
    if (err) setError('Kunne ikke knytte leirplassene. Prøv igjen senere.')
  }

  return (
    <div className="about-overlay">
      <div className="about-modal auth-modal">
        <h1 className="about-title">
          {count === 1 ? 'Vi fant én leirplass på denne enheten' : `Vi fant ${count} leirplasser på denne enheten`}
        </h1>
        <p>
          Vil du knytte {count === 1 ? 'den' : 'dem'} til kontoen din? Da finner du{' '}
          {count === 1 ? 'den' : 'dem'} igjen på alle enhetene dine.
        </p>
        <div className="auth-form">
          <button className="primary" onClick={handleClaim} disabled={claiming}>
            {claiming ? 'Knytter…' : 'Ja, knytt til kontoen'}
          </button>
          {error && <p className="coord-error">{error}</p>}
        </div>
        <button className="auth-skip" onClick={onSkip}>Ikke nå</button>
        <p className="auth-hint">
          Leirplassene dine fungerer som før uansett hva du velger.
        </p>
      </div>
    </div>
  )
}

// Naming a private planning pin. Deliberately plain — no photos, no access type,
// no region. This is a note to yourself, not a submission, and the form should
// not imply otherwise.
export function PlanningPinModal({ position, onSave, onCancel }) {
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const { error: err } = await onSave({ name, note })
    setSaving(false)
    if (err) setError('Kunne ikke lagre. Prøv igjen.')
  }

  return (
    <div className="about-overlay" onClick={onCancel}>
      <div className="about-modal auth-modal" onClick={(e) => e.stopPropagation()}>
        <button className="about-close" onClick={onCancel}>✕</button>
        <h1 className="about-title">Ny planleggingspin</h1>
        <p className="auth-hint" style={{ margin: '0 0 0.25rem' }}>
          {position.lat.toFixed(4)}, {position.lng.toFixed(4)}
        </p>
        <form onSubmit={handleSubmit} className="auth-form">
          <label htmlFor="plan-name">Navn</label>
          <input
            id="plan-name"
            type="text"
            autoFocus
            required
            maxLength={80}
            placeholder="f.eks. Mulig teltplass ved vannet"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <label htmlFor="plan-note">Notat (valgfritt)</label>
          <textarea
            id="plan-note"
            rows={3}
            maxLength={500}
            placeholder="Sjekk om det er flatt nok…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button type="submit" className="primary" disabled={saving || !name.trim()}>
            {saving ? 'Lagrer…' : 'Lagre pin'}
          </button>
          {error && <p className="coord-error">{error}</p>}
        </form>
        <p className="auth-hint">
          Kun du kan se denne. Den vises ikke på kartet for andre og sendes ikke til godkjenning.
        </p>
      </div>
    </div>
  )
}

// Choosing a display name.
//
// NOT shown automatically. It used to appear after sign-in and again on every
// reload, because skipping was only remembered in component state — and it was
// asking for something with no current use, since attribution is deferred and no
// name is displayed anywhere yet. Now it opens only when someone clicks their
// name in the nav.
//
// The copy matters here. Saying "your name will be shown on the spots you add"
// is both untrue today and alarming: it reads as all-or-nothing, when the plan
// is a per-pin choice.
export function UsernameModal({ userId, currentName, onDone, onClose }) {
  const [username, setUsername] = useState(currentName ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')

    // upsert so this doubles as "change my name" — the modal is reachable at
    // any time now, not just once after signing up.
    const { error: err } = await supabase
      .from('profiles')
      .upsert({ user_id: userId, username: username.trim() }, { onConflict: 'user_id' })

    setSaving(false)
    if (!err) return onDone()

    // 23505 unique_violation, 23514 check_violation, 42501 RLS refusal — the
    // last one is how a reserved name comes back, since the policy rejects it.
    if (err.code === '23505') setError('Det navnet er opptatt.')
    else if (err.code === '23514') setError('Bruk 3–24 tegn: bokstaver, tall, bindestrek eller understrek.')
    else if (err.code === '42501') setError('Det navnet er reservert.')
    else setError('Kunne ikke lagre navnet. Prøv igjen.')
  }

  // Anonymity is the absence of a profile row, so going back to it is a delete
  // rather than a flag. Confirmed first because it frees the name for others.
  async function handleGoAnonymous() {
    if (!window.confirm('Fjerne visningsnavnet? Navnet blir ledig for andre, så du får det kanskje ikke tilbake.')) return
    setSaving(true)
    setError('')
    const { error: err } = await supabase.from('profiles').delete().eq('user_id', userId)
    setSaving(false)
    if (err) { setError('Kunne ikke fjerne navnet. Prøv igjen.'); return }
    onDone()
  }

  return (
    <div className="about-overlay" onClick={onClose}>
      <div className="about-modal auth-modal" onClick={(e) => e.stopPropagation()}>
        <button className="about-close" onClick={onClose}>✕</button>
        <h1 className="about-title">{currentName ? 'Endre visningsnavn' : 'Velg et visningsnavn'}</h1>
        {/* This is a privacy claim, so it has to be true in the database, not
            just in the paragraph. profiles used to be publicly readable —
            anyone with the anon key could list every username — which is why
            phase1d-profiles-private.sql restricts select to the owner. */}
        <p>Navnet ditt er kun synlig for deg.</p>
        <form onSubmit={handleSubmit} className="auth-form">
          <label htmlFor="auth-username">Visningsnavn</label>
          <input
            id="auth-username"
            type="text"
            autoFocus
            minLength={3}
            maxLength={24}
            placeholder="f.eks. Turgåer_Agder"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <button type="submit" className="primary" disabled={saving || username.trim().length < 3}>
            {saving ? 'Lagrer…' : 'Lagre navn'}
          </button>
          {error && <p className="coord-error">{error}</p>}
        </form>
        {currentName ? (
          <button className="auth-skip" onClick={handleGoAnonymous} disabled={saving}>
            Bli anonym igjen — fjern navnet
          </button>
        ) : (
          <p className="auth-hint">
            Uten navn er du anonym. Det er helt greit — du kan legge til et navn når som helst.
          </p>
        )}
      </div>
    </div>
  )
}
