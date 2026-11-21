-- Our Lists update 3: recycle bin. Paste into Supabase > SQL Editor and press Run.
alter table lists add column if not exists deleted_at timestamptz;
alter table items add column if not exists deleted_at timestamptz;
