/**
 * Dental AI Chatbot - Backend API Server
 * 
 * This Express.js server provides:
 * - JWT-based authentication with secure password handling
 * - Chatbot message processing via Python service integration
 * - Appointment booking with conflict detection
 * - Session management and message history
 * - Rate limiting and security middleware
 * 
 * @version 1.0.0
 * @author Dental AI Team
 */

// Load environment variables first
import 'dotenv/config'

// Core Express and middleware imports
import cors from 'cors'
import express from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import jwt from 'jsonwebtoken'
import morgan from 'morgan'

// Database and authentication imports
import {
  authenticateUser,
  AuthError,
  authMiddleware,
  changePassword,
  createUser,
  generateToken,
  getUserById,
  updateUser
} from './auth.js'
import { query } from './db.js'

// Application configuration
const app = express()
const PORT = process.env.PORT || 8000
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret'
const PY_SERVICE_URL = process.env.PY_SERVICE_URL || 'http://localhost:8001'

// ================================
// Middleware Configuration
// ================================

// Security: Add security headers and prevent common attacks
app.use(helmet())

// CORS: Allow cross-origin requests from frontend
app.use(cors())

// Body parsing: Enable JSON request body parsing
app.use(express.json())

// Logging: HTTP request logging for development/debugging
app.use(morgan('dev'))

// Rate limiting: Prevent abuse with 60 requests per minute per IP
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 60,             // Maximum 60 requests per window
  message: { error: 'Too many requests, please try again later' }
})
app.use(limiter)

// ================================
// Database Helper Functions
// ================================
/**
 * Creates or updates a demo user for legacy token support
 * @param {string} sub - User identifier (legacy format)
 * @returns {Promise<number>} User ID
 */
async function upsertUser(sub) {
  const email = `${sub}@demo.local`
  const name = 'Demo User'

  try {
    const res = await query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'hash_demo', $2)
       ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name
       RETURNING id`,
      [email, name]
    )
    return res.rows[0].id
  } catch (error) {
    console.error('Failed to upsert user:', error)
    throw error
  }
}

/**
 * Ensures a chat session exists for the user and returns session ID
 * @param {number} userId - Database user ID
 * @param {string} sessionToken - Session token from client
 * @returns {Promise<number|null>} Session ID or null if no token provided
 */
async function ensureSession(userId, sessionToken) {
  if (!sessionToken) return null

  try {
    // Check if session already exists
    const found = await query(
      'SELECT id FROM chat_sessions WHERE session_token = $1',
      [sessionToken]
    )

    if (found.rowCount > 0) {
      return found.rows[0].id
    }

    // Create new session
    const ins = await query(
      'INSERT INTO chat_sessions (user_id, session_token) VALUES ($1, $2) RETURNING id',
      [userId, sessionToken]
    )
    return ins.rows[0].id
  } catch (error) {
    console.error('Failed to ensure session:', error)
    throw error
  }
}

/**
 * Logs a chat message to the database for conversation history
 * @param {Object} params - Message parameters
 * @param {number} params.userId - Database user ID
 * @param {string} params.sessionToken - Session token
 * @param {string} params.role - Message role ('user', 'assistant', 'system')
 * @param {string} params.content - Message content
 * @param {Object} params.meta - Optional metadata (appointment info, etc.)
 */
async function logMessage({ userId, sessionToken, role, content, meta = {} }) {
  try {
    await query(
      `INSERT INTO chat_messages (user_id, session_token, role, content, meta)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, sessionToken, role, content, meta]
    )
  } catch (error) {
    console.error('Failed to log message:', error)
    // Don't throw - message logging shouldn't break the main flow
  }
}

// ================================
// Health Check Endpoints
// ================================

/**
 * Backend service health check
 * Used for monitoring, load balancer health checks, and service discovery
 */
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'backend',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  })
})

/**
 * Python microservice health check (dependency health)
 * Verifies that the LangChain/AI service is available and responsive
 */
