import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { AccessMode } from "@chengxiaobang/shared";
import { useConfirmDialog } from "@/components/ConfirmDialog";

export function useAccessModeSelection(options: {
  accessMode: AccessMode;
  setAccessMode(mode: AccessMode): void;
  source: string;
}): (mode: AccessMode) => Promise<void> {
  const { t } = useTranslation();
  const confirmDialog = useConfirmDialog();
  const { accessMode, setAccessMode, source } = options;

  return useCallback(
    async (mode: AccessMode) => {
      if (mode === accessMode) {
        console.debug("[access-mode] 忽略重复权限模式选择", {
          source,
          mode
        });
        return;
      }

      if (mode === "full_access") {
        console.info("[access-mode] 请求切换到完全访问，等待用户确认", {
          source,
          previousMode: accessMode
        });
        const confirmed = await confirmDialog({
          title: t("permission.fullAccessWarningTitle"),
          description: t("permission.fullAccessWarningDescription"),
          confirmLabel: t("permission.fullAccessWarningConfirm"),
          cancelLabel: t("permission.fullAccessWarningCancel"),
          tone: "danger",
          source: `${source}.fullAccessWarning`
        });
        console.info("[access-mode] 完全访问确认结果", {
          source,
          previousMode: accessMode,
          confirmed
        });
        if (!confirmed) {
          return;
        }
      }

      console.info("[access-mode] 切换权限模式", {
        source,
        previousMode: accessMode,
        nextMode: mode
      });
      setAccessMode(mode);
    },
    [accessMode, confirmDialog, setAccessMode, source, t]
  );
}
