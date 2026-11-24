import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AgentComponent from '../../src/react-app/components/Agent/Agent';
import { AuthContext, type AuthState } from '../../src/react-app/auth/auth-context';
import { AgentComposer } from '../../src/react-app/components/AgentComposer/AgentComposer';
import { Markdown } from '../../src/react-app/components/Markdown/Markdown';
import { loadHistory } from '../../src/react-app/chat/chat.api';
import { promptError } from '../../src/react-app/chat/chat.types';

const auth: AuthState = {
  account: { id: 'test-account', name: 'Test account' },
  loading: false, configured: true, error: '',
  signIn: async () => {}, signOut: async () => {},
  request: (url, init) => fetch(url, init),
};

function Agent() {
  return <AuthContext.Provider value={auth}><AgentComponent /></AuthContext.Provider>;
}

function history(sessionId: string, messages: unknown[] = []) {
  return Response.json({ session_id: sessionId, messages });
}

function streamingRun() {
  const encoder = new TextEncoder();
  let writer: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { writer = controller; },
    cancel,
  });
  return {
    response: new Response(stream, { headers: { 'content-type': 'text/event-stream' } }),
    emit: (event: unknown) => writer.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)),
    close: () => writer.close(),
    cancel,
  };
}

const REQUEST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('agent conversation', () => {
  it('restores history under StrictMode, sends real UUID headers, and shows stage outputs and Markdown', async () => {
    const run = streamingRun();
    let requestId = '';
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      if (init.method === 'POST') {
        requestId = headers.get('x-request-id') ?? '';
        expect(headers.get('x-session-id')).toMatch(/^[0-9a-f-]{36}$/);
        expect(JSON.parse(String(init.body))).toEqual({ prompt: 'Help me plan', max_turns: 5 });
        return run.response;
      }
      return history(headers.get('x-session-id') ?? '');
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<StrictMode><Agent /></StrictMode>);
    const user = userEvent.setup();
    const input = await screen.findByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(input.hasAttribute('disabled')).toBe(false));
    await user.type(input, 'Help me plan');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText(/Connecting to the agents/)).toBeTruthy();
    await act(async () => run.emit({ status: 'running', turn: 1, agent: 'planner_agent', output: '**Plan** carefully.' }));
    await user.click(screen.getByRole('button', { name: /Planner Completed/ }));
    expect(await screen.findByText('Plan', { selector: 'strong' })).toBeTruthy();
    await act(async () => {
      run.emit({ status: 'running', turn: 2, agent: 'research_agent', output: 'Model-only analysis.' });
      run.emit({ status: 'running', turn: 3, agent: 'synthesizer_agent', output: 'Synthesis.' });
    });
    await act(async () => run.emit({ status: 'done', request_id: requestId, final_output: '**Ready**\n\n```ts\nconst x = 1;\n```', history_length: 2 }));
    expect(await screen.findByText('Ready', { selector: 'strong' })).toBeTruthy();
    expect(screen.getByLabelText('Code block').textContent).toContain('const x = 1;');
    expect(screen.queryByRole('button', { name: 'Stop agents' })).toBeNull();
    expect(screen.getByText('Help me plan')).toBeTruthy();
  });

  it('keeps existing messages when reset fails and clears them only after confirmation', async () => {
    let fail = true;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === 'DELETE') return fail ? Response.json({ error: { message: 'Cannot clear history' } }, { status: 409 }) : new Response(null, { status: 204 });
      return history(new Headers(init.headers).get('x-session-id') ?? '', [
        { sequence: 1, role: 'user', content: 'Stored question', request_id: REQUEST_ID },
        { sequence: 2, role: 'assistant', content: 'Stored reply', request_id: REQUEST_ID },
      ]);
    }));
    render(<Agent />);
    const user = userEvent.setup();
    await screen.findByText('Stored reply');
    await user.click(screen.getByRole('button', { name: 'Reset conversation' }));
    expect(await screen.findByText(/Conversation was not reset: Cannot clear history/)).toBeTruthy();
    expect(screen.getByText('Stored reply')).toBeTruthy();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Reset conversation' }));
    expect(await screen.findByText('What should we work on?')).toBeTruthy();
    expect(screen.queryByText('Stored reply')).toBeNull();
  });

  it('cancels with request headers, aborts the stream, and verifies history', async () => {
    const run = streamingRun();
    let requestId = '';
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      if (init.method === 'POST') {
        requestId = headers.get('x-request-id') ?? '';
        return run.response;
      }
      if (init.method === 'DELETE') {
        expect(url).toBe('/api/chat');
        expect(headers.get('x-request-id')).toBe(requestId);
        return new Response(null, { status: 204 });
      }
      return history(headers.get('x-session-id') ?? '');
    }));
    render(<Agent />);
    const user = userEvent.setup();
    const input = screen.getByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(input.hasAttribute('disabled')).toBe(false));
    await user.type(input, 'Cancel this');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await user.click(await screen.findByRole('button', { name: 'Stop agents' }));
    expect(await screen.findByText('Run cancelled. No completed exchange was stored.')).toBeTruthy();
    expect(run.cancel).toHaveBeenCalledOnce();
    await waitFor(() => expect(input.hasAttribute('disabled')).toBe(false));
  });

  it('does not claim cancellation when the cancellation endpoint fails', async () => {
    const run = streamingRun();
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === 'POST') return run.response;
      if (init.method === 'DELETE') return Response.json({ error: { message: 'Network operation failed' } }, { status: 503 });
      return history(new Headers(init.headers).get('x-session-id') ?? '');
    }));
    const { unmount } = render(<Agent />);
    const user = userEvent.setup();
    const input = screen.getByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(input.hasAttribute('disabled')).toBe(false));
    await user.type(input, 'Continue running');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await user.click(await screen.findByRole('button', { name: 'Stop agents' }));
    expect(await screen.findByText(/Cancellation was not confirmed: Network operation failed/)).toBeTruthy();
    expect(run.cancel).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Stop agents' })).toBeTruthy();
    unmount();
    await waitFor(() => expect(run.cancel).toHaveBeenCalledOnce());
  });

  it('blocks new submissions while a cancellation is still being confirmed', async () => {
    const run = streamingRun();
    let confirm: (response: Response) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === 'POST') return run.response;
      if (init.method === 'DELETE') return new Promise<Response>((resolve) => { confirm = resolve; });
      return history(new Headers(init.headers).get('x-session-id') ?? '');
    }));
    render(<Agent />);
    const user = userEvent.setup();
    const input = screen.getByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(input.hasAttribute('disabled')).toBe(false));
    await user.type(input, 'Stop this run');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await user.click(await screen.findByRole('button', { name: 'Stop agents' }));
    await act(async () => run.emit({ status: 'error', code: 'run_cancelled', message: 'Server stopped the run.' }));
    expect(input.hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Cancelling run' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Reset conversation' }).hasAttribute('disabled')).toBe(true);
    await act(async () => confirm(new Response(null, { status: 204 })));
    await waitFor(() => expect(input.hasAttribute('disabled')).toBe(false));
    expect(screen.getByText('Run cancelled. No completed exchange was stored.')).toBeTruthy();
  });

  it('shows failed stage output without committing a failed exchange', async () => {
    const run = streamingRun();
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => init.method === 'POST'
      ? run.response : history(new Headers(init.headers).get('x-session-id') ?? '')));
    render(<Agent />);
    const user = userEvent.setup();
    const input = screen.getByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(input.hasAttribute('disabled')).toBe(false));
    await user.type(input, 'Research this');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await act(async () => {
      run.emit({ status: 'running', turn: 1, agent: 'planner_agent', output: 'Initial plan.' });
      run.emit({ status: 'error', code: 'provider_timeout', message: 'The research call timed out.' });
    });
    expect(await screen.findByText('The research call timed out.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Planner Completed/ }));
    expect(screen.getByText('Initial plan.')).toBeTruthy();
    expect(screen.getByText('Stopped')).toBeTruthy();
    expect(screen.getAllByText('Research this')).toHaveLength(1);
    expect(input.hasAttribute('disabled')).toBe(false);
  });

  it('restores a committed exchange if completion wins the cancellation race', async () => {
    const run = streamingRun();
    let requestId = '';
    let cancelled = false;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      if (init.method === 'POST') {
        requestId = headers.get('x-request-id') ?? '';
        return run.response;
      }
      if (init.method === 'DELETE') {
        cancelled = true;
        run.close();
        return Response.json({ error: { message: 'Already completed' } }, { status: 409 });
      }
      return history(headers.get('x-session-id') ?? '', cancelled ? [
        { sequence: 1, role: 'user', content: 'Race', request_id: requestId },
        { sequence: 2, role: 'assistant', content: 'Committed answer', request_id: requestId },
      ] : []);
    }));
    render(<Agent />);
    const user = userEvent.setup();
    const input = screen.getByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(input.hasAttribute('disabled')).toBe(false));
    await user.type(input, 'Race');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await user.click(await screen.findByRole('button', { name: 'Stop agents' }));
    expect(await screen.findByText('Committed answer')).toBeTruthy();
    expect(screen.queryByText(/No completed exchange was stored/)).toBeNull();
    expect(screen.getAllByText('Race')).toHaveLength(1);
  });

  it('shows malformed history errors and allows retry rather than sending with unknown history', async () => {
    let invalid = true;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => invalid
      ? Response.json({ session_id: 'wrong', messages: [] })
      : history(new Headers(init.headers).get('x-session-id') ?? '')));
    render(<Agent />);
    expect(await screen.findByText('The server returned invalid conversation history.')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Message' }).hasAttribute('disabled')).toBe(true);
    invalid = false;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reload history' }));
    expect(await screen.findByText('What should we work on?')).toBeTruthy();
  });

  it('ignores an old history response after unmount', async () => {
    let resolve: (response: Response) => void = () => {};
    let sessionId = '';
    let signal: AbortSignal | null | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      sessionId = new Headers(init.headers).get('x-session-id') ?? '';
      signal = init.signal;
      return new Promise<Response>((done) => { resolve = done; });
    }));
    const { unmount } = render(<Agent />);
    unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => resolve(history(sessionId)));
    expect(screen.queryByLabelText('Conversation')).toBeNull();
  });

  it('repairs a committed reply after D1 synchronisation fails without another model submission', async () => {
    const run = streamingRun();
    let requestId = '';
    let stored = false;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      if (init.method === 'POST') {
        requestId = headers.get('x-request-id') ?? '';
        return run.response;
      }
      return history(headers.get('x-session-id') ?? '', stored ? [
        { sequence: 1, role: 'user', content: 'Save this', request_id: requestId },
        { sequence: 2, role: 'assistant', content: 'Recovered saved answer', request_id: requestId },
      ] : []);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<Agent />);
    const input = screen.getByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(input.hasAttribute('disabled')).toBe(false));
    const user = userEvent.setup();
    await user.type(input, 'Save this');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await act(async () => {
      stored = true;
      run.emit({ status: 'error', code: 'history_sync_failed', message: 'D1 history could not be updated. Reload history to retry.' });
      run.close();
    });
    const reload = await screen.findByRole('button', { name: 'Reload history' });
    expect(input.hasAttribute('disabled')).toBe(true);
    await user.click(reload);
    expect(await screen.findByText('Recovered saved answer')).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Reload history' })).toBeNull();
  });
});

