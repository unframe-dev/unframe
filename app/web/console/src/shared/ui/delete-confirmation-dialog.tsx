import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Button } from "./button";

type DeleteConfirmationDialogProps = {
  triggerLabel: string;
  title: string;
  description: string;
  disabled?: boolean;
  onConfirm: () => Promise<void>;
  errorMessage: (error: unknown) => string;
};

export function DeleteConfirmationDialog({
  triggerLabel,
  title,
  description,
  disabled,
  onConfirm,
  errorMessage,
}: DeleteConfirmationDialogProps) {
  const [open, setOpen] = useState(false);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const submitting = useRef(false);
  const mutation = useMutation({ mutationFn: onConfirm, retry: false });
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (submitting.current) return;
        if (nextOpen) mutation.reset();
        setOpen(nextOpen);
      }}
    >
      <AlertDialog.Trigger render={<Button variant="outline" disabled={disabled} />}>
        {triggerLabel}
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-80 bg-black/45" />
        <AlertDialog.Popup
          className="fixed top-1/2 left-1/2 z-81 grid max-h-[calc(100dvh-2rem)] w-[min(440px,calc(100%-2rem))] -translate-1/2 gap-4 overflow-y-auto rounded-[20px] border border-[var(--line)] bg-[var(--surface)] p-6 text-[var(--foreground)] shadow-xl"
          initialFocus={cancelButton}
        >
          <AlertDialog.Title className="text-xl font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description className="break-words text-sm text-[var(--muted)]">
            {description}
          </AlertDialog.Description>
          {mutation.isError ? <p role="alert">{errorMessage(mutation.error)}</p> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <AlertDialog.Close
              render={<Button ref={cancelButton} variant="outline" disabled={mutation.isPending} />}
            >
              キャンセル
            </AlertDialog.Close>
            <Button
              variant="destructive"
              disabled={mutation.isPending}
              onClick={() => {
                if (submitting.current) return;
                submitting.current = true;
                mutation.mutate(undefined, {
                  onSuccess: () => setOpen(false),
                  onSettled: () => {
                    submitting.current = false;
                  },
                });
              }}
            >
              {mutation.isPending ? "削除しています…" : "削除する"}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
