// e2e tests run against a dedicated database; never point this at real data.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://zerodue:zerodue@localhost:5432/zerodue_test?schema=public';
process.env.JWT_ACCESS_SECRET = 'e2e-access-secret-0123456789';
process.env.JWT_REFRESH_SECRET = 'e2e-refresh-secret-0123456789';
process.env.WEB_ORIGIN = 'http://localhost:3000';
process.env.ALLOW_SIGNUP = 'true';
process.env.AUTH_RATE_LIMIT = '1000';
process.env.SCHEDULER = 'false'; // tests drive the reminder jobs by hand
