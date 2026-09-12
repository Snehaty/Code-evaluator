// apps/web/app/claims/[id]/page.tsx
import Link from "next/link";
import {
  Breadcrumb,
  Button,
  Card,
  CardBody,
  CommitSha,
  DescriptionList,
  EmptyState,
  EvidenceLock,
  Mono,
  PageHeader,
  RepoRef,
  Section,
  SectionHeading,
  VerdictCard,
  Well,
} from "@zkcvp/design-system-ledger/components";
import { getDb } from "../../../lib/db";
import { requireSession } from "../../../lib/auth/session";
import { getProject } from "../../../lib/projects/service";
import { getClaim } from "../../../lib/claims/service";

/** Absolute dates throughout this product, never relative. */
const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * `full_name` is `owner/name`, but `RepoRef` wants the two parts separately so
 * it can dim the owner segment. Split on the first slash only — a repo name
 * itself never contains one, an owner (org) name never does either. (Same
 * helper as repos/page.tsx; the app has no shared home for it yet.)
 */
function splitFullName(fullName: string): { owner: string; name: string } {
  const i = fullName.indexOf("/");
  return i === -1
    ? { owner: "", name: fullName }
    : { owner: fullName.slice(0, i), name: fullName.slice(i + 1) };
}

export default async function ClaimPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  /* Any project member reads this page — the report is unconditionally
   * visible the moment it exists, stakeholders included (getClaim's own
   * doc comment). getClaim enforces membership on its own; there is nothing
   * further to gate here. */
  const session = await requireSession();
  const db = getDb();

  const claim = await getClaim(db, session, id);

  /* Only for the trail, the same reasoning as requirements/[id]/page.tsx:
   * getClaim already proved membership of this project, so re-reading it to
   * put a name in the breadcrumb cannot widen what the visitor can reach. */
  const project = await getProject(db, session, claim.projectId);

  return (
    <main className="lg-container app-page">
      <PageHeader
        title="Claim"
        above={
          <Breadcrumb
            items={[
              { label: "Projects", href: "/projects" },
              { label: project.name, href: `/projects/${claim.projectId}` },
              { label: "Claim" },
            ]}
          />
        }
        lead={`Submitted ${dateTimeFormat.format(claim.submittedAt)}`}
      />

      <div className="lg-stack lg-stack--loose">
        {claim.evaluation === null ? (
          /* Abandoned, not broken and not waiting: the tab closed or the host
           * cut the request mid-run. There is no pending state anywhere in
           * this product, so this is not a spinner with a longer timeout —
           * it is a terminal outcome of its own, and the only way forward is
           * a fresh claim. */
          <Card>
            <CardBody>
              <EmptyState
                title="This run was interrupted."
                actions={
                  <Link href={`/projects/${claim.projectId}/claims/new`}>
                    <Button type="button" tone="primary">
                      Compose a new claim
                    </Button>
                  </Link>
                }
              >
                No verdict was recorded.
              </EmptyState>
            </CardBody>
          </Card>
        ) : (
          <Section>
            <SectionHeading>Verdicts</SectionHeading>
            <div className="lg-stack">
              {claim.evaluation.results.map((r) => (
                <VerdictCard
                  key={r.requirementVersionId}
                  requirementTitle={r.title}
                  verdict={r.verdict}
                  rationale={r.rationale}
                />
              ))}
            </div>
          </Section>
        )}

        {/* The pinned commits are what the verdict is about (or, in an
         * interrupted run, what a resubmission needs to name again) — never a
         * footnote, so they get their own section regardless of how the run
         * ended. Rendered as the design system's own "PINNED CLAIM INPUTS"
         * composition (domain.css): a well holding a micro-label and a stack
         * of identifiers, not the picker's CommitRow — this record has no
         * commit message, author, or date to show, because getClaim never
         * calls GitHub, and a picker row would otherwise have to fabricate
         * them. */}
        <Section>
          <Well>
            <span className="lg-micro-label">Pinned commits</span>
            <div className="lg-stack lg-stack--tight">
              {claim.commits.map((c) => {
                const { owner, name } = splitFullName(c.fullName);
                return (
                  <div
                    key={`${c.fullName}@${c.commitSha}`}
                    className="lg-row-flex lg-row-flex--wrap"
                  >
                    <RepoRef owner={owner} name={name} />
                    <CommitSha sha={c.commitSha} />
                  </div>
                );
              })}
            </div>
          </Well>
        </Section>

        {claim.evaluation && (
          <Section>
            <SectionHeading>Evaluation record</SectionHeading>
            <div className="lg-stack">
              <DescriptionList
                items={[
                  { term: "Model", value: <Mono>{claim.evaluation.modelId}</Mono> },
                  {
                    term: "Evaluated",
                    value: dateTimeFormat.format(claim.evaluation.createdAt),
                  },
                ]}
              />

              {/*
               * Withheld is not unverifiable. The bundle's contents stay
               * sealed — no disclosure mechanism exists in this phase, and
               * none is added here — but the digest is real and independently
               * checkable, which is why EvidenceLock renders it regardless:
               * that is the live affordance, not a button. No `onVerify` is
               * wired here because no Transparency Log exists yet to check
               * against (PRODUCT.md: the log backend is still undecided);
               * inventing a handler with nothing behind it would be the
               * opposite of honest. EvidenceLock's own copy already draws the
               * one distinction that matters: this proves the record was not
               * altered, not that the verdict above it was correct.
               */}
              <EvidenceLock evidenceHash={claim.evaluation.evidenceHash} />
            </div>
          </Section>
        )}
      </div>
    </main>
  );
}
