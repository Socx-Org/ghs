import { test } from "node:test";
import assert from "node:assert/strict";
import { createWidgetsService } from "../src/application/widgets.service.ts";
import { createLogger } from "../src/logger.ts";
import type { Widget, WidgetsRepository } from "../src/data/widgets.repository.ts";

// Proves ADR-060's claim: the application layer is testable without an
// HTTP server or a real database -- a fake repository stands in for pg
// entirely (ENG-030.3: unit tests for business logic).
function fakeRepository(initial: Widget[] = []): WidgetsRepository {
  const widgets = [...initial];
  return {
    async list() {
      return widgets;
    },
    async create(name: string) {
      const widget: Widget = { id: widgets.length + 1, name, createdAt: new Date().toISOString() };
      widgets.push(widget);
      return widget;
    },
  };
}

const silentLogger = createLogger("test");

test("listWidgets returns what the repository has", async () => {
  const repository = fakeRepository([{ id: 1, name: "existing", createdAt: "2026-01-01T00:00:00.000Z" }]);
  const service = createWidgetsService(repository, silentLogger);

  const widgets = await service.listWidgets();

  assert.equal(widgets.length, 1);
  assert.equal(widgets[0]!.name, "existing");
});

test("createWidget persists via the repository and returns the created widget", async () => {
  const repository = fakeRepository();
  const service = createWidgetsService(repository, silentLogger);

  const widget = await service.createWidget("new widget");

  assert.equal(widget.name, "new widget");
  assert.equal((await service.listWidgets()).length, 1);
});
