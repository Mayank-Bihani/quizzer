import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { CurrentUser } from "../../../src/core/contracts";
import { api, ApiRequestError } from "../api/client";

type AuthState = {
  user: CurrentUser | null;
  loading: boolean;
  sessionExpired: boolean;
  refresh: () => Promise<void>;
  acceptGoogleCredential: (idToken: string) => Promise<CurrentUser>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setUser(await api.me());
      setSessionExpired(false);
    } catch (error) {
      if (!(error instanceof ApiRequestError) || error.status !== 401)
        throw error;
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh().catch(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    const expire = () => {
      if (user) setSessionExpired(true);
      setUser(null);
    };
    window.addEventListener("quizzer:unauthorized", expire);
    return () => window.removeEventListener("quizzer:unauthorized", expire);
  }, [user]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      sessionExpired,
      refresh,
      acceptGoogleCredential: async (idToken) => {
        const signedInUser = await api.signIn({ idToken });
        setSessionExpired(false);
        setUser(signedInUser);
        return signedInUser;
      },
      signOut: async () => {
        await api.logout();
        setSessionExpired(false);
        setUser(null);
      },
    }),
    [loading, refresh, sessionExpired, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("useAuth must be used inside AuthProvider.");
  return auth;
}
