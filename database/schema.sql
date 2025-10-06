
/*
 * Dental AI Chatbot Database Schema
 * 
 * This PostgreSQL schema supports:
 * - User authentication and profile management
 * - AI chatbot conversation tracking
 * - Appointment scheduling with conflict prevention
 * - Audit trails and performance optimization
 * 
 * @version 1.0.0
 * @database PostgreSQL 12+
 * @author Dental AI Team
 */

-- ================================
-- Core User Management
-- ================================

/*
 * Users table: Core user profiles and authentication
 * 
 * Features:
 * - Secure password hashing (handled by application layer)
 * - Soft delete capability with is_active flag
 * - Comprehensive user profile information
 * - Audit trail with creation and update timestamps
 */
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,           -- Unique identifier for login
    password_hash TEXT NOT NULL,                  -- bcrypt hashed password (never store plaintext)
    name VARCHAR(255) NOT NULL,                   -- User's full name
    phone VARCHAR(20),                            -- Contact phone number (optional)
    date_of_birth DATE,                           -- Date of birth for dental records
    created_at TIMESTAMP DEFAULT NOW(),           -- Account creation timestamp
    updated_at TIMESTAMP DEFAULT NOW(),           -- Last profile update timestamp
    last_login TIMESTAMP,                         -- Most recent login time
    is_active BOOLEAN DEFAULT TRUE                -- Soft delete flag (false = deactivated)
);

-- ================================
-- Conversation Management
-- ================================

/*
 * Chat sessions: Conversation grouping and session management
 * 
 * Purpose:
 * - Group related messages into conversation sessions
 * - Track session lifecycle (start/end times)
 * - Enable conversation context and history restoration
 */
CREATE TABLE IF NOT EXISTS chat_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,  -- Owner of the session
    session_token VARCHAR(255),                              -- Client-generated session identifier
    started_at TIMESTAMP DEFAULT NOW(),                      -- Session start time
    ended_at TIMESTAMP                                       -- Session end time (NULL if active)
);

-- ================================
-- Appointment System
-- ================================

/*
 * Appointments table: Dental appointment scheduling and management
 * 
 * Features:
 * - Comprehensive appointment lifecycle tracking
 * - Conflict prevention with unique constraints
 * - Flexible appointment types and durations
 * - Cancellation tracking with reasons
 */
CREATE TABLE IF NOT EXISTS appointments (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,  -- Appointment owner (nullable for system integrity)
    scheduled_at TIMESTAMP NOT NULL,                          -- Appointment date and time
    status VARCHAR(32) DEFAULT 'pending' CHECK (              -- Appointment status with validation
        status IN ('pending', 'confirmed', 'completed', 'cancelled', 'no_show')
    ),
    appointment_type VARCHAR(100) DEFAULT 'general_checkup',  -- Type of dental service
    duration_minutes INTEGER DEFAULT 60,                     -- Appointment duration for scheduling
    notes TEXT,                                               -- Additional notes or instructions
    created_at TIMESTAMP DEFAULT NOW(),                      -- Booking creation time
    updated_at TIMESTAMP DEFAULT NOW(),                      -- Last modification time
    cancelled_at TIMESTAMP,                                  -- Cancellation timestamp (if applicable)
    cancel_reason TEXT                                       -- Reason for cancellation (if applicable)
);

-- ================================
-- Performance Optimization Indexes
-- ================================

/*
 * User table indexes
 * Optimizes authentication queries and user lookups
 */
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
COMMENT ON INDEX idx_users_email IS 'Fast login and email uniqueness validation';

CREATE INDEX IF NOT EXISTS idx_users_active ON users (is_active) WHERE is_active = TRUE;
COMMENT ON INDEX idx_users_active IS 'Partial index for active user queries (excludes deactivated accounts)';

CREATE INDEX IF NOT EXISTS idx_users_last_login ON users (last_login DESC) WHERE last_login IS NOT NULL;
COMMENT ON INDEX idx_users_last_login IS 'Recent activity tracking and analytics';

/*
 * Appointment table indexes
 * Optimizes scheduling queries, conflict detection, and reporting
 */
CREATE INDEX IF NOT EXISTS idx_appts_user_time ON appointments (user_id, scheduled_at);
COMMENT ON INDEX idx_appts_user_time IS 'User appointment history and upcoming appointments';

CREATE INDEX IF NOT EXISTS idx_appts_status_time ON appointments (status, scheduled_at);
COMMENT ON INDEX idx_appts_status_time IS 'Status-based appointment filtering and reporting';

CREATE INDEX IF NOT EXISTS idx_appts_scheduled_at ON appointments (scheduled_at);
COMMENT ON INDEX idx_appts_scheduled_at IS 'Time-based appointment queries and calendar views';

