import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const supabase = supabaseUrl ? createClient(supabaseUrl, supabaseAnonKey) : null;

export const FOXY_TUTOR_URL = process.env.NEXT_PUBLIC_FOXY_TUTOR_URL || '';
