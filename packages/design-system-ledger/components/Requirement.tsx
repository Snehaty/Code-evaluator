"use client";

import type { ReactNode } from "react";
import { cx } from "./cx";
import { StatusBadge, VersionPill } from "./Badge";
import type { RequirementDisplayStatus } from "./types";

export interface RequirementRowProps {
  title: string;
  /** One or two sentences. Set at the reading size, not the UI size. */
  description?: ReactNode;
  /**
   * The status of the requirement's CURRENT version, resolved through
   * `requirements.current_version_id` at read time.
   *
   * Plan 01 forbids storing effective status on the requirement, so this is
   * always assumed to have come from a join. Pass the value; never derive it
   * from whether a verdict exists somewhere in the row's history.
   */
  status: RequirementDisplayStatus;
  /** The version the status above belongs to. */
  version?: number;
  /**
   * From `requirements.archived_at`.
   *
   * Orthogonal to status. A requirement can be archived whatever its
   * verification history, and archiving says nothing about whether it was ever
   * verified — so when this is set the badge shows "Archived" but the title is
   * only dimmed, never struck through or emptied.
   */
  archived?: boolean;
  actions?: ReactNode;
  onClick?: () => void;
  className?: string;
}

