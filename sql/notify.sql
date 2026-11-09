-- sql/notify.sql
-- Event layer для pgsql_api: реестр отслеживаемых объектов + журнал событий.
-- Требует PostgreSQL 13+ (xid8, pg_current_xact_id, pg_current_snapshot).
-- Выполнять от роли-владельца схемы (например, notify_owner).

begin;

create schema if not exists notify;
revoke all on schema notify from public;

-- ---------------------------------------------------------------------------
-- 1. РЕЕСТР: какие таблицы (объекты) отслеживаются и как из строки сделать событие
-- ---------------------------------------------------------------------------
create table notify.registry (
    id            integer generated always as identity primary key,
    table_oid     regclass    not null unique,           -- отслеживаемая таблица
    topic         text        not null,                  -- логическое имя, напр. 'crm.customer'
    pk_columns    text[]      not null,                  -- столбцы первичного ключа
    scope_column  text,                                  -- столбец для маршрутизации/прав (напр. board_id, tenant_id); null = нет
    watch_columns text[],                                -- UPDATE порождает событие, только если изменился один из них; null = любой
    ops           text[]      not null default '{INSERT,UPDATE,DELETE}',
    enabled       boolean     not null default true,
    description   text,
    created_at    timestamptz not null default now(),
    constraint registry_ops_chk check (ops <@ array['INSERT','UPDATE','DELETE']::text[]),
    constraint registry_pk_chk  check (cardinality(pk_columns) > 0)
);

comment on table notify.registry is
  'Реестр объектов, изменения которых публикуются в notify.event. Одна строка = одна таблица.';

-- ---------------------------------------------------------------------------
-- 2. ЖУРНАЛ: куда собираются все события (outbox / change log)
-- ---------------------------------------------------------------------------
create table notify.event (
    id              bigint generated always as identity primary key,
    xid             xid8        not null default pg_current_xact_id(),  -- для безопасного курсора
    ts              timestamptz not null default now(),                  -- время транзакции
    registry_id     integer     not null references notify.registry(id) on delete cascade,
    topic           text        not null,
    scope           text,                    -- значение scope_column (как текст)
    table_name      text        not null,    -- schema.table
    op              text        not null check (op in ('INSERT','UPDATE','DELETE')),
    pk              jsonb       not null,    -- {"id": 123} — только ключ, НИКАКИХ данных строки
    changed_columns text[]                   -- только для UPDATE: имена изменённых столбцов
);

create index event_xid_idx   on notify.event (xid, id);
create index event_ts_idx    on notify.event (ts);
create index event_topic_idx on notify.event (topic, scope);

comment on table notify.event is
  'Журнал изменений. Содержит только "что/где/когда", не содержимое строк. Чистится по retention.';

-- ---------------------------------------------------------------------------
-- 3. Универсальная триггерная функция
-- ---------------------------------------------------------------------------
create or replace function notify.capture()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, notify
as $$
declare
    r        notify.registry%rowtype;
    new_j    jsonb;
    old_j    jsonb;
    row_j    jsonb;
    changed  text[];
    pk_val   jsonb;
begin
    select * into r from notify.registry where table_oid = TG_RELID;
    if not found or not r.enabled or not (TG_OP = any (r.ops)) then
        return null;
    end if;

    if TG_OP <> 'INSERT' then old_j := to_jsonb(OLD); end if;
    if TG_OP <> 'DELETE' then new_j := to_jsonb(NEW); end if;
    row_j := coalesce(new_j, old_j);

    if TG_OP = 'UPDATE' then
        select array_agg(k order by k) into changed
        from jsonb_object_keys(new_j) k
        where new_j -> k is distinct from old_j -> k;

        if changed is null then
            return null;                                   -- ничего не изменилось
        end if;
        if r.watch_columns is not null and not (changed && r.watch_columns) then
            return null;                                   -- изменились неинтересные столбцы
        end if;
    end if;

    select jsonb_object_agg(c, row_j -> c) into pk_val
    from unnest(r.pk_columns) c;

    insert into notify.event (registry_id, topic, scope, table_name, op, pk, changed_columns)
    values (
        r.id,
        r.topic,
        case when r.scope_column is not null then row_j ->> r.scope_column end,
        format('%I.%I', TG_TABLE_SCHEMA, TG_TABLE_NAME),
        TG_OP,
        pk_val,
        changed
    );

    -- Постоянный payload: PostgreSQL схлопывает одинаковые NOTIFY в пределах транзакции,
    -- поэтому демон получает один сигнал на транзакцию, а не на каждую строку.
    perform pg_notify('notify_event', '');
    return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Регистрация / снятие таблицы
-- ---------------------------------------------------------------------------
create or replace function notify.register(
    p_table         regclass,
    p_topic         text,
    p_scope_column  text    default null,
    p_watch_columns text[]  default null,
    p_ops           text[]  default '{INSERT,UPDATE,DELETE}',
    p_description   text    default null
) returns integer
language plpgsql
set search_path = pg_catalog, notify
as $$
declare
    v_pk  text[];
    v_id  integer;
