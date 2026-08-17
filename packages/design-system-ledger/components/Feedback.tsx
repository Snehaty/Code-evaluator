"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cx } from "./cx";
import { Button, IconButton } from "./Button";
import {
  ICON_MD,
  IconClose,
  IconError,
  IconInfo,
  IconSatisfied,
  IconUndo,
  IconWarning,
} from "./icons";

export type AlertTone = "info" | "success" | "warning" | "danger";

const ALERT_ICON: Record<AlertTone, typeof IconInfo> = {
  info: IconInfo,
  success: IconSatisfied,
  warning: IconWarning,
  danger: IconError,
};

export interface AlertProps {
  tone?: AlertTone;
  title?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/**
 * An inline message.
 *
 * `danger` is for things that actually failed — a rate limit, a crash, a blown
 * execution ceiling. A negative verdict is NOT one of these and must never be
 * rendered in this tone: it is a completed evaluation that disagreed, and
 * dressing it as an error tells the developer their tooling broke.
 *
 * No coloured band down the left edge. Tone is carried by the icon, the tinted
 * background and the words.
 */
export function Alert({
  tone = "info",
  title,
  children,
  actions,
  className,
}: AlertProps) {
  const Glyph = ALERT_ICON[tone];
  return (
    <div
      className={cx("lg-alert", `lg-alert--${tone}`, className)}
      /* Only the failure tones interrupt. An info alert that is part of the
         page's initial content should not be announced out of order. */
      role={tone === "danger" ? "alert" : "status"}
    >
      <span className="lg-alert__icon">
        <Glyph size={ICON_MD} />
      </span>
      <div className="lg-alert__body">
        {title && <strong className="lg-alert__title">{title}</strong>}
        <div>{children}</div>
        {actions && <div className="lg-alert__actions">{actions}</div>}
      </div>
    </div>
  );
}

/**
 * Slows under `prefers-reduced-motion` rather than stopping.
 *
 * A frozen spinner says "hung" about a request that is genuinely still running,
 * which misinforms rather than accommodates. The duration lives in
 * `--lg-dur-indicator`, which reduced motion lengthens instead of zeroing.
 */
export function Spinner({
  size = ICON_MD,
  label = "Working",
  className,
}: {
  size?: number;
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cx("lg-spinner", className)}
      style={{ width: size, height: size }}
      role="status"
      aria-label={label}
    />
  );
}

/**
 * An indeterminate progress bar. There is no `value` prop, deliberately — see
 * `EvaluationProgress` below for why this system never renders a fraction it
 * cannot honestly compute.
 */
export function ProgressBar({
  label = "In progress",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cx("lg-progress", className)}
      role="progressbar"
      aria-label={label}
      /* No aria-valuenow: omitting it is how ARIA expresses indeterminate. */
    >
      <span className="lg-progress__bar" />
    </div>
  );
}

export function Skeleton({
  width,
  height,
  className,
}: {
  width?: string | number;
  height?: string | number;
  className?: string;
}) {
  return (
    <span
      className={cx("lg-skeleton", className)}
      style={{ width, height, display: "block" }}
      aria-hidden="true"
    />
  );
}

export function EmptyState({
  title,
  children,
  actions,
  className,
}: {
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("lg-empty", className)}>
      <h3 className="lg-empty__title">{title}</h3>
      {children && <p className="lg-empty__body">{children}</p>}
      {actions}
    </div>
  );
}

export function ToastRegion({ children }: { children: ReactNode }) {
  return (
    <div className="lg-toast-region" role="region" aria-label="Notifications">
      {children}
    </div>
  );
}

export function Toast({
  children,
  onDismiss,
  className,
}: {
  children: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  return (
    <div className={cx("lg-toast", className)} role="status">
      <div className="lg-toast__body">{children}</div>
      {onDismiss && (
        <IconButton
          label="Dismiss"
          size="sm"
          icon={<IconClose size={ICON_MD} />}
          onClick={onDismiss}
        />
      )}
    </div>
  );
}

export interface UndoToastProps {
  children: ReactNode;
  /** Seconds in the window. Plan 02 fixes this at 60 for repo attachment. */
  seconds?: number;
  onUndo: () => void;
  onExpire?: () => void;
  className?: string;
}

/**
 * The undo window, with the remaining time drawn as a ring and printed as a
 * number inside it.
 *
 * Repo attachment is permanent once this window closes: plan 02 has no detach
 * endpoint and no soft-delete state, so this countdown IS the entire reversible
 * period. That is why the time is legible rather than implied by a fading toast
 * the user has to guess the duration of.
 */
export function UndoToast({
  children,
  seconds = 60,
  onUndo,
  onExpire,
  className,
}: UndoToastProps) {
  const [left, setLeft] = useState(seconds);

  useEffect(() => {
    if (left <= 0) {
      onExpire?.();
      return;
    }
    const t = window.setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => window.clearTimeout(t);
  }, [left, onExpire]);

  const r = 12;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - left / seconds);

  return (
    <div className={cx("lg-toast", className)} role="status">
      <span className="lg-countdown">
        <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
          <circle
            className="lg-countdown__track"
            cx="14"
            cy="14"
            r={r}
            fill="none"
            strokeWidth="2"
          />
          <circle
            className="lg-countdown__ring"
            cx="14"
            cy="14"
            r={r}
            fill="none"
            strokeWidth="2"
            strokeLinecap="butt"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
          />
        </svg>
        <span className="lg-countdown__value">{left}</span>
      </span>

      <div className="lg-toast__body">
        {children}
        <span className="lg-sr-only">{left} seconds left to undo.</span>
      </div>

      <Button size="sm" icon={<IconUndo size={ICON_MD} />} onClick={onUndo}>
        Undo
      </Button>
    </div>
  );
}

export interface EvaluationProgressProps {
  /** Seconds elapsed in the held-open request. */
  elapsedSeconds: number;
  /** The platform's execution ceiling for this deployment. */
  ceilingSeconds: number;
  className?: string;
}

/**
 * Evaluation in flight.
 *
 * Evaluation runs synchronously inside the request that submits the claim, so
 * the developer's own tab is held open for its full duration. Two rules, both
 * about honesty rather than aesthetics:
 *
 *   1. The bar is INDETERMINATE. There is no honest fraction for an LLM
 *      evaluation, and a fabricated percentage is the kind of small lie that
 *      costs a user their trust in everything else on the page.
 *   2. The elapsed clock turns ochre past 70% of the ceiling, so the developer
 *      is warned BEFORE the request is cut off rather than after. Ochre is this
 *      system's attention colour and is not a verdict colour, so the clock
 *      cannot be misread as a result.
 */
export function EvaluationProgress({
  elapsedSeconds,
  ceilingSeconds,
  className,
}: EvaluationProgressProps) {
  const nearCeiling = elapsedSeconds > ceilingSeconds * 0.7;

  const mmss = (s: number) =>
    `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  return (
    <div className={cx("lg-eval", className)}>
      <div className="lg-eval__head">
        <span className="lg-eval__label">
          <Spinner label="Evaluating" />
          Reading the pinned commits
        </span>
        <span className="lg-eval__clock" data-near-ceiling={nearCeiling || undefined}>
          {mmss(elapsedSeconds)} / {mmss(ceilingSeconds)}
        </span>
      </div>

      <ProgressBar label="Evaluation in progress" />

      <p className="lg-eval__note">
        {nearCeiling
          ? "This run is approaching the platform's execution limit. If it is cut off, no verdict is recorded and the claim can be submitted again."
          : "Keep this tab open. The evaluation runs inside this request, so closing it ends the run before a verdict is recorded."}
      </p>
    </div>
  );
}
