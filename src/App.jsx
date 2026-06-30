import CampingMap from './components/CampingMap'

export default function App() {
  return (
    <div className="app">
      <header>
        <h1>Norway wild camping spots</h1>
        <p>Community-sourced coordinates and photos for places worth pitching a tent.</p>
      </header>
      <CampingMap />
    </div>
  )
}
