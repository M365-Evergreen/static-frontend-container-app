import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { InteractionRequiredAuthError, PublicClientApplication, type AccountInfo } from '@azure/msal-browser';
import { readApiError } from '../chat/chat.api';
import { AuthContext, type ApiRequest } from './auth-context';

interface Configuration {
  tenantId: string;
  clientId: string;
  authority: string;
  scope: string;
}

function configuration(value: unknown): Configuration {
  if (
    typeof value !== 'object' || value === null ||
    !('tenantId' in value) || typeof value.tenantId !== 'string' ||
    !/^[0-9a-f-]{36}$/.test(value.tenantId) ||
    !('clientId' in value) || typeof value.clientId !== 'string' ||
    !/^[0-9a-f-]{36}$/.test(value.clientId) ||
    !('authority' in value) || value.authority !== `https://login.microsoftonline.com/${value.tenantId}` ||
    !('scope' in value) || typeof value.scope !== 'string' || !/^api:\/\/[0-9a-f-]{36}\/[\w.-]+$/.test(value.scope)
  ) throw new Error('The server returned invalid Microsoft sign-in configuration.');
  return { tenantId: value.tenantId, clientId: value.clientId, authority: value.authority, scope: value.scope };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [runtime, setRuntime] = useState<{ client: PublicClientApplication; scope: string } | null>(null);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const initialize = async () => {
      try {
        const response = await fetch('/api/auth/config', { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error(await readApiError(response));
        const config = configuration(await response.json());
        const client = new PublicClientApplication({
          auth: {
            clientId: config.clientId,
            authority: config.authority,
            redirectUri: `${window.location.origin}/redirect.html`,
          },
          cache: { cacheLocation: 'sessionStorage' },
        });
        await client.initialize();
        if (controller.signal.aborted) return;
        const restored = client.getActiveAccount() ??
          client.getAllAccounts().find((candidate) => candidate.tenantId === config.tenantId) ?? null;
        const selected = restored?.tenantId === config.tenantId ? restored : null;
        client.setActiveAccount(selected);
        setRuntime({ client, scope: config.scope });
        setAccount(selected);
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Microsoft sign-in could not be initialised.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void initialize();
    return () => controller.abort();
  }, []);

  const signIn = async () => {
    if (!runtime || loading) return;
    setLoading(true);
    setError('');
    try {
      const result = await runtime.client.loginPopup({ scopes: [runtime.scope], prompt: 'select_account' });
      if (!result.account) throw new Error('Microsoft did not return a signed-in account.');
      runtime.client.setActiveAccount(result.account);
      setAccount(result.account);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Microsoft sign-in failed.');
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    if (!runtime || !account || loading) return;
    setLoading(true);
    setError('');
    setAccount(null);
    try {
      await runtime.client.logoutPopup({
        account,
        postLogoutRedirectUri: `${window.location.origin}/redirect.html`,
      });
    } catch {
      setError('Signed out of this app, but Microsoft sign-out could not complete.');
      try {
        await runtime.client.clearCache({ account });
      } catch {
        setError('The Microsoft session cache could not be cleared. Close this tab to finish signing out.');
      }
    } finally {
      setLoading(false);
    }
  };

  const request: ApiRequest = useCallback(async (url, init) => {
    if (!url.startsWith('/api/')) throw new Error('Authenticated requests must use a relative API URL.');
    if (!runtime || !account) throw new Error('Sign in with Microsoft to use chat.');
    init?.signal?.throwIfAborted();
    let token: string;
    try {
      token = (await runtime.client.acquireTokenSilent({ account, scopes: [runtime.scope] })).accessToken;
      if (!token) throw new Error('Empty access token.');
    } catch (failure) {
      if (failure instanceof InteractionRequiredAuthError) {
        const message = 'Your Microsoft sign-in needs attention. Sign in again to continue.';
        setError(message);
        throw new Error(message);
      }
      const message = 'A Microsoft access token could not be acquired. Sign in again to continue.';
      setError(message);
      throw new Error(message);
    }
    init?.signal?.throwIfAborted();
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(url, { ...init, headers });
    if (response.status === 401) setError('Your Microsoft sign-in is invalid or expired. Sign in again.');
    return response;
  }, [runtime, account]);

  return (
    <AuthContext.Provider value={{
      account: account ? { id: account.homeAccountId, name: account.name ?? account.username } : null,
      loading, configured: runtime !== null, error, signIn, signOut, request,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
