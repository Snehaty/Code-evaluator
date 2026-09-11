import type { EvaluationErrorKind } from "@zkcvp/contracts";

/** The Evaluator's graph nodes, in the order a run first reaches them. */
export type ClaimPhase = "plan" | "gather" | "analyze" | "format";

/**
 * The wire protocol for a claim submission.
 *
 * Streaming spends the HTTP status code before the outcome is known, so the
 * terminal FRAME carries the outcome instead of the status line:
 *
 *     A verdict is a `done` frame. A failure is a `failed` frame.
 *     Never both, never neither.
 *
 * `done` and `failed` are structurally different objects, which is what makes
 * an infrastructure failure impossible to read as a completed evaluation that
 * returned "not satisfied". `failed.status` carries the code the response
 * would have had, so a client can still treat a rate limit as a rate limit.
 */
export type ClaimFrame =
  | { t: "progress"; phase: ClaimPhase; filesRead: number; round: number }
  | { t: "done"; claimId: string; evaluationId: string }
  | {
      t: "failed";
      kind: EvaluationErrorKind;
      status: number;
      message: string;
      retryAt?: string;
    };

export function encodeFrame(frame: ClaimFrame): string {
  return JSON.stringify(frame) + "\n";
}

/**
 * Reads whole frames out of a buffer, returning the unterminated tail.
 *
 * A network chunk can split a line anywhere, so the caller keeps `rest` and
 * prepends it to the next chunk. Parsing eagerly on chunk boundaries would
 * throw on a half-written frame roughly whenever a run got interesting.
 */
export function decodeFrames(buffer: string): {
  frames: ClaimFrame[];
  rest: string;
} {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const frames = lines
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as ClaimFrame);
  return { frames, rest };
}

export function isTerminal(
  frame: ClaimFrame,
): frame is Extract<ClaimFrame, { t: "done" | "failed" }> {
  return frame.t === "done" || frame.t === "failed";
}
