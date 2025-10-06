
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    date_of_birth DATE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    last_login TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS chat_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    session_token VARCHAR(255),
    started_at TIMESTAMP DEFAULT NOW(),
    ended_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS appointments (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    scheduled_at TIMESTAMP NOT NULL,
    status VARCHAR(32) DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled', 'no_show')),
    appointment_type VARCHAR(100) DEFAULT 'general_checkup',
    duration_minutes INTEGER DEFAULT 60,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    cancelled_at TIMESTAMP,
    cancel_reason TEXT
);

-- User table indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_active ON users (is_active) WHERE is_active = TRUE;

-- Appointment table indexes
CREATE INDEX IF NOT EXISTS idx_appts_user_time ON appointments (user_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_appts_status_time ON appointments (status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_appts_scheduled_at ON appointments (scheduled_at);

-- Chat session indexes
CREATE INDEX IF NOT EXISTS idx_chats_user ON chat_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_chats_token ON chat_sessions (session_token);

-- Prevent double-booking (unique constraint on confirmed appointments)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_confirmed_appointments 
ON appointments (scheduled_at) 
WHERE status = 'confirmed';

-- Auto-update timestamps
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at 
    BEFORE UPDATE ON users 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER appointments_updated_at 
    BEFORE UPDATE ON appointments 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at();

-- Chat messages table (from chat_logs.sql)
CREATE TABLE IF NOT EXISTS chat_messages (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  session_token VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL,               -- 'user' | 'assistant' | 'system'
  content TEXT NOT NULL,
  meta JSONB,                               -- optional data (e.g., {appointment_candidate, intent})
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session_time
  ON chat_messages (session_token, created_at DESC);

-- Sample users
INSERT INTO users (email, password_hash, name) VALUES
('alice@example.com', 'hash_demo', 'Alice'),
('bob@example.com', 'hash_demo', 'Bob')
ON CONFLICT (email) DO NOTHING;
