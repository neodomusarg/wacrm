"use client";

import { useEffect, useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTranslations } from "next-intl";
import type { Deal, PipelineStage } from "@/types";
import { LOST_REASONS, stageTypeOf, type LostReason } from "@/lib/neodomus";

interface StageTransitionDialogProps {
  open: boolean;
  deal: Deal | null;
  stage: PipelineStage | null;
  onCancel: () => void;
  onConfirm: (extra: { lost_reason?: LostReason; recontact_date?: string }) => void;
}

function getLocalDateString(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function StageTransitionDialog({
  open,
  deal,
  stage,
  onCancel,
  onConfirm,
}: StageTransitionDialogProps) {
  const t = useTranslations("Pipelines.transition");
  const stageType = stageTypeOf(stage);

  const todayStr = useMemo(() => getLocalDateString(), []);
  const defaultFutureDate = useMemo(() => {
    const future = new Date();
    future.setDate(future.getDate() + 30);
    return getLocalDateString(future);
  }, []);

  const [lostReason, setLostReason] = useState<LostReason | "">("");
  const [recontactDate, setRecontactDate] = useState<string>("");

  // Reset form fields when the dialog opens or the selected deal changes.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    if (stageType === "lost") {
      setLostReason(deal?.lost_reason ?? "");
    } else if (stageType === "paused") {
      setRecontactDate(deal?.recontact_date ?? defaultFutureDate);
    }
  }, [open, stageType, deal, defaultFutureDate]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!deal || !stage) return null;

  const isLost = stageType === "lost";
  const isPaused = stageType === "paused";

  const isConfirmDisabled =
    (isLost && !lostReason) ||
    (isPaused && (!recontactDate || recontactDate < todayStr));

  function handleConfirm() {
    if (isLost) {
      if (!lostReason) return;
      onConfirm({ lost_reason: lostReason as LostReason });
    } else if (isPaused) {
      if (!recontactDate || recontactDate < todayStr) return;
      onConfirm({ recontact_date: recontactDate });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="sm:max-w-sm bg-popover border-border">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {isLost ? t("markAsLostTitle") : t("pauseAndRecontactTitle")}
          </DialogTitle>
        </DialogHeader>

        <div className="py-2 space-y-4">
          {isLost && (
            <div className="space-y-2">
              <Label className="text-muted-foreground">{t("lostReason")}</Label>
              <select
                value={lostReason}
                onChange={(e) => setLostReason(e.target.value as LostReason)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="">{t("selectLostReason")}</option>
                {LOST_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {reason}
                  </option>
                ))}
              </select>
            </div>
          )}

          {isPaused && (
            <div className="space-y-2">
              <Label className="text-muted-foreground">{t("recontactDate")}</Label>
              <Input
                type="date"
                min={todayStr}
                value={recontactDate}
                onChange={(e) => setRecontactDate(e.target.value)}
                className="bg-muted border-border text-foreground"
              />
              <p className="text-xs text-muted-foreground">
                {t("recontactReminderNotice")}
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="bg-popover/50 border-border">
          <Button
            variant="outline"
            onClick={onCancel}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            {t("cancel")}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isConfirmDisabled}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
