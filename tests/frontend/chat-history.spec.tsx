import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext, type ApiRequest, type AuthState } from '../../src/react-app/auth/auth-context';
import { ChatHistoryProvider } from '../../src/react-app/chat/ChatHistoryProvider';
import { restoreSession } from '../../src/react-app/chat/chat.api';
import { Sidebar } from '../../src/react-app/components/Sidebar/Sidebar';
import { AgentPage } from '../../src/react-app/pages/AgentPage/AgentPage';

const SESSION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REQUEST = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const now = Date.now();

function summary(session_id: string, title: string) {
  return { session_id, title, created_at: now, updated_at: now, message_count: 2 };
}

function authFor(request: ApiRequest, id = 'account-a'): AuthState {
  return {
    account: { id, name: id }, request, configured: true, loading: false, error: '',
    signIn: vi.fn(async () => {}), signOut: vi.fn(async () => {}),
  };
}

function tree(auth: AuthState, { collapsed = false, onNavigate = vi.fn(), chat = true } = {}) {
  return <AuthContext.Provider value={auth}>
    <ChatHistoryProvider>
      <MemoryRouter initialEntries={[`/agent/${SESSION}`]}>
        <Sidebar isOpen={!collapsed} onToggle={vi.fn()} onNavLinkClick={onNavigate} />
        {chat && <Routes><Route path="/agent/:sessionId" element={<AgentPage />} /></Routes>}
      </MemoryRouter>
    </ChatHistoryProvider>
  </AuthContext.Provider>;
}

function transcript(sessionId: string, content: string) {
  return Response.json({
    session_id: sessionId,
    messages: [
      { sequence: 1, role: 'user', content: `Question for ${content}`, request_id: REQUEST },
      { sequence: 2, role: 'assistant', content, request_id: REQUEST },
    ],
  });
}