app.get('/health/python', async (_req, res) => {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 second timeout

    const response = await fetch(`${PY_SERVICE_URL}/health`, {
      signal: controller.signal
    })
    clearTimeout(timeoutId)

    const data = await response.json()
    return res.json({
      status: data.status || 'unknown',
      service: 'python_service',
      url: PY_SERVICE_URL
    })
  } catch (error) {
    console.error('Python service health check failed:', error.message)
    return res.status(503).json({
      status: 'down',
      service: 'python_service',
      error: 'Service unavailable'
    })
  }
})

/* ---------- Authentication Routes ---------- */
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name, phone, dateOfBirth } = req.body

    // Validation
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' })
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' })
    }

    const user = await createUser({ email, password, name, phone, dateOfBirth })
    const token = generateToken({ sub: user.id, email: user.email, role: 'user' })

    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        created_at: user.created_at
      },
      token,
      expires_in: '24h'
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return res.status(error.statusCode).json({ error: error.message })
    }
    console.error('Registration error:', error)
    res.status(500).json({ error: 'Registration failed' })
  }
})

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' })
    }

    const user = await authenticateUser(email, password)
    const token = generateToken({ sub: user.id, email: user.email, role: 'user' })

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        is_active: user.is_active
      },
      token,
      expires_in: '24h'
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return res.status(error.statusCode).json({ error: error.message })
    }
    console.error('Login error:', error)
    res.status(500).json({ error: 'Login failed' })
  }
})

app.get('/api/auth/profile', authMiddleware, async (req, res) => {
  try {
    const user = await getUserById(req.user.sub)
    res.json({ user })
  } catch (error) {
    if (error instanceof AuthError) {
      return res.status(error.statusCode).json({ error: error.message })
    }
    console.error('Profile error:', error)
    res.status(500).json({ error: 'Failed to get profile' })
  }
})

app.put('/api/auth/profile', authMiddleware, async (req, res) => {
  try {
    const { name, phone, dateOfBirth } = req.body
    const updates = { name, phone, date_of_birth: dateOfBirth }

    const user = await updateUser(req.user.sub, updates)
    res.json({ user })
  } catch (error) {
    if (error instanceof AuthError) {
      return res.status(error.statusCode).json({ error: error.message })
    }
    console.error('Profile update error:', error)
    res.status(500).json({ error: 'Failed to update profile' })
  }
})

app.post('/api/auth/change-password', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new passwords are required' })
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' })
    }

    await changePassword(req.user.sub, currentPassword, newPassword)
    res.json({ message: 'Password changed successfully' })
  } catch (error) {
    if (error instanceof AuthError) {
      return res.status(error.statusCode).json({ error: error.message })
    }
    console.error('Password change error:', error)
    res.status(500).json({ error: 'Failed to change password' })
  }
})

// ================================
// Legacy Demo Token Endpoint
// ================================

/**
 * Legacy token endpoint for demo/testing purposes only
 * Creates a short-lived token without requiring registration
 * @deprecated Use /api/auth/register and /api/auth/login for production
 */
app.post('/api/chatbot/token', async (_req, res) => {
  const payload = { sub: 'user_1', role: 'user' }
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '5m' })

  try {
    await upsertUser(payload.sub)
  } catch (error) {
    console.warn('Upsert user failed:', error?.message)
  }

  res.json({
    token,
    expires_in: 300,
    warning: 'This is a demo token. Use /api/auth/register for production.'
  })
})

/**
 * Legacy authentication middleware for backward compatibility
 * @deprecated Use authMiddleware from auth.js for new endpoints
 */
function legacyAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token) {
    return res.status(401).json({ error: 'Missing authorization token' })
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    req.user = decoded
    next()
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}

// ================================
// Chat & Messaging Endpoints
// ================================

/**
 * Process chat message through Python AI service
 * Handles conversation flow, appointment extraction, and response generation
 */
