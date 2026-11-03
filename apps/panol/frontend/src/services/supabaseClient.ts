// ==============================================================
// 🐘 CLIENTE DIRECTO DE SUPABASE (REACT / VITE)
// ==============================================================

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://rsvajuxihvmpmrmlcbul.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_n97mVkSclRpuv_OsseO3gg_BjR9QT3R';

/**
 * Cliente Supabase principal apuntando al esquema 'panol'
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  db: {
    schema: 'panol',
  },
});

/**
 * Cliente Supabase para consultas al esquema 'public' (ej: tractores, semis, unidades)
 */
export const supabasePublic = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
