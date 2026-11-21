-- Our Lists: database setup. Paste all of this into Supabase > SQL Editor and press Run.
-- 1) Put your two email addresses in the line marked CHANGE ME before running.

create table if not exists allowed_emails (email text primary key);

insert into allowed_emails (email) values
  ('person1@example.com'), ('person2@example.com')   -- CHANGE ME
on conflict do nothing;

create or replace function is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from allowed_emails where lower(email) = lower(auth.jwt() ->> 'email'));
$$;

create table if not exists lists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'todo' check (kind in ('todo', 'shopping')),
  created_at timestamptz not null default now()
);

create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references lists(id) on delete cascade,
  text text not null,
  done boolean not null default false,
  added_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now()
);
create index if not exists items_list_id on items(list_id);

alter table allowed_emails enable row level security;
alter table lists enable row level security;
alter table items enable row level security;

drop policy if exists "members read allowed" on allowed_emails;
create policy "members read allowed" on allowed_emails for select to authenticated using (is_member());
drop policy if exists "members all lists" on lists;
create policy "members all lists" on lists for all to authenticated using (is_member()) with check (is_member());
drop policy if exists "members all items" on items;
create policy "members all items" on items for all to authenticated using (is_member()) with check (is_member());

-- Let signed-in users reach these tables (automatic API grants are off in this project).
-- The policies above still limit access to the allowed emails only.
grant usage on schema public to authenticated;
grant select on allowed_emails to authenticated;
grant select, insert, update, delete on lists, items to authenticated;
grant execute on function is_member() to authenticated;
revoke execute on function is_member() from anon, public;

-- Live sync
alter table items replica identity full;
alter table lists replica identity full;
do $$ begin
  alter publication supabase_realtime add table lists, items;
exception when duplicate_object then null; end $$;

-- Starter lists
insert into lists (name, kind)
select * from (values ('To do', 'todo'), ('Groceries', 'shopping')) v(name, kind)
where not exists (select 1 from lists);