CREATE INDEX IF NOT EXISTS idx_appts_type_status ON appointments (appointment_type, status);
COMMENT ON INDEX idx_appts_type_status IS 'Appointment analytics by type and status';

/*
 * Chat session indexes
 * Optimizes conversation retrieval and session management
 */
CREATE INDEX IF NOT EXISTS idx_chats_user ON chat_sessions (user_id);
COMMENT ON INDEX idx_chats_user IS 'User conversation history lookup';

CREATE INDEX IF NOT EXISTS idx_chats_token ON chat_sessions (session_token);
COMMENT ON INDEX idx_chats_token IS 'Fast session token validation and retrieval';

CREATE INDEX IF NOT EXISTS idx_chats_started_at ON chat_sessions (started_at DESC);
COMMENT ON INDEX idx_chats_started_at IS 'Recent session activity and cleanup queries';

-- ================================
-- Business Logic Constraints
-- ================================

/*
 * Prevent appointment double-booking
 * Ensures only one confirmed appointment per time slot across all users
 */
CREATE UNIQUE INDEX IF NOT EXISTS uniq_confirmed_appointments 
ON appointments (scheduled_at) 
WHERE status = 'confirmed';
COMMENT ON INDEX uniq_confirmed_appointments IS 'Prevents double-booking of confirmed appointment slots';

/*
 * Ensure unique active sessions per user
 * Prevents multiple active sessions for the same user
 */
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_user_session
ON chat_sessions (user_id)
WHERE ended_at IS NULL;
COMMENT ON INDEX uniq_active_user_session IS 'One active chat session per user (ended_at IS NULL)';

-- ================================
-- Database Functions and Triggers
-- ================================

/*
 * Automatic timestamp update function
 * Updates the updated_at column whenever a record is modified
 */
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
COMMENT ON FUNCTION update_updated_at() IS 'Automatically updates updated_at timestamp on record modification';

/*
 * Apply automatic timestamp updates to relevant tables
 */
CREATE TRIGGER users_updated_at 
    BEFORE UPDATE ON users 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at();
COMMENT ON TRIGGER users_updated_at ON users IS 'Auto-update users.updated_at on record changes';

CREATE TRIGGER appointments_updated_at 
    BEFORE UPDATE ON appointments 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at();
COMMENT ON TRIGGER appointments_updated_at ON appointments IS 'Auto-update appointments.updated_at on record changes';

-- ================================
-- Chat Message Storage
-- ================================

/*
 * Chat messages: Conversation history and AI interaction logs
 * 
 * Purpose:
 * - Store complete conversation transcripts
 * - Track AI model responses and metadata
 * - Enable conversation replay and analytics
 * - Support debugging and model improvement
 */
CREATE TABLE IF NOT EXISTS chat_messages (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,  -- Message owner
    session_token VARCHAR(255) NOT NULL,                     -- Links to chat session
    role VARCHAR(32) NOT NULL CHECK (                        -- Message source validation
        role IN ('user', 'assistant', 'system')
    ),
    content TEXT NOT NULL,                                   -- Message text content
    meta JSONB,                                              -- Structured metadata (appointments, intent, etc.)
    created_at TIMESTAMP DEFAULT NOW()                       -- Message timestamp
);
COMMENT ON TABLE chat_messages IS 'Complete conversation history with AI interaction metadata';
COMMENT ON COLUMN chat_messages.role IS 'Message source: user (human), assistant (AI), system (automated)';
COMMENT ON COLUMN chat_messages.meta IS 'JSON metadata: appointment_candidate, intent, confidence, etc.';

/*
 * Chat message indexes
 * Optimizes conversation retrieval and analytics queries
 */
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_time
ON chat_messages (session_token, created_at DESC);
COMMENT ON INDEX idx_chat_messages_session_time IS 'Fast conversation history retrieval in chronological order';

CREATE INDEX IF NOT EXISTS idx_chat_messages_user_time
ON chat_messages (user_id, created_at DESC);
COMMENT ON INDEX idx_chat_messages_user_time IS 'User conversation history across all sessions';

CREATE INDEX IF NOT EXISTS idx_chat_messages_role
ON chat_messages (role, created_at DESC);
COMMENT ON INDEX idx_chat_messages_role IS 'Analytics queries by message source (user/assistant/system)';

-- JSONB indexes for metadata queries
CREATE INDEX IF NOT EXISTS idx_chat_messages_meta_appointment
ON chat_messages USING GIN ((meta->'appointment_candidate'));
COMMENT ON INDEX idx_chat_messages_meta_appointment IS 'Fast lookup of messages with appointment proposals';

