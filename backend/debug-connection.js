import pkg from 'pg'
const { Client } = pkg

async function debugConnection() {
  console.log('🔍 Testing PostgreSQL connection with debug info...');
  
  const client = new Client({
    user: 'postgres',
    host: 'localhost',
    database: 'dental',
    password: 'postgres',
    port: 5432,
  });

  try {
    console.log('📞 Attempting to connect...');
    await client.connect();
    console.log('✅ Connected successfully!');
    
    const result = await client.query('SELECT NOW() as time, version()');
    console.log('⏰ Current time:', result.rows[0].time);
    console.log('🐘 PostgreSQL version:', result.rows[0].version);
    
    // Test our schema
    console.log('\n📋 Testing database schema...');
    const tables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    console.log('Tables found:', tables.rows.map(r => r.table_name));
    
    // Check users table
    const userCount = await client.query('SELECT COUNT(*) as count FROM users');
    console.log('👥 Users in database:', userCount.rows[0].count);
    
    await client.end();
    console.log('✅ All tests passed!');
  } catch (error) {
    console.error('❌ Connection failed:', error.message);
    console.error('Error code:', error.code);
    console.error('Error detail:', error.detail);
    console.error('Full error:', error);
  }
}

debugConnection();