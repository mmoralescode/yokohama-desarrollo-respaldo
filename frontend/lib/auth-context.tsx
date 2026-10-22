"use client";

import {createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode} from "react";
import {api, ApiError} from "./api";
import {proposalMode} from "./proposal-mode";

export interface CompanyUser {id: number; name: string; email: string; role: "admin" | "user"; active: boolean; vehicle_ids: number[]}
export const OWNER_EMAIL = "admin.yoko@gmail.com";
export const DEVELOPER_EMAIL = "martinmoralesbasurto1@gmail.com";
export const ADMIN_EMAILS = [OWNER_EMAIL, DEVELOPER_EMAIL] as const;
export function isAdministratorEmail(email: string) {
  return ADMIN_EMAILS.some(allowed => allowed === email.trim().toLowerCase());
}
export function isCompanyAdministrator(user: CompanyUser | null | undefined) {
  return user?.active === true && user.role === "admin" && isAdministratorEmail(user.email);
}
type AuthState = {user: CompanyUser | null; configured: boolean; required: boolean; loading: boolean; error: string | null; isAdmin: boolean; proposal: boolean; refresh: () => Promise<void>};
const AuthContext = createContext<AuthState>({user: null, configured: false, required: false, loading: true, error: null, isAdmin: false, proposal: proposalMode, refresh: async () => {}});

export function AuthProvider({children}: {children: ReactNode}) {
  const [user, setUser] = useState<CompanyUser | null>(null);
  const [configured, setConfigured] = useState(false);
  const [required, setRequired] = useState(false);
  const [loading, setLoading] = useState(!proposalMode);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    if (proposalMode) return;
    const requestId = ++revision.current;
    try {
      const status = await api<{configured: boolean; required: boolean}>("auth/status");
      if (typeof status.configured !== "boolean" || typeof status.required !== "boolean") throw new Error("No se pudo verificar el estado de las cuentas.");
      if (requestId !== revision.current) return;
      setConfigured(status.configured); setRequired(status.required); setError(null);
      let next: CompanyUser | null = null;
      if (status.configured) {
        try {next = await api<CompanyUser>("auth/me");}
        catch (reason) {
          // An expired/missing session is expected; network/server failures must
          // not unlock the panel or preserve a stale administrator identity.
          if (!(reason instanceof ApiError) || reason.status !== 401) throw reason;
        }
      }
      if (requestId === revision.current) setUser(next);
    } catch (reason) {
      if (requestId === revision.current) {setUser(null); setError(reason instanceof Error ? reason.message : "No se pudo verificar la sesión.");}
    } finally {if (requestId === revision.current) setLoading(false);}
  }, []);
  useEffect(() => {
    void refresh();
    const expired = () => {revision.current++; setRequired(true); setUser(null); setLoading(false);};
    const focus = () => {void refresh();};
    window.addEventListener("yokohama-session-expired", expired);
    window.addEventListener("focus", focus);
    return () => {revision.current++; window.removeEventListener("yokohama-session-expired", expired); window.removeEventListener("focus", focus);};
  }, [refresh]);
  const isAdmin = !loading && !error && (proposalMode || isCompanyAdministrator(user));
  return <AuthContext.Provider value={{user, configured, required, loading, error, isAdmin, proposal: proposalMode, refresh}}>{children}</AuthContext.Provider>;
}

export function useAuth() {return useContext(AuthContext);}
