"use client";

import type { ReactNode } from "react";
import { cx } from "./cx";
import { ICON_SM, IconChevron } from "./icons";

export interface TabItem {
  id: string;
  label: ReactNode;
}

/**
 * Tabs.
 *
 * The strip scrolls horizontally rather than wrapping. A two-line tab bar
 * reorders itself as the label set changes, which destroys the muscle memory
 * that is most of what tabs are for.
 */
export function Tabs({
  items,
  active,
  onSelect,
  label,
  className,
}: {
  items: TabItem[];
  active: string;
  onSelect: (id: string) => void;
  /** Names the tab set, e.g. "Report sections". */
  label: string;
  className?: string;
}) {
  return (
    <div className={cx("lg-tabs", className)} role="tablist" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          id={`tab-${item.id}`}
          aria-selected={item.id === active}
          aria-controls={`panel-${item.id}`}
          /* Only the selected tab is in the tab order; arrow keys move between
             them. This is the ARIA tabs pattern, and it is why a tab strip does
             not cost a keyboard user one Tab press per tab. */
          tabIndex={item.id === active ? 0 : -1}
          className="lg-tab"
          onClick={() => onSelect(item.id)}
          onKeyDown={(e) => {
            const i = items.findIndex((t) => t.id === active);
            if (e.key === "ArrowRight") {
              onSelect(items[(i + 1) % items.length].id);
            } else if (e.key === "ArrowLeft") {
              onSelect(items[(i - 1 + items.length) % items.length].id);
            }
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export interface Crumb {
  label: ReactNode;
  href?: string;
}

/**
 * Breadcrumbs. The only thing that belongs in `PageHeader`'s `above` slot,
 * because it is the only thing there that is navigable.
 */
export function Breadcrumb({
  items,
  className,
}: {
  items: Crumb[];
  className?: string;
}) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className={cx("lg-breadcrumb", className)}>
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i}>
              {item.href && !last ? (
                <a href={item.href}>{item.label}</a>
              ) : (
                <span aria-current={last ? "page" : undefined}>{item.label}</span>
              )}
              {!last && (
                <IconChevron
                  size={ICON_SM}
                  className="lg-breadcrumb__sep"
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function SideNav({
  children,
  label = "Sections",
  className,
}: {
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <nav className={cx("lg-sidenav", className)} aria-label={label}>
      {children}
    </nav>
  );
}

export function SideNavSection({
  label,
  children,
  className,
}: {
  label?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("lg-sidenav__section", className)}>
      {label && <span className="lg-sidenav__section-label">{label}</span>}
      {children}
    </div>
  );
}

export function NavItem({
  children,
  href,
  active,
  icon,
  count,
  onClick,
  className,
}: {
  children: ReactNode;
  href?: string;
  active?: boolean;
  icon?: ReactNode;
  /** A count of rows behind this item. Monospace, so columns of them align. */
  count?: number;
  onClick?: () => void;
  className?: string;
}) {
  const inner = (
    <>
      {icon}
      <span className="lg-truncate">{children}</span>
      {count !== undefined && <span className="lg-nav-item__count">{count}</span>}
    </>
  );

  /*
   * An anchor when it navigates, a button when it does not. A div with an
   * onClick is neither focusable nor announced as actionable, and a link with
   * no href is announced as a link that goes nowhere.
   */
  return href ? (
    <a
      href={href}
      className={cx("lg-nav-item", className)}
      aria-current={active ? "page" : undefined}
    >
      {inner}
    </a>
  ) : (
    <button
      type="button"
      className={cx("lg-nav-item", className)}
      aria-current={active ? "true" : undefined}
      onClick={onClick}
    >
      {inner}
    </button>
  );
}