describe('authenticated sidebar history', () => {
  it('resumes selected conversations and creates a new UUID conversation without deleting stored history', async () => {
    const api = vi.fn<ApiRequest>(async (url, init) => {
      if (url === '/api/conversations') return Response.json({
        conversations: [summary(SESSION, 'First conversation'), summary(OTHER, 'Second conversation')], cursor: null,
      });
      const sessionId = new Headers(init?.headers).get('x-session-id') ?? '';
      return sessionId === SESSION || sessionId === OTHER
        ? transcript(sessionId, sessionId === SESSION ? 'First stored reply' : 'Second stored reply')
        : Response.json({ session_id: sessionId, messages: [] });
    });
    const onNavigate = vi.fn();
    render(tree(authFor(api), { onNavigate }));
    const user = userEvent.setup();
    await screen.findByText('First stored reply');
    await user.click(await screen.findByRole('link', { name: /Second conversation/ }));
    expect(await screen.findByText('Second stored reply')).toBeTruthy();
    expect(screen.queryByText('First stored reply')).toBeNull();
    expect(screen.getByRole('link', { name: /Second conversation/ }).getAttribute('aria-current')).toBe('page');
    await user.click(screen.getByRole('button', { name: 'New chat' }));
    expect(await screen.findByText('What should we work on?')).toBeTruthy();
    expect(screen.queryByText('Second stored reply')).toBeNull();
    expect(api.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    expect(onNavigate).toHaveBeenCalledTimes(2);
    const latest = api.mock.calls.filter(([url]) => url === '/api/history').at(-1);
    const id = new Headers(latest?.[1]?.headers).get('x-session-id');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect([SESSION, OTHER]).not.toContain(id);
  });

  it('aborts an active stream and removes drafts when another conversation is selected', async () => {
    let signal: AbortSignal | null | undefined;
    const cancelled = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel: cancelled });
    const api = vi.fn<ApiRequest>(async (url, init) => {
      if (url === '/api/conversations') return Response.json({ conversations: [summary(OTHER, 'Other conversation')], cursor: null });
      if (init?.method === 'POST') {
        signal = init.signal;
        return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
      }
      const sessionId = new Headers(init?.headers).get('x-session-id') ?? '';
      return sessionId === OTHER ? transcript(OTHER, 'Other stored reply') : Response.json({ session_id: sessionId, messages: [] });
    });
    render(tree(authFor(api)));
    const user = userEvent.setup();
    const input = screen.getByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(input.hasAttribute('disabled')).toBe(false));
    await user.type(input, 'Unfinished prompt');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByText(/Connecting to the agents/);
    await user.click(screen.getByRole('link', { name: /Other conversation/ }));
    expect(await screen.findByText('Other stored reply')).toBeTruthy();
    expect(signal?.aborted).toBe(true);
    await waitFor(() => expect(cancelled).toHaveBeenCalledOnce());
    expect(screen.queryByText('Unfinished prompt')).toBeNull();
  });

  it('refreshes the D1 catalogue after a completed exchange', async () => {
    let requestId = '';
    let complete = false;
    let writer: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(controller) { writer = controller; } });
    const api = vi.fn<ApiRequest>(async (url, init) => {
      if (url === '/api/conversations') return Response.json({
        conversations: complete ? [summary(SESSION, 'New saved conversation')] : [], cursor: null,
      });
      if (init?.method === 'POST') {
        requestId = new Headers(init.headers).get('x-request-id') ?? '';
        return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
      }
      return Response.json({ session_id: new Headers(init?.headers).get('x-session-id'), messages: [] });
    });
    render(tree(authFor(api)));
    const input = screen.getByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(input.hasAttribute('disabled')).toBe(false));
    const user = userEvent.setup();
    await user.type(input, 'New saved conversation');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await act(async () => {
      complete = true;
      const events = [
        ...['planner_agent', 'research_agent', 'synthesizer_agent'].map((agent, index) => ({ status: 'running', turn: index + 1, agent, output: 'Stage output' })),
        { status: 'done', request_id: requestId, final_output: 'Saved reply', history_length: 2 },
      ];
      writer.enqueue(new TextEncoder().encode(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')));
      writer.close();
    });
    expect(await screen.findByRole('link', { name: /New saved conversation/ })).toBeTruthy();
    expect(screen.getByText('Saved reply')).toBeTruthy();
  });

  it('hides the previous account catalogue immediately and ignores its late responses', async () => {
    let resolveOld: (response: Response) => void = () => {};
    let oldSignal: AbortSignal | null | undefined;
    const old = authFor(async (_url, init) => {
      oldSignal = init?.signal;
      return new Promise<Response>((resolve) => { resolveOld = resolve; });
    });
    const next = authFor(async () => Response.json({
      conversations: [summary(OTHER, 'New account conversation')], cursor: null,
    }), 'account-b');
    const { rerender } = render(tree(old, { chat: false }));
    rerender(tree(next, { chat: false }));
    expect(oldSignal?.aborted).toBe(true);
    expect(await screen.findByRole('link', { name: /New account conversation/ })).toBeTruthy();
    await act(async () => resolveOld(Response.json({ conversations: [summary(SESSION, 'Old account conversation')], cursor: null })));
    expect(screen.queryByRole('link', { name: /Old account conversation/ })).toBeNull();
  });

  it('shows catalogue failures with retry and loads subsequent pages', async () => {
    let failed = true;
    const api = vi.fn<ApiRequest>(async (url) => {
      if (failed) return Response.json({ error: { message: 'D1 is unavailable' } }, { status: 503 });
      return Response.json(url.includes('cursor=')
        ? { conversations: [summary(OTHER, 'Older conversation')], cursor: null }
        : { conversations: [summary(SESSION, 'Recent conversation')], cursor: 'next-page' });
    });
    render(tree(authFor(api), { chat: false }));
    expect(await screen.findByText('D1 is unavailable')).toBeTruthy();
    failed = false;
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Retry history' }));
    await screen.findByRole('link', { name: /Recent conversation/ });
    await user.click(screen.getByRole('button', { name: 'Load more conversations' }));
    expect(await screen.findByRole('link', { name: /Older conversation/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Recent conversation/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load more conversations' })).toBeNull();
  });

  it('requires sign-in before fetching history and keeps collapsed navigation usable', async () => {
    const api = vi.fn<ApiRequest>();
    const signedOut = { ...authFor(api), account: null };
    const { rerender } = render(tree(signedOut));
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();
    const sidebar = screen.getByRole('region', { name: 'Chat history' });
    await userEvent.setup().click(within(sidebar).getByRole('button', { name: 'Sign in with Microsoft' }));
    expect(signedOut.signIn).toHaveBeenCalledOnce();
    expect(api).not.toHaveBeenCalled();
    api.mockResolvedValue(Response.json({ conversations: [summary(SESSION, 'Private conversation')], cursor: null }));
    rerender(tree(authFor(api), { collapsed: true, chat: false }));
    expect(screen.getByRole('button', { name: 'New chat' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Saved conversations' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });

  it('never restores anonymous session IDs into an authenticated account', () => {
    localStorage.setItem('static-frontend-container-app.session-id', SESSION);
    const a = restoreSession('account-a');
    const b = restoreSession('account-b');
    expect(a.sessionId).not.toBe(SESSION);
    expect(b.sessionId).not.toBe(a.sessionId);
    expect(restoreSession('account-a').sessionId).toBe(a.sessionId);
  });
});
