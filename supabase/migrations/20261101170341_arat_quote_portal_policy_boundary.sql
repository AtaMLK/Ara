-- Also close the old migration-set policy when installing on a fresh database.
-- Customer reads must use the projection, never internal item rows.
drop policy if exists customer_quote_items_customer_select on public.customer_quote_items;

-- Admin revision actions already authenticate the actor, but their SSR writes
-- were denied. Permit only active admins to author admin timeline events.
create policy arat_admin_timeline_insert on public.timeline_events
for insert to authenticated
with check (
  (select public.is_admin()) and actor_type = 'admin'
  and actor_user_id = (select auth.uid())
);
create policy arat_admin_notification_insert on public.notifications
for insert to authenticated
with check ((select public.is_admin()));
