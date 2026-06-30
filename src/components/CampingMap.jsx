import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { supabase } from '../supabaseClient'
import AddSpotForm from './AddSpotForm'

// Default Leaflet marker icons don't load correctly with bundlers; point at CDN assets.
const markerIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34]
})

function ClickHandler({ onMapClick }) {
  useMapEvents({
    click(e) {
      onMapClick(e.latlng)
    }
  })
  return null
}

export default function CampingMap() {
  const [spots, setSpots] = useState([])
  const [pendingPosition, setPendingPosition] = useState(null)
  const [loading, setLoading] = useState(true)

  async function loadSpots() {
    setLoading(true)
    const { data, error } = await supabase
      .from('spots')
      .select('*')
      .eq('status', 'approved')
    if (!error && data) setSpots(data)
    setLoading(false)
  }

  useEffect(() => {
    loadSpots()
  }, [])

  return (
    <div>
      <p className="hint">
        {pendingPosition
          ? `Pin dropped at ${pendingPosition.lat.toFixed(3)}, ${pendingPosition.lng.toFixed(3)}. Fill in details below.`
          : loading
          ? 'Loading spots…'
          : 'Click anywhere on the map to drop a pin and submit a wild camping spot.'}
      </p>
      <MapContainer center={[62.0, 9.5]} zoom={5} id="map">
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickHandler onMapClick={setPendingPosition} />
        {spots.map((spot) => (
          <Marker key={spot.id} position={[spot.latitude, spot.longitude]} icon={markerIcon}>
            <Popup>
              <strong>{spot.name}</strong>
              {spot.photo_url && (
                <img src={spot.photo_url} alt={spot.name} className="popup-photo" />
              )}
              <div style={{ fontSize: '0.85rem', color: '#555' }}>{spot.description}</div>
            </Popup>
          </Marker>
        ))}
        {pendingPosition && (
          <Marker position={pendingPosition} icon={markerIcon} opacity={0.6} />
        )}
      </MapContainer>

      {pendingPosition && (
        <AddSpotForm
          position={pendingPosition}
          onCancel={() => setPendingPosition(null)}
          onSaved={() => {
            setPendingPosition(null)
            loadSpots()
          }}
        />
      )}
    </div>
  )
}
