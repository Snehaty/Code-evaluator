/**
 * Render check.
 *
 *   npm run check
 *
 * Server-renders every gallery section and asserts things about the resulting
 * markup. It exists because a typecheck proves the components compile and a
 * build proves the graph resolves, and neither proves the thing that actually
 * matters here: that the rules in README.md hold in output a user would see.
 *
 * Every assertion below corresponds to a documented domain rule. When one fails,
 * the fix is in the component, not in the assertion.
 *
 * Note the scoping in the two enum and ARIA checks. The gallery's own specimen
 * notes DISCUSS `eval_failed` and `aria-valuenow` in prose, deliberately, so a
 * naive substring search over the whole document reports its own documentation
 * as a leak. The checks therefore look at the elements that carry the rule
 * rather than at the page.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { Gallery } from "../gallery/Gallery";
import { Foundations } from "../gallery/sections/Foundations";
import { Controls } from "../gallery/sections/Controls";
import { Containers } from "../gallery/sections/Containers";
import { FeedbackSection } from "../gallery/sections/Feedback";
import { Domain } from "../gallery/sections/Domain";

let failed = 0;
const parts: string[] = [];

const cases: Array<[string, () => string]> = [
  ["Gallery", () => renderToStaticMarkup(<Gallery />)],
  ["Foundations", () => renderToStaticMarkup(<Foundations />)],
  ["Controls", () => renderToStaticMarkup(<Controls />)],
  ["Containers", () => renderToStaticMarkup(<Containers />)],
  ["Feedback", () => renderToStaticMarkup(<FeedbackSection />)],
  ["Domain", () => renderToStaticMarkup(<Domain />)],
];

for (const [name, run] of cases) {
  try {
    const html = run();
    parts.push(html);
    console.log(`ok   render ${name} (${html.length} chars)`);
  } catch (e) {
    failed++;
    console.log(`FAIL render ${name}: ${(e as Error).message}`);
  }
}

const doc = parts.join("\n");

/** Inner text of every element whose class list contains `cls`. */
function textOf(cls: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<(\\w+)[^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*>([\\s\\S]*?)</\\1>`, "g");
  for (const m of doc.matchAll(re)) out.push(m[2].replace(/<[^>]+>/g, ""));
  return out;
}

/** The opening tags of every element carrying `role="x"`. */
function tagsWithRole(role: string): string[] {
  return [...doc.matchAll(new RegExp(`<\\w+[^>]*role="${role}"[^>]*>`, "g"))].map((m) => m[0]);
}

const chipText = textOf("lg-chip").join(" | ");
const progressTags = tagsWithRole("progressbar");

const checks: Array<[string, boolean]> = [
  // eval_failed is a negative verdict, not a malfunction.
  ["status chips say 'Not satisfied'", chipText.includes("Not satisfied")],
  ["no status chip leaks a raw enum name", !/eval_failed|not_satisfied/.test(chipText)],
  ["negative verdict has its own chip class", doc.includes("lg-chip--unsatisfied")],
  /* `unsatisfied` and `danger` share a red now, so this no longer separates two
     hues — it keeps the two CLASSES apart. That is what lets a verdict and a
     failure be re-separated later without hunting for which red meant which,
     and it is why a failure must never be marked up as a verdict on the way to
     looking the same. */
  ["a failure is never marked up as a verdict", !/lg-chip--danger[^>]*>[^<]*Not satisfied/.test(doc)],

  // new is an absence of information, not a caution.
  ["status new renders as 'Not evaluated'", chipText.includes("Not evaluated")],

  // archived is orthogonal to status.
  ["archived renders as its own dashed chip", doc.includes("lg-chip--archived")],

  // Sealed is not unverifiable.
  ["sealed evidence keeps a live verify action", doc.includes("Verify digest")],

  // An intact record is not a correct judgment.
  [
    "log caveat is present verbatim",
    doc.includes("It does not confirm the evaluation reached the right conclusion"),
  ],
  ["valid proof does not reuse the satisfied colour", !/lg-logref[^>]*data-state="verified"[\s\S]{0,400}lg-chip--satisfied/.test(doc)],

  // Never fake a progress percentage.
  ["at least one indeterminate progressbar rendered", progressTags.length > 0],
  ["no progressbar declares aria-valuenow", !progressTags.some((t) => t.includes("aria-valuenow"))],

  // Digests are compared by eye, head and tail.
  ["digests truncate in the middle", /\w+…\w+/.test(doc)],

  // Identity is never coloured.
  ["role chips carry no verdict tone", !/lg-chip--role[^"]*(satisfied|danger|warning)/.test(doc)],

  // Icons come from one family, and they render.
  ["phosphor icons render as svg", (doc.match(/<svg/g) || []).length > 40],

  // House style.
  ["no em dash or en dash anywhere in the output", !/[—–]/.test(doc)],

  // Accessibility floors that are easy to regress.
  ["every icon-only button has an accessible name", !/<button(?![^>]*aria-label)[^>]*lg-icon-btn/.test(doc)],
  ["tab strip uses the ARIA tabs pattern", doc.includes('role="tablist"') && doc.includes('aria-selected')],
];

console.log("");
for (const [label, pass] of checks) {
  if (!pass) failed++;
  console.log(`${pass ? "ok  " : "FAIL"} ${label}`);
}

console.log(`\n${failed === 0 ? "ALL PASS" : `${failed} FAILURE(S)`}`);
process.exit(failed === 0 ? 0 : 1);
