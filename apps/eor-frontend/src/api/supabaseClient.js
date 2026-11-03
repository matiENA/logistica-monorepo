import { createClient } from '@supabase/supabase-js';

// En eor_v1 las credenciales NO tienen fallback hardcodeado: se exigen por entorno
// (.env raiz en local / variables de build en Render Static Site).
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://rsvajuxihvmpmrmlcbul.supabase.co';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY || 'sb_publishable_n97mVkSclRpuv_OsseO3gg_BjR9QT3R';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  db: {
    schema: 'public',
  },
});
