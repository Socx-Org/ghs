import { Router } from "express";
import type { WidgetsService } from "../../../application/widgets.service.ts";

// Request/response shape and input validation live here, not in the
// application layer (ADR-060). This layer talks to the application layer
// only -- never imports pg or the repository directly.
export function widgetsRouter(service: WidgetsService): Router {
  const router = Router();

  router.get("/widgets", async (_req, res, next) => {
    try {
      const widgets = await service.listWidgets();
      res.status(200).json(widgets);
    } catch (err) {
      next(err);
    }
  });

  router.post("/widgets", async (req, res, next) => {
    try {
      const { name } = req.body as { name?: unknown };
      if (typeof name !== "string" || name.trim().length === 0) {
        res.status(400).json({ error: "name must be a non-empty string" });
        return;
      }
      const widget = await service.createWidget(name.trim());
      res.status(201).json(widget);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