describe('composer and content', () => {
  it('supports Enter, Shift+Enter, IME composition, and an accessible unavailable menu', async () => {
    const submit = vi.fn(async () => {});
    render(<AgentComposer prompt="Hello" busy={false} cancelling={false} disabled={false} onPromptChange={() => {}} onSubmit={submit} onCancel={async () => {}} />);
    const input = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(submit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(submit).toHaveBeenCalledOnce();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Add context/ }));
    expect(await screen.findByRole('menu')).toBeTruthy();
    for (const item of screen.getAllByRole('menuitem')) {
      expect(item.getAttribute('aria-disabled')).toBe('true');
      expect(item.textContent).toContain('Unavailable');
    }
    expect(screen.getByText('Configured knowledge retrieval is not live web browsing.')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /Add context/ })));
  });

  it('does not silently truncate Unicode prompts and disables oversized sends', () => {
    expect(promptError('😀'.repeat(8000))).toBeUndefined();
    expect(promptError('😀'.repeat(8001))).toBeTruthy();
    render(<AgentComposer prompt={'x'.repeat(8001)} busy={false} cancelling={false} disabled={false} onPromptChange={() => {}} onSubmit={async () => {}} onCancel={async () => {}} />);
    expect(screen.getByRole('button', { name: 'Send message' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('8,000');
  });

  it('renders GFM and code without raw HTML, unsafe links, or remote images', () => {
    const { container } = render(<Markdown>{'**Safe**\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))\n\n![tracker](https://example.com/tracker.png)\n\n```js\nconst x = 1;\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |'}</Markdown>);
    expect(screen.getByText('Safe', { selector: 'strong' })).toBeTruthy();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')?.getAttribute('href')).not.toContain('javascript:');
    expect(screen.getByLabelText('Code block').textContent).toContain('const x = 1;');
    expect(container.querySelector('table')).toBeTruthy();
  });

  it('rejects invalid or unordered persisted messages', async () => {
    const sessionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    vi.stubGlobal('fetch', vi.fn(async () => history(sessionId, [
      { sequence: 2, role: 'assistant', content: 'Second', request_id: REQUEST_ID },
      { sequence: 1, role: 'user', content: 'First', request_id: REQUEST_ID },
    ])));
    await expect(loadHistory(sessionId, new AbortController().signal)).rejects.toThrow('unordered');
  });
});
