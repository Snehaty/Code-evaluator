// apps/web/app/requirements/[id]/page.tsx
import Link from "next/link";
import {
  Alert,
  Breadcrumb,
  Button,
  Card,
  CardBody,
  CardHeader,
  ICON_MD,
  IconNew,
  PageHeader,
  Section,
  SectionHeading,
  StatusBadge,
  Timeline,
  TimelineItem,
  VersionPill,
} from "@zkcvp/design-system-ledger/components";
import { getDb } from "../../../lib/db";
import { requireSession } from "../../../lib/auth/session";
import { getProject } from "../../../lib/projects/service";
import { getRequirement } from "../../../lib/requirements/service";
import { ArchiveButton } from "./ArchiveButton";

/** Absolute dates throughout this product, never relative. */
const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export default async function RequirementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  /* Any member reads this page; getRequirement enforces membership of the
   * requirement's project. Only the two mutating affordances below are
   * stakeholder-only. */
  const session = await requireSession();
  const db = getDb();
  const { requirement, versionHistory } = await getRequirement(db, session, id);

  /* Only for the trail. `getRequirement` already proved membership of this
   * project, so this cannot widen what the visitor can reach — it re-reads a row
   * they have just been authorised against, to put a name on it. A requirement
   * reached from a link used to be a dead end that never said which checklist
   * it belonged to. */
  const project = await getProject(db, session, requirement.projectId);

  const archived = requirement.archivedAt !== null;
  const isStakeholder = session.kind === "stakeholder";

  return (
    <main className="lg-container app-page">
      <PageHeader
        /* Archived dims the title and nothing more — never struck through,
         * never emptied (docs/architecture.md, "Display rules"). `title` is a
         * ReactNode, and `lg-text-muted` is a general Ledger tone utility, so
         * this composes the design system rather than restyling it. */
        title={
          archived ? (
            <span className="lg-text-muted">{requirement.title}</span>
          ) : (
            requirement.title
          )
        }
        above={
          <Breadcrumb
            items={[
              { label: "Projects", href: "/projects" },
              {
                label: project.name,
                href: `/projects/${requirement.projectId}`,
              },
              { label: requirement.title },
            ]}
          />
        }
        lead={`Created ${dateTimeFormat.format(requirement.createdAt)}`}
        actions={
          /* An archived requirement cannot be edited — editRequirement returns
           * 404 for one — so the affordance is not offered rather than offered
           * and then rejected. Archiving is likewise withheld: there is no
           * un-archive in this phase and nothing left to archive. */
          isStakeholder && !archived ? (
            <>
              <Link href={`/requirements/${id}/edit`}>
                <Button type="button" tone="secondary">
                  Edit
                </Button>
              </Link>
              <ArchiveButton requirementId={id} />
            </>
          ) : undefined
        }
      />

      {/* PageHeader carries its own bottom margin; the blocks after it do not,
          so they are stacked rather than left flush against each other. */}
      <div className="lg-stack lg-stack--loose">
        {archived ? (
          <Alert tone="info" title="This requirement is archived">
            It no longer appears on the project&rsquo;s checklist and can no
            longer be edited. Archiving is separate from verification — it says
            nothing about whether this requirement was ever verified — and there
            is no un-archive in this phase.
          </Alert>
        ) : null}

        <Card>
          <CardHeader
            title="Current version"
            /* Two axes, two chips, side by side. `archived_at` and the current
             * version's `status` are independent — plan 01, invariant 5:
             * "never let one imply or overwrite the other" — so unlike a
             * RequirementRow, which folds them because it has room for one
             * badge, this page keeps the status badge reporting the version's
             * own status and adds the archived chip beside it. The archived
             * chip is dashed rather than filled precisely so it can never be
             * read as a fourth status. */
            actions={
              /* One wrapping row: `.lg-card__header` does not wrap, and three
               * chips plus a timestamp next to a title will not fit a phone. */
              <span className="lg-row-flex lg-row-flex--wrap">
                <VersionPill version={requirement.versionNumber} current />
                <StatusBadge status={requirement.status} />
                {requirement.archivedAt ? (
                  /* The date rides with the chip rather than occupying a row of
                   * its own — the chip already carries the fact, the date only
                   * says when. Nested so the two never split across lines. */
                  <span className="lg-row-flex">
                    <StatusBadge status="archived" />
                    <span className="lg-caption">
                      {dateTimeFormat.format(requirement.archivedAt)}
                    </span>
                  </span>
                ) : null}
              </span>
            }
          />
          <CardBody>
            <p className="lg-prose">{requirement.description}</p>
          </CardBody>
        </Card>

        {/* Only once there is a history to show. At v1 the single entry
            repeats the card above it line for line — same title, same
            description, same status, same date — and a "Version history"
            heading over one duplicated row states a fact the reader can
            already see. Every requirement on a new checklist is at v1, so this
            is the common case, not the edge one. Nothing is lost: the card
            carries the version pill, the status and the text, and the header
            carries the title and the creation date. */}
        {versionHistory.length > 1 ? (
          <Section>
            <SectionHeading>Version history</SectionHeading>
            {/* Versions are immutable: an edit writes a new one and never alters
                an old one, so this list is an audit trail and is shown in full,
                in version order, exactly as the service returns it. The current
                version is included: seeing the trail end where the card begins is
                what confirms the card is the latest. */}
            <Timeline label="Version history">
              {versionHistory.map((v) => (
                <TimelineItem
                  key={v.id}
                  /* Every item in the system's own gallery carries a marker, and
                   * the connecting rule is drawn down the marker column — without
                   * one the rule ran between two invisible nodes and the entries
                   * sat behind an empty gutter. Deliberately the same neutral
                   * glyph on every row: the StatusBadge below already says what
                   * this version reached, and a second status-coded mark would
                   * encode it twice. */
                  marker={<IconNew size={ICON_MD} />}
                  title={
                    <>
                      <VersionPill
                        version={v.versionNumber}
                        current={v.id === requirement.currentVersionId}
                      />{" "}
                      {v.title}
                    </>
                  }
                  /* Not TimelineItem's `at` prop, which formats in the reader's
                   * locale: this page pins en-GB, and two date formats on one
                   * screen is worse than a hand-built stamp. `<time>` is here so
                   * the value stays machine-readable anyway. */
                  meta={
                    <time dateTime={v.createdAt.toISOString()}>
                      {dateTimeFormat.format(v.createdAt)}
                    </time>
                  }
                >
                  {/* The chip is wrapped: a bare chip in the timeline's flex
                      column would be stretched to the column's full width. */}
                  <span className="lg-row-flex">
                    {/* The raw enum never reaches the screen — StatusBadge owns
                        the label, and `eval_failed` reads "Not satisfied". */}
                    <StatusBadge status={v.status} />
                  </span>
                  {/* `lg-prose`, matching the card above. base.css scopes that
                      class to "evaluator rationales and requirement
                      descriptions", which is exactly this — and `lg-body` had it
                      set brighter and to the full container width, so a
                      superseded version read as more prominent than the current
                      one and the same sentence took two different measures 150px
                      apart. */}
                  <p className="lg-prose">{v.description}</p>
                </TimelineItem>
              ))}
            </Timeline>
          </Section>
        ) : null}
      </div>
    </main>
  );
}
