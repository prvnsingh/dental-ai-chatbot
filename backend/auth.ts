// backend/auth.ts - Authentication middleware and utilities
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { Request, Response, NextFunction } from 'express'
import { query } from './db.js'

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret'
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h'
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12')

export interface User {
  id: number
  email: string
  name: string
  phone?: string
  date_of_birth?: string
  created_at: string
  updated_at?: string
  last_login?: string
  is_active: boolean
}

export interface CreateUserInput {
  email: string
  password: string
  name: string
  phone?: string
  dateOfBirth?: string
}

export interface JWTPayload {
  sub: number
  email: string
  role: string
  iat?: number
  exp?: number
}

export interface AuthenticatedRequest extends Request {
  user?: JWTPayload
}

export class AuthError extends Error {
  public statusCode: number

  constructor(message: string, statusCode: number = 401) {
    super(message)
    this.statusCode = statusCode
    this.name = 'AuthError'
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS)
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export function generateToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })
}

export function verifyToken(token: string): JWTPayload {
  return jwt.verify(token, JWT_SECRET) as JWTPayload
}

export async function createUser(input: CreateUserInput): Promise<Omit<User, 'password_hash'>> {
  try {
    const { email, password, name, phone = null, dateOfBirth = null } = input

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

    return result.rows[0] as Omit<User, 'password_hash'>
  } catch (error) {
    if (error instanceof AuthError) throw error
    if ((error as any).code === '23505') { // Unique violation
      throw new AuthError('User already exists', 409)
    }
    throw new AuthError('Failed to create user', 500)
  }
}

export async function authenticateUser(email: string, password: string): Promise<Omit<User, 'password_hash'>> {
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

    const user = result.rows[0] as User & { password_hash: string }

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

export async function getUserById(id: number): Promise<User> {
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

    return result.rows[0] as User
  } catch (error) {
    if (error instanceof AuthError) throw error
    throw new AuthError('Failed to get user', 500)
  }
}

export interface UpdateUserInput {
  name?: string
  phone?: string
  date_of_birth?: string
}

export async function updateUser(id: number, updates: UpdateUserInput): Promise<User> {
  try {
    const allowedFields = ['name', 'phone', 'date_of_birth']
    const fields: string[] = []
    const values: any[] = []
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

    return result.rows[0] as User
  } catch (error) {
    if (error instanceof AuthError) throw error
    throw new AuthError('Failed to update user', 500)
  }
}

export async function changePassword(id: number, currentPassword: string, newPassword: string): Promise<boolean> {
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
export function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid authorization header' })
      return
    }

    const token = authHeader.slice(7)
    const decoded = verifyToken(token)
    req.user = decoded
    next()
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Token expired' })
      return
    }
    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: 'Invalid token' })
      return
    }
    res.status(401).json({ error: 'Authentication failed' })
  }
}

// Optional authentication middleware (doesn't fail if no token)
export function optionalAuthMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
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