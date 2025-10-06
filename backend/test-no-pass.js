import pkg from 'pg'
const { Pool } = pkg

async function testNoPassword() {
  const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'dental',
    port: 5432,
    // No password
  });

  try {
    const client = await pool.connect();
    console.log('✅ Connection without password successful!');
    
    const result = await client.query('SELECT NOW() as current_time, version()');
    console.log('Current time:', result.rows[0].current_time);
    console.log('PostgreSQL version:', result.rows[0].version);
    
    client.release();
    await pool.end();
  } catch (error) {
    console.error('❌ No password connection error:', error.message);
  }
}

testNoPassword();