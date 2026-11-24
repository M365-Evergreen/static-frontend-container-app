import { useId, useState } from 'react';
import { useParams } from 'react-router-dom';
import Agent from '../../components/Agent/Agent';
import { Button } from 'react-aria-components/Button';
import { Sidebar } from '../../components/Sidebar/Sidebar';
import styles from './AgentPage.module.css';

export const AgentPage = () => {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerId = useId();
  const { sessionId } = useParams();

  if (sessionId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) {
    return <p role="alert">This conversation ID is invalid.</p>;
  }

  return (
    <div className={styles.agentPage}>
      <header className={styles.agentPageHeader}>
        <Button
          onPress={() => setDrawerOpen((open) => !open)}
          aria-expanded={drawerOpen}
          aria-controls={drawerId}
          className={styles.settingsButton}
        >
          PAULIBABY
        </Button>
      </header>

      <Sidebar
        id={drawerId}
        isOpen={drawerOpen}
        isMobile
        heading="Post Settings"
        onToggle={() => setDrawerOpen(false)}
        onNavLinkClick={() => setDrawerOpen(false)}
      />

      <div className={styles.agentContent}>
        <Agent key={sessionId ?? 'current'} sessionId={sessionId?.toLowerCase()} />
      </div>
    </div>
  );
};

export default AgentPage;