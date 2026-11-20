import { AgentComposer } from './components/AgentComposer/AgentComposer';
import { AgentEmptyState } from './components/AgentEmptyState/AgentEmptyState';
import { AgentHeader } from './components/AgentHeader/AgentHeader';
import { AgentTrace } from './components/AgentTrace/AgentTrace';
import { Button } from './components/Button/Button';
import { ChatMessage } from './components/ChatMessage/ChatMessage';
import { MessageScroller } from './components/MessageScroller/MessageScroller';
import { useAgentChat } from './hooks/useAgentChat';
import styles from './Agent.module.css';

function Agent() {
  const chat = useAgentChat();
  const anchorId = chat.draft?.requestId ?? chat.traces[chat.traces.length - 1]?.requestId ?? null;
  const status = chat.loadingHistory ? 'Restoring conversation...'
    : chat.resetting ? 'Resetting conversation...'
    : chat.cancelling ? 'Requesting cancellation...'
    : chat.draft?.status === 'starting' ? 'Connecting. The container may need to start.'
    : chat.draft?.status === 'running' ? `${chat.draft.progress.length} of 3 agent stages completed. Waiting for the reply.`
    : chat.draft?.status === 'cancelled' ? 'Run cancelled.'
    : chat.draft?.status === 'failed' ? 'Run failed.'
    : chat.messages.length ? 'Reply ready.' : '';

  return (
    <section className={styles.shell} aria-labelledby="agent-heading">
      <AgentHeader
        disabled={chat.busy || chat.loadingHistory || chat.resetting}
        resetting={chat.resetting}
        onReset={chat.reset}
      />
      <div className={styles.status} role="status" aria-atomic="true">{status}</div>
      {chat.notice && <p className={styles.notice}>{chat.notice}</p>}
      {chat.historyError && (
        <div className={styles.error} role="alert">
          <p>{chat.historyError}</p>
          <Button variant="secondary" disabled={chat.busy || chat.resetting} onClick={() => void chat.retryHistory()}>
            Reload history
          </Button>
        </div>
      )}
      {chat.actionError && <p className={styles.error} role="alert">{chat.actionError}</p>}
      {!chat.loadingHistory && !chat.historyError && chat.messages.length === 0 && !chat.draft ? (
        <div className={styles.empty}><AgentEmptyState /></div>
      ) : (
        <MessageScroller anchorId={anchorId} busy={chat.busy || chat.loadingHistory}>
          {chat.messages.map((message) => {
            const trace = chat.traces.find((entry) => entry.requestId === message.request_id);
            return <ChatMessage
              key={`${message.role}-${message.sequence}`}
              role={message.role}
              content={message.content}
              turnId={message.role === 'user' ? message.request_id : undefined}
            >
              {message.role === 'assistant' && trace && trace.progress.length > 0 && (
                <AgentTrace progress={trace.progress} />
              )}
            </ChatMessage>;
          })}
          {chat.draft && (
            <>
              <ChatMessage role="user" content={chat.draft.prompt} turnId={chat.draft.requestId} />
              <ChatMessage role="assistant">
                <AgentTrace progress={chat.draft.progress} status={chat.draft.status} />
                {chat.draft.error && <p className={styles.error} role="alert">{chat.draft.error}</p>}
              </ChatMessage>
            </>
          )}
        </MessageScroller>
      )}
      <AgentComposer
        prompt={chat.prompt}
        onPromptChange={chat.setPrompt}
        busy={chat.busy}
        cancelling={chat.cancelling}
        disabled={chat.loadingHistory || Boolean(chat.historyError) || chat.resetting}
        onSubmit={chat.submit}
        onCancel={chat.cancel}
      />
    </section>
  );
}

export default Agent;
