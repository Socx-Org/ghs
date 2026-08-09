import type { Logger } from "../logger.ts";
import type { Widget, WidgetsRepository } from "../data/widgets.repository.ts";

// No transport- or framework-specific code in this layer, and no input
// validation -- that belongs to the interface layer (ADR-060). This layer
// trusts its caller already validated shape, and depends only on the
// repository's narrow interface and the logger, neither of which is
// Express- or pg-shaped. Testable without an HTTP server or a real
// database (see tests/widgets.service.test.ts).

export interface WidgetsService {
  listWidgets(): Promise<Widget[]>;
  createWidget(name: string): Promise<Widget>;
}

export function createWidgetsService(repository: WidgetsRepository, logger: Logger): WidgetsService {
  return {
    async listWidgets() {
      return repository.list();
    },

    async createWidget(name: string) {
      const widget = await repository.create(name);
      logger.info("widget created", { widgetId: widget.id });
      return widget;
    },
  };
}
