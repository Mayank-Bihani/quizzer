import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { NavLink, useLocation } from "react-router-dom";
import type { CurrentUser } from "../../../src/core/contracts";
import { initials } from "../lib/format";
import { StudentBottomNav, StudentTopNav } from "./ui";

export function StudentShell({
  user,
  children,
  hideBottomNav = false,
}: {
  user: CurrentUser;
  children: ReactNode;
  hideBottomNav?: boolean;
}) {
  return (
    <div className="app">
      <header className="app__top">
        <NavLink className="brandmark" to="/">
          <img src="/assets/brand/quizzer-logo.png" alt="Quizzer" />
        </NavLink>
        <StudentTopNav />
        <NavLink className="profile-link" to="/profile">
          <div className="av" aria-hidden="true">
            {initials(user.name)}
          </div>
          <span className="tiny truncate">{user.name}</span>
        </NavLink>
      </header>
      <main className="app__main">
        <div className="stack-lg">{children}</div>
      </main>
      {!hideBottomNav && <StudentBottomNav />}
    </div>
  );
}

const adminLinks = [
  ["Console home", "/admin"],
  ["Bank", "/admin/bank"],
  ["Quizzes", "/admin/quizzes/new/define"],
  ["Schedule", "/admin/schedule"],
  ["Reports", "/admin/reports"],
  ["Admins", "/admin/users"],
] as const;

function AdminLinks({ onNavigate }: { onNavigate?: () => void } = {}) {
  return (
    <>
      {adminLinks.map(([label, to]) => (
        <NavLink
          className={({ isActive }) => (isActive ? "on" : undefined)}
          key={to}
          to={to}
          end={to === "/admin"}
          onClick={onNavigate}
        >
          {label}
        </NavLink>
      ))}
    </>
  );
}

export function AdminShell({
  user,
  children,
}: {
  user: CurrentUser;
  children: ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();
  const closeDrawer = () => setDrawerOpen(false);

  // A route change never unmounts AdminShell (only `children` swaps), so a plain onClick on each
  // link is the primary close path; this is a backstop for browser back/forward navigation, which
  // changes location without ever firing that onClick.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDrawer();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [drawerOpen]);

  return (
    <div className="adm">
      <header className="adm__bar">
        <NavLink className="brandmark" to="/admin">
          <img src="/assets/brand/quizzer-logo.png" alt="Quizzer" />
        </NavLink>
        <div className="admdrawer">
          <button
            type="button"
            className="admdrawer__trigger"
            aria-label="Open admin menu"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen((open) => !open)}
          >
            ☰
          </button>
          {drawerOpen && (
            <nav className="menu" aria-label="Admin sections">
              <AdminLinks onNavigate={closeDrawer} />
            </nav>
          )}
        </div>
        <span className="grow" />
        <NavLink className="tiny" to="/">
          Student view
        </NavLink>
        <NavLink className="profile-link" to="/profile">
          <div className="av sm" aria-hidden="true">
            {initials(user.name)}
          </div>
          <span className="tiny truncate">{user.name}</span>
        </NavLink>
      </header>
      {drawerOpen &&
        createPortal(
          <div
            className="admdrawer__scrim"
            role="presentation"
            onClick={closeDrawer}
          />,
          document.body,
        )}
      <nav className="adm__side" aria-label="Admin sections">
        <AdminLinks />
      </nav>
      <main className="adm__main">
        <div className="stack-lg">{children}</div>
      </main>
    </div>
  );
}
