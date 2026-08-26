/**
 * PLAN node — decides which files to read.
 *
 * 🤖 LLM: YES (reads file tree + requirements, outputs file paths)
 * 📡 GitHub API: YES (listTree to get repo structure)
 *
 * This is the first node in the graph. It:
 * 1. Calls listTree() to get the repo's file structure at the commit SHA
 * 2. Gives the LLM: file tree + all requirement descriptions
 * 3. LLM outputs a list of file paths to read
 */
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { z } from "zod";
import type { EvaluatorState } from "../state";

const PlanOutputSchema = z.object({
  filesToRead: z
    .array(z.string())
    .describe("File paths to read from the repo, e.g. ['src/auth.ts', 'prisma/schema.prisma']"),
  reasoning: z
    .string()
    .describe("Brief explanation of why these files were chosen"),
});

export async function planNode(
  state: EvaluatorState,
): Promise<Partial<EvaluatorState>> {
  const { repoCommits, requirements, github } = state;

  // 1. Get file tree for each repo+commit
  const treeSummaries: string[] = [];
  const treeToolCalls: EvaluatorState["toolCallLog"] = [];

  for (const rc of repoCommits) {
    const entries = await github.listTree(rc.repo, rc.commitSha);
    const timestamp = new Date().toISOString();
    treeToolCalls.push({
      tool: "listTree",
      args: { repo: rc.repo, commitSha: rc.commitSha },
      result: `${entries.length} entries`,
      at: timestamp,
    });

    // Build a readable tree summary (files only, skip dirs)
    const fileList = entries
      .filter((e) => e.type === "file")
      .map((e) => `  ${e.path}${e.size ? ` (${e.size}b)` : ""}`)
      .join("\n");

    treeSummaries.push(
      `Repository: ${rc.repo} @ ${rc.commitSha.substring(0, 8)}\n${fileList}`,
    );
  }

  // 2. Build the prompt
  const requirementsList = requirements
    .map((r, i) => `${i + 1}. [${r.title}]: ${r.description}`)
    .join("\n");

  const prompt = `You are a code review planner. Given a repository file tree and a set of requirements, decide which files need to be read to evaluate whether the code satisfies the requirements.

FILE TREE:
${treeSummaries.join("\n\n")}

REQUIREMENTS TO EVALUATE:
${requirementsList}

Select the files most likely to contain evidence for or against these requirements. Be selective — don't list every file. Focus on source code files relevant to the requirements. Skip assets, images, lock files, and configs unless a requirement specifically mentions them.

Return at most 25 files.`;

  // 3. Call Gemini with structured output
  const llm = new ChatGoogleGenerativeAI({
    model: state.modelId ?? "gemini-3.5-flash",
    temperature: 0,
  });

  const structured = llm.withStructuredOutput(PlanOutputSchema);
  const result = await structured.invoke(prompt);

  return {
    plan: result.filesToRead,
    toolCallLog: [...state.toolCallLog, ...treeToolCalls],
  };
}
