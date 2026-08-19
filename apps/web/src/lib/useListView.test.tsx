import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useListView } from "./useListView";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("useListView", () => {
  it("defaults to table when nothing is stored", () => {
    const { result } = renderHook(() => useListView("accounts"));
    expect(result.current[0]).toBe("table");
  });

  it("respects an explicit default when nothing is stored", () => {
    const { result } = renderHook(() => useListView("accounts", "grid"));
    expect(result.current[0]).toBe("grid");
  });

  it("persists the chosen view to localStorage, scoped by id", () => {
    const { result } = renderHook(() => useListView("accounts"));
    act(() => result.current[1]("grid"));
    expect(result.current[0]).toBe("grid");
    expect(localStorage.getItem("ghs-list-view:accounts")).toBe("grid");
  });

  it("reads back a persisted choice on a fresh mount, ignoring the default", () => {
    localStorage.setItem("ghs-list-view:accounts", "grid");
    const { result } = renderHook(() => useListView("accounts", "table"));
    expect(result.current[0]).toBe("grid");
  });

  it("keeps two different ids independent", () => {
    const accounts = renderHook(() => useListView("accounts"));
    const courses = renderHook(() => useListView("courses"));
    act(() => accounts.result.current[1]("grid"));
    expect(accounts.result.current[0]).toBe("grid");
    expect(courses.result.current[0]).toBe("table");
  });
});
