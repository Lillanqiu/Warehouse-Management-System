create table if not exists users (
  id text primary key,
  username text unique not null,
  password text not null,
  name text not null,
  role text not null check(role in ('admin', 'user')),
  department text not null,
  active integer not null default 1
);

create table if not exists assets (
  id text primary key,
  code text unique not null,
  name text not null,
  category text not null,
  spec text,
  quantity integer not null,
  location text not null,
  keeper_id text not null references users(id),
  status text not null,
  remark text
);

create table if not exists records (
  id text primary key,
  asset_id text not null references assets(id),
  type text not null,
  quantity integer not null,
  user_id text not null references users(id),
  operator_id text not null references users(id),
  in_time text,
  out_time text,
  status text not null,
  paper_no text,
  note text,
  photo text
);

create table if not exists audits (
  id text primary key,
  time text not null,
  user_id text not null references users(id),
  action text not null,
  detail text not null,
  ip text
);

create table if not exists paper_queue (
  id text primary key,
  paper_no text not null,
  source text not null,
  owner_id text not null references users(id),
  status text not null,
  text text not null
);

create table if not exists departments (
  id text primary key,
  name text unique not null,
  active integer not null default 1
);

create table if not exists import_archives (
  id text primary key,
  file_name text not null,
  file_type text not null,
  category text not null,
  uploaded_by text not null references users(id),
  uploaded_at text not null,
  result_json text not null,
  content blob not null
);

create table if not exists system_settings (
  key text primary key,
  value text not null
);

create table if not exists admin_requests (
  id text primary key,
  user_id text not null references users(id),
  status text not null,
  reason text,
  created_at text not null,
  handled_by text,
  handled_at text
);

create table if not exists asset_requests (
  id text primary key,
  user_id text not null references users(id),
  asset_name text not null,
  category text,
  spec text,
  quantity integer not null default 1,
  reason text,
  status text not null,
  created_at text not null,
  handled_by text,
  handled_at text,
  handle_note text
);

create table if not exists purchase_wishes (
  id text primary key,
  user_id text not null references users(id),
  item_name text not null,
  category text,
  spec text,
  quantity integer not null default 1,
  priority text,
  expected_time text,
  reason text,
  status text not null,
  created_at text not null,
  handled_by text,
  handled_at text,
  handle_note text
);
