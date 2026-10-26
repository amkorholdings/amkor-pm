-- Payments: Stripe (card and ACH) and in-person deposits (cash, money order, cashier's check).
-- In-person deposits go into a bank account tied to the tenant's profile. That account number is the
-- tenant's deposit number. Deposits can be made at any Truliant branch or any CO-OP Shared Branch credit union.
-- Every successful payment posts one 'payment' row to the ledger; a returned payment posts an adjustment.

alter table people add column stripe_customer_id text unique;

-- One deposit account per tenant.
create table deposit_accounts (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null unique references people(id),
  institution text not null default 'Truliant Federal Credit Union',
  account_number text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  lease_id uuid not null references leases(id),
  person_id uuid references people(id),
  method text not null check (method in ('card','ach','cash','money_order','cashiers_check')),
  amount numeric(10,2) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending','succeeded','failed','returned')),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  deposit_account_id uuid references deposit_accounts(id),
  deposit_reference text,             -- bank transaction id, money order number, or check number
  deposit_location text,              -- e.g. 'Truliant' or the shared branch credit union's name
  received_date date,
  ledger_entry_id uuid references ledger_entries(id),
  reversal_entry_id uuid references ledger_entries(id),
  created_at timestamptz not null default now(),
  unique (deposit_account_id, deposit_reference)   -- the same bank deposit can't be recorded twice
);

create index payments_lease on payments (lease_id, created_at);

alter table deposit_accounts enable row level security;
alter table payments enable row level security;

create policy "staff all" on deposit_accounts for all using (is_staff()) with check (is_staff());
create policy "staff all" on payments for all using (is_staff()) with check (is_staff());

-- Tenants see their own deposit number and payments. Writes go through the server (service role).
create policy "tenant reads own deposit account" on deposit_accounts
  for select using (person_id = current_person_id());

create policy "tenant reads own payments" on payments
  for select using (lease_id in (select lease_id from lease_people where person_id = current_person_id()));

-- Marks a pending payment succeeded and posts it to the ledger, in one transaction.
-- Safe to call twice (Stripe retries webhooks): the second call returns the existing ledger entry.
create or replace function post_payment(p_payment_id uuid, p_entry_date date, p_description text)
returns uuid language plpgsql set search_path = public as $$
declare
  p payments;
  entry_id uuid;
begin
  update payments set status = 'succeeded', received_date = coalesce(received_date, p_entry_date)
  where id = p_payment_id and status = 'pending'
  returning * into p;
  if not found then
    select ledger_entry_id into entry_id from payments where id = p_payment_id;
    return entry_id;
  end if;

  insert into ledger_entries (lease_id, entry_date, entry_type, description, amount)
  values (p.lease_id, p_entry_date, 'payment', p_description, -p.amount)
  returning id into entry_id;

  update payments set ledger_entry_id = entry_id where id = p.id;
  return entry_id;
end $$;

-- Reverses a succeeded payment (ACH return, card dispute, bounced check) with an adjustment row.
create or replace function return_payment(p_payment_id uuid, p_entry_date date, p_description text)
returns uuid language plpgsql set search_path = public as $$
declare
  p payments;
  entry_id uuid;
begin
  update payments set status = 'returned'
  where id = p_payment_id and status = 'succeeded'
  returning * into p;
  if not found then
    select reversal_entry_id into entry_id from payments where id = p_payment_id;
    return entry_id;
  end if;

  insert into ledger_entries (lease_id, entry_date, entry_type, description, amount, reverses_entry_id)
  values (p.lease_id, p_entry_date, 'adjustment', p_description, p.amount, p.ledger_entry_id)
  returning id into entry_id;

  update payments set reversal_entry_id = entry_id where id = p.id;
  return entry_id;
end $$;

-- Records an in-person deposit by the tenant's deposit number and posts it to their active lease.
-- Pass p_lease_id only when the tenant has more than one active lease.
create or replace function record_deposit(
  p_account_number text,
  p_amount numeric,
  p_method text,
  p_received_date date,
  p_reference text default null,
  p_location text default null,
  p_lease_id uuid default null
) returns uuid language plpgsql set search_path = public as $$
declare
  acct deposit_accounts;
  lease uuid := p_lease_id;
  lease_count int;
  payment_id uuid;
begin
  if p_method not in ('cash','money_order','cashiers_check') then
    raise exception 'method must be cash, money_order, or cashiers_check';
  end if;

  select * into acct from deposit_accounts where account_number = p_account_number and active;
  if not found then
    raise exception 'no active deposit account with number %', p_account_number;
  end if;

  if lease is null then
    select count(*), min(l.id::text)::uuid into lease_count, lease
    from leases l join lease_people lp on lp.lease_id = l.id
    where lp.person_id = acct.person_id and l.status = 'active';
    if lease_count = 0 then raise exception 'tenant has no active lease'; end if;
    if lease_count > 1 then raise exception 'tenant has % active leases; pass a lease id', lease_count; end if;
  elsif not exists (select 1 from lease_people where lease_id = lease and person_id = acct.person_id) then
    raise exception 'lease % does not belong to this deposit account''s tenant', lease;
  end if;

  insert into payments (lease_id, person_id, method, amount, deposit_account_id, deposit_reference,
                        deposit_location, received_date)
  values (lease, acct.person_id, p_method, p_amount, acct.id, p_reference, p_location, p_received_date)
  returning id into payment_id;

  perform post_payment(
    payment_id,
    p_received_date,
    concat_ws(' ', initcap(replace(p_method, '_', ' ')), 'deposit',
              case when p_location is not null then 'at ' || p_location end,
              case when p_reference is not null then '#' || p_reference end)
  );
  return payment_id;
end $$;
