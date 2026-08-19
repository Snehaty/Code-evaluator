// apps/web/app/AppHeader.tsx
import Link from "next/link";
import { Button, RoleTag } from "@zkcvp/design-system-ledger/components";
import { readViewer } from "../lib/auth/viewer";
import { signOutAction } from "./sign-out";

/**
 * The app's one piece of global chrome.
 *
 * It exists to answer two questions no page in this product could answer on its
 * own: what am I looking at, and who am I looking at it as. The second is not
 * cosmetic here — the two Auth.js instances have separately scoped cookies, both
 * can be live at once, and `requireSession()` silently prefers the developer.
 * Without this bar, a stakeholder holding a stale developer cookie is shown the
 * developer's view of every screen with nothing on the page to explain why.
 *
 * `readViewer()` rather than `requireSession()`: this renders on /login too, and
 * a header that threw a 401 on the sign-in page would be absurd.
 */
export async function AppHeader() {
  const viewer = await readViewer();

  return (
    <header className="app-header">
      <div className="lg-container app-header__inner">
        {/* Home is /projects, not /. `/` only redirects here anyway, and a mark
            that lands on a redirect flickers. */}
        <Link href="/projects" className="app-header__mark">
          ZKCVP
        </Link>

        {viewer && (
          <div className="app-header__viewer">
            <RoleTag role={viewer.kind} />
            {/* Truncates rather than wraps: a long email must not give the bar
                a second line and push every page down. */}
            <span className="lg-caption lg-truncate app-header__label">
              {viewer.label}
            </span>
            <form action={signOutAction.bind(null, viewer.kind)}>
              <Button type="submit" size="sm" tone="quiet">
                Sign out
              </Button>
            </form>
          </div>
        )}
      </div>
    </header>
  );
}
