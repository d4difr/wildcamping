import React from 'react'

// A way out of a blank page.
//
// This exists because of a real incident: stale data in localStorage made the
// app throw "zg is not a constructor" before anything rendered. The same build
// worked in incognito and on mobile, so the code was fine — the browser profile
// was not. The only fix was clearing site data through DevTools, which no
// ordinary visitor would ever find. A black screen with no recourse is the worst
// failure a site can have, because the user cannot even report it usefully.
//
// Two mechanisms, because they catch different things:
//
//   ErrorBoundary  render-time errors, which React hands to us
//   the watchdog   everything else — the incident above threw from an async
//                  worker callback, which an error boundary never sees
//
// vilda_owner_token is deliberately PRESERVED. It is what proves ownership of
// spots submitted before signing in; clearing it would silently cost someone
// the ability to edit or delete their own contributions. "Clear site data" in
// DevTools does not make that distinction, which is another reason not to send
// people there.
const KEEP = ['vilda_owner_token']

function clearLocalDataAndReload() {
  try {
    const preserved = KEEP.map((k) => [k, localStorage.getItem(k)])
    localStorage.clear()
    sessionStorage.clear()
    for (const [k, v] of preserved) if (v != null) localStorage.setItem(k, v)
  } catch {
    // If storage itself is unavailable there is nothing to clear.
  }
  window.location.reload()
}

function RecoveryPanel({ detail }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1.5rem', background: '#1b4332',
      fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
    }}>
      <div style={{
        maxWidth: 460, background: '#fffdf9', borderRadius: 14,
        padding: '1.75rem', boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
      }}>
        <h1 style={{ margin: '0 0 0.75rem', fontSize: '1.35rem', color: '#1b4332' }}>
          Vilda klarte ikke å starte
        </h1>
        <p style={{ margin: '0 0 0.75rem', lineHeight: 1.5, color: '#3d4a42' }}>
          Som regel skyldes dette gamle data lagret i nettleseren din. Å tømme dem
          løser det nesten alltid.
        </p>
        <p style={{ margin: '0 0 1.25rem', fontSize: '0.85rem', color: '#6b7770', lineHeight: 1.5 }}>
          Du blir logget ut, men leirplassene dine beholdes.
        </p>
        <button
          onClick={clearLocalDataAndReload}
          style={{
            width: '100%', padding: '0.7rem', border: 0, borderRadius: 10,
            background: '#d98e04', color: '#fff', fontSize: '0.95rem',
            fontWeight: 600, cursor: 'pointer',
          }}
        >
          Tøm lokale data og prøv igjen
        </button>
        <button
          onClick={() => window.location.reload()}
          style={{
            width: '100%', marginTop: '0.5rem', padding: '0.6rem', border: 0,
            background: 'none', color: '#3d4a42', fontSize: '0.85rem',
            textDecoration: 'underline', cursor: 'pointer',
          }}
        >
          Bare last inn på nytt
        </button>
        {detail && (
          <p style={{
            margin: '1rem 0 0', fontSize: '0.7rem', color: '#8a938c',
            fontFamily: 'ui-monospace, monospace', wordBreak: 'break-word',
          }}>
            {detail}
          </p>
        )}
      </div>
    </div>
  )
}

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error) {
    console.error('Vilda crashed during render:', error)
  }

  render() {
    if (this.state.error) return <RecoveryPanel detail={this.state.error.message} />
    return this.props.children
  }
}

// Catches what the boundary cannot: an error thrown outside React's render
// cycle — from a worker callback, a promise, an event handler — that leaves the
// page blank. Only fires if the app genuinely painted nothing, so a stray error
// in a working app never shows this.
export function installBlankPageWatchdog(rootEl, delayMs = 6000) {
  let sawError = null
  const note = (e) => { sawError = sawError ?? (e?.message || e?.reason?.message || 'ukjent feil') }
  window.addEventListener('error', note)
  window.addEventListener('unhandledrejection', note)

  setTimeout(() => {
    window.removeEventListener('error', note)
    window.removeEventListener('unhandledrejection', note)
    const empty = !rootEl || rootEl.childElementCount === 0
    if (!empty || !sawError) return
    console.error('Vilda rendered nothing; showing recovery panel. First error:', sawError)
    ReactDOMRenderRecovery(rootEl, sawError)
  }, delayMs)
}

// Imported lazily so this module has no hard dependency on react-dom at load.
let ReactDOMRenderRecovery = () => {}
export function setRecoveryRenderer(fn) { ReactDOMRenderRecovery = fn }

export { RecoveryPanel }
