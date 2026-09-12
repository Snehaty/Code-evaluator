// apps/web/lib/claims/use-claim-stream.ts
"use client";
import { useCallback, useState } from "react";
import { decodeFrames, isTerminal, type ClaimFrame } from "./frames";
import type { EvaluationPhase } from "@zkcvp/design-system-ledger/components";

export type ClaimRun =
  | { status: "idle" }
  | {
      status: "running";
      phase: EvaluationPhase;
      completed: EvaluationPhase[];
      filesRead: number;
      round: number;
      startedAt: number;
    }
  | { status: "done"; claimId: string }
  | { status: "failed"; message: string; retryAt?: string };

export function useClaimStream() {
  const [run, setRun] = useState<ClaimRun>({ status: "idle" });

  const submit = useCallback(
    async (projectId: string, body: unknown) => {
      const startedAt = Date.now();
      setRun({
        status: "running",
        /* "claim" is complete the instant the stream opens: the claim row is
         * written before a byte of body is sent. */
        phase: "plan",
        completed: ["claim"],
        filesRead: 0,
        round: 0,
        startedAt,
      });

      const res = await fetch(`/api/projects/${projectId}/claims`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok || !res.body) {
        const problem = await res.json().catch(() => null);
        setRun({
          status: "failed",
          message: problem?.error?.message ?? "The claim could not be submitted.",
        });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let rest = "";

      const apply = (frame: ClaimFrame) => {
        if (frame.t === "progress") {
          setRun((prev) =>
            prev.status === "running"
              ? {
                  ...prev,
                  phase: frame.phase as EvaluationPhase,
                  completed: prev.completed.includes(frame.phase as EvaluationPhase)
                    ? prev.completed
                    : [...prev.completed, frame.phase as EvaluationPhase],
                  filesRead: frame.filesRead,
                  round: frame.round,
                }
              : prev,
          );
          return;
        }
        if (frame.t === "done") {
          setRun({ status: "done", claimId: frame.claimId });
          return;
        }
        setRun({ status: "failed", message: frame.message, retryAt: frame.retryAt });
      };

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const decoded = decodeFrames(rest + decoder.decode(value, { stream: true }));
          rest = decoded.rest;
          for (const frame of decoded.frames) {
            apply(frame);
            if (isTerminal(frame)) return;
          }
        }
        /* The stream ended with no terminal frame — the connection dropped or
         * the host cut the request. Never report this as a verdict. */
        setRun({
          status: "failed",
          message: "The connection ended before a verdict was recorded. Submit the claim again.",
        });
      } catch {
        setRun({
          status: "failed",
          message: "The run was interrupted before a verdict was recorded.",
        });
      }
    },
    [],
  );

  return { run, submit };
}
