import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { MessageScroller } from '../../src/react-app/components/MessageScroller/MessageScroller';

function box(top: number, height: number): DOMRect {
  return { top, bottom: top + height, left: 0, right: 500, height, width: 500, x: 0, y: top, toJSON: () => ({}) };
}

it('anchors a new question, preserves manual scrolling, and returns to the live edge', async () => {
  let contentHeight = 1200;
  let anchorTop = 1000;
  let resized: ResizeObserverCallback = () => {};
  class Observer implements ResizeObserver {
    constructor(callback: ResizeObserverCallback) { resized = callback; }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const notificationObserver = new Observer(() => {});
  vi.stubGlobal('ResizeObserver', Observer);
  const children = <><div>Old messages</div><div data-turn-id="turn-one">New question</div></>;
  const { rerender } = render(<MessageScroller anchorId={null} busy>{children}</MessageScroller>);
  const viewport = screen.getByRole('region', { name: 'Conversation' });
  const body = viewport.firstElementChild;
  const spacer = body?.nextElementSibling;
  const anchor = screen.getByText('New question');
  if (!(body instanceof HTMLElement) || !(spacer instanceof HTMLElement)) throw new Error('Missing scroller elements');
  Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 400 });
  Object.defineProperty(viewport, 'scrollHeight', { configurable: true, get: () => contentHeight + (parseFloat(spacer.style.height) || 0) });
  vi.spyOn(viewport, 'getBoundingClientRect').mockImplementation(() => box(0, 400));
  vi.spyOn(body, 'getBoundingClientRect').mockImplementation(() => box(-viewport.scrollTop, contentHeight));
  vi.spyOn(anchor, 'getBoundingClientRect').mockImplementation(() => box(anchorTop - viewport.scrollTop, 50));
  rerender(<MessageScroller anchorId="turn-one" busy>{children}</MessageScroller>);
  expect(viewport.scrollTop).toBe(1000);
  expect(spacer.style.height).toBe('200px');

  viewport.scrollTop = 500;
  fireEvent.scroll(viewport);
  contentHeight = 1800;
  act(() => resized([], notificationObserver));
  expect(viewport.scrollTop).toBe(500);
  expect(spacer.style.height).toBe('0px');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Return to latest message' }));
  expect(viewport.scrollTop).toBe(1400);
  expect(document.activeElement).toBe(viewport);

  contentHeight = 1900;
  act(() => resized([], notificationObserver));
  expect(viewport.scrollTop).toBe(1500);
  anchorTop = 1850;
  anchor.dataset.turnId = 'turn-two';
  rerender(<MessageScroller anchorId="turn-two" busy>{children}</MessageScroller>);
  expect(viewport.scrollTop).toBe(1850);
});
