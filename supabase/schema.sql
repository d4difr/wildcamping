-- Run this in the Supabase SQL editor (Project > SQL Editor > New query)

create extension if not exists pgcrypto;

create table if not exists spots (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  latitude double precision not null,
  longitude double precision not null,
  photo_url text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

-- Row Level Security: public can read approved spots and insert new ones as
-- approved (no moderation queue for now, while the site has little traffic).
alter table spots enable row level security;

create policy "Public can read approved spots"
  on spots for select
  using (status = 'approved');

create policy "Public can submit new spots"
  on spots for insert
  with check (status = 'approved');

-- Storage bucket for photos. Create it via the Supabase dashboard
-- (Storage > New bucket > name: spot-photos > Public bucket: on)
-- or run:
insert into storage.buckets (id, name, public)
values ('spot-photos', 'spot-photos', true)
on conflict (id) do nothing;

create policy "Public can upload photos"
  on storage.objects for insert
  with check (bucket_id = 'spot-photos');

create policy "Public can view photos"
  on storage.objects for select
  using (bucket_id = 'spot-photos');

-- Seed a few approved starter spots
insert into spots (name, description, latitude, longitude, status) values
  ('Reinebringen viewpoint', 'Steep hike, sweeping views over Reine and the fjord. Flat tent spots near the top ridge.', 67.933, 13.072, 'approved'),
  ('Jotunheimen ridge near Besseggen', 'Classic ridge walk, exposed but stunning between two lakes of different colors.', 61.504, 8.652, 'approved'),
  ('Senja, Husfjellet', 'Coastal mountain camping with arctic light and dramatic sea views.', 69.367, 17.45, 'approved');
