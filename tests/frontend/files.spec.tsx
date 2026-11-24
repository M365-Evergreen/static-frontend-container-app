import { StrictMode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FileGrid } from '../../src/react-app/components/FileGrid/FileGrid';

const files = Array.from({ length: 5 }, (_, index) => ({
  key: `folder/document-${index}.pdf`,
  size: index * 1024,
  uploaded: '2026-11-21T12:00:00.000Z',
}));

describe('homepage files', () => {
  it('loads five real file names and metadata into the accessible grid', async () => {
    const fetchMock = vi.fn(async () => Response.json({ files }));
    vi.stubGlobal('fetch', fetchMock);
    render(<StrictMode><FileGrid /></StrictMode>);
    const grid = await screen.findByRole('grid', { name: 'Files' });
    await waitFor(() => expect(within(grid).getAllByRole('row')).toHaveLength(5));
    for (const file of files) expect(within(grid).getByText(file.key)).toBeTruthy();
    expect(within(grid).getByText('0 B')).toBeTruthy();
    expect(within(grid).getByText('4 KB')).toBeTruthy();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/files', expect.objectContaining({
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    }));
  });

  it('shows an honest empty state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ files: [] })));
    render(<FileGrid />);
    expect(await screen.findByText('No files are available in this bucket.')).toBeTruthy();
  });

  it('surfaces storage errors and retries instead of displaying placeholder files', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json({ error: { message: 'Files could not be loaded. Try again.' } }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ files })));
    render(<FileGrid />);
    expect((await screen.findByRole('alert')).textContent).toBe('Files could not be loaded. Try again.');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry files' }));
    const grid = await screen.findByRole('grid', { name: 'Files' });
    await waitFor(() => expect(within(grid).getAllByRole('row')).toHaveLength(5));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    { files: [{ ...files[0], size: -1 }] },
    { files: [{ ...files[0], uploaded: 'not a date' }] },
    { files: [...files, files[0]] },
    { files: [files[0], files[0]] },
  ])('rejects malformed or oversized responses: %j', async (payload) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(payload)));
    render(<FileGrid />);
    expect((await screen.findByRole('alert')).textContent).toBe('The server returned an invalid file list.');
  });

  it('aborts the file request when the homepage unmounts', async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Promise<Response>(() => {});
    }));
    const { unmount } = render(<FileGrid />);
    await waitFor(() => expect(signal).toBeDefined());
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
