// Create Supabase tables for ӨРТӨӨ API
require('dotenv').config({ path: '/tmp/ortoo/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://sedtcjccbloolchbzndj.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNlZHRjamNjYmxvb2xjaGJ6bmRqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjExMzQ0MCwiZXhwIjoyMDkxNjg5NDQwfQ.bca34Jq2syNqmicKAbk8u87Otnkm1uE3eN6cQFZl2mM'
);

async function setup() {
  // Test insert to create table (Supabase auto-creates if RLS allows)
  // We need to use the SQL editor approach via raw query
  // Let's try inserting a test key — if table doesn't exist, we need dashboard
  
  const { data, error } = await supabase.from('ortoo_api_keys').insert({
    key: 'ort_test_setup_key',
    tier: 'free',
    requests: 0,
    reset_date: new Date().toISOString().slice(0,10)
  }).select();
  
  if (error) {
    console.log('Table does not exist. Creating via SQL...');
    console.log('Please run this SQL in Supabase Dashboard > SQL Editor:\n');
    console.log(`CREATE TABLE IF NOT EXISTS ortoo_api_keys (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  tier TEXT DEFAULT 'free',
  requests INT DEFAULT 0,
  reset_date TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  name TEXT,
  email TEXT,
  webhook_url TEXT
);

CREATE TABLE IF NOT EXISTS ortoo_webhook_logs (
  id SERIAL PRIMARY KEY,
  api_key_id INT REFERENCES ortoo_api_keys(id),
  event TEXT,
  payload JSONB,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  status INT
);

ALTER TABLE ortoo_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE ortoo_webhook_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can do everything" ON ortoo_api_keys FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role can do everything" ON ortoo_webhook_logs FOR ALL USING (true) WITH CHECK (true);`);
    process.exit(1);
  }
  
  // Clean up test key
  await supabase.from('ortoo_api_keys').delete().eq('key', 'ort_test_setup_key');
  console.log('✅ Tables exist and working!');
  process.exit(0);
}

setup();
