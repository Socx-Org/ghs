import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { Alert } from "../Alert";
import { Button } from "../Button";
import { FormField } from "../FormField";
import { Input } from "../Input";
import { Modal } from "../Modal";
import { useToast } from "../useToast";
import { ApiError, updateRoundPlayedAt } from "../../lib/api";
import { isoStringToDateInputValue, playedAtToIsoString } from "../../lib/dates";

export interface EditPlayedDateButtonProps {
  roundId: string;
  playedAt: string;
  size?: "sm" | "md";
}

// ghs#169: one shared "Edit date" affordance -- a button opening a small
// modal with a single date field -- used on both RoundEntryPage
// (draft/rejected/amending) and RoundDetailsPage (all four editable
// statuses, including pending -- RoundEntryPage never even renders a
// form for a pending round at all, so RoundDetailsPage is the only place
// that status's edit affordance can live; see this issue's own
// discovery notes). One shared component rather than two independent
// implementations, so the action isn't inconsistently a modal on one
// screen and something else on the other depending on which a player
// happens to be viewing.
//
// Self-contained: owns its own open/form/mutation state and invalidates
// ["rounds", roundId] on success -- the one cache key both pages already
// read this round through -- so neither caller needs any wiring beyond
// rendering this component while the round's status allows the edit
// (DATE_EDITABLE_ROUND_STATUSES, types/domain.ts).
export function EditPlayedDateButton({ roundId, playedAt, size = "sm" }: EditPlayedDateButtonProps) {
  const [open, setOpen] = useState(false);
  const [dateValue, setDateValue] = useState(() => isoStringToDateInputValue(playedAt));
  const [feedback, setFeedback] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { show } = useToast();

  function openModal() {
    // Re-derived from the current playedAt every time the modal opens,
    // not just once at mount -- this button stays rendered across
    // whatever re-fetches happen while it's closed (e.g. after a
    // previous edit), so a stale dateValue from an earlier open must
    // never resurface (review discipline already established elsewhere
    // in this app, e.g. AdminRoundReviewPage's closeRejectModal).
    setDateValue(isoStringToDateInputValue(playedAt));
    setFeedback(null);
    setOpen(true);
  }

  const mutation = useMutation({
    mutationFn: (newPlayedAt: string) => updateRoundPlayedAt(roundId, newPlayedAt),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rounds", roundId] });
      setOpen(false);
      show({ variant: "success", message: "Played date updated.", duration: 2500 });
    },
    onError: (error) => {
      // Deliberately doesn't close the modal here -- same convention as
      // every other destructive/consequential confirmation in this app
      // (e.g. account/course/round deletion): the player can see the
      // error and retry from the still-open form.
      setFeedback(error instanceof ApiError ? error.message : "Couldn't update the played date. Try again.");
    },
  });

  // Review fix: clearing the native date input leaves dateValue "" --
  // playedAtToIsoString would then construct an Invalid Date and
  // .toISOString() on it throws a RangeError, synchronously, outside
  // useMutation's own try/catch (it happens while computing .mutate()'s
  // argument, not inside mutationFn) -- an uncaught exception in a click
  // handler, not a caught, reportable error. Validated here instead, the
  // same "reject bad input at the boundary" discipline as every other
  // form in this app.
  function handleSave() {
    if (!dateValue) {
      setFeedback("Choose a date.");
      return;
    }
    mutation.mutate(playedAtToIsoString(dateValue));
  }

  return (
    <>
      <Button variant="secondary" size={size} icon={<Pencil aria-hidden="true" className="h-4 w-4" />} onClick={openModal}>
        Edit date
      </Button>

      {open && (
        <Modal
          open={open}
          onClose={() => setOpen(false)}
          title="Edit played date"
          footer={
            <>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button isLoading={mutation.isPending} disabled={!dateValue} onClick={handleSave}>
                Save
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            {feedback && <Alert variant="error">{feedback}</Alert>}
            <FormField label="Date played">
              <Input type="date" value={dateValue} onChange={(event) => setDateValue(event.target.value)} />
            </FormField>
          </div>
        </Modal>
      )}
    </>
  );
}
