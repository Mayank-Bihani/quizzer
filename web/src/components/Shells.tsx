import { type ReactNode } from "react";
import { NavLink } from "react-router-dom";
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

function AdminLinks() {
  return (
    <>
      {adminLinks.map(([label, to]) => (
        <NavLink
          className={({ isActive }) => (isActive ? "on" : undefined)}
          key={to}
          to={to}
          end={to === "/admin"}
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
  return (
    <div className="adm">
      <header className="adm__bar">
        <NavLink className="brandmark" to="/admin">
          <img src="/assets/brand/quizzer-logo.png" alt="Quizzer" />
        </NavLink>
        <details className="admdrawer">
          <summary aria-label="Open admin menu">☰</summary>
          <nav className="menu" aria-label="Admin sections">
            <AdminLinks />
          </nav>
        </details>
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
      <nav className="adm__side" aria-label="Admin sections">
        <AdminLinks />
      </nav>
      <main className="adm__main">
        <div className="stack-lg">{children}</div>
      </main>
    </div>
  );
}
