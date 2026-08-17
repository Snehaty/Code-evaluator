"use client";

import type { ReactNode } from "react";
import { cx } from "./cx";
import { VerdictBadge } from "./Badge";
import { Button } from "./Button";
import { HashRef } from "./Identifiers";
import { ICON_LG, ICON_MD, IconLogProof, IconSealed } from "./icons";
import {
  LOG_REF_CAVEAT,
  LOG_REF_LABEL,
  VERDICT_LABEL,
  type LogRefState,
  type Verdict,
} from "./types";

export interface VerdictCardProps {
  requirementTitle: string;
  verdict: Verdict;
  /**
   * Human language only. Per the Evaluator contract, a rationale may cite a file
   * path or a line range but must never embed verbatim source — that is enforced
   * at generation time in the agent, not here.
   */
  rationale: ReactNode;
  /** Typically a row of FileRefs, plus the pinned SHA the verdict was read at. */
  footer?: ReactNode;
  className?: string;
}

/**
 * One entry from `report.perRequirement`.
 *
 * Styled as prose, deliberately — not as a code block. If the agent ever leaked
 * verbatim source into a rationale, it would render as visibly wrong here, set
 * in a reading typeface at a 66-character measure. That is a weak but free
 * signal. It is NOT a filter and must not be relied on as one: filtering code
 * out of already-generated text is unreliable, which is why the constraint lives
 * in the agent's output step instead.
 */
export function VerdictCard({
  requirementTitle,
  verdict,
  rationale,
  footer,
  className,
}: VerdictCardProps) {
  return (
    <article
      className={cx("lg-verdict-card", className)}
      data-verdict={verdict}
    >
      <header className="lg-verdict-card__header">
        <h3 className="lg-verdict-card__title">{requirementTitle}</h3>
        <VerdictBadge verdict={verdict} />
      </header>

      <div className="lg-verdict-card__rationale">{rationale}</div>

      {footer && <footer className="lg-verdict-card__footer">{footer}</footer>}
    </article>
  );
}

/**
 * The headline verdict on a stakeholder's report view.
 *
 * The largest fact on the page, which is the reason this direction carries a
 * display type size at all. A negative verdict is set in plain ink rather than
 * tinted — it does not need a hue to be emphatic, and giving it one would put it
 * next to the red that this system reserves for things that actually broke.
 */
export function VerdictStatement({
  verdict,
  requirementCount,
  className,
}: {
  verdict: Verdict;
  /** How many requirements this verdict covers. */
  requirementCount?: number;
  className?: string;
}) {
  return (
    <div className={cx("lg-verdict-statement", className)} data-verdict={verdict}>
      <span className="lg-micro-label">Evaluator verdict</span>
      <strong className="lg-verdict-statement__value">
        {VERDICT_LABEL[verdict]}
      </strong>
      {requirementCount !== undefined && (
        <span className="lg-caption">
          Across {requirementCount} pinned requirement
          {requirementCount === 1 ? "" : "s"}, read at the commits named below.
        </span>
      )}
    </div>
  );
}

export interface EvidenceLockProps {
  evidenceHash: string;
  algorithm?: string;
  /** Wired to the Transparency Log's verify() once that exists. */
  onVerify?: () => void;
  className?: string;
}

/**
 * The withheld evidence bundle.
 *
 * Two things have to land at once, and they are easy to conflate:
 *
 *   1. The bundle's contents are not viewable. It holds real source from a
 *      private repo and no disclosure mechanism exists in this phase.
 *   2. Its digest is still independently checkable. Verifying that the evidence
 *      was never altered and disclosing what the evidence SAYS are separate
 *      operations, and the first never requires the second.
 *
 * So the verify action stays live while the content stays sealed, and it is a
 * real secondary button rather than a greyed-out hint. Removing it because the
 * bundle is private would collapse the distinction the whole trust model rests
 * on: withheld is not unverifiable.
 */
export function EvidenceLock({
  evidenceHash,
  algorithm = "sha256",
  onVerify,
  className,
}: EvidenceLockProps) {
  return (
    <div className={cx("lg-evidence", className)}>
      <span className="lg-evidence__icon">
        <IconSealed size={ICON_LG} />
      </span>

      <span className="lg-evidence__body">
        <span className="lg-evidence__label">
          Evidence bundle sealed
          <HashRef hash={evidenceHash} algorithm={algorithm} />
        </span>
        <span className="lg-evidence__note">
          Contents are not disclosed in this phase. The digest can still be
          checked against the log without revealing them.
        </span>
      </span>

      <span className="lg-evidence__actions">
        {onVerify && (
          <Button size="sm" onClick={onVerify}>
            Verify digest
          </Button>
        )}
      </span>
    </div>
  );
}

/**
 * A transparency-log reference.
 *
 * The most dangerous component in the product to get wrong. An inclusion proof
 * shows the RECORD was not quietly altered after it was written. It says nothing
 * whatsoever about whether the Evaluator's judgment was correct.
 *
 * Two things enforce that here:
 *
 *   - The caveat is not an optional prop. It comes from `LOG_REF_CAVEAT` keyed
 *     by state, so there is no call site that can render this component without
 *     the sentence that keeps it honest.
 *   - A valid proof renders in plain ink, never in the satisfied green. Reusing
 *     the verdict colour would fuse the two claims in exactly the way this
 *     product must never fuse them.
 */
export function LogRef({
  state,
  leafHash,
  algorithm = "sha256",
  onCheck,
  className,
}: {
  state: LogRefState;
  leafHash?: string;
  algorithm?: string;
  onCheck?: () => void;
  className?: string;
}) {
  return (
    <div className={cx("lg-logref", className)} data-state={state}>
      <div className="lg-logref__head">
        <span className="lg-logref__state">
          <IconLogProof size={ICON_MD} />
          {LOG_REF_LABEL[state]}
        </span>
        {leafHash && <HashRef hash={leafHash} algorithm={algorithm} />}
        {onCheck && state !== "unavailable" && (
          <>
            <span className="lg-spacer" />
            <Button size="sm" tone="quiet" onClick={onCheck}>
              Re-check
            </Button>
          </>
        )}
      </div>
      <p className="lg-logref__caveat">{LOG_REF_CAVEAT[state]}</p>
    </div>
  );
}
