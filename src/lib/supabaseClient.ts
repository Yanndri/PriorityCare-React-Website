import { createClient } from '@supabase/supabase-js'

// These values come from your React project's .env.local file.
// Example:
// VITE_SUPABASE_URL=https://your-project.supabase.co
// VITE_SUPABASE_ANON_KEY=your-publishable-key
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Missing Supabase environment variables. The app will use fallback sample data.')
}

export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '')
