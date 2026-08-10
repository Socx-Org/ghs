import type { Request, Response, NextFunction } from "express";
import type { AuthProvider, Identity } from "../../../application/auth-provider.ts";

// Augment Express's Request with the verified identity -- set by
// requireAuth, read by requireRole and route handlers.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      identity?: Identity;
    }
  }
}

export function requireAuth(authProvider: AuthProvider) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      res.status(401).json({ error: "missing bearer token" });
      return;
    }
    try {
      req.identity = authProvider.verifyAccessToken(header.slice("Bearer ".length));
      next();
    } catch {
      res.status(401).json({ error: "invalid or expired token" });
    }
  };
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.identity || !roles.includes(req.identity.ghsRole)) {
      res.status(403).json({ error: "insufficient role" });
      return;
    }
    next();
  };
}
