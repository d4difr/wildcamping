import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { ErrorBoundary, RecoveryPanel, installBlankPageWatchdog, setRecoveryRenderer } from './Recovery.jsx'

const rootEl = document.getElementById('root')
const root = ReactDOM.createRoot(rootEl)

// How the watchdog paints its panel, kept out of Recovery.jsx so that module
// does not import react-dom itself.
setRecoveryRenderer((_el, detail) => root.render(<RecoveryPanel detail={detail} />))

root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)

// Last resort for errors React never sees — see Recovery.jsx. Only shows if the
// page actually painted nothing, so a working app is never interrupted.
installBlankPageWatchdog(rootEl)