CREATE INDEX IF NOT EXISTS idx_chat_messages_meta_intent
ON chat_messages USING GIN ((meta->'intent'));
COMMENT ON INDEX idx_chat_messages_meta_intent IS 'Analytics on conversation intents (chat, propose, confirm, etc.)';

-- ================================
-- Sample Data for Development & Testing
-- ================================

/*
 * Sample users for development and testing
 * Note: In production, users should register through the application
 * Password: 'demo123' (hashed using bcrypt)
 */
INSERT INTO users (email, password_hash, name, phone, date_of_birth, created_at) VALUES
('alice@example.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewKyNiD.a.E.gbBK', 'Alice Johnson', '(555) 123-4567', '1985-03-15', NOW() - INTERVAL '30 days'),
('bob@example.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewKyNiD.a.E.gbBK', 'Bob Smith', '(555) 987-6543', '1990-07-22', NOW() - INTERVAL '15 days'),
('carol@example.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewKyNiD.a.E.gbBK', 'Carol Davis', '(555) 456-7890', '1988-11-08', NOW() - INTERVAL '7 days')
ON CONFLICT (email) DO NOTHING;

/*
 * Sample appointments for testing scheduling features
 */
INSERT INTO appointments (user_id, scheduled_at, status, appointment_type, duration_minutes, notes) VALUES
(1, NOW() + INTERVAL '7 days' + INTERVAL '10 hours', 'confirmed', 'general_checkup', 60, 'Regular 6-month checkup and cleaning'),
(2, NOW() + INTERVAL '14 days' + INTERVAL '14 hours', 'confirmed', 'dental_cleaning', 45, 'Professional teeth cleaning'),
(1, NOW() + INTERVAL '21 days' + INTERVAL '9 hours', 'pending', 'consultation', 30, 'Initial consultation for dental work')
ON CONFLICT DO NOTHING;

/*
 * Sample chat sessions for conversation testing
 */
INSERT INTO chat_sessions (user_id, session_token, started_at) VALUES
(1, 'demo-session-alice-001', NOW() - INTERVAL '2 hours'),
(2, 'demo-session-bob-001', NOW() - INTERVAL '1 hour')
ON CONFLICT DO NOTHING;

/*
 * Sample chat messages for conversation history testing
 */
INSERT INTO chat_messages (user_id, session_token, role, content, meta, created_at) VALUES
(1, 'demo-session-alice-001', 'user', 'Hi, I need to schedule a dental cleaning', '{}', NOW() - INTERVAL '2 hours'),
(1, 'demo-session-alice-001', 'assistant', 'I''d be happy to help you schedule a dental cleaning. What day and time works best for you?', '{"intent": "chat"}', NOW() - INTERVAL '2 hours' + INTERVAL '5 seconds'),
(1, 'demo-session-alice-001', 'user', 'How about next Monday at 2pm?', '{}', NOW() - INTERVAL '2 hours' + INTERVAL '30 seconds'),
(1, 'demo-session-alice-001', 'assistant', 'Perfect! I can schedule you for Monday at 2:00 PM. Would you like me to confirm this appointment?', '{"intent": "propose", "appointment_candidate": "2024-01-15T14:00:00", "needs_confirmation": true}', NOW() - INTERVAL '2 hours' + INTERVAL '35 seconds')
ON CONFLICT DO NOTHING;

-- ================================
-- Database Maintenance Views
-- ================================

/*
 * Useful views for monitoring and analytics
 */

-- Active appointments view
CREATE OR REPLACE VIEW active_appointments AS
SELECT 
    a.id,
    u.name as user_name,
    u.email as user_email,
    a.scheduled_at,
    a.status,
    a.appointment_type,
    a.duration_minutes,
    a.notes
FROM appointments a
JOIN users u ON a.user_id = u.id
WHERE a.scheduled_at > NOW() AND a.status IN ('confirmed', 'pending')
ORDER BY a.scheduled_at;

-- Conversation analytics view
CREATE OR REPLACE VIEW conversation_stats AS
SELECT 
    DATE(created_at) as date,
    COUNT(*) as total_messages,
    COUNT(CASE WHEN role = 'user' THEN 1 END) as user_messages,
    COUNT(CASE WHEN role = 'assistant' THEN 1 END) as assistant_messages,
    COUNT(CASE WHEN meta->>'intent' = 'propose' THEN 1 END) as appointment_proposals,
    COUNT(CASE WHEN meta->>'intent' = 'confirm' THEN 1 END) as appointment_confirmations
FROM chat_messages
GROUP BY DATE(created_at)
ORDER BY date DESC;

COMMENT ON VIEW active_appointments IS 'Current and upcoming appointments with user details';
COMMENT ON VIEW conversation_stats IS 'Daily conversation metrics and appointment booking analytics';
