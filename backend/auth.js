// backend/auth.js - Authentication middleware and utilities
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { query } from './db.js'

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret'
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h'
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12')

export class AuthError extends Error {
  constructor(message, statusCode = 401) {
    super(message)
    this.statusCode = statusCode
    this.name = 'AuthError'
  }
}

export async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS)
}

export async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash)
}

export function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET)
}

export async function createUser({ email, password, name, phone = null, dateOfBirth = null }) {
  try {
    // Check if user already exists
    const existingUser = await query('SELECT id FROM users WHERE email = $1', [email])
    if (existingUser.rowCount > 0) {
      throw new AuthError('User already exists', 409)
    }

    // Hash password
    const passwordHash = await hashPassword(password)

    // Insert user
    const result = await query(
      `INSERT INTO users (email, password_hash, name, phone, date_of_birth) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, email, name, phone, created_at`,
      [email, passwordHash, name, phone, dateOfBirth]
    )

    return result.rows[0]
  } catch (error) {
    if (error instanceof AuthError) throw error
    if (error.code === '23505') { // Unique violation
      throw new AuthError('User already exists', 409)
    }
    throw new AuthError('Failed to create user', 500)
  }
}

export async function authenticateUser(email, password) {
  try {
    const result = await query(
      `SELECT id, email, password_hash, name, phone, is_active 
       FROM users 
       WHERE email = $1`,
      [email]
    )

    if (result.rowCount === 0) {
      throw new AuthError('Invalid credentials', 401)
    }

    const user = result.rows[0]

    if (!user.is_active) {
      throw new AuthError('Account is deactivated', 403)
    }

    const isValidPassword = await comparePassword(password, user.password_hash)
    if (!isValidPassword) {
      throw new AuthError('Invalid credentials', 401)
    }

    // Update last login
    await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id])

    // Remove sensitive data
    const { password_hash, ...userWithoutPassword } = user
    return userWithoutPassword
  } catch (error) {
    if (error instanceof AuthError) throw error
    throw new AuthError('Authentication failed', 500)
  }
}

export async function getUserById(id) {
  try {
    const result = await query(
      `SELECT id, email, name, phone, date_of_birth, created_at, last_login, is_active 
       FROM users 
       WHERE id = $1 AND is_active = TRUE`,
      [id]
    )

    if (result.rowCount === 0) {
      throw new AuthError('User not found', 404)
    }

    return result.rows[0]
  } catch (error) {
    if (error instanceof AuthError) throw error
    throw new AuthError('Failed to get user', 500)
  }
}

export async function updateUser(id, updates) {
  try {
    const allowedFields = ['name', 'phone', 'date_of_birth']
    const fields = []
    const values = []
    let paramCount = 1

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key) && value !== undefined) {
        fields.push(`${key} = $${paramCount}`)
        values.push(value)
        paramCount++
      }
    }

    if (fields.length === 0) {
      throw new AuthError('No valid fields to update', 400)
    }

    values.push(id) // Add ID as last parameter
    const result = await query(
      `UPDATE users 
       SET ${fields.join(', ')} 
       WHERE id = $${paramCount} AND is_active = TRUE
       RETURNING id, email, name, phone, date_of_birth, updated_at`,
      values
    )

    if (result.rowCount === 0) {
      throw new AuthError('User not found', 404)
    }

    return result.rows[0]
  } catch (error) {
    if (error instanceof AuthError) throw error
    throw new AuthError('Failed to update user', 500)
  }
}

export async function changePassword(id, currentPassword, newPassword) {
  try {
    // Get current password hash
    const result = await query(
      'SELECT password_hash FROM users WHERE id = $1 AND is_active = TRUE',
      [id]
    )

    if (result.rowCount === 0) {
      throw new AuthError('User not found', 404)
    }

    // Verify current password
    const isValidPassword = await comparePassword(currentPassword, result.rows[0].password_hash)
    if (!isValidPassword) {
      throw new AuthError('Current password is incorrect', 401)
    }

    // Hash new password
    const newPasswordHash = await hashPassword(newPassword)

    // Update password
    await query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [newPasswordHash, id]
    )

    return true
  } catch (error) {
    if (error instanceof AuthError) throw error
    throw new AuthError('Failed to change password', 500)
  }
}

// Authentication middleware
export function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization header' })
    }

    const token = authHeader.slice(7)
    const decoded = verifyToken(token)
    req.user = decoded
    next()
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' })
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' })
    }
    return res.status(401).json({ error: 'Authentication failed' })
  }
}

// Optional authentication middleware (doesn't fail if no token)
export function optionalAuthMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7)
      const decoded = verifyToken(token)
      req.user = decoded
    }
    next()
  } catch (error) {
    // Ignore auth errors in optional middleware
    next()
  }
}