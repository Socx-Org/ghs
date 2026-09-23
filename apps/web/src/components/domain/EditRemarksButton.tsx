import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { Alert } from "../Alert";
import { Button } from "../Button";
import { FormField } from "../FormField";
import { Textarea } from "../Textarea";
import { Modal } from "../Modal";
import { useToast } from "../useToast";
import { ApiError, updateRoundRemarks } from "../../lib/api";

export interface EditRemarksButtonProps {
  roundId: string;
  remarks: string | null;
  size?: "sm" | "md";
}

// ghs#215: mirrors EditPlayedDateButton.tsx exactly (ghs#169) -- one
// shared "Edit remarks" affordance (a button opening a small modal with
// a single field), self-contained open/form/mutation state, invalidates
// ["rounds", roundId] on success. Used on both RoundDetailsPage (player)
// and AdminRoundReviewPage (admin) -- see those pages' own comments for
// why remarks is scoped there rather than RoundEntryPage/NewRoundPage.
export function EditRemarksButton({ roundId, remarks, size = "sm" }: EditRemarksButtonProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(() => remarks ?? "");
  const [feedback, setFeedback] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { show } = useToast();

  function openModal() {
    // Re-derived from the current remarks every time the modal opens,
    // same "never let a stale value from an earlier open resurface"
    // discipline as EditPlayedDateButton's own openModal.
    setValue(remarks ?? "");
    setFeedback(null);
    setOpen(true);
  }

  const mutation = useMutation({
    mutationFn: (nextRemarks: string | null) => updateRoundRemarks(roundId, nextRemarks),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rounds", roundId] });
      setOpen(false);
      show({ variant: "success", message: "Remarks updated.", duration: 2500 });
    },
    onError: (error) => {
      // Same convention as every other consequential confirmation in
      // this app -- stays open on error so the player/admin can see the
      // message and retry without having to reopen the modal.
      setFeedback(error instanceof ApiError ? error.message : "Couldn't update remarks. Try again.");
    },
  });

  function handleSave() {
    // Empty/whitespace-only clears it. The backend normalizes the same way,
    // but doing it here avoids sending meaningless whitespace and keeps the
    // payload consistent with what will be persisted.
    const trimmed = value.trim();
    mutation.mutate(trimmed.length > 0 ? trimmed : null);
  }

  return (
    <>
      <Button variant="secondary" size={size} icon={<Pencil aria-hidden="true" className="h-4 w-4" />} onClick={openModal}>
        Edit remarks
      </Button>

      {open && (
        <Modal
          open={open}
          onClose={() => setOpen(false)}
          title="Edit remarks"
          footer={
            <>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button isLoading={mutation.isPending} onClick={handleSave}>
                Save
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            {feedback && <Alert variant="error">{feedback}</Alert>}
            <FormField label="Remarks">
              <Textarea value={value} onChange={(event) => setValue(event.target.value)} placeholder="Anything worth noting about this round…" rows={4} />
            </FormField>
          </div>
        </Modal>
      )}
    </>
  );
}
