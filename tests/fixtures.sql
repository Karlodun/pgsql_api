-- Test fixture: a tiny CRM table with RLS per tenant, two users, custom claims.
\set ON_ERROR_STOP 1

create schema crm;
create table crm.customer (
    id        serial primary key,
    tenant_id int  not null,
    name      text not null,
    note      text
);
create table crm.tenant_member (role name, tenant_id int, primary key (role, tenant_id));

alter table crm.customer enable row level security;
create policy tenant_rw on crm.customer
    using      (tenant_id in (select tenant_id from crm.tenant_member where role = current_user))
    with check (tenant_id in (select tenant_id from crm.tenant_member where role = current_user));

create role crm_user nologin;
grant usage on schema crm to crm_user;
grant select, insert, update, delete on crm.customer to crm_user;
grant select on crm.tenant_member to crm_user;
grant usage on sequence crm.customer_id_seq to crm_user;

create role alice login password 'alice' in role crm_user;
create role bob   login password 'bob'   in role crm_user;
create role crm_readonly nologin;
grant crm_readonly to alice;

insert into crm.tenant_member values ('alice', 1), ('bob', 2);

select notify.register('crm.customer', 'crm.customer', 'tenant_id', array['name', 'note']);

-- Application-specific claims: a user sees crm.customer events only for his tenants.
create or replace function notify.claims()
returns jsonb
language sql stable
security invoker
set search_path = pg_catalog, notify
as $$
    select jsonb_build_object(
        'crm.customer',
        coalesce((select jsonb_agg(tenant_id::text) from crm.tenant_member where role = session_user), '[]'::jsonb)
    )
$$;
