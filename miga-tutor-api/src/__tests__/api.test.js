const request = require('supertest');

// Mock supabase and anthropic before loading the app
jest.mock('../config/supabase', () => ({
  auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } }) },
  from: jest.fn().mockReturnThis(),
}));
jest.mock('../config/anthropic', () => ({}));

const app = require('../index');

describe('Health check', () => {
  it('GET /health returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('MIGA Tutor API');
  });
});

describe('Auth protection', () => {
  it('rejects unauthenticated requests to /api/chat', async () => {
    const res = await request(app).post('/api/chat').send({ message: 'hello' });
    expect(res.status).toBe(401);
  });

  it('rejects unauthenticated requests to /api/quiz/generate', async () => {
    const res = await request(app).post('/api/quiz/generate').send({ topic: 'math' });
    expect(res.status).toBe(401);
  });

  it('rejects unauthenticated requests to /api/profile', async () => {
    const res = await request(app).get('/api/profile');
    expect(res.status).toBe(401);
  });
});

describe('404 handling', () => {
  it('returns 404 for unknown routes', async () => {
    const res = await request(app).get('/api/unknown');
    expect(res.status).toBe(404);
  });
});

describe('Payment plans', () => {
  it('GET /api/payment/plans returns 401 without auth', async () => {
    const res = await request(app).get('/api/payment/plans');
    expect(res.status).toBe(401);
  });
});
