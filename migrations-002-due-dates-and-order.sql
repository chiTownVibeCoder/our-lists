-- Our Lists update 2: due dates on to-dos and drag-to-reorder.
-- Paste into Supabase > SQL Editor and press Run. Safe to run more than once.
alter table items add column if not exists due_date date;
alter table items add column if not exists position double precision;

-- Give existing items an order based on when they were added.
update items set position = sub.n
from (select id, row_number() over (partition by list_id order by created_at) as n from items) sub
where items.id = sub.id and items.position is null;
