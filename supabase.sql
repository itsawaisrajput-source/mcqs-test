create table user_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}',
  updated_at timestamptz default now()
);
alter table user_data enable row level security;
create policy "own row" on user_data for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
