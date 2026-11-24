import { useContext } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Button } from 'react-aria-components/Button';
import { MessageSquare, Plus, RefreshCw } from 'lucide-react';
import { AuthControls } from '../../auth/AuthControls';
import { useAuth } from '../../auth/auth-context';
import { ChatHistoryContext } from '../../chat/history-context';
import type { ChatHistoryState } from '../../chat/history-context';
import styles from './Sidebar.module.css';

interface Props {
  collapsed: boolean;
  onNavigate?: () => void;
}

function History({ collapsed, onNavigate, history }: Props & { history: ChatHistoryState }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const newChat = () => {
    navigate(`/agent/${crypto.randomUUID()}`);
    onNavigate?.();
  };
  return (
    <section className={styles.history} aria-label="Chat history">
      {auth.account && (
        <Button className={styles.historyButton} onPress={newChat} aria-label="New chat" isDisabled={auth.loading}>
          <Plus size={18} aria-hidden="true" />
          {!collapsed && 'New chat'}
        </Button>
      )}
      {!collapsed && (
        <>
          <div className={styles.historyHeading}>
            <h2>Chat history</h2>
            {auth.account && (
              <Button className={styles.refresh} onPress={history.refresh} isDisabled={history.loading} aria-label="Refresh conversations">
                <RefreshCw size={16} aria-hidden="true" />
              </Button>
            )}
          </div>
          {auth.account ? (
            <div className={styles.historyList} aria-busy={history.loading}>
              {history.loading && <p role="status">Loading conversations...</p>}
              {history.error && <div role="alert">
                <p>{history.error}</p>
                <Button className={styles.historyButton} onPress={history.refresh} isDisabled={history.loading}>Retry history</Button>
              </div>}
              {!history.loading && !history.error && history.conversations.length === 0 && <p>No conversations yet.</p>}
              <nav aria-label="Saved conversations">
                {history.conversations.map((conversation) => (
                  <NavLink
                    key={conversation.session_id}
                    to={`/agent/${conversation.session_id}`}
                    onClick={onNavigate}
                    title={conversation.title}
                    className={({ isActive }) => `${styles.conversation} ${isActive ? styles.navActive : ''}`}
                  >
                    <MessageSquare size={16} aria-hidden="true" />
                    <span>
                      <span className={styles.conversationTitle}>{conversation.title}</span>
                      <time dateTime={new Date(conversation.updated_at).toISOString()}>
                        {new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(conversation.updated_at)}
                      </time>
                    </span>
                  </NavLink>
                ))}
              </nav>
              {history.hasMore && <Button className={styles.historyButton} onPress={history.loadMore} isDisabled={history.loading}>Load more conversations</Button>}
            </div>
          ) : !auth.loading && <p>Sign in to view your conversations.</p>}
        </>
      )}
      <div className={styles.historyAccount}><AuthControls collapsed={collapsed} /></div>
    </section>
  );
}

export function SidebarHistory(props: Props) {
  const history = useContext(ChatHistoryContext);
  return history ? <History {...props} history={history} /> : null;
}
