import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import type { PageResponse } from "../../../src/core/api";
import type { QuizType } from "../../../src/core/contracts";
import { ApiRequestError } from "../api/client";
import { quizTypeLabels } from "../lib/format";

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  back,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: { to: string; label: string };
}) {
  return (
    <header className="phdr">
      {back && (
        <Link className="phdr__back" to={back.to}>
          <span aria-hidden="true">←</span> {back.label}
        </Link>
      )}
      {eyebrow && <div className="eyebrow">{eyebrow}</div>}
      <div className="phdr__row">
        <div className="grow">
          <h1 className="phdr__title">{title}</h1>
          {subtitle && <p className="phdr__sub">{subtitle}</p>}
        </div>
        {actions}
      </div>
    </header>
  );
}

export function SectionBadge({ type }: { type: QuizType }) {
  return <span className={`chip-sec b-${type}`}>{quizTypeLabels[type]}</span>;
}

export function LoadingCard() {
  return (
    <div className="card stack" aria-label="Loading">
      <div className="skel skel-line" />
      <div className="skel skel-block" />
      <div className="skel skel-line skel-line--short" />
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="state">
      <img src="/assets/illustrations/shade-empty.svg" alt="" />
      <h2 className="h3">{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function ErrorState({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  const message =
    error instanceof ApiRequestError
      ? error.message
      : "Check your connection and try again.";
  return (
    <div className="state" role="alert">
      <img src="/assets/illustrations/shade-error.svg" alt="" />
      <h2 className="h3">Could not load this page</h2>
      <p>{message}</p>
      {retry && (
        <button className="btn sec" type="button" onClick={retry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Pagination({
  page,
  onOffset,
}: {
  page: Pick<PageResponse<unknown>, "total" | "limit" | "offset">;
  onOffset: (offset: number) => void;
}) {
  const from = page.total === 0 ? 0 : page.offset + 1;
  const to = Math.min(page.total, page.offset + page.limit);
  return (
    <nav className="pagination" aria-label="Pagination">
      <button
        className="btn sec"
        type="button"
        disabled={page.offset === 0}
        onClick={() => onOffset(Math.max(0, page.offset - page.limit))}
      >
        Previous
      </button>
      <span className="tiny num">
        {from}–{to} of {page.total}
      </span>
      <button
        className="btn sec"
        type="button"
        disabled={to >= page.total}
        onClick={() => onOffset(page.offset + page.limit)}
      >
        Next
      </button>
    </nav>
  );
}

export function useResource<T>(
  loader: () => Promise<T>,
  dependencies: readonly unknown[],
) {
  const [state, setState] = useState<{
    data: T | null;
    error: unknown;
    loading: boolean;
  }>({ data: null, error: null, loading: true });
  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await loader();
      setState({ data, error: null, loading: false });
    } catch (error) {
      setState({ data: null, error, loading: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  useEffect(() => {
    void load();
  }, [load]);
  return {
    ...state,
    reload: load,
    setData: (data: T) => setState({ data, error: null, loading: false }),
  };
}

export function StudentTopNav() {
  const active = ({ isActive }: { isActive: boolean }) =>
    isActive ? "on" : undefined;
  return (
    <nav className="topnav grow" aria-label="Main">
      <NavLink className={active} to="/" end>
        Home
      </NavLink>
      <NavLink className={active} to="/history">
        History
      </NavLink>
      <NavLink className={active} to="/boards/weekly">
        Leaderboards
      </NavLink>
    </nav>
  );
}

export function StudentBottomNav() {
  const active = ({ isActive }: { isActive: boolean }) =>
    isActive ? "on" : undefined;
  return (
    <nav className="navbar" aria-label="Main">
      <NavLink className={active} to="/" end>
        <span className="gl" aria-hidden="true">
          ◧
        </span>
        Home
      </NavLink>
      <NavLink className={active} to="/history">
        <span className="gl" aria-hidden="true">
          ◔
        </span>
        History
      </NavLink>
      <NavLink className={active} to="/boards/weekly">
        <span className="gl" aria-hidden="true">
          ▲
        </span>
        Boards
      </NavLink>
      <NavLink className={active} to="/profile">
        <span className="gl" aria-hidden="true">
          ◍
        </span>
        Profile
      </NavLink>
    </nav>
  );
}
