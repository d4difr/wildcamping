# Norway wild camping spots

A map where users can browse and submit wild camping spots in Norway.

## Stack
- React + Vite (frontend)
- Leaflet / react-leaflet (map, free OpenStreetMap tiles)
- Supabase (Postgres database, file storage, hosting for backend)

## 1. Create a Supabase project
1. Go to supabase.com and sign up (free tier is enough to start).
2. Create a new project. Pick any region (Frankfurt is closest to Norway).
3. Once it's ready, go to Project Settings > API. You'll need the "Project URL"
   and the "anon public" key for the next step.
4. Go to SQL Editor > New query, paste the contents of `supabase/schema.sql`,
   and run it. This creates the `spots` table, sets up access rules so
   submissions start as "pending" and only "approved" spots are public, and
   creates the photo storage bucket.

## 2. Configure the app
1. Copy `.env.example` to `.env`.
2. Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` with the values
   from step 1.

## 3. Run locally
```
npm install
npm run dev
```
Open the local URL it prints (usually http://localhost:5173).

## 4. Moderating submissions
New spots are currently inserted with `status = 'approved'` and go live
immediately — there's no review queue while the site has little traffic.
Once that changes, switch new submissions back to `status = 'pending'` in
`AddSpotForm.jsx` and update the `Public can submit new spots` RLS policy
in `supabase/schema.sql` to match, then approve rows by hand in Supabase's
Table Editor (or build an admin page for it).

## 5. Deploy
Push this folder to a GitHub repo, then connect it to Vercel or Netlify
(both have free tiers and a "New Project > Import from GitHub" flow). Add
the same two environment variables (`VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`) in the host's project settings, since `.env` itself
is gitignored and won't be deployed.

## Roadmap ideas
- Search/filter spots by region
- Marker clustering once there are many spots
- User accounts (Supabase Auth) so people can track their submissions
- Upvotes or ratings on spots
- A simple in-app moderation queue instead of using the Supabase table editor
