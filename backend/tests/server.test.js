import request from 'supertest';
import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';

// Mock the database module
const mockQuery = jest.fn();
jest.unstable_mockModule('../db.js', () => ({
  query: mockQuery
}));

// Mock fetch for Python service calls
global.fetch = jest.fn();

// Import after mocking
const { default: app } = await import('../server.js');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

describe('Backend API Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockReset();
    fetch.mockReset();
  });

  describe('Health Endpoints', () => {
    test('GET /health should return ok status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toEqual({
        status: 'ok',
        service: 'backend'
      });
    });

    test('GET /health/python should return python service status', async () => {
      fetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ status: 'ok' })
      });

      const response = await request(app)
        .get('/health/python')
        .expect(200);

      expect(response.body.status).toBe('ok');
    });

    test('GET /health/python should handle service down', async () => {
      fetch.mockRejectedValueOnce(new Error('Service unavailable'));

      const response = await request(app)
        .get('/health/python')
        .expect(503);

      expect(response.body.status).toBe('down');
    });
  });

  describe('Authentication', () => {
    test('POST /api/chatbot/token should generate valid JWT', async () => {
      // Mock upsertUser query
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 1 }]
      });

      const response = await request(app)
        .post('/api/chatbot/token')
        .expect(200);

      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('expires_in', 300);

      // Verify token is valid
      const decoded = jwt.verify(response.body.token, JWT_SECRET);
      expect(decoded.sub).toBe('user_1');
      expect(decoded.role).toBe('user');
    });

    test('Protected endpoints should reject requests without token', async () => {
      await request(app)
        .post('/api/chatbot/message')
        .send({ message: 'test' })
        .expect(401);
    });

    test('Protected endpoints should reject invalid token', async () => {
      await request(app)
        .post('/api/chatbot/message')
        .set('Authorization', 'Bearer invalid-token')
        .send({ message: 'test' })
        .expect(401);
    });
  });

  describe('Chat Messages', () => {
    let validToken;

    beforeEach(() => {
      validToken = jwt.sign(
        { sub: 'user_1', role: 'user' },
        JWT_SECRET,
        { expiresIn: '5m' }
      );
    });

    test('POST /api/chatbot/message should process message successfully', async () => {
      // Mock database calls
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // upsertUser
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1 }] }) // ensureSession
        .mockResolvedValueOnce({}) // logMessage user
        .mockResolvedValueOnce({}); // logMessage assistant

      // Mock Python service response
      fetch.mockResolvedValueOnce({
        json: () => Promise.resolve({
          reply: 'I can help you book an appointment',
          intent: 'chat'
        })
      });

      const response = await request(app)
        .post('/api/chatbot/message')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          message: 'Hello, I need help',
          session_id: 'test-session'
        })
        .expect(200);

      expect(response.body.ok).toBe(true);
      expect(response.body.data).toHaveProperty('reply');
    });

    test('POST /api/chatbot/message should handle missing message', async () => {
      await request(app)
        .post('/api/chatbot/message')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ session_id: 'test-session' })
        .expect(400);
    });

    test('POST /api/chatbot/message should handle Python service error', async () => {
      // Mock database calls
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 1 }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1 }] })
        .mockResolvedValueOnce({});

      // Mock Python service failure
      fetch.mockRejectedValueOnce(new Error('Service unavailable'));

      await request(app)
        .post('/api/chatbot/message')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          message: 'Hello',
          session_id: 'test-session'
        })
        .expect(500);
    });
  });

  describe('Appointment Confirmation', () => {
    let validToken;

    beforeEach(() => {
      validToken = jwt.sign(
        { sub: 'user_1', role: 'user' },
        JWT_SECRET,
        { expiresIn: '5m' }
      );
    });

    test('POST /api/chatbot/confirm should confirm appointment', async () => {
      // Mock database calls
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // upsertUser
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1 }] }) // ensureSession
        .mockResolvedValueOnce({ rowCount: 0 }) // conflict check
        .mockResolvedValueOnce({ // appointment insert
          rows: [{
            id: 1,
            scheduled_at: '2025-10-07T10:00:00Z',
            status: 'confirmed',
            created_at: '2025-10-06T12:00:00Z'
          }]
        })
        .mockResolvedValueOnce({}); // logMessage

      const response = await request(app)
        .post('/api/chatbot/confirm')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          session_id: 'test-session',
          scheduled_at: '2025-10-07T10:00:00Z',
          confirm: true
        })
        .expect(200);

      expect(response.body.ok).toBe(true);
      expect(response.body.status).toBe('confirmed');
      expect(response.body.appointment).toBeDefined();
    });

    test('POST /api/chatbot/confirm should handle time conflict', async () => {
      // Mock database calls
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // upsertUser
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1 }] }) // ensureSession
        .mockResolvedValueOnce({ rowCount: 1 }); // conflict check - found conflict

      await request(app)
        .post('/api/chatbot/confirm')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          session_id: 'test-session',
          scheduled_at: '2025-10-07T10:00:00Z',
          confirm: true
        })
        .expect(409);
    });

    test('POST /api/chatbot/confirm should handle decline', async () => {
      // Mock database calls
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // upsertUser
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1 }] }); // ensureSession

      const response = await request(app)
        .post('/api/chatbot/confirm')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          session_id: 'test-session',
          scheduled_at: '2025-10-07T10:00:00Z',
          confirm: false
        })
        .expect(200);

      expect(response.body.ok).toBe(true);
      expect(response.body.status).toBe('declined');
    });

    test('POST /api/chatbot/confirm should validate required fields', async () => {
      await request(app)
        .post('/api/chatbot/confirm')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          session_id: 'test-session'
          // missing scheduled_at
        })
        .expect(400);
    });

    test('POST /api/chatbot/confirm should validate datetime format', async () => {
      await request(app)
        .post('/api/chatbot/confirm')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          session_id: 'test-session',
          scheduled_at: 'invalid-date',
          confirm: true
        })
        .expect(400);
    });
  });

  describe('Session History', () => {
    let validToken;

    beforeEach(() => {
      validToken = jwt.sign(
        { sub: 'user_1', role: 'user' },
        JWT_SECRET,
        { expiresIn: '5m' }
      );
    });

    test('GET /api/chat_sessions/:session_id/messages should return message history', async () => {
      const mockMessages = [
        {
          role: 'user',
          content: 'Hello',
          meta: null,
          created_at: '2025-10-06T12:00:00Z'
        },
        {
          role: 'assistant',
          content: 'Hi! How can I help?',
          meta: { intent: 'chat' },
          created_at: '2025-10-06T12:00:01Z'
        }
      ];

      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // upsertUser
        .mockResolvedValueOnce({ rows: mockMessages }); // messages query

      const response = await request(app)
        .get('/api/chat_sessions/test-session/messages')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(response.body.ok).toBe(true);
      expect(response.body.messages).toEqual(mockMessages);
    });

    test('DELETE /api/chat_sessions/:session_id/messages should clear session history', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // upsertUser
        .mockResolvedValueOnce({}); // delete query

      const response = await request(app)
        .delete('/api/chat_sessions/test-session/messages')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(response.body.ok).toBe(true);
      expect(response.body.deleted).toBe(true);
    });
  });
});