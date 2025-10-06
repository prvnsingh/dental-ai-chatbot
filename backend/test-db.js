import 'dotenv/config';
import { query } from './db.js';

async function testDatabase() {
  try {
    // Test connection
    const result = await query('SELECT NOW() as current_time');
    console.log('✅ Database connection successful!');
    console.log('Current time:', result.rows[0].current_time);
    
    // Check tables
    const tables = await query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    console.log('📋 Available tables:', tables.rows.map(r => r.table_name));
    
    // Check users table
    const userCount = await query('SELECT COUNT(*) as count FROM users');
    console.log('👥 Users in database:', userCount.rows[0].count);
    
    process.exit(0);
  } catch (e) {
    console.error('❌ Database error:', e.message);
    process.exit(1);
  }
}

testDatabase();