// apps/web/app/projects/[id]/repos/page.tsx
import {
  Breadcrumb,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
  RepoRef,
  Section,
  SectionHeading,
  Table,
  Td,
} from "@zkcvp/design-system-ledger/components";
import { getDb } from "../../../../lib/db";
import { requireSession } from "../../../../lib/auth/session";
import { getProject } from "../../../../lib/projects/service";
import {
  listAttachedRepos,
  listCandidateRepos,
  UNDO_WINDOW_MS,
} from "../../../../lib/repos/service";
import { AttachRepoForm } from "./AttachRepoForm";

/** Absolute dates throughout this product, never relative. */
const dateFormat = new Intl.DateTimeFormat("en-GB", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

/**
 * `full_name` is `owner/name`, but `RepoRef` wants the two parts separately so
 * it can dim the owner segment. Split on the first slash only — a repo name
 * itself never contains one, an owner (org) name never does either.
 */
function splitFullName(fullName: string): { owner: string; name: string } {
  const i = fullName.indexOf("/");
  return i === -1
    ? { owner: "", name: fullName }
    : { owner: fullName.slice(0, i), name: fullName.slice(i + 1) };
}

export default async function ReposPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  /* Both roles read this page — plan 02's matrix: a stakeholder member and a
   * developer member both see the attached list. getProject and
   * listAttachedRepos each enforce membership, so no separate guard is
   * needed here. */
  const session = await requireSession();
  const db = getDb();

  const project = await getProject(db, session, id);
  const repos = await listAttachedRepos(db, session, id);

  /* The picker and the undo affordance spend the acting developer's own
   * GitHub token. A stakeholder has no GitHub identity to spend, so this is
   * a statement about capability, not about trust — the same shape as
   * `canInvite` on the members page. listCandidateRepos asserts developer
   * membership again on its own; this only decides whether it is called at
   * all. */
  const isDeveloper = session.kind === "developer";
  const candidates = isDeveloper ? await listCandidateRepos(db, session, id) : [];

  return (
    <main className="lg-container app-page">
      <PageHeader
        title="Repositories"
        above={
          <Breadcrumb
            items={[
              { label: "Projects", href: "/projects" },
              { label: project.name, href: `/projects/${id}` },
              { label: "Repositories" },
            ]}
          />
        }
        lead="Repositories a developer has attached from their own GitHub account."
      />

      <div className="lg-stack lg-stack--loose">
        <Section>
          <SectionHeading>Attached</SectionHeading>

          {repos.length === 0 ? (
            <EmptyState title="No repositories attached yet">
              {isDeveloper
                ? "Attach one below from your GitHub account."
                : "A developer on this project attaches repositories from their own GitHub account."}
            </EmptyState>
          ) : (
            <Card flush>
              <CardBody>
                <Table label="Repositories attached to this project">
                  <thead>
                    <tr>
                      <th>Repository</th>
                      <th className="lg-table__cell--shrink">Attached</th>
                    </tr>
                  </thead>
                  <tbody>
                    {repos.map((r) => {
                      const { owner, name } = splitFullName(r.fullName);
                      return (
                        /* Keyed by the attachment row id, never by the repo
                         * name — plan 02's join key is `github_repo_id`, and
                         * `full_name` may go stale after a rename. */
                        <tr key={r.id}>
                          <Td>
                            <RepoRef owner={owner} name={name} />
                          </Td>
                          <Td shrink>{dateFormat.format(r.addedAt)}</Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </CardBody>
            </Card>
          )}
        </Section>

        {/* Only a developer member may attach or remove — both spend their
         * own GitHub token, which a stakeholder does not have. */}
        {isDeveloper && (
          <Card>
            <CardHeader title="Attach a repository" />
            <CardBody>
              <div className="lg-stack">
                <p className="lg-caption">
                  Attaching is reversible for{" "}
                  {Math.round(UNDO_WINDOW_MS / 1000)} seconds. After that a
                  repository stays attached for the life of this project —
                  there is no separate remove.
                </p>
                <AttachRepoForm projectId={id} candidates={candidates} />
              </div>
            </CardBody>
          </Card>
        )}
      </div>
    </main>
  );
}
