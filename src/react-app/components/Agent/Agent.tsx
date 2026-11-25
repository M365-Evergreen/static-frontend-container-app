import { useContext } from 'react';
import { AgentComposer } from '../AgentComposer/AgentComposer';
import { AgentEmptyState } from '../AgentEmptyState/AgentEmptyState';
import { AgentHeader } from '../AgentHeader/AgentHeader';
import { AgentTrace } from '../AgentTrace/AgentTrace';
import { Button } from '../Button/Button';
import { ChatMessage } from '../ChatMessage/ChatMessage';
import { MessageScroller } from '../MessageScroller/MessageScroller';
import { useAgentChat } from '../../hooks/useAgentChat';
import { useAuth } from '../../auth/auth-context';
import { AuthControls } from '../../auth/AuthControls';
import { ChatHistoryContext } from '../../chat/history-context';
import styles from './Agent.module.css';

function AgentConversation({ sessionId, ownerId }: { sessionId?: string; ownerId: string }) {
  const { request } = useAuth();
  const history = useContext(ChatHistoryContext);
  const chat = useAgentChat({ sessionId, ownerId, request, onHistoryChanged: history?.refresh });
  const isEmpty = !chat.loadingHistory && !chat.historyError && chat.messages.length === 0 && !chat.draft;
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
      <div className={`${styles.workspace} ${isEmpty ? styles.workspaceEmpty : ''}`}>
        {isEmpty ? (
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
      </div>
    </section>
  );
}

function Agent({ sessionId }: { sessionId?: string }) {
  const auth = useAuth();
  if (!auth.account || auth.loading) {
    return <section className={styles.shell} aria-label="Chat sign-in">
      <h2>Sign in to chat</h2>
      <p>Your conversations are private to your Cloudflare Access account.</p>
      <AuthControls />
    </section>;
  }
  return <AgentConversation key={`${auth.account.id}:${sessionId ?? 'current'}`} sessionId={sessionId} ownerId={auth.account.id} />;
}

export default Agent;