app.post('/api/chatbot/message', legacyAuth, async (req, res) => {
  try {
    const { message, session_id } = req.body || {}

    // Validate required fields
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Message is required and must be a non-empty string' })
    }

    // Get or create user and session
    const userId = await upsertUser(req.user?.sub || 'user_1')
    await ensureSession(userId, session_id)

    // Log user input for conversation history
    await logMessage({
      userId,
      sessionToken: session_id,
      role: 'user',
      content: message.trim()
    })

    // Forward message to Python AI service
    const pythonResponse = await fetch(`${PY_SERVICE_URL}/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: message.trim(),
        user_id: req.user?.sub || 'user_1',
        session_id
      })
    })

    if (!pythonResponse.ok) {
      throw new Error(`Python service returned ${pythonResponse.status}`)
    }

    const data = await pythonResponse.json()

    // Extract assistant response and metadata
    const assistantReply = data?.reply || data?.data?.reply || 'I apologize, I could not process that request.'
    const appointmentCandidate = data?.appointment_candidate || data?.data?.appointment_candidate
    const intent = data?.intent || data?.data?.intent || 'chat'
    const needsConfirmation = data?.needs_confirmation ?? data?.data?.needs_confirmation ?? false

    // Log assistant response for conversation history
    await logMessage({
      userId,
      sessionToken: session_id,
      role: 'assistant',
      content: assistantReply,
      meta: appointmentCandidate ? {
        appointment_candidate: appointmentCandidate,
        intent,
        needs_confirmation: needsConfirmation
      } : { intent }
    })

    return res.json({ ok: true, data })

  } catch (error) {
    console.error('Chat message processing error:', error)
    return res.status(500).json({
      error: 'Failed to process message',
      message: 'Unable to reach AI service. Please try again later.'
    })
  }
})

// ================================
// Appointment Management Endpoints  
// ================================

/**
 * Confirm or decline a proposed appointment
 * Handles conflict detection and database persistence
 */
app.post('/api/chatbot/confirm', legacyAuth, async (req, res) => {
  try {
    const { session_id, scheduled_at, confirm } = req.body || {}

    // Validate required fields
    if (!session_id || !scheduled_at) {
      return res.status(400).json({
        ok: false,
        error: 'bad_request',
        message: 'Both session_id and scheduled_at are required'
      })
    }

    // Validate appointment time format (ISO8601)
    const appointmentTime = new Date(scheduled_at)
    if (isNaN(appointmentTime.getTime())) {
      return res.status(400).json({
        ok: false,
        error: 'bad_request',
        message: 'scheduled_at must be a valid ISO8601 datetime string'
      })
    }

    // Validate appointment is in the future
    if (appointmentTime <= new Date()) {
      return res.status(400).json({
        ok: false,
        error: 'bad_request',
        message: 'Appointment time must be in the future'
      })
    }

    // Get or create user and session
    const userId = await upsertUser(req.user?.sub || 'user_1')
    await ensureSession(userId, session_id)

    // Handle decline case
    if (!confirm) {
      await logMessage({
        userId,
        sessionToken: session_id,
        role: 'assistant',
        content: 'Appointment declined. Please let me know when you\'d like to schedule instead.',
        meta: { action: 'declined', proposed_time: scheduled_at }
      })
      return res.json({ ok: true, status: 'declined' })
    }

    // Check for scheduling conflicts (prevent double-booking)
    const conflictCheck = await query(
      `SELECT id, user_id FROM appointments
       WHERE scheduled_at = $1 AND status = 'confirmed'
       LIMIT 1`,
      [scheduled_at]
    )

    if (conflictCheck.rowCount > 0) {
      return res.status(409).json({
        ok: false,
        error: 'conflict',
        message: 'That time slot is already booked. Please select a different time.'
      })
    }

    // Create confirmed appointment
    const appointmentResult = await query(
      `INSERT INTO appointments (user_id, scheduled_at, status, notes)
       VALUES ($1, $2, 'confirmed', 'Booked via AI chatbot')
       RETURNING id, scheduled_at, status, created_at`,
      [userId, scheduled_at]
    )

    const appointment = appointmentResult.rows[0]

    // Log confirmation to chat history
    await logMessage({
      userId,
      sessionToken: session_id,
      role: 'assistant',
      content: `✅ Appointment confirmed for ${new Date(scheduled_at).toLocaleString()}.`,
      meta: {
        appointment_id: appointment.id,
        status: 'confirmed',
        action: 'confirmed'
      }
    })

    return res.json({
      ok: true,
      status: 'confirmed',
      appointment: {
        ...appointment,
        formatted_time: new Date(scheduled_at).toLocaleString()
      }
    })

  } catch (error) {
    console.error('Appointment confirmation error:', error)
    return res.status(500).json({
      ok: false,
      error: 'server_error',
      message: 'Failed to process appointment confirmation'
    })
  }
})

// ================================
// Chat History Management
// ================================

/**
 * Retrieve conversation history for a specific session
 * Returns messages in chronological order with metadata
 */
app.get('/api/chat_sessions/:session_id/messages', legacyAuth, async (req, res) => {
  try {
    const sessionId = req.params.session_id

    // Validate session ID
    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({
        ok: false,
        error: 'invalid_session_id',
        message: 'Session ID is required and must be a valid string'
      })
    }

    const userId = await upsertUser(req.user?.sub || 'user_1')

    // Retrieve conversation history
    const result = await query(
      `SELECT role, content, meta, created_at
       FROM chat_messages
       WHERE user_id = $1 AND session_token = $2
       ORDER BY created_at ASC`,
      [userId, sessionId]
    )

    res.json({
      ok: true,
      messages: result.rows,
      count: result.rowCount,
      session_id: sessionId
    })

  } catch (error) {
    console.error('Message history retrieval error:', error)
    res.status(500).json({
      ok: false,
      error: 'fetch_failed',
      message: 'Failed to retrieve conversation history'
    })
  }
})

/**
 * Clear all messages for a specific chat session
 * Used when user wants to start a fresh conversation
 */
app.delete('/api/chat_sessions/:session_id/messages', legacyAuth, async (req, res) => {
  try {
    const sessionId = req.params.session_id

    // Validate session ID
    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({
        ok: false,
        error: 'invalid_session_id',
        message: 'Session ID is required and must be a valid string'
      })
    }

    const userId = await upsertUser(req.user?.sub || 'user_1')

    // Delete all messages for the session
    const result = await query(
      `DELETE FROM chat_messages WHERE user_id = $1 AND session_token = $2`,
      [userId, sessionId]
    )

    res.json({
      ok: true,
      deleted: true,
      messages_deleted: result.rowCount,
      session_id: sessionId
    })

  } catch (error) {
    console.error('Message deletion error:', error)
    res.status(500).json({
      ok: false,
      error: 'deletion_failed',
      message: 'Failed to delete conversation history'
    })
  }
})

// ================================
// Error Handling & Server Startup
// ================================

/**
 * Global error handler for unhandled errors
 * Logs errors for debugging and returns safe error response to client
 */
app.use((err, _req, res, _next) => {
  console.error('Unhandled server error:', {
    message: err.message,
    stack: err.stack,
    timestamp: new Date().toISOString()
  })

  res.status(500).json({
    error: 'Internal server error',
    message: 'An unexpected error occurred. Please try again later.'
  })
})

/**
 * Handle 404 for unmatched routes
 */
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: `Route ${req.originalUrl} not found`,
    available_endpoints: {
      health: 'GET /health',
      auth: 'POST /api/auth/register, POST /api/auth/login',
      chat: 'POST /api/chatbot/message',
      appointments: 'POST /api/chatbot/confirm',
      history: 'GET /api/chat_sessions/:id/messages'
    }
  })
})

/**
 * Start the Express server
 * Logs startup information for monitoring and debugging
 */
app.listen(PORT, () => {
  console.log(`🚀 Dental AI Chatbot Backend Server`)
  console.log(`📍 Running at: http://localhost:${PORT}`)
  console.log(`🔗 Python Service: ${PY_SERVICE_URL}`)
  console.log(`⚡ Environment: ${process.env.NODE_ENV || 'development'}`)
  console.log(`📅 Started: ${new Date().toISOString()}`)
})
