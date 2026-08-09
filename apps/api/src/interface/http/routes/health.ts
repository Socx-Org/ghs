import { Router } from "express";

// Bare liveness route only -- every production service must expose
// something reference/deployment's health gate (and any process
// supervisor) can poll (OPS-040.1). Readiness checks, dependency probes,
// and the broader monitoring pattern are reference/monitoring's concern,
// not duplicated here.
export function healthRouter(): Router {
  const router = Router();
  router.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });
  return router;
}
