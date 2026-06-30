import CampingMap from './components/CampingMap'
import Contours from './components/Contours'

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <Contours className="contours" />
        <div className="app-header-inner">
          <p className="eyebrow">Norway · wild camping</p>
          <h1>Find a place to pitch your tent</h1>
          <p>
            Community-sourced coordinates and photos for spots worth the
            hike, from fjord ridgelines to arctic coastline.
          </p>
        </div>
      </header>
      <CampingMap />
    </div>
  )
}