begin
    -- первичный ключ берём из каталога
    select array_agg(a.attname::text order by k.ord) into v_pk
    from pg_index i
    cross join lateral unnest(i.indkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
    where i.indrelid = p_table and i.indisprimary;

    if v_pk is null then
        raise exception 'notify.register: таблица % не имеет первичного ключа', p_table;
    end if;

    if p_scope_column is not null and not exists (
        select 1 from pg_attribute
        where attrelid = p_table and attname = p_scope_column and attnum > 0 and not attisdropped
    ) then
        raise exception 'notify.register: столбец % отсутствует в %', p_scope_column, p_table;
    end if;

    insert into notify.registry (table_oid, topic, pk_columns, scope_column, watch_columns, ops, description)
    values (p_table, p_topic, v_pk, p_scope_column, p_watch_columns, p_ops, p_description)
    on conflict (table_oid) do update
        set topic = excluded.topic, pk_columns = excluded.pk_columns,
            scope_column = excluded.scope_column, watch_columns = excluded.watch_columns,
            ops = excluded.ops, description = excluded.description, enabled = true
    returning id into v_id;

    execute format('drop trigger if exists notify_capture on %s', p_table);
    execute format(
        'create trigger notify_capture after insert or update or delete on %s '
        'for each row execute function notify.capture()', p_table);

    return v_id;
end;
$$;

create or replace function notify.unregister(p_table regclass)
returns void
language plpgsql
set search_path = pg_catalog, notify
as $$
begin
    execute format('drop trigger if exists notify_capture on %s', p_table);
    delete from notify.registry where table_oid = p_table;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Чтение для демона: безопасный горизонт и выборка по курсору
-- ---------------------------------------------------------------------------
-- Горизонт = xmin текущего снимка. Все транзакции с xid < горизонта завершены,
-- значит набор событий с xid < горизонта окончателен и больше не изменится.
create or replace function notify.horizon()
returns xid8
language sql stable
as $$ select pg_snapshot_xmin(pg_current_snapshot()) $$;

-- События в полуинтервале [p_from, p_to). Курсор клиента = граница горизонта.
create or replace function notify.events_between(p_from xid8, p_to xid8, p_limit integer default 10000)
returns setof notify.event
language sql stable
as $$
    select * from notify.event
    where xid >= p_from and xid < p_to
    order by xid, id
    limit p_limit
$$;

-- Самый старый ещё хранимый горизонт: если курсор клиента старше — нужен полный ресинк.
create or replace function notify.oldest_xid()
returns xid8
language sql stable
as $$ select min(xid) from notify.event $$;

-- Служебное состояние: всё, что ниже purged_below, удалено очисткой.
-- Клиент с курсором ниже этой границы получает reset (полный ресинк).
create table notify.meta (
    singleton    boolean primary key default true check (singleton),
    purged_below xid8    not null default '0'
);
insert into notify.meta default values;

-- Очистка по сроку хранения. Удаляет события целыми транзакциями (по xid),
-- чтобы граница purged_below была точной.
create or replace function notify.purge(p_keep interval default interval '24 hours')
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, notify
as $$
declare
    v_cut xid8;
    v_n   bigint;
begin
    -- первая транзакция, которую ещё надо хранить
    select min(xid) into v_cut from notify.event where ts >= now() - p_keep;
    if v_cut is null then
        v_cut := pg_snapshot_xmin(pg_current_snapshot());  -- хранить нечего
    end if;

    delete from notify.event where xid < v_cut;
    get diagnostics v_n = row_count;

    update notify.meta set purged_below = greatest(purged_below, v_cut);
    return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Подписка: что клиенту разрешено видеть в ленте (решает БД, а не PHP/демон)
-- ---------------------------------------------------------------------------
-- Вызывается pgsql.php ОТ ИМЕНИ пользователя (после SET ROLE) при выдаче токена демону.
-- Возвращает {"topic": null | ["scope", ...]}: null = все scope этого topic.
-- По умолчанию: topic разрешён, если у current_user есть SELECT на таблицу.
-- Приложение может заменить функцию (create or replace) и выдавать точные scope,
-- например список board_id, к которым у пользователя есть доступ.
create or replace function notify.claims()
returns jsonb
language sql stable
security invoker
set search_path = pg_catalog, notify
as $$
    select coalesce(jsonb_object_agg(topic, null::jsonb), '{}'::jsonb)
    from (
        select distinct r.topic
        from notify.registry r
        where r.enabled
          and has_table_privilege(current_user, r.table_oid, 'SELECT')
    ) t
$$;

-- ---------------------------------------------------------------------------
-- 7. Права
-- ---------------------------------------------------------------------------
-- Прикладные роли НЕ пишут в notify.* напрямую; события создаёт только триггер (security definer).
revoke all on all tables    in schema notify from public;
revoke all on all functions in schema notify from public;

-- Для notify.claims(): метаданные реестра (без журнала) читаемы всем.
grant usage on schema notify to public;
grant select (topic, table_oid, enabled) on notify.registry to public;
grant execute on function notify.claims() to public;

do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'notify_daemon') then
        create role notify_daemon login;   -- пароль/cert задаётся отдельно
    end if;
end $$;

grant usage  on schema notify to notify_daemon;
grant select on notify.event, notify.registry, notify.meta to notify_daemon;
grant execute on function notify.horizon(), notify.events_between(xid8, xid8, integer),
                          notify.oldest_xid(), notify.purge(interval) to notify_daemon;

commit;
