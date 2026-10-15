-- Customer-facing item facts are independent of optional supplier catalog links.
alter table public.customer_quote_items
  add column description text,
  add column model text,
  add column brand text,
  add column delivery_text text;

-- Repair labels only where one customer item makes the association unambiguous.
-- Keep sent references, commercial amounts and communications unchanged.
update public.customer_quote_items qi set
  description=coalesce(qi.description,i.normalized_information#>>'{intake,items,0,product}'),
  model=coalesce(qi.model,i.normalized_information#>>'{intake,items,0,model}'),
  brand=coalesce(qi.brand,i.normalized_information#>>'{intake,items,0,brand}'),
  delivery_text=coalesce(qi.delivery_text,qi.price_calculation->>'customer_delivery')
from public.customer_quotes q join public.inquiries i on i.id=q.inquiry_id
where qi.customer_quote_id=q.id and jsonb_array_length(coalesce(i.normalized_information#>'{intake,items}','[]'::jsonb))=1;
