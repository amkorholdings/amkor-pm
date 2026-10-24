-- Staff accounts (Eric and anyone he adds) get full access to core records.
-- Tenants get read-only access to their own lease, ledger, and profile.

create table staff (
  auth_user_id uuid primary key,
  name text,
  created_at timestamptz not null default now()
);
alter table staff enable row level security;

create policy "staff reads own row" on staff
  for select using (auth_user_id = auth.uid());

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where auth_user_id = auth.uid());
$$;

create or replace function current_person_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from people where auth_user_id = auth.uid();
$$;

-- Staff: full access to the core tables.
do $$
declare t text;
begin
  foreach t in array array['owners','properties','units','people','leases','lease_people','ledger_entries'] loop
    execute format('create policy "staff all" on %I for all using (is_staff()) with check (is_staff())', t);
  end loop;
end $$;

-- Tenants: read-only, scoped to their own leases.
create policy "tenant reads own person" on people
  for select using (auth_user_id = auth.uid());

create policy "tenant reads own lease links" on lease_people
  for select using (person_id = current_person_id());

create policy "tenant reads own leases" on leases
  for select using (id in (select lease_id from lease_people where person_id = current_person_id()));

create policy "tenant reads own unit" on units
  for select using (id in (
    select l.unit_id from leases l
    join lease_people lp on lp.lease_id = l.id
    where lp.person_id = current_person_id()
  ));

create policy "tenant reads own property" on properties
  for select using (id in (
    select u.property_id from units u
    join leases l on l.unit_id = u.id
    join lease_people lp on lp.lease_id = l.id
    where lp.person_id = current_person_id()
  ));

create policy "tenant reads own ledger" on ledger_entries
  for select using (lease_id in (select lease_id from lease_people where person_id = current_person_id()));

-- Ledger is append-only. Corrections are new adjustment rows.
create or replace function forbid_ledger_change() returns trigger
language plpgsql as $$
begin
  raise exception 'ledger is append-only; add an adjustment instead';
end $$;

create trigger ledger_no_update_or_delete
  before update or delete on ledger_entries
  for each row execute function forbid_ledger_change();

-- Make the balance view respect row level security of the caller.
drop view if exists lease_balances;
create view lease_balances with (security_invoker = true) as
select lease_id, sum(amount) as balance
from ledger_entries
group by lease_id;
