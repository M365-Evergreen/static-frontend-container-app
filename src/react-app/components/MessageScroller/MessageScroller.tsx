import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import { IconButton } from '../IconButton/IconButton';
import type { MessageScrollerProps } from './MessageScroller.types';
import styles from './MessageScroller.module.css';

export function MessageScroller({ children, anchorId, busy }: MessageScrollerProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const spacer = useRef<HTMLDivElement>(null);
  const previousAnchor = useRef<string | null>(null);
  const following = useRef(true);
  const [showLatest, setShowLatest] = useState(false);

  const update = useCallback(() => {
    const view = viewport.current;
    const body = content.current;
    if (!view || !body || !spacer.current) return;
    const anchor = anchorId
      ? Array.from(body.querySelectorAll<HTMLElement>('[data-turn-id]')).find((node) => node.dataset.turnId === anchorId)
      : undefined;
    const top = anchor ? anchor.getBoundingClientRect().top - view.getBoundingClientRect().top + view.scrollTop : 0;
    const bottom = body.getBoundingClientRect().bottom - view.getBoundingClientRect().top + view.scrollTop;
    spacer.current.style.height = `${anchor ? Math.max(0, view.clientHeight - (bottom - top)) : 0}px`;
    if (anchorId !== previousAnchor.current) {
      previousAnchor.current = anchorId;
      following.current = true;
    }
    if (following.current) {
      view.scrollTop = anchor
        ? Math.max(top, view.scrollHeight - view.clientHeight)
        : view.scrollHeight;
    }
    setShowLatest(view.scrollHeight - view.clientHeight - view.scrollTop > 32);
  }, [anchorId]);

  useLayoutEffect(() => {
    update();
    const observer = new ResizeObserver(update);
    if (viewport.current) observer.observe(viewport.current);
    if (content.current) observer.observe(content.current);
    return () => observer.disconnect();
  }, [update]);

  // Text and disclosure changes must work even when a browser batches resize notifications.
  useLayoutEffect(() => { update(); }, [children, update]);

  return (
    <div className={styles.scroller}>
      <div
        ref={viewport}
        role="region"
        aria-label="Conversation"
        aria-busy={busy}
        tabIndex={0}
        className={styles.viewport}
        onScroll={() => {
          const view = viewport.current;
          if (!view) return;
          const atLatest = view.scrollHeight - view.clientHeight - view.scrollTop <= 32;
          following.current = atLatest;
          setShowLatest(!atLatest);
        }}
        onWheel={(event) => {
          if (event.deltaY < 0) following.current = false;
        }}
      >
        <div ref={content} className={styles.content}>{children}</div>
        <div ref={spacer} aria-hidden="true" />
      </div>
      {showLatest && (
        <IconButton
          aria-label="Return to latest message"
          tooltip="Return to latest"
          className={styles.latest}
          onPress={() => {
            following.current = true;
            update();
            viewport.current?.focus({ preventScroll: true });
          }}
        >
          <ArrowDown size={18} aria-hidden="true" />
        </IconButton>
      )}
    </div>
  );
}
