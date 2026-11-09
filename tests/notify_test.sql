-- Тест схемы notify. Запуск: psql -v ON_ERROR_STOP=1 -f test_notify.sql
\set ON_ERROR_STOP 1

create schema crm;
create table crm.customer (
    id         serial primary key,
    tenant_id  int  not null,
    name       text not null,
    note       text,
    updated_at timestamptz default now()
);
create table crm.secret (id int primary key, v text);

select notify.register('crm.customer', 'crm.customer', 'tenant_id',
                       array['name','note'], p_description => 'Клиенты CRM') as reg_id;

-- регистрация таблицы без PK должна падать
create table crm.nopk (v text);
do $$ begin
    perform notify.register('crm.nopk', 'crm.nopk');
    raise exception 'должно было упасть';
exception when others then
    if sqlerrm not like '%первичного ключа%' then raise; end if;
end $$;

-- прикладная роль
create role app_user login;
grant usage on schema crm to app_user;
grant select, insert, update, delete on crm.customer to app_user;
grant usage on sequence crm.customer_id_seq to app_user;

set role app_user;
insert into crm.customer (tenant_id, name) values (1, 'Alpha'), (2, 'Beta');
update crm.customer set note = 'vip' where name = 'Alpha';
update crm.customer set updated_at = now() + interval '1 s' where name = 'Beta';  -- не watch → нет события
update crm.customer set name = name where name = 'Beta';                          -- ничего не изменилось → нет события
delete from crm.customer where name = 'Beta';

-- прямой доступ к журналу запрещён
do $$ begin
    perform 1 from notify.event;
    raise exception 'должно было упасть';
exception when insufficient_privilege then null; end $$;
do $$ begin
    insert into notify.event (registry_id, topic, table_name, op, pk) values (1,'x','x','INSERT','{}');
    raise exception 'должно было упасть';
exception when insufficient_privilege then null; end $$;

select 'claims app_user' as t, notify.claims();
reset role;

select 'events' as t, id, topic, scope, table_name, op, pk, changed_columns from notify.event order by xid, id;

do $$
declare n int;
begin
    select count(*) into n from notify.event;
    if n <> 4 then raise exception 'ожидалось 4 события, получено %', n; end if;
    perform 1 from notify.event where op='UPDATE' and changed_columns = array['note'] and pk = '{"id": 1}' and scope = '1';
    if not found then raise exception 'UPDATE-событие некорректно'; end if;
    perform 1 from notify.event where op='DELETE' and pk = '{"id": 2}' and scope = '2';
    if not found then raise exception 'DELETE-событие некорректно'; end if;
end $$;

-- горизонт и выборка
select 'horizon' as t, notify.horizon(), notify.oldest_xid();
select 'between' as t, count(*) from notify.events_between('0'::xid8, notify.horizon());

-- снятие с регистрации
select notify.unregister('crm.customer');
insert into crm.customer (tenant_id, name) values (3, 'Gamma');
do $$ begin
    if (select count(*) from notify.event) <> 0 then   -- on delete cascade удалил события
        raise exception 'после unregister события должны исчезнуть (cascade)';
    end if;
end $$;
select 'OK' as result;
