import { z } from 'zod';

export const customerQuoteItemsSchema = z.array(z.object({
  id: z.string().uuid(),
  quantity: z.number().positive().finite(),
  unit_price: z.number().nonnegative().finite().nullable(),
  total: z.number().nonnegative().finite().nullable(),
  description: z.string(),
  model: z.string().nullable(),
  brand: z.string().nullable(),
  delivery_text: z.string().nullable(),
}));
