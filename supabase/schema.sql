-- FruitSlot Instant: Supabase schema.
-- Run once in Supabase > SQL Editor. Safe to read top to bottom.
-- Customers can only act through place_order(); prices are always computed here, never trusted from the app.

create extension if not exists pgcrypto;

-- ───────────────────────── Tables ─────────────────────────

create table public.shops (
  id          text primary key,                 -- '1town', '2town'
  name        text not null,
  lat         double precision,                 -- SET THESE (see bottom)
  lng         double precision,
  radius_km   numeric not null default 4,       -- delivery radius
  is_open     boolean not null default true,    -- owner can close the shop from the app
  open_time   time not null default '07:00',    -- IST
  close_time  time not null default '21:00'     -- IST
);

create table public.products (
  id        text primary key,                   -- same ids as your Book: 'pomegranate', 'apple', ...
  name      text not null,
  name_te   text,
  unit      text not null default 'kg' check (unit in ('kg','pc')),
  step      numeric not null default 0.5,       -- smallest quantity a customer can add (kg or pieces)
  image_url text,
  sort      int not null default 100,
  active    boolean not null default true
);

create table public.shop_products (
  shop_id    text not null references public.shops(id) on delete cascade,
  product_id text not null references public.products(id) on delete cascade,
  price      numeric not null check (price > 0), -- Rs per kg (or per piece) for instant orders
  in_stock   boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (shop_id, product_id)
);

create table public.settings (
  key   text primary key,
  value jsonb not null
);

create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text,
  phone      text,
  created_at timestamptz not null default now()
);

create table public.addresses (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  label      text not null default 'Home',
  name       text,
  phone      text,
  house      text not null,
  area       text,
  landmark   text,
  lat        double precision not null,
  lng        double precision not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.addresses(user_id);

create table public.staff (
  user_id uuid not null references auth.users(id) on delete cascade,
  shop_id text not null references public.shops(id) on delete cascade,
  role    text not null default 'owner' check (role in ('owner','packer','rider')),
  primary key (user_id, shop_id)
);

create type public.order_status as enum
  ('placed','accepted','packed','out_for_delivery','delivered','cancelled');

create table public.orders (
  id                bigint generated always as identity primary key,
  user_id           uuid not null references auth.users(id),
  shop_id           text not null references public.shops(id),
  mode              text not null default 'instant' check (mode in ('instant','tomorrow')),
  status            public.order_status not null default 'placed',
  payment_method    text not null check (payment_method in ('online','cod','upi')),   -- online = Cashfree, upi = pay to the shop's UPI and the owner confirms
  payment_status    text not null default 'pending' check (payment_status in ('pending','to_verify','paid','failed','refunded')),
  subtotal          numeric not null,
  delivery_fee      numeric not null default 0,
  total             numeric not null,
  address           jsonb not null,             -- snapshot, so later edits do not change old orders
  notes             text,
  rider_name        text,
  rider_phone       text,
  cashfree_order_id text unique,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on public.orders(user_id, created_at desc);
create index on public.orders(shop_id, status, created_at desc);

create table public.order_items (
  id         bigint generated always as identity primary key,
  order_id   bigint not null references public.orders(id) on delete cascade,
  product_id text not null references public.products(id),
  name       text not null,
  unit       text not null,
  qty        numeric not null check (qty > 0),
  price      numeric not null,
  line_total numeric not null
);
create index on public.order_items(order_id);

create table public.payments (
  id          bigint generated always as identity primary key,
  order_id    bigint not null references public.orders(id) on delete cascade,
  gateway     text not null default 'cashfree',
  gateway_ref text not null,
  amount      numeric not null,
  status      text not null,
  raw         jsonb,
  created_at  timestamptz not null default now(),
  unique (gateway, gateway_ref)
);

-- ───────────────────────── Helpers ─────────────────────────

create or replace function public.distance_km(lat1 double precision, lng1 double precision,
                                              lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)));
$$;

create or replace function public.is_staff(p_shop text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid() and shop_id = p_shop);
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();
create trigger shop_products_touch before update on public.shop_products
  for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, phone) values (new.id, new.phone) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────────── Place an order ─────────────────────────
