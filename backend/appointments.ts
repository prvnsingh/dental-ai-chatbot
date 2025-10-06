// backend/appointments.ts - Appointment management APIs
import { Request, Response } from 'express'
import { query } from './db.js'
import { AuthenticatedRequest, AuthError } from './auth.js'

export interface Appointment {
  id: number
  user_id: number
  scheduled_at: string
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'
  appointment_type: string
  duration_minutes: number
  notes?: string
  created_at: string
  updated_at: string
  cancelled_at?: string
  cancel_reason?: string
}

export interface CreateAppointmentInput {
  scheduled_at: string
  appointment_type?: string
  duration_minutes?: number
  notes?: string
}

export interface UpdateAppointmentInput {
  status?: string
  appointment_type?: string
  duration_minutes?: number
  notes?: string
  cancel_reason?: string
}

class AppointmentError extends Error {
  public statusCode: number

  constructor(message: string, statusCode: number = 400) {
    super(message)
    this.statusCode = statusCode
    this.name = 'AppointmentError'
  }
}

// Get user appointments
export async function getUserAppointments(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.sub
    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' })
      return
    }

    const { status, from, to, limit = 50, offset = 0 } = req.query

    let queryText = `
      SELECT id, user_id, scheduled_at, status, appointment_type, 
             duration_minutes, notes, created_at, updated_at
      FROM appointments 
      WHERE user_id = $1
    `
    const params: any[] = [userId]
    let paramCount = 2

    // Add filters
    if (status) {
      queryText += ` AND status = $${paramCount}`
      params.push(status)
      paramCount++
    }

    if (from) {
      queryText += ` AND scheduled_at >= $${paramCount}`
      params.push(from)
      paramCount++
    }

    if (to) {
      queryText += ` AND scheduled_at <= $${paramCount}`
      params.push(to)
      paramCount++
    }

    queryText += ` ORDER BY scheduled_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`
    params.push(parseInt(limit as string), parseInt(offset as string))

    const result = await query(queryText, params)

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM appointments WHERE user_id = $1'
    const countParams = [userId]

    if (status || from || to) {
      // Rebuild count query with same filters
      let countParamCount = 2
      if (status) {
        countQuery += ` AND status = $${countParamCount}`
        countParams.push(status as string)
        countParamCount++
      }
      if (from) {
        countQuery += ` AND scheduled_at >= $${countParamCount}`
        countParams.push(from as string)
        countParamCount++
      }
      if (to) {
        countQuery += ` AND scheduled_at <= $${countParamCount}`
        countParams.push(to as string)
      }
    }

    const countResult = await query(countQuery, countParams)
    const total = parseInt(countResult.rows[0].total)

    res.json({
      appointments: result.rows,
      total,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string)
    })
  } catch (error) {
    console.error('Get appointments error:', error)
    res.status(500).json({ error: 'Failed to get appointments' })
  }
}

// Create appointment
export async function createAppointment(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.sub
    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' })
      return
    }

    const { scheduled_at, appointment_type = 'general_checkup', duration_minutes = 60, notes }: CreateAppointmentInput = req.body

    if (!scheduled_at) {
      res.status(400).json({ error: 'scheduled_at is required' })
      return
    }

    // Validate date format
    const scheduledDate = new Date(scheduled_at)
    if (isNaN(scheduledDate.getTime())) {
      res.status(400).json({ error: 'Invalid date format' })
      return
    }

    // Check for conflicts
    const conflictCheck = await query(
      `SELECT id FROM appointments 
       WHERE scheduled_at = $1 AND status IN ('pending', 'confirmed')`,
      [scheduled_at]
    )

    if (conflictCheck.rowCount > 0) {
      res.status(409).json({ error: 'Time slot already booked' })
      return
    }

    // Create appointment
    const result = await query(
      `INSERT INTO appointments (user_id, scheduled_at, appointment_type, duration_minutes, notes, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING *`,
      [userId, scheduled_at, appointment_type, duration_minutes, notes]
    )

    res.status(201).json({ appointment: result.rows[0] })
  } catch (error) {
    console.error('Create appointment error:', error)
    res.status(500).json({ error: 'Failed to create appointment' })
  }
}

