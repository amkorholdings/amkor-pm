-- Bank feed through Plaid. Each morning the app pulls new transactions on the unit deposit accounts and posts
-- every incoming deposit to the unit's active lease. Works with any bank Plaid supports, so the units can move
-- to another bank later without code changes: connect the new bank and map its accounts to the units.

-- One row per bank login connected through Plaid. access_token is a secret: no policies, so only the
-- service role (server code) can read this table.
create table plaid_items (
  id uuid primary key default gen_random_uuid(),
  item_id text not null unique,
  access_token text not null,
  institution_name text,
  cursor text,                        -- Plaid /transactions/sync position
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
alter table plaid_items enable row level security;

-- Accounts under each connected login, for mapping to unit deposit accounts.
create table plaid_accounts (
  account_id text primary key,
  plaid_item_id uuid not null references plaid_items(id) on delete cascade,
  name text,
  mask text,                          -- last 4 digits of the account number
  created_at timestamptz not null default now()
);
alter table plaid_accounts enable row level security;
create policy "staff all" on plaid_accounts for all using (is_staff()) with check (is_staff());

alter table deposit_accounts add column plaid_account_id text unique references plaid_accounts(account_id) on delete set null;

-- Every incoming deposit seen in the feed, and what happened to it.
create table bank_transactions (
  id uuid primary key default gen_random_uuid(),
  plaid_transaction_id text not null unique,
  plaid_account_id text not null,
  deposit_account_id uuid references deposit_accounts(id),
  posted_date date not null,
  amount numeric(10,2) not null,      -- money in, as a positive number
  description text,
  status text not null check (status in ('posted','unmatched','error','ignored')),
  payment_id uuid references payments(id),
  error text,
  created_at timestamptz not null default now()
);
create index bank_transactions_status on bank_transactions (status, posted_date);
alter table bank_transactions enable row level security;
create policy "staff all" on bank_transactions for all using (is_staff()) with check (is_staff());
