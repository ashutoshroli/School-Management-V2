// Jest sets NODE_ENV="test" automatically, which is NOT "development" -
// config/index.ts intentionally throws if JWT_SECRET is unset outside
// development (see the security-hardening commit that added this
// fail-fast check), so tests need a dummy secret + DB URL to be able to
// import app.ts/config/index.ts at all. These are test-only dummy
// values, never used against a real service.
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-not-for-production";
process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://user:password@localhost:5432/school_erp_test?schema=public";

// passport-google-oauth20's Strategy constructor throws synchronously if
// clientID/clientSecret are empty strings - config/passport.ts is
// imported (and the strategy constructed) as a side effect of importing
// app.ts, so any test that imports app.ts needs dummy values here even
// though it never actually exercises the Google OAuth flow.
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "test-google-client-secret";