-- p_items example: [{"product_id":"apple","qty":1.5},{"product_id":"kamala","qty":2}]

create or replace function public.place_order(
  p_shop_id        text,
  p_address_id     uuid,
  p_items          jsonb,
  p_payment_method text,
  p_mode           text default 'instant',
  p_notes          text default null)
returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_shop     public.shops%rowtype;
  v_addr     public.addresses%rowtype;
  v_item     jsonb;
  v_prod     record;
  v_qty      numeric;
  v_subtotal numeric := 0;
  v_delivery numeric;
  v_min      numeric;
  v_fee      numeric;
  v_free     numeric;
  v_dist     double precision;
  v_now_ist  time := (now() at time zone 'Asia/Kolkata')::time;
  v_order    public.orders%rowtype;
begin
  if v_uid is null then raise exception 'Please log in'; end if;
  if p_payment_method not in ('online','cod','upi') then raise exception 'Bad payment method'; end if;
  if p_mode not in ('instant','tomorrow') then raise exception 'Bad delivery mode'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Cart is empty';
  end if;
  if jsonb_array_length(p_items) > 40 then raise exception 'Too many items'; end if;

  select * into v_shop from public.shops where id = p_shop_id;
  if not found then raise exception 'Unknown shop'; end if;
  if v_shop.lat is null or v_shop.lng is null then raise exception 'Shop location is not set yet'; end if;
  if p_mode = 'instant' and (not v_shop.is_open or v_now_ist < v_shop.open_time or v_now_ist >= v_shop.close_time) then
    raise exception 'Shop is closed right now';
  end if;

  select * into v_addr from public.addresses where id = p_address_id and user_id = v_uid;
  if not found then raise exception 'Address not found'; end if;
  v_dist := public.distance_km(v_shop.lat, v_shop.lng, v_addr.lat, v_addr.lng);
  if v_dist > v_shop.radius_km then raise exception 'Sorry, this address is outside our delivery area'; end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'qty')::numeric;
    select p.name, p.unit, p.step, sp.price, sp.in_stock into v_prod
      from public.products p
      join public.shop_products sp on sp.product_id = p.id and sp.shop_id = p_shop_id
     where p.id = v_item->>'product_id' and p.active;
    if not found then raise exception 'Item % is not sold here', v_item->>'product_id'; end if;
    if not v_prod.in_stock then raise exception '% is out of stock', v_prod.name; end if;
    if v_qty is null or v_qty <= 0 or v_qty > 50 or mod(v_qty, v_prod.step) <> 0 then
      raise exception 'Bad quantity for %', v_prod.name;
    end if;
    v_subtotal := v_subtotal + round(v_prod.price * v_qty, 2);
  end loop;

  select coalesce((select (value #>> '{}')::numeric from public.settings where key = 'min_order'), 0) into v_min;
  select coalesce((select (value #>> '{}')::numeric from public.settings where key = 'delivery_fee'), 0) into v_fee;
  select coalesce((select (value #>> '{}')::numeric from public.settings where key = 'free_delivery_above'), 1e9) into v_free;

  if v_subtotal < v_min then raise exception 'Minimum order is Rs %', v_min; end if;
  v_delivery := case when v_subtotal >= v_free then 0 else v_fee end;

  insert into public.orders (user_id, shop_id, mode, payment_method, subtotal, delivery_fee, total, address, notes)
  values (v_uid, p_shop_id, p_mode, p_payment_method, v_subtotal, v_delivery, v_subtotal + v_delivery,
          jsonb_build_object('label', v_addr.label, 'name', v_addr.name, 'phone', v_addr.phone,
                             'house', v_addr.house, 'area', v_addr.area, 'landmark', v_addr.landmark,
                             'lat', v_addr.lat, 'lng', v_addr.lng, 'distance_km', round(v_dist::numeric, 2)),
          p_notes)
  returning * into v_order;

  insert into public.order_items (order_id, product_id, name, unit, qty, price, line_total)
  select v_order.id, p.id, p.name, p.unit, i.qty, sp.price, round(sp.price * i.qty, 2)
    from jsonb_to_recordset(p_items) as i(product_id text, qty numeric)
    join public.products p on p.id = i.product_id
    join public.shop_products sp on sp.product_id = p.id and sp.shop_id = p_shop_id;

  return v_order;
end $$;

-- Customer cancels before the shop accepts.
create or replace function public.cancel_order(p_order_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.orders set status = 'cancelled'
   where id = p_order_id and user_id = auth.uid() and status = 'placed';
  if not found then raise exception 'This order can no longer be cancelled'; end if;
end $$;

-- Staff marks a cash-on-delivery order as paid after collecting the cash.
create or replace function public.mark_cod_paid(p_order_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v_shop text;
begin
  select shop_id into v_shop from public.orders where id = p_order_id and payment_method = 'cod';
  if v_shop is null or not public.is_staff(v_shop) then raise exception 'Not allowed'; end if;
  update public.orders set payment_status = 'paid' where id = p_order_id;
end $$;


-- Manual UPI: the customer pays the shop's UPI ID, taps "I have paid", the owner checks PhonePe and confirms.
create or replace function public.customer_paid_upi(p_order_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.orders set payment_status = 'to_verify'
   where id = p_order_id and user_id = auth.uid() and payment_method = 'upi'
     and payment_status in ('pending','failed') and status <> 'cancelled';
  if not found then raise exception 'This order does not need a UPI payment'; end if;
end $$;

-- Staff confirms (or rejects) a manual UPI payment after matching amount and time in PhonePe.
create or replace function public.confirm_upi(p_order_id bigint, p_received boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_shop text;
begin
  select shop_id into v_shop from public.orders where id = p_order_id and payment_method = 'upi';
  if v_shop is null or not public.is_staff(v_shop) then raise exception 'Not allowed'; end if;
  update public.orders set payment_status = case when p_received then 'paid' else 'failed' end
   where id = p_order_id and payment_status in ('pending','to_verify','failed');
end $$;

-- ───────────────────────── Security (RLS) ─────────────────────────

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

alter table public.shops          enable row level security;
alter table public.products       enable row level security;
alter table public.shop_products  enable row level security;
alter table public.settings       enable row level security;
alter table public.profiles       enable row level security;
alter table public.addresses      enable row level security;
alter table public.staff          enable row level security;
alter table public.orders         enable row level security;
alter table public.order_items    enable row level security;
alter table public.payments       enable row level security;   -- no policies: only the service role can touch it

-- Public catalogue
grant select on public.shops, public.products, public.shop_products, public.settings to anon, authenticated;
create policy shops_read          on public.shops         for select using (true);
create policy products_read       on public.products      for select using (active);
create policy shop_products_read  on public.shop_products for select using (true);
create policy settings_read       on public.settings      for select
  using (key in ('min_order','delivery_fee','free_delivery_above','upi_id'));

-- Staff can change prices and stock for their own shop (and nothing else on that table)
grant insert, update (price, in_stock, updated_at) on public.shop_products to authenticated;
create policy shop_products_staff_insert on public.shop_products for insert with check (public.is_staff(shop_id));
create policy shop_products_staff_update on public.shop_products for update
  using (public.is_staff(shop_id)) with check (public.is_staff(shop_id));
grant update (is_open) on public.shops to authenticated;
create policy shops_staff_update on public.shops for update
  using (public.is_staff(id)) with check (public.is_staff(id));

-- Profiles and addresses: own rows only
grant select, update (name, phone) on public.profiles to authenticated;
create policy profiles_own_read   on public.profiles for select using (id = auth.uid());
create policy profiles_own_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

grant select, insert, update, delete on public.addresses to authenticated;
create policy addresses_own on public.addresses for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Staff can see which shops they belong to
grant select on public.staff to authenticated;
create policy staff_own_read on public.staff for select using (user_id = auth.uid());

-- Orders: customers read their own; staff read and progress orders for their shop.
-- Customers cannot insert directly (place_order does it) and nobody can edit prices or payment fields.
grant select on public.orders to authenticated;
grant update (status, rider_name, rider_phone) on public.orders to authenticated;
create policy orders_own_read    on public.orders for select using (user_id = auth.uid());
create policy orders_staff_read  on public.orders for select using (public.is_staff(shop_id));
create policy orders_staff_update on public.orders for update
  using (public.is_staff(shop_id)) with check (public.is_staff(shop_id));

grant select on public.order_items to authenticated;
create policy order_items_read on public.order_items for select using (
  exists (select 1 from public.orders o
           where o.id = order_items.order_id
             and (o.user_id = auth.uid() or public.is_staff(o.shop_id))));

grant execute on function public.place_order(text, uuid, jsonb, text, text, text) to authenticated;
grant execute on function public.cancel_order(bigint)  to authenticated;
grant execute on function public.mark_cod_paid(bigint) to authenticated;
grant execute on function public.customer_paid_upi(bigint) to authenticated;
grant execute on function public.confirm_upi(bigint, boolean) to authenticated;
grant execute on function public.is_staff(text)        to authenticated;

-- Live order updates for the customer screen and the owner's order board
alter publication supabase_realtime add table public.orders;

-- ───────────────────────── Starter data ─────────────────────────
-- !! Replace the coordinates with your real shop locations (right-click the shop in Google Maps > copy lat, lng).
insert into public.shops (id, name, lat, lng, radius_km) values
  ('1town', '1 Town (Rythu Bazar)', 16.7107, 81.0952, 4),
  ('2town', '2 Town Rythu Bazar',   16.7107, 81.0952, 4);

insert into public.settings (key, value) values
  ('min_order',           '300'),
  ('upi_id',              '"Q800513737@ybl"'),
  ('delivery_fee',        '30'),
  ('free_delivery_above', '600');

-- Only fruits with a rate from you are seeded. Add the rest from the owner screen later.
insert into public.products (id, name, name_te, unit, step, sort) values
  ('pomegranate', 'Pomegranate',   'దానిమ్మ',      'kg', 0.5, 10),
  ('apple',       'Apple',         'యాపిల్',       'kg', 0.5, 20),
  ('kamala',      'Orange (Kamala)', 'కమలా పండు',   'kg', 0.5, 30),
  ('mosambi',     'Mosambi',       'బత్తాయి',      'kg', 0.5, 40),
  ('black-grapes','Black grapes',  'ద్రాక్ష',       'kg', 0.5, 50),
  ('kiwi',        'Kiwi',          null,           'kg', 0.25, 60),
  ('white-dragon','Dragon fruit (white)', null,    'kg', 0.5, 70),
  ('red-dragon',  'Dragon fruit (red)',   null,    'kg', 0.5, 71),
  ('plum',        'Plum',          null,           'kg', 0.25, 80),
  ('pineapple',   'Pineapple',     'అనాస',         'kg', 1,   90),
  ('muskmelon',   'Muskmelon',     'కర్బూజ',       'kg', 1,   100),
  ('watermelon',  'Watermelon',    'పుచ్చకాయ',     'kg', 1,   110),
  ('regipandu',   'Regi pandu',    'రేగు పండు',    'kg', 0.5, 120),
  ('avacado',     'Avocado',       null,           'pc', 1,   130);

insert into public.shop_products (shop_id, product_id, price)
select s.id, v.product_id, v.price
  from public.shops s
 cross join (values
   ('pomegranate', 180), ('apple', 180), ('kamala', 75), ('mosambi', 50),
   ('black-grapes', 100), ('kiwi', 360), ('white-dragon', 120), ('red-dragon', 130),
   ('plum', 200), ('pineapple', 60), ('muskmelon', 45), ('watermelon', 35),
   ('regipandu', 80), ('avacado', 70)) as v(product_id, price);

-- After you sign in once with your own phone or Google account, make yourself the owner:
--   select id, phone, email from auth.users;   -- copy your user id
--   insert into public.staff (user_id, shop_id, role) values
--     ('<YOUR-USER-ID>', '1town', 'owner'), ('<YOUR-USER-ID>', '2town', 'owner');
