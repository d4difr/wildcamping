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

// Choosing a display name. Skippable on purpose: no username means posts show as
// anonymous, which is a first-class option rather than a fallback.
export function UsernameModal({ userId, onDone, onSkip }) {
  const [username, setUsername] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')

    const { error: err } = await supabase
      .from('profiles')
      .insert({ user_id: userId, username: username.trim() })

    setSaving(false)
    if (!err) return onDone()

    // 23505 unique_violation, 23514 check_violation, 42501 RLS refusal — the
    // last one is how a reserved name comes back, since the policy rejects it.
    if (err.code === '23505') setError('Det navnet er opptatt.')
    else if (err.code === '23514') setError('Bruk 3–24 tegn: bokstaver, tall, bindestrek eller understrek.')
    else if (err.code === '42501') setError('Det navnet er reservert.')
    else setError('Kunne ikke lagre navnet. Prøv igjen.')
  }

  return (
    <div className="about-overlay">
      <div className="about-modal auth-modal">
        <h1 className="about-title">Velg et visningsnavn</h1>
        <p>Navnet vises ved leirplassene du legger til. Du kan hoppe over dette.</p>
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
        <button className="auth-skip" onClick={onSkip}>Hopp over — vis meg som anonym</button>
      </div>
    </div>
  )
}
