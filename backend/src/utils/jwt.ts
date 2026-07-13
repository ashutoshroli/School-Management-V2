import jwt from "jsonwebtoken";
import { config } from "../config";
import { JwtPayload } from "../types";

/**
 * Generate access token (short-lived, default 15 minutes)
 */
export const generateAccessToken = (payload: JwtPayload): string => {
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.accessTokenExpiresIn || "15m",
  } as jwt.SignOptions);
};

/**
 * Generate refresh token (long-lived, default 7 days)
 */
export const generateRefreshToken = (payload: JwtPayload): string => {
  return jwt.sign(
    { ...payload, type: "refresh" },
    config.jwt.refreshSecret || config.jwt.secret,
    { expiresIn: config.jwt.refreshTokenExpiresIn || "7d" }
  );
};

/**
 * Verify access token
 */
export const verifyAccessToken = (token: string): JwtPayload => {
  return jwt.verify(token, config.jwt.secret) as JwtPayload;
};

/**
 * Verify refresh token
 */
export const verifyRefreshToken = (token: string): JwtPayload => {
  const secret = config.jwt.refreshSecret || config.jwt.secret;
  const decoded = jwt.verify(token, secret) as JwtPayload & { type?: string };
  
  if (decoded.type !== "refresh") {
    throw new Error("Invalid token type");
  }
  
  // Remove the type field from the payload
  const { type, ...payload } = decoded;
  return payload;
};

/**
 * Generate both access and refresh tokens
 */
export const generateTokenPair = (payload: JwtPayload): { accessToken: string; refreshToken: string } => {
  return {
    accessToken: generateAccessToken(payload),
    refreshToken: generateRefreshToken(payload),
  };
};

// Legacy function for backward compatibility
export const generateToken = (payload: JwtPayload): string => {
  return generateAccessToken(payload);
};

// Legacy function for backward compatibility  
export const verifyToken = (token: string): JwtPayload => {
  return verifyAccessToken(token);
};
