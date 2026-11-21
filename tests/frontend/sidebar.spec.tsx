import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from '../../src/react-app/layouts/AppShell';
import { AppRouter } from '../../src/react-app/routes/AppRouter';
import { Sidebar } from '../../src/react-app/components/Sidebar/Sidebar';

function renderShell() {
  render(<MemoryRouter><AppShell /></MemoryRouter>);
  return userEvent.setup();
}

describe('sidebar toggle', () => {
  it('starts with an accessible desktop icon rail and expands and collapses from the rail', async () => {
    const user = renderShell();
    const toggle = screen.getByRole('button', { name: 'Show sidebar' });
    expect(screen.queryByRole('button', { name: 'Open Drawer' })).toBeNull();
    const sidebar = document.getElementById(toggle.getAttribute('aria-controls')!);
    expect(sidebar).not.toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(sidebar?.hasAttribute('inert')).toBe(false);
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Dashboard' }).getAttribute('title')).toBe('Dashboard');

    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(sidebar?.hasAttribute('inert')).toBe(false);
    expect(screen.getByRole('link', { name: 'Dashboard' }).hasAttribute('title')).toBe(false);

    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(sidebar?.hasAttribute('inert')).toBe(false);
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeTruthy();
  });

  it('closes through the close button and navigation links', async () => {
    const user = renderShell();
    const toggle = screen.getByRole('button', { name: 'Show sidebar' });

    await user.click(screen.getByRole('button', { name: 'Show sidebar' }));
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Hide sidebar' }));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);

    await user.click(screen.getByRole('link', { name: 'Dashboard' }));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Close sidebar' })).toBeNull();
  });

  it('defaults to hidden on mobile when no open state is provided', () => {
    render(<MemoryRouter><Sidebar isMobile onToggle={vi.fn()} /></MemoryRouter>);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Dashboard' })).toBeNull();
  });

  it('dismisses the mobile drawer with Escape and restores focus', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: query === '(max-width: 47.999rem)',
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => true,
    }));
    const user = renderShell();
    const toggle = screen.getByRole('button', { name: 'Open Drawer' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Dashboard' })).toBeNull();

    await user.click(toggle);
    await user.click(screen.getByRole('button', { name: 'Hide sidebar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('link', { name: 'Dashboard' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(toggle));

    await user.click(toggle);
    const dialog = screen.getByRole('dialog', { name: 'Admin navigation' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard('[Escape]');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(toggle));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    await user.click(toggle);
    await user.click(document.body);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await user.click(toggle);
    await user.click(screen.getByRole('link', { name: 'Dashboard' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps desktop and mobile navigation state separate when resizing', async () => {
    let mobile = false;
    const listeners = new Set<EventListenerOrEventListenerObject>();
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      get matches() { return query === '(max-width: 47.999rem)' && mobile; },
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => { listeners.add(listener); },
      removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => { listeners.delete(listener); },
      dispatchEvent: () => true,
    }));
    const resize = () => listeners.forEach((listener) => {
      const event = new Event('change');
      if (typeof listener === 'function') listener(event);
      else listener.handleEvent(event);
    });
    const user = renderShell();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Show sidebar' }));
    act(() => {
      mobile = true;
      resize();
    });
    expect(screen.getByRole('button', { name: 'Open Drawer' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => {
      mobile = false;
      resize();
    });
    expect(screen.getByRole('button', { name: 'Hide sidebar' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open Drawer' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeTruthy();
  });
});

describe('workspace routes', () => {
  it('renders chat inside the shell on both Home and Agent without duplicate drawers', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => Response.json({
      session_id: new Headers(init.headers).get('x-session-id'),
      messages: [],
    })));
    window.history.replaceState(null, '', '/');
    render(<AppRouter />);
    const user = userEvent.setup();
    expect(await screen.findByText('What should we work on?')).toBeTruthy();
    expect(screen.getByRole('main').contains(screen.getByRole('textbox', { name: 'Message' }))).toBe(true);
    await user.click(screen.getByRole('link', { name: 'Agent' }));
    expect(await screen.findByRole('button', { name: 'PAULIBABY' })).toBeTruthy();
    expect(await screen.findByText('What should we work on?')).toBeTruthy();
    expect(screen.getAllByRole('navigation', { name: 'Admin navigation' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'PAULIBABY' }));
    expect(screen.getByRole('dialog', { name: 'Post Settings' })).toBeTruthy();
    await user.keyboard('[Escape]');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    window.history.replaceState(null, '', '/');
  });
});
