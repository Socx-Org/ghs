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

  // ghs#229: "Load from CSV" -- holes only; name/holeCount/courseRating/
  // slopeRating stay as the same real fields above, unaffected by mode.
  describe("Load from CSV (holes only)", () => {
    function csvFile(text: string, name = "holes.csv") {
      return new File([text], name, { type: "text/csv" });
    }

    const NINE_HOLE_CSV =
      "hole_number,distance_yards,par,stroke_index\n" +
      "1,300,5,1\n2,310,4,2\n3,320,4,3\n4,330,5,4\n5,340,4,5\n6,350,4,6\n7,360,5,7\n8,370,4,8\n9,380,4,9";

    it("shows a CSV file input alongside the (still-present) manual holes table once 'Load from CSV' is selected", async () => {
      renderForm();
      await userEvent.click(screen.getByRole("radio", { name: "Load from CSV" }));

      expect(screen.getByLabelText("CSV file")).toBeInTheDocument();
      // Unlike CreateCoursePage's own CSV mode (which replaces the whole
      // form), the holes table stays -- it doubles as the preview.
      expect(screen.getByLabelText("Hole 1 distance in yards")).toBeInTheDocument();
    });

    it("populates the existing holes table from a valid file, matching the hole count already selected", async () => {
      renderForm();
      await userEvent.selectOptions(screen.getByLabelText("Holes"), "9");
      await userEvent.click(screen.getByRole("radio", { name: "Load from CSV" }));
      await userEvent.upload(screen.getByLabelText("CSV file"), csvFile(NINE_HOLE_CSV));

      expect(await screen.findByLabelText("Hole 1 distance in yards")).toHaveValue(300);
      expect(screen.getByLabelText("Hole 1 par")).toHaveValue(5);
      expect(screen.getByLabelText("Hole 1 stroke index")).toHaveValue(1);
      expect(screen.getByLabelText("Hole 9 distance in yards")).toHaveValue(380);
    });

    it("submits the correctly-shaped payload after a CSV-populated holes table, exactly like a manual entry would", async () => {
      const { onSubmit } = renderForm();
      await userEvent.type(screen.getByLabelText("Name"), "White");
      await userEvent.selectOptions(screen.getByLabelText("Holes"), "9");
      await userEvent.type(screen.getByLabelText("Course rating"), "71.2");
      await userEvent.type(screen.getByLabelText("Slope rating"), "128");
      await userEvent.click(screen.getByRole("radio", { name: "Load from CSV" }));
      await userEvent.upload(screen.getByLabelText("CSV file"), csvFile(NINE_HOLE_CSV));
      await screen.findByLabelText("Hole 9 distance in yards");

      await userEvent.click(screen.getByRole("button", { name: "Add tee configuration" }));

      expect(onSubmit).toHaveBeenCalledTimes(1);
      const input = onSubmit.mock.calls[0]![0];
      expect(input).toMatchObject({ name: "White", holeCount: 9, courseRating: 71.2, slopeRating: 128 });
      expect(input.holes).toHaveLength(9);
      expect(input.holes[0]).toEqual({ holeNumber: 1, distanceYards: 300, par: 5, strokeIndex: 1 });
      expect(input.holes[8]).toEqual({ holeNumber: 9, distanceYards: 380, par: 4, strokeIndex: 9 });
    });

    it("shows a clear parse error for a structurally invalid file (duplicate hole number), without touching the existing holes table", async () => {
      renderForm();
      await userEvent.selectOptions(screen.getByLabelText("Holes"), "9");
      await userEvent.type(screen.getByLabelText("Hole 1 distance in yards"), "999");
      await userEvent.click(screen.getByRole("radio", { name: "Load from CSV" }));
      const duplicateCsv =
        "hole_number,distance_yards,par,stroke_index\n1,300,5,1\n1,310,4,2\n3,320,4,3\n4,330,5,4\n5,340,4,5\n6,350,4,6\n7,360,5,7\n8,370,4,8\n9,380,4,9";
      await userEvent.upload(screen.getByLabelText("CSV file"), csvFile(duplicateCsv));

      expect(await screen.findByText(/duplicate hole number 1/)).toBeInTheDocument();
      // The pre-existing manual value is still there -- a bad upload
      // never clobbers it.
      expect(screen.getByLabelText("Hole 1 distance in yards")).toHaveValue(999);
    });

    it("an individual bad value (non-numeric par) populates normally and surfaces via the SAME per-field validation a manual entry's own blank value gets, rather than blocking the whole import", async () => {
      const { onSubmit } = renderForm();
      await userEvent.type(screen.getByLabelText("Name"), "White");
      await userEvent.selectOptions(screen.getByLabelText("Holes"), "9");
      await userEvent.type(screen.getByLabelText("Course rating"), "71.2");
      await userEvent.type(screen.getByLabelText("Slope rating"), "128");
      await userEvent.click(screen.getByRole("radio", { name: "Load from CSV" }));
      const badParCsv =
        "hole_number,distance_yards,par,stroke_index\n1,300,not-a-par,1\n2,310,4,2\n3,320,4,3\n4,330,5,4\n5,340,4,5\n6,350,4,6\n7,360,5,7\n8,370,4,8\n9,380,4,9";
      await userEvent.upload(screen.getByLabelText("CSV file"), csvFile(badParCsv));
      await screen.findByLabelText("Hole 9 distance in yards");

      // No blocking parse error -- the file parsed fine overall.
      expect(screen.queryByText(/Couldn't parse|Missing required|Invalid hole numbers/)).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Add tee configuration" }));

      // Hole-table cells are bare Inputs (invalid={...} styling only,
      // no FormField/visible per-field message) -- the generic banner
      // plus this cell's own aria-invalid is the real, existing
      // "something's wrong with a hole field" signal, same as a manual
      // entry's own blank field would get. There is no separate
      // "Enter a par" text anywhere in this UI to assert on.
      expect(await screen.findByText(/distance, par, and stroke index are all required/)).toBeInTheDocument();
      expect(screen.getByLabelText("Hole 1 par")).toHaveAttribute("aria-invalid", "true");
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });
});
