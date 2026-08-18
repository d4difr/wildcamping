// The columns of `spots` that may leave the server.
//
// Shared by the client and by api/spots-private.js. The client needs an explicit
// list because anon lost table-level SELECT when owner_token was revoked, so
// `select('*')` fails. The server needs the same list for the opposite reason:
// it queries with the service role, which bypasses RLS entirely, so `*` would
// happily return owner_token to the browser.
//
// owner_token is absent on purpose and must stay absent.
//
// Adding a column to `spots` means adding it here AND to the SQL grant in
// supabase/fix-owner-token-exposure.sql, or it is silently invisible to the app.
export const SPOT_COLUMNS = [
  'id', 'name', 'description', 'latitude', 'longitude',
  'photo_url', 'photo_urls', 'status', 'created_at',
  'access', 'spot_type', 'spot_types', 'region',
  'flags', 'flag_reports', 'deleted_at',
  'flatness_deg', 'flatness_relief_m', 'flatness_offset_m', 'flatness_checked_at',
]

export const SPOT_COLUMNS_SQL = SPOT_COLUMNS.join(', ')
