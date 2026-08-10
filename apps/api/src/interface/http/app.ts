import express from "express";
import type { Express, Request, Response, NextFunction } from "express";
import type { Logger } from "../../logger.ts";
import type { ClubsService } from "../../application/clubs.service.ts";
import type { CoursesService } from "../../application/courses.service.ts";
import { healthRouter } from "./routes/health.ts";
import { clubsRouter } from "./routes/clubs.ts";
import { coursesRouter } from "./routes/courses.ts";

export interface AppDeps {
  logger: Logger;
  clubsService: ClubsService;
  coursesService: CoursesService;
}

// Composition root for the interface layer -- wires routers, never touches
// persistence directly (ADR-060).
export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json());

  app.use((req, _res, next) => {
    deps.logger.info("request received", { method: req.method, path: req.path });
    next();
  });

  app.use(healthRouter());
  app.use(clubsRouter(deps.clubsService));
  app.use(coursesRouter(deps.coursesService));

  // Centralised error handling -- errors from any route are logged
  // structurally (OPS-050.3: never the raw request body, which may contain
  // sensitive fields) and never leak an internal message to the client.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    deps.logger.error("unhandled request error", { error: err.message });
    res.status(500).json({ error: "internal server error" });
  });

  return app;
}
