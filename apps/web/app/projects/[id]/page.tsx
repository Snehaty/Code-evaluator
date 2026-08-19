// apps/web/app/projects/[id]/page.tsx
import Link from "next/link";
import {
  Breadcrumb,
  Button,
  ChecklistProgress,
  EmptyState,
  PageHeader,
  RequirementList,
  RequirementRow,
  Section,
  SectionHeading,
  type RequirementDisplayStatus,
} from "@zkcvp/design-system-ledger/components";
import { getDb } from "../../../lib/db";
import { requireSession } from "../../../lib/auth/session";
import { getProject } from "../../../lib/projects/service";
import { listRequirements } from "../../../lib/requirements/service";

/** Absolute dates throughout this product, never relative. */
const dateFormat = new Intl.DateTimeFormat("en-GB", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  const db = getDb();

  const project = await getProject(db, session, id);

  /* This IS the active checklist view, so it takes the service's default and
   * excludes archived rows — plan 01, "Archiving vs. status": "Archiving
   * removes a requirement from the active checklist view; it says nothing
   * about whether it was ever verified."
   *
   * The archived rendering path below is therefore unreachable today, and that
   * is deliberate: it stays wired so an explicit "show archived" toggle is a
   * change to this one call rather than to the rows. */
  const requirements = await listRequirements(db, session, id);

  const isStakeholder = session.kind === "stakeholder";

  /* `archived` is folded into a display status ONLY for the segmented track,
   * which shows one mark per requirement. The two facts stay separate in the
   * data and in the props handed to each RequirementRow below. */
  const displayStatuses: RequirementDisplayStatus[] = requirements.map((r) =>
    r.archivedAt !== null ? "archived" : r.status,
  );

  return (
    <main className="lg-container app-page">
      <PageHeader
        title={project.name}
        above={
          <Breadcrumb
            items={[
              { label: "Projects", href: "/projects" },
              { label: project.name },
            ]}
          />
        }
        lead={`Created ${dateFormat.format(project.createdAt)}`}
        actions={
          <>
            {/* Both roles read the member list; only a stakeholder invites. */}
            <Link href={`/projects/${id}/members`}>
              <Button type="button" tone="secondary">
                Members
              </Button>
            </Link>
            {isStakeholder ? (
              <Link href={`/projects/${id}/requirements/new`}>
                <Button type="button" tone="primary">
                  New requirement
                </Button>
              </Link>
            ) : null}
          </>
        }
      />

      <Section>
        <SectionHeading
          actions={
            /* "0 of 0 verified" next to an empty checklist is noise, so the
             * track only appears once there is something to count. */
            requirements.length > 0 ? (
              <ChecklistProgress statuses={displayStatuses} />
            ) : undefined
          }
        >
          Requirements
        </SectionHeading>

        {requirements.length === 0 ? (
          <EmptyState title="No requirements yet">
            {isStakeholder
              ? "Add the first requirement to this checklist."
              : "You will see requirements here once a stakeholder adds them."}
          </EmptyState>
        ) : (
          <RequirementList>
            {requirements.map((r) => (
              <RequirementRow
                key={r.id}
                title={r.title}
                description={r.description}
                /* status and archived are separate props and are never
                 * conflated: archived_at is orthogonal to the version status,
                 * and the row folds them for display on its own. The raw
                 * `eval_failed` enum reaches the screen only through the
                 * StatusBadge the row renders, which labels it "Not
                 * satisfied". */
                status={r.status}
                version={r.versionNumber}
                archived={r.archivedAt !== null}
                actions={
                  /* The row is an <li> and the list a <ul>, so the link lives
                   * in the row's own actions slot — wrapping the row in an <a>
                   * would put a non-<li> child inside the <ul>. */
                  <Link
                    href={`/requirements/${r.id}`}
                    aria-label={`View ${r.title}`}
                    /* The row is not tappable, so this link is the whole
                       target. app.css grows it to 44px under a coarse pointer
                       and leaves the desktop row alone. */
                    className="app-row-action"
                  >
                    View
                  </Link>
                }
              />
            ))}
          </RequirementList>
        )}
      </Section>
    </main>
  );
}
