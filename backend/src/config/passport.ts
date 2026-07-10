import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { config } from "./index";
import prisma from "./database";

passport.use(
  new GoogleStrategy(
    {
      clientID: config.google.clientId,
      clientSecret: config.google.clientSecret,
      callbackURL: config.google.callbackUrl,
    },
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;
        if (!email) {
          return done(new Error("No email found in Google profile"), undefined);
        }

        // Find existing user by googleId or email
        let user = await prisma.user.findFirst({
          where: {
            OR: [{ googleId: profile.id }, { email }],
          },
        });

        if (user && !user.googleId) {
          // Link Google account to existing user
          user = await prisma.user.update({
            where: { id: user.id },
            data: {
              googleId: profile.id,
              avatar: profile.photos?.[0]?.value,
              lastLogin: new Date(),
            },
          });
        } else if (user) {
          // Update last login
          user = await prisma.user.update({
            where: { id: user.id },
            data: { lastLogin: new Date() },
          });
        }

        // If no user found, they need to be pre-registered by admin
        if (!user) {
          return done(null, undefined, {
            message: "No account found. Please contact admin.",
          });
        }

        if (!user.isActive) {
          return done(null, undefined, {
            message: "Account is deactivated.",
          });
        }

        // Note: `done()` here carries the raw Prisma `User` row (id,
        // email, role, ...), not our JWT `JwtPayload` shape - it's a
        // distinct, transient "OAuth profile" concept that only exists
        // between this callback and googleCallback() in
        // auth.controller.ts (which already reads it via `req.user as
        // any` and builds the real JwtPayload/JWT from it). Cast here
        // rather than reshaping Express.User, since JwtPayload is what
        // every *authenticated* request's `req.user` actually is once
        // the `authenticate` middleware has run.
        return done(null, user as any);
      } catch (error) {
        return done(error as Error, undefined);
      }
    }
  )
);

export default passport;
