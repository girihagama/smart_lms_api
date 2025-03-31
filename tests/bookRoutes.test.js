const request = require('supertest');
const server = 'http://localhost:8090'; // Replace with your server's URL/port

describe('rootRoutes tests', () => {
  it('should return a 200 status and a JSON response for GET /', async () => {
    const response = await request(server).get('/book/');

    expect(response.status).toBe(401);
  });
});
