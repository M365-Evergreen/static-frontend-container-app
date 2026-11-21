import { useId, useState } from 'react';
import Agent from '../../components/Agent/Agent';
import { Button } from 'react-aria-components/Button';
import { Sidebar } from '../../components/Sidebar/Sidebar';
import styles from './AgentPage.module.css';

export const AgentPage = () => {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerId = useId();

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
        <Agent />
      </div>
    </div>
  );
};

export default AgentPage;