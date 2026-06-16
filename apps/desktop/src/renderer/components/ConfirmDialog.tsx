import { WarningCircleIcon } from "@/assets/file-type-icons";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ConfirmDialogTone = "default" | "danger";

export interface ConfirmDialogOptions {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmDialogTone;
  source?: string;
}

type ConfirmDialogRequest = ConfirmDialogOptions & { id: number };
type ConfirmDialogFn = (options: ConfirmDialogOptions) => Promise<boolean>;

const ConfirmDialogContext = createContext<ConfirmDialogFn | null>(null);

export function ConfirmDialogProvider(props: { children: ReactNode }) {
  const { t } = useTranslation();
  const [request, setRequest] = useState<ConfirmDialogRequest | null>(null);
  const resolverRef = useRef<((confirmed: boolean) => void) | undefined>(undefined);
  const nextIdRef = useRef(1);

  const confirm = useCallback<ConfirmDialogFn>((options) => {
    return new Promise((resolve) => {
      if (resolverRef.current) {
        console.warn("[confirm-dialog] 新确认弹窗覆盖了尚未处理的弹窗", {
          previousId: request?.id,
          nextSource: options.source
        });
        resolverRef.current(false);
      }
      const nextRequest: ConfirmDialogRequest = {
        id: nextIdRef.current++,
        tone: "default",
        ...options
      };
      resolverRef.current = resolve;
      setRequest(nextRequest);
      console.info("[confirm-dialog] 打开确认弹窗", {
        id: nextRequest.id,
        source: nextRequest.source,
        tone: nextRequest.tone,
        title: nextRequest.title
      });
    });
  }, [request?.id]);

  const settle = useCallback(
    (confirmed: boolean) => {
      if (!request || !resolverRef.current) {
        return;
      }
      const resolver = resolverRef.current;
      resolverRef.current = undefined;
      setRequest(null);
      console.info("[confirm-dialog] 用户处理确认弹窗", {
        id: request.id,
        source: request.source,
        confirmed
      });
      resolver(confirmed);
    },
    [request]
  );

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmDialogContext.Provider value={value}>
      {props.children}
      <ConfirmDialog
        open={Boolean(request)}
        title={request?.title ?? ""}
        description={request?.description ?? ""}
        confirmLabel={request?.confirmLabel ?? t("confirmDialog.confirm")}
        cancelLabel={request?.cancelLabel ?? t("confirmDialog.cancel")}
        tone={request?.tone ?? "default"}
        onOpenChange={(open) => {
          if (!open) {
            settle(false);
          }
        }}
        onCancel={() => settle(false)}
        onConfirm={() => settle(true)}
      />
    </ConfirmDialogContext.Provider>
  );
}

export function useConfirmDialog(): ConfirmDialogFn {
  const confirm = useContext(ConfirmDialogContext);
  if (!confirm) {
    throw new Error("useConfirmDialog must be used inside ConfirmDialogProvider");
  }
  return confirm;
}

function ConfirmDialog(props: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  tone: ConfirmDialogTone;
  onOpenChange(open: boolean): void;
  onCancel(): void;
  onConfirm(): void;
}) {
  const danger = props.tone === "danger";
  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialogContent>
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "mt-0.5 flex size-8 flex-none items-center justify-center rounded-full border",
              danger
                ? "border-error-soft bg-error-soft text-error-deep"
                : "border-link-bg-soft bg-link-bg-soft text-link-deep"
            )}
          >
            <WarningCircleIcon className="size-4" />
          </span>
          <AlertDialogHeader className="min-w-0 flex-1">
            <AlertDialogTitle>{props.title}</AlertDialogTitle>
            <AlertDialogDescription>{props.description}</AlertDialogDescription>
          </AlertDialogHeader>
        </div>
        <AlertDialogFooter>
          <Button variant="secondary" size="sm" asChild>
            <AlertDialogCancel onClick={props.onCancel}>{props.cancelLabel}</AlertDialogCancel>
          </Button>
          <Button variant={danger ? "destructive" : "default"} size="sm" asChild>
            <AlertDialogAction onClick={props.onConfirm}>{props.confirmLabel}</AlertDialogAction>
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
