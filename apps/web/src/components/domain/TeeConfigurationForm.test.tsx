import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TeeConfigurationForm } from "./TeeConfigurationForm";
import type { TeeConfiguration } from "../../types/domain";

afterEach(() => {
  cleanup();
});

function renderForm(props: Partial<ComponentProps<typeof TeeConfigurationForm>> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const onCancel = vi.fn();
  render(<TeeConfigurationForm onSubmit={onSubmit} onCancel={onCancel} submitLabel="Add tee configuration" {...props} />);
  return { onSubmit, onCancel };
}

async function fillHole(index: number, distanceYards: string, par: string, strokeIndex: string) {
  await userEvent.type(screen.getByLabelText(`Hole ${index + 1} distance in yards`), distanceYards);
  await userEvent.type(screen.getByLabelText(`Hole ${index + 1} par`), par);
  await userEvent.type(screen.getByLabelText(`Hole ${index + 1} stroke index`), strokeIndex);
}

describe("TeeConfigurationForm", () => {
  it("defaults to 18 empty hole rows in create mode", () => {
    renderForm();
    expect(screen.getByLabelText("Holes")).toHaveValue("18");
    expect(screen.getByLabelText("Hole 18 distance in yards")).toBeInTheDocument();
    expect(screen.queryByLabelText("Hole 19 distance in yards")).not.toBeInTheDocument();
    expect((screen.getByLabelText("Hole 1 distance in yards") as HTMLInputElement).value).toBe("");
  });

  it("resizes the holes table when holeCount changes, preserving already-entered rows", async () => {
    renderForm();
    await fillHole(0, "380", "4", "7");

    await userEvent.selectOptions(screen.getByLabelText("Holes"), "9");
    expect(screen.queryByLabelText("Hole 10 distance in yards")).not.toBeInTheDocument();
    expect((screen.getByLabelText("Hole 1 distance in yards") as HTMLInputElement).value).toBe("380");

    await userEvent.selectOptions(screen.getByLabelText("Holes"), "18");
    expect(screen.getByLabelText("Hole 18 distance in yards")).toBeInTheDocument();
    expect((screen.getByLabelText("Hole 1 distance in yards") as HTMLInputElement).value).toBe("380");
    expect((screen.getByLabelText("Hole 10 distance in yards") as HTMLInputElement).value).toBe("");
  });

  it("shows client-side validation errors without calling onSubmit", async () => {
    const { onSubmit } = renderForm();
    await userEvent.selectOptions(screen.getByLabelText("Holes"), "9");
    await userEvent.click(screen.getByRole("button", { name: "Add tee configuration" }));

    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(screen.getByText("Enter a course rating")).toBeInTheDocument();
    expect(screen.getByText("Enter a slope rating")).toBeInTheDocument();
    expect(screen.getByText(/distance, par, and stroke index are all required/)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("rejects a fractional slope rating -- ghs#187, a slope_rating column is a Postgres SMALLINT so a decimal value like the course rating must never reach it", async () => {
    const { onSubmit } = renderForm();
    await userEvent.type(screen.getByLabelText("Name"), "White");
    await userEvent.type(screen.getByLabelText("Course rating"), "71.2");
    await userEvent.type(screen.getByLabelText("Slope rating"), "68.5");
    await userEvent.click(screen.getByRole("button", { name: "Add tee configuration" }));

    expect(await screen.findByText("Slope rating must be a whole number")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits the correctly-shaped payload for a complete 9-hole configuration", async () => {
    const { onSubmit } = renderForm();
    await userEvent.type(screen.getByLabelText("Name"), "White");
    await userEvent.selectOptions(screen.getByLabelText("Holes"), "9");
    await userEvent.type(screen.getByLabelText("Course rating"), "71.2");
    await userEvent.type(screen.getByLabelText("Slope rating"), "128");
    for (let i = 0; i < 9; i++) {
      await fillHole(i, String(300 + i * 10), "4", String(i + 1));
    }
    await userEvent.click(screen.getByRole("button", { name: "Add tee configuration" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const input = onSubmit.mock.calls[0]![0];
    expect(input).toMatchObject({ name: "White", holeCount: 9, courseRating: 71.2, slopeRating: 128 });
    expect(input.holes).toHaveLength(9);
    expect(input.holes[0]).toEqual({ holeNumber: 1, distanceYards: 300, par: 4, strokeIndex: 1 });
    expect(input.holes[8]).toEqual({ holeNumber: 9, distanceYards: 380, par: 4, strokeIndex: 9 });
  });

  it("pre-fills every field from initialValues in edit mode", () => {
    const existing: TeeConfiguration = {
      id: "tee-1",
      name: "Blue",
      holeCount: 9,
      courseRating: 70.5,
      slopeRating: 125,
      holes: [
        { id: "h1", holeNumber: 1, distanceYards: 350, par: 4, strokeIndex: 3 },
        { id: "h2", holeNumber: 2, distanceYards: 150, par: 3, strokeIndex: 9 },
      ],
    };
    renderForm({ initialValues: existing, submitLabel: "Save changes" });

    expect(screen.getByLabelText("Name")).toHaveValue("Blue");
    expect(screen.getByLabelText("Holes")).toHaveValue("9");
    expect(screen.getByLabelText("Course rating")).toHaveValue(70.5);
    expect(screen.getByLabelText("Slope rating")).toHaveValue(125);
    expect(screen.getByLabelText("Hole 1 distance in yards")).toHaveValue(350);
    expect(screen.getByLabelText("Hole 1 par")).toHaveValue(4);
    expect(screen.getByLabelText("Hole 1 stroke index")).toHaveValue(3);
    expect(screen.getByLabelText("Hole 2 distance in yards")).toHaveValue(150);
    // Holes 3-9 have no existing data -- pre-filled empty, not zero.
    expect(screen.getByLabelText("Hole 3 distance in yards")).toHaveValue(null);
  });

  it("calls onCancel when Cancel is clicked, without calling onSubmit", async () => {
    const { onSubmit, onCancel } = renderForm();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