// Update appointment
export async function updateAppointment(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.sub
    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' })
      return
    }

    const appointmentId = parseInt(req.params.id)
    if (isNaN(appointmentId)) {
      res.status(400).json({ error: 'Invalid appointment ID' })
      return
    }

    const { status, appointment_type, duration_minutes, notes, cancel_reason }: UpdateAppointmentInput = req.body

    // Check if appointment exists and belongs to user
    const existingAppointment = await query(
      'SELECT * FROM appointments WHERE id = $1 AND user_id = $2',
      [appointmentId, userId]
    )

    if (existingAppointment.rowCount === 0) {
      res.status(404).json({ error: 'Appointment not found' })
      return
    }

    const appointment = existingAppointment.rows[0] as Appointment

    // Build update query
    const updates: string[] = []
    const values: any[] = []
    let paramCount = 1

    if (status !== undefined) {
      updates.push(`status = $${paramCount}`)
      values.push(status)
      paramCount++

      // Set cancelled_at if cancelling
      if (status === 'cancelled') {
        updates.push(`cancelled_at = NOW()`)
      }
    }

    if (appointment_type !== undefined) {
      updates.push(`appointment_type = $${paramCount}`)
      values.push(appointment_type)
      paramCount++
    }

    if (duration_minutes !== undefined) {
      updates.push(`duration_minutes = $${paramCount}`)
      values.push(duration_minutes)
      paramCount++
    }

    if (notes !== undefined) {
      updates.push(`notes = $${paramCount}`)
      values.push(notes)
      paramCount++
    }

    if (cancel_reason !== undefined) {
      updates.push(`cancel_reason = $${paramCount}`)
      values.push(cancel_reason)
      paramCount++
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' })
      return
    }

    values.push(appointmentId, userId)

    const result = await query(
      `UPDATE appointments 
       SET ${updates.join(', ')}
       WHERE id = $${paramCount} AND user_id = $${paramCount + 1}
       RETURNING *`,
      values
    )

    res.json({ appointment: result.rows[0] })
  } catch (error) {
    console.error('Update appointment error:', error)
    res.status(500).json({ error: 'Failed to update appointment' })
  }
}

// Delete appointment
export async function deleteAppointment(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.sub
    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' })
      return
    }

    const appointmentId = parseInt(req.params.id)
    if (isNaN(appointmentId)) {
      res.status(400).json({ error: 'Invalid appointment ID' })
      return
    }

    const result = await query(
      'DELETE FROM appointments WHERE id = $1 AND user_id = $2 RETURNING id',
      [appointmentId, userId]
    )

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Appointment not found' })
      return
    }

    res.json({ message: 'Appointment deleted successfully' })
  } catch (error) {
    console.error('Delete appointment error:', error)
    res.status(500).json({ error: 'Failed to delete appointment' })
  }
}

// Get available time slots
export async function getAvailableSlots(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { date, duration = 60 } = req.query

    if (!date) {
      res.status(400).json({ error: 'date parameter is required' })
      return
    }

    // Get existing appointments for the day
    const startOfDay = `${date}T00:00:00`
    const endOfDay = `${date}T23:59:59`

    const existingAppointments = await query(
      `SELECT scheduled_at, duration_minutes 
       FROM appointments 
       WHERE scheduled_at >= $1 AND scheduled_at <= $2 
       AND status IN ('pending', 'confirmed')
       ORDER BY scheduled_at`,
      [startOfDay, endOfDay]
    )

    // Generate available slots (9 AM to 5 PM, excluding lunch 12-1 PM)
    const workingHours = [
      { start: 9, end: 12 },   // Morning
      { start: 13, end: 17 }   // Afternoon
    ]

    const slots: string[] = []
    const appointmentDuration = parseInt(duration as string)

    for (const period of workingHours) {
      for (let hour = period.start; hour < period.end; hour++) {
        for (let minute = 0; minute < 60; minute += 30) { // 30-minute intervals
          const slotTime = new Date(`${date}T${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:00`)
          const slotEndTime = new Date(slotTime.getTime() + appointmentDuration * 60000)

          // Check if this slot conflicts with existing appointments
          let hasConflict = false
          for (const apt of existingAppointments.rows) {
            const aptStart = new Date(apt.scheduled_at)
            const aptEnd = new Date(aptStart.getTime() + apt.duration_minutes * 60000)

            if ((slotTime >= aptStart && slotTime < aptEnd) ||
                (slotEndTime > aptStart && slotEndTime <= aptEnd) ||
                (slotTime <= aptStart && slotEndTime >= aptEnd)) {
              hasConflict = true
              break
            }
          }

          if (!hasConflict && slotEndTime <= new Date(`${date}T${period.end}:00:00`)) {
            slots.push(slotTime.toISOString())
          }
        }
      }
    }

    res.json({ available_slots: slots })
  } catch (error) {
    console.error('Get available slots error:', error)
    res.status(500).json({ error: 'Failed to get available slots' })
  }
}