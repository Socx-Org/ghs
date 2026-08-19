import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import NotFoundPage from "./NotFoundPage";

afterEach(() => {
  cleanup();
});

function renderWithHistory() {
  return render(
    <MemoryRouter initialEntries={["/", "/some/unknown/path"]} initialIndex={1}>
      <Routes>
        <Route path="/" element={<p>Home page content</p>} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("NotFoundPage", () => {
  it("shows clear not-found messaging", () => {
    renderWithHistory();
    expect(screen.getByText("Page not found")).toBeInTheDocument();
    expect(screen.getByText(/doesn't exist or may have moved/)).toBeInTheDocument();
  });

  it("Go Back navigates through real browser history, not just to a fixed path", async () => {
    renderWithHistory();
    await userEvent.click(screen.getByRole("button", { name: "Go Back" }));
    expect(screen.getByText("Home page content")).toBeInTheDocument();
  });

  it("Go to Dashboard navigates to /", async () => {
    renderWithHistory();
    await userEvent.click(screen.getByRole("button", { name: "Go to Dashboard" }));
    expect(screen.getByText("Home page content")).toBeInTheDocument();
  });
});
