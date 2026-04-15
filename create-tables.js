// Create Supabase tables via direct PostgreSQL connection
const { Client } = require('/usr/lib/node_modules/pg');

async function setup() {
  // Supabase project: sedtcjccbloolchbzndj
  // Direct connection to Postgres
  const client = new Client({
    host: 'db.sedtcjccbloolchbzndj.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: process.env.SUPABASE_DB_PASS || 'Ortoo2026!khaan',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('Connected to Supabase PostgreSQL');
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS ortoo_api_keys (
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
    `);
    
    console.log('✅ Tables created!');
    
    // Enable RLS but allow service role
    await client.query(`
      ALTER TABLE ortoo_api_keys ENABLE ROW LEVEL SECURITY;
      ALTER TABLE ortoo_webhook_logs ENABLE ROW LEVEL SECURITY;
      
      DO $$ BEGIN
        CREATE POLICY "Service full access" ON ortoo_api_keys FOR ALL USING (true) WITH CHECK (true);
        CREATE POLICY "Service full access" ON ortoo_webhook_logs FOR ALL USING (true) WITH CHECK (true);
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    
    console.log('✅ RLS configured!');
    await client.end();
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

setup();
