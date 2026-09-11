import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";

type GoogleCredentialResponse = { credential?: string };
type GoogleAccounts = {
  id: {
    initialize: (options: {
      client_id: string;
      callback: (response: GoogleCredentialResponse) => void;
      cancel_on_tap_outside: boolean;
    }) => void;
    renderButton: (
      element: HTMLElement,
      options: Record<string, string | number>,
    ) => void;
  };
};

declare global {
  interface Window {
    google?: { accounts: GoogleAccounts };
  }
}

function safeReturnTo(value: string | null): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  )
    return "/";
  return value;
}

export function SignInPage() {
  const { user, sessionExpired, acceptGoogleCredential } = useAuth();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const button = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"idle" | "working" | "error">("idle");
  const [message, setMessage] = useState("");
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

  useEffect(() => {
    if (user) navigate(safeReturnTo(search.get("returnTo")), { replace: true });
  }, [navigate, search, user]);

  useEffect(() => {
    if (!clientId || !button.current) return;
    const render = () => {
      if (!window.google || !button.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        cancel_on_tap_outside: true,
        callback: (response) => {
          if (!response.credential) {
            setMessage("Google sign-in was cancelled.");
            return;
          }
          setStatus("working");
          void acceptGoogleCredential(response.credential)
            .then(() =>
              navigate(safeReturnTo(search.get("returnTo")), { replace: true }),
            )
            .catch((error: unknown) => {
              setStatus("error");
              setMessage(
                error instanceof Error
                  ? error.message
                  : "Google sign-in could not be verified.",
              );
            });
        },
      });
      button.current.replaceChildren();
      window.google.accounts.id.renderButton(button.current, {
        type: "standard",
        theme: "outline",
        size: "large",
        shape: "rectangular",
        text: "continue_with",
        width: 280,
      });
    };
    const existing = document.querySelector<HTMLScriptElement>(
      "script[data-google-identity]",
    );
    if (existing) {
      if (window.google) render();
      else existing.addEventListener("load", render, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = "true";
    script.addEventListener("load", render, { once: true });
    script.addEventListener(
      "error",
      () => {
        setStatus("error");
        setMessage(
          "Google sign-in could not be loaded. Check your connection.",
        );
      },
      { once: true },
    );
    document.head.append(script);
  }, [acceptGoogleCredential, clientId, navigate, search]);

  return (
    <main className="signin">
      <section className="signin__card card">
        <span className="brandmark">
          <img src="/assets/brand/quizzer-logo.png" alt="Quizzer" />
        </span>
        <div>
          <h1>Sign in to Quizzer</h1>
          <p className="muted">
            One account for quiz runs, results, and the admin console.
          </p>
        </div>
        {sessionExpired && (
          <div className="alert a-warn" role="alert">
            <span aria-hidden="true">!</span>
            <span>Your session expired. Sign in again to continue.</span>
          </div>
        )}
        {clientId ? (
          <div
            ref={button}
            className="google-button"
            aria-busy={status === "working"}
          />
        ) : (
          <div className="alert a-warn" role="alert">
            <span aria-hidden="true">!</span>
            <span>
              Set <code>VITE_GOOGLE_CLIENT_ID</code> at build time to enable
              Google Identity Services.
            </span>
          </div>
        )}
        {status === "working" && (
          <p className="tiny" role="status">
            Verifying your Google ID token with Quizzer…
          </p>
        )}
        {message && (
          <div
            className={`alert ${status === "error" ? "a-dgr" : "a-info"}`}
            role="alert"
          >
            {message}
          </div>
        )}
        <p className="tiny">
          Quizzer keeps only a secure, HttpOnly same-origin session cookie. The
          browser does not store the Google token.
        </p>
      </section>
    </main>
  );
}
