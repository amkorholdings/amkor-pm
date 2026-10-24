-- Core records: owners, properties, units, people, leases, and the tenant ledger.
-- The ledger is append-only: corrections are new rows (adjustments), never edits.

create extension if not exists "pgcrypto";

-- Owners of the properties (for owner-side statements).
create table owners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  created_at timestamptz not null default now()
);

create table properties (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references owners(id),
  name text not null,
  address_line1 text not null,
  address_line2 text,
  city text not null,
  state text not null,
  postal_code text not null,
  buildium_id text unique,            -- for migration traceability
  created_at timestamptz not null default now()
);

create table units (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  unit_number text not null,
  bedrooms numeric(3,1),
  bathrooms numeric(3,1),
  market_rent numeric(10,2),
  is_listed boolean not null default false,
  buildium_id text unique,
  created_at timestamptz not null default now(),
  unique (property_id, unit_number)
);

create table people (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,           -- links to Supabase auth for the tenant portal
  first_name text not null,
  last_name text not null,
  email text,
  phone text,
  buildium_id text unique,
  created_at timestamptz not null default now()
);

create table leases (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id),
  start_date date not null,
  end_date date,
  monthly_rent numeric(10,2) not null,
  security_deposit numeric(10,2) not null default 0,
  status text not null default 'active' check (status in ('pending','active','ended')),
  buildium_id text unique,
  created_at timestamptz not null default now()
);

create table lease_people (
  lease_id uuid not null references leases(id) on delete cascade,
  person_id uuid not null references people(id),
  role text not null default 'tenant' check (role in ('tenant','occupant','guarantor')),
  primary key (lease_id, person_id)
);

-- Tenant ledger: every money movement for a lease is one row.
-- Positive amount = owed by tenant (charge). Negative = paid or credited.
create table ledger_entries (
  id uuid primary key default gen_random_uuid(),
  lease_id uuid not null references leases(id),
  entry_date date not null,
  entry_type text not null check (entry_type in ('charge','payment','credit','adjustment','deposit','refund')),
  description text,
  amount numeric(10,2) not null,
  reverses_entry_id uuid references ledger_entries(id),  -- corrections point at what they fix
  buildium_id text unique,
  created_at timestamptz not null default now()
);

create index ledger_entries_lease_date on ledger_entries (lease_id, entry_date);

-- Running balance per lease. The ledger is the source of truth; this is just a read.
create view lease_balances as
select lease_id, sum(amount) as balance
from ledger_entries
group by lease_id;

-- Row level security: enable now, add policies with the tenant portal.
alter table owners enable row level security;
alter table properties enable row level security;
alter table units enable row level security;
alter table people enable row level security;
alter table leases enable row level security;
alter table lease_people enable row level security;
alter table ledger_entries enable row level security;
