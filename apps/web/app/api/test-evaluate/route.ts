/**
 * TEST-ONLY evaluation endpoint.
 *
 * Accepts requirements directly in the request body (since the claim flow isn't
 * built yet) and runs the full evaluator pipeline using the developer's session
 * token.
 *
 * This is the glue between:
 *   - Session auth (requireDeveloper → githubAccessToken)
 *   - GitHubReadTool (token sealed inside)
 *   - LangGraphEvaluator (reads code, produces verdicts)
 *
 * In production, this will become POST /api/claims with requirements read
 * from DB and results stored. For now it's a pass-through for testing.
 *
 * Auth: developer member only (needs GitHub token in session)
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { EvaluationError, type EvaluationErrorKind } from "@zkcvp/contracts";
import { createGitHubReadTool } from "@zkcvp/github/read-tool";
import { LangGraphEvaluator } from "@zkcvp/orchestrator";
import { env } from "../../../lib/env";
import { requireDeveloper, SessionError } from "../../../lib/auth/session";

const RequestSchema = z.object({
  repoCommits: z
    .array(
      z.object({
        repo: z.string().min(1),
        commitSha: z.string().min(7),
      }),
    )
    .min(1),
  requirements: z
    .array(
      z.object({
        title: z.string().min(1),
        description: z.string().min(1),
      }),
    )
    .min(1),
});

/**
 * A verdict is a 200; a failure never is.
 *
 * That rule is the transport-layer form of PRODUCT.md principle 2. An
 * evaluation that ran and returned `not_satisfied` is a successful request with
 * a negative result. An evaluation that could not read its evidence is a failed
 * request, and the two must be impossible for a caller to confuse — otherwise a
 * rate limit reaches a stakeholder as "Not satisfied".
 */
const STATUS_BY_KIND: Record<EvaluationErrorKind, number> = {
  unauthorized: 401,
  rate_limited: 429,
  repo_unreachable: 404,
  model_unavailable: 503,
  evidence_incomplete: 422,
  deadline_exceeded: 504,
  invalid_input: 400,
};

export async function POST(request: Request) {
  // 1. Auth — get the developer's GitHub token from the session
  let session;
  try {
    session = await requireDeveloper();
  } catch (err: unknown) {
    if (err instanceof SessionError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  // 2. Parse and validate request body
  let body;
  try {
    const raw = await request.json();
    body = RequestSchema.parse(raw);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: "Invalid request body", details: String(err) },
      { status: 400 },
    );
  }

  // 3. One budget for the whole run, shared by the reads and the model calls.
  //    Both refuse to start work they cannot finish inside it, which is what
  //    keeps the host from killing the request mid-write with no error to show.
  const deadline = new Date(Date.now() + env().EVAL_CEILING_SECONDS * 1000);

  // 4. Build the GitHubReadTool (token sealed inside — LLM never sees it)
  const github = createGitHubReadTool(session.githubAccessToken, {
    deadline,
    signal: request.signal,
  });

  // 5. Build evaluator input
  //    In production: requirements come from DB, claimId from a new claims row.
  const claimId = `test-${Date.now()}`;
  const requirements = body.requirements.map((r, i) => ({
    requirementVersionId: `test-req-${i + 1}`,
    title: r.title,
    description: r.description,
  }));

  // 6. Run the evaluator
  const evaluator = new LangGraphEvaluator();
  let result;
  try {
    result = await evaluator.evaluate({
      claim: { claimId, repoCommits: body.repoCommits },
      requirements,
      github,
      modelId: env().EVAL_MODEL_ID,
      deadline,
      signal: request.signal,
    });
  } catch (err: unknown) {
    if (err instanceof EvaluationError) {
      return NextResponse.json(
        {
          error: err.message,
          kind: err.kind,
          ...(err.retryAt ? { retryAt: err.retryAt } : {}),
        },
        { status: STATUS_BY_KIND[err.kind] },
      );
    }
    return NextResponse.json(
      { error: "Evaluation failed", details: String(err) },
      { status: 500 },
    );
  }

  // 7. Return the report only.
  //    In production: evidence goes to DB (never exposed), report to the
  //    response. The evidence bundle carries verbatim private source, so even
  //    here it is summarised rather than returned.
  return NextResponse.json({
    report: result.report,
    _debug: {
      evidenceToolCallCount: result.evidence.toolCallLog.length,
      evaluationId: result.evidence.evaluationId,
      droppedPathCount: result.evidence.droppedPaths.length,
    },
  });
}
