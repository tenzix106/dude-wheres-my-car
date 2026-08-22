create table if not exists public.lobbies (
  id text primary key,
  state jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.lobbies enable row level security;

-- Lobby state is only accessed by the Node server with SUPABASE_SECRET_KEY.
-- No anon/authenticated policies are intentionally created.

