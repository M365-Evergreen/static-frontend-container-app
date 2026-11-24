import { createContext, useContext } from 'react';

export type ApiRequest = (url: string, init?: RequestInit) => Promise<Response>;

export interface AuthState {
  account: { id: string; name: string } | null;
  loading: boolean;
  configured: boolean;
  error: string;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  request: ApiRequest;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('Authentication must be used inside AuthProvider.');
  return auth;
}
