import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://msphoxijyywdvsbipyqj.supabase.co';
const supabaseAnonKey =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zcGhveGlqeXl3ZHZzYmlweXFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNTM0NzUsImV4cCI6MjA4ODYyOTQ3NX0.phTJCsCPYW1RCtBTZvJSHeyJHeMQQKW_LDb8aQuoy6I';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
