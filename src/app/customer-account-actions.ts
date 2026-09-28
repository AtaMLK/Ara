'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/lib/ai/guards';
import { ToolError } from '@/lib/errors';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

const createSchema = z
  .object({
    email: z.string().trim().email().max(320),
    password: z.string().min(8).max(128),
    name: z.string().trim().min(1).max(160),
    customerType: z.enum(['company', 'individual']),
    companyName: z.string().trim().max(200).optional(),
    country: z.string().trim().min(1).max(120),
    phone: z.string().trim().max(80).optional(),
    address: z.string().trim().max(500).optional(),
    taxRegistration: z.string().trim().max(160).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.customerType === 'company' && !value.companyName?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['companyName'],
        message: 'Company name is required for company customers',
      });
    }
  });

const passwordSchema = z.object({
  customerId: z.string().uuid(),
  password: z.string().min(8).max(128),
});

function fail(error: unknown): never {
  if (error instanceof ToolError) throw new Error(error.message);
  if (error instanceof z.ZodError) throw new Error('Invalid input');
  throw error instanceof Error ? error : new Error('Action failed');
}

export async function createCustomerAccountAction(input: {
  email: string;
  password: string;
  name: string;
  customerType: 'company' | 'individual';
  companyName?: string;
  country: string;
  phone?: string;
  address?: string;
  taxRegistration?: string;
  notes?: string;
}) {
  try {
    const parsed = createSchema.parse(input);
    const { user: adminUser } = await requireAdmin();
    const supabase = createSupabaseAdminClient();

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: parsed.email,
      password: parsed.password,
      email_confirm: true,
      user_metadata: {
        account_type: 'customer',
        created_by_admin: adminUser.id,
      },
    });

    if (authError || !authData.user) {
      throw new ToolError('CONFLICT', authError?.message ?? 'Could not create customer login');
    }

    const userId = authData.user.id;
    const customerCode = `CUS-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    try {
      const { error: profileError } = await supabase.from('profiles').insert({
        user_id: userId,
        role: 'customer',
        status: 'active',
      });

      if (profileError) {
        throw new ToolError('CONFLICT', `Customer profile could not be created: ${profileError.message}`);
      }

      const { data: customer, error: customerError } = await supabase
        .from('customers')
        .insert({
          user_id: userId,
          customer_code: customerCode,
          name: parsed.name,
          company_name: parsed.companyName || null,
          customer_type: 'company',
          email: parsed.email,
          status: 'active',
        })
        .select('id,customer_code')
        .single();

      if (customerError || !customer) {
        throw new ToolError('CONFLICT', `Customer record could not be created: ${customerError?.message ?? 'unknown error'}`);
      }

      revalidatePath('/customers');
      return { ok: true, customerId: customer.id, customerCode: customer.customer_code };
    } catch (error) {
      await supabase.auth.admin.deleteUser(userId);
      throw error;
    }
  } catch (error) {
    fail(error);
  }
}

export async function changeCustomerPasswordAction(input: {
  customerId: string;
  password: string;
}) {
  try {
    const parsed = passwordSchema.parse(input);
    await requireAdmin();
    const supabase = createSupabaseAdminClient();

    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id,user_id')
      .eq('id', parsed.customerId)
      .single();

    if (customerError || !customer?.user_id) {
      throw new ToolError('NOT_FOUND', 'Customer account not found');
    }

    const { error } = await supabase.auth.admin.updateUserById(customer.user_id, {
      password: parsed.password,
    });

    if (error) throw new ToolError('CONFLICT', error.message);

    revalidatePath('/customers');
    return { ok: true };
  } catch (error) {
    fail(error);
  }
}
