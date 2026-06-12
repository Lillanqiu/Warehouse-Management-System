create table if not exists users (
  id text primary key,
  username text unique not null,
  password text not null,
  name text not null,
  role text not null check(role in ('admin', 'asset_manager', 'department_head', 'teacher', 'user')),
  role_id text,
  department text not null,
  active integer not null default 1
);

create table if not exists roles (
  id text primary key,
  name text unique not null,
  description text,
  active integer not null default 1,
  created_at text not null default '',
  updated_at text not null default ''
);

create table if not exists permissions (
  code text primary key,
  name text not null,
  description text
);

create table if not exists role_permissions (
  role_id text not null references roles(id),
  permission_code text not null references permissions(code),
  primary key (role_id, permission_code)
);

create table if not exists menu_permissions (
  menu_key text primary key,
  label text not null,
  active integer not null default 1
);

create table if not exists role_menus (
  role_id text not null references roles(id),
  menu_key text not null references menu_permissions(menu_key),
  primary key (role_id, menu_key)
);

create table if not exists assets (
  id text primary key,
  code text unique not null,
  name text not null,
  category text not null,
  spec text,
  quantity integer not null,
  safe_stock integer not null default 0,
  brand text,
  unit text not null default '件',
  unit_price real not null default 0,
  total_amount real not null default 0,
  purchase_date text,
  inbound_date text,
  supplier text,
  use_department text,
  use_user_id text,
  source text,
  creator_id text,
  created_at text,
  updated_at text,
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

create table if not exists stock_records (
  id text primary key,
  asset_id text not null references assets(id),
  flow_type text not null,
  quantity integer not null,
  before_quantity integer not null,
  after_quantity integer not null,
  related_type text,
  related_id text,
  operator_id text not null references users(id),
  note text,
  created_at text not null
);

create table if not exists borrow_orders (
  id text primary key,
  order_no text unique not null,
  asset_id text not null references assets(id),
  borrower_id text not null references users(id),
  quantity integer not null default 1,
  count_quantity integer not null default 1,
  operator_id text not null references users(id),
  expected_return_date text,
  actual_return_date text,
  status text not null,
  approval_status text not null,
  approver_id text,
  approval_time text,
  return_check text,
  note text,
  created_at text not null,
  updated_at text not null
);

create table if not exists transfer_orders (
  id text primary key,
  order_no text unique not null,
  asset_id text not null references assets(id),
  old_department text,
  new_department text,
  old_location text,
  new_location text,
  old_keeper_id text,
  new_keeper_id text,
  reason text,
  transfer_date text,
  status text not null,
  operator_id text not null references users(id),
  approver_id text,
  created_at text not null,
  updated_at text not null
);

create table if not exists repair_orders (
  id text primary key,
  order_no text unique not null,
  asset_id text not null references assets(id),
  reporter_id text not null references users(id),
  repairer text,
  status text not null,
  fault_desc text,
  cost real not null default 0,
  result text,
  start_time text,
  end_time text,
  operator_id text not null references users(id),
  created_at text not null,
  updated_at text not null
);

create table if not exists scrap_orders (
  id text primary key,
  order_no text unique not null,
  asset_id text not null references assets(id),
  applicant_id text not null references users(id),
  reason text,
  residual_value real not null default 0,
  scrap_date text,
  status text not null,
  approval_status text not null,
  approver_id text,
  approval_time text,
  operator_id text not null references users(id),
  created_at text not null,
  updated_at text not null
);

create table if not exists asset_flow_logs (
  id text primary key,
  asset_id text not null references assets(id),
  action text not null,
  operator_id text not null references users(id),
  business_no text,
  source_type text,
  source_id text,
  before_json text,
  after_json text,
  note text,
  created_at text not null
);

create table if not exists device_group_rules (
  id text primary key,
  source_key text unique not null,
  group_name text not null,
  family_id text,
  active integer not null default 1,
  created_by text,
  created_at text not null,
  updated_at text not null
);

create table if not exists audits (
  id text primary key,
  time text not null,
  user_id text not null references users(id),
  action text not null,
  detail text not null,
  ip text,
  object_type text,
  object_id text,
  before_value text,
  after_value text,
  business_no text
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

create table if not exists asset_categories (
  id text primary key,
  name text unique not null,
  parent_id text,
  code text,
  category_type text not null default '固定资产',
  active integer not null default 1,
  created_at text not null default '',
  updated_at text not null default ''
);

create table if not exists locations (
  id text primary key,
  name text unique not null,
  parent_id text,
  type text not null default '仓库',
  code text,
  manager_id text,
  remark text,
  active integer not null default 1,
  created_at text not null,
  updated_at text not null
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

create table if not exists import_row_fingerprints (
  id text primary key,
  file_hash text not null,
  row_hash text not null unique,
  file_name text not null,
  row_number integer not null,
  target_type text,
  target_id text,
  result text not null,
  archive_id text,
  imported_by text,
  created_at text not null
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
  unit text not null default '',
  quantity integer not null default 1,
  unit_price real not null default 0,
  total_amount real not null default 0,
  item_type text not null default '',
  priority text,
  expected_time text,
  reason text,
  status text not null,
  created_at text not null,
  handled_by text,
  handled_at text,
  handle_note text
);

create table if not exists inventory_check_tasks (
  id text primary key,
  check_no text unique not null,
  scope_type text not null,
  scope_value text,
  owner_id text not null references users(id),
  start_time text not null,
  end_time text,
  status text not null,
  remark text,
  created_at text not null
);

create table if not exists inventory_check_items (
  id text primary key,
  task_id text not null references inventory_check_tasks(id),
  asset_id text not null references assets(id),
  system_location text,
  actual_location text,
  system_status text,
  actual_status text,
  system_keeper_id text,
  actual_keeper_id text,
  checked integer not null default 0,
  diff_type text not null,
  remark text
);
