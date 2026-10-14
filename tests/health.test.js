
const request = require('supertest');
const app = require('../src/app');

describe('GET /health', function () {
  it('returns a successful health response', async function () {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('healthy');
  });
});
