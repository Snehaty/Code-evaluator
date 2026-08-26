/**
 * GATHER node — reads files from GitHub.
 *
 * 🤖 LLM: NO
 * 📡 GitHub API: YES (readFile for each planned path)
 *
 * Reads every file path from the plan (or additionalFilesNeeded on loop-back).
 * Logs every call to toolCallLog for the EvidenceBundle.
 * Gracefully handles missing files (404s).
 */
import type { ToolCall } from "@zkcvp/contracts";
import type { EvaluatorState } from "../state";

/** Max characters per file to avoid blowing up LLM context. */
const MAX_FILE_CHARS = 15_000;

function truncate(content: string): string {
  if (content.length <= MAX_FILE_CHARS) return content;
  return (
    content.substring(0, MAX_FILE_CHARS) +
    "\n\n[TRUNCATED — file exceeds size limit]"
  );
}

export async function gatherNode(
  state: EvaluatorState,
): Promise<Partial<EvaluatorState>> {
  const { repoCommits, github } = state;

  // On first run, use plan. On loop-back, use additionalFilesNeeded.
  const filesToRead =
    state.iterationCount === 0 ? state.plan : state.additionalFilesNeeded;

  const newToolCalls: ToolCall[] = [];
  const newFiles: Record<string, string> = { ...state.gatheredFiles };

  for (const filePath of filesToRead) {
    // Skip if already gathered
    if (newFiles[filePath]) continue;

    // Read from the first repo+commit (most claims have one)
    // TODO: support multi-repo claims by matching path to repo
    const rc = repoCommits[0];

    try {
      const content = await github.readFile(rc.repo, rc.commitSha, filePath);
      const truncated = truncate(content);
      newFiles[filePath] = truncated;

      newToolCalls.push({
        tool: "readFile",
        args: { repo: rc.repo, commitSha: rc.commitSha, path: filePath },
        result: truncated,
        at: new Date().toISOString(),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      newFiles[filePath] = `[ERROR] ${message}`;

      newToolCalls.push({
        tool: "readFile",
        args: { repo: rc.repo, commitSha: rc.commitSha, path: filePath },
        result: `[ERROR] ${message}`,
        at: new Date().toISOString(),
      });
    }
  }

  return {
    toolCallLog: [...state.toolCallLog, ...newToolCalls],
    gatheredFiles: newFiles,
    iterationCount: state.iterationCount + 1,
  };
}
