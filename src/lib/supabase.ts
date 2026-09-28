import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  throw new Error('Mangler VITE_SUPABASE_URL eller VITE_SUPABASE_ANON_KEY — se .env.example');
}

export const supabaseUrl = url;
export const supabase = createClient(url, anonKey);
