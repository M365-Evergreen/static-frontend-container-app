import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../src/react-app/auth/AuthProvider';
import { AuthControls } from '../../src/react-app/auth/AuthControls';
import { useAuth, type ApiRequest } from '../../src/react-app/auth/auth-context';

const msal = vi.hoisted(() => ({
  initialize: vi.fn(),
  getActiveAccount: vi.fn(),
  getAllAccounts: vi.fn(),
  setActiveAccount: vi.fn(),
  loginPopup: vi.fn(),
  logoutPopup: vi.fn(),
  clearCache: vi.fn(),
  acquireTokenSilent: vi.fn(),
  configuration: vi.fn(),
}));

vi.mock('@azure/msal-browser', () => ({
  InteractionRequiredAuthError: class extends Error {},
  PublicClientApplication: class {
    constructor(config: unknown) { msal.configuration(config); }
    initialize = msal.initialize;
    getActiveAccount = msal.getActiveAccount;
    getAllAccounts = msal.getAllAccounts;
    setActiveAccount = msal.setActiveAccount;
    loginPopup = msal.loginPopup;
    logoutPopup = msal.logoutPopup;
    clearCache = msal.clearCache;
    acquireTokenSilent = msal.acquireTokenSilent;
  },
}));

const tenantId = '11111111-1111-4111-8111-111111111111';
const clientId = '22222222-2222-4222-8222-222222222222';
const config = {
  tenantId, clientId, authority: `https://login.microsoftonline.com/${tenantId}`,
  scope: `api://${clientId}/Chat.Access`,
};
const account = { homeAccountId: 'account-a', tenantId, name: 'Test account', username: 'test-account' };

function Harness() {
  const auth = useAuth();
  const [result, setResult] = useState('');
  const load = async () => {
    try {
      await auth.request('/api/conversations', { headers: { 'x-example': 'preserved' } });
      setResult('Private request completed');
    } catch (failure) {
      setResult(failure instanceof Error ? failure.message : 'Request failed');
    }
  };
  return <>
    <AuthControls />
    {auth.account && <p>Authenticated workspace</p>}
    <button onClick={() => void load()}>Load private data</button>
    <output>{result}</output>
  </>;
}

beforeEach(() => {
  vi.resetAllMocks();
  msal.initialize.mockResolvedValue(undefined);
  msal.getActiveAccount.mockReturnValue(null);
  msal.getAllAccounts.mockReturnValue([]);
  msal.loginPopup.mockResolvedValue({ account });
  msal.logoutPopup.mockResolvedValue(undefined);
  msal.clearCache.mockResolvedValue(undefined);
  msal.acquireTokenSilent.mockResolvedValue({ accessToken: 'delegated-access-token', idToken: 'not-an-api-token' });
});

describe('Microsoft Entra browser integration', () => {
  it('uses the dedicated MSAL bridge, signs in and attaches a delegated access token to API requests', async () => {
    const fetchMock = vi.fn<ApiRequest>(async () => Response.json(config));
    vi.stubGlobal('fetch', fetchMock);
    render(<AuthProvider><Harness /></AuthProvider>);
    const signIn = screen.getByRole('button', { name: 'Sign in with Microsoft' });
    await waitFor(() => expect(signIn.hasAttribute('disabled')).toBe(false));
    const user = userEvent.setup();
    await user.click(signIn);
    expect(await screen.findByText('Authenticated workspace')).toBeTruthy();
    expect(msal.configuration).toHaveBeenCalledWith({
      auth: { clientId, authority: config.authority, redirectUri: `${window.location.origin}/redirect.html` },
      cache: { cacheLocation: 'sessionStorage' },
    });
    expect(msal.loginPopup).toHaveBeenCalledWith({ scopes: [config.scope], prompt: 'select_account' });
    await user.click(screen.getByRole('button', { name: 'Load private data' }));
    await screen.findByText('Private request completed');
    const call = fetchMock.mock.calls.at(-1);
    expect(call?.[0]).toBe('/api/conversations');
    const headers = new Headers(call?.[1]?.headers);
    expect(headers.get('authorization')).toBe('Bearer delegated-access-token');
    expect(headers.get('x-example')).toBe('preserved');
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(screen.queryByText('Authenticated workspace')).toBeNull());
    expect(msal.logoutPopup).toHaveBeenCalledOnce();
  });

  it('fails closed with an actionable message when Entra configuration is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      error: { message: 'Microsoft Entra sign-in is not configured.' },
    }, { status: 503 })));
    render(<AuthProvider><Harness /></AuthProvider>);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Microsoft Entra sign-in is not configured.');
    expect(screen.getByRole('button', { name: 'Sign in with Microsoft' }).hasAttribute('disabled')).toBe(true);
    expect(msal.initialize).not.toHaveBeenCalled();
  });

  it('does not send API requests without a token and exposes a sign-in-again action', async () => {
    const fetchMock = vi.fn(async () => Response.json(config));
    vi.stubGlobal('fetch', fetchMock);
    msal.getActiveAccount.mockReturnValue(account);
    msal.acquireTokenSilent.mockRejectedValue(new Error('Token acquisition failed'));
    render(<AuthProvider><Harness /></AuthProvider>);
    await screen.findByText('Authenticated workspace');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Load private data' }));
    expect(await screen.findByRole('button', { name: 'Sign in again' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert').textContent).toContain('could not be acquired');
  });
});
