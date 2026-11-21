import { useId, useRef, useState } from 'react';
import { Outlet } from 'react-router-dom';
import styles from './AppShell.module.css';
import Header from '../components/Header/Header';
import { Sidebar } from '../components/Sidebar/Sidebar';
import { useMediaQuery } from '../hooks/useMediaQuery';

export const AppShell = () => {
  const isMobile = useMediaQuery('(max-width: 47.999rem)');
  const [desktopOpen, setDesktopOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const sidebarOpen = isMobile ? mobileOpen : desktopOpen;
  const setSidebarOpen = isMobile ? setMobileOpen : setDesktopOpen;
  const sidebarId = useId();
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  const toggleSidebar = () => {
    setSidebarOpen((open) => !open);
  };
  const closeSidebar = () => {
    setSidebarOpen(false);
  };

  return (
    <div className={styles.shell}>
      <a href="#main-content" className={styles.skipLink}>Skip to main content</a>
      <Sidebar
        id={sidebarId}
        isOpen={sidebarOpen}
        isMobile={isMobile}
        onToggle={toggleSidebar}
        onNavLinkClick={closeSidebar}
      />
      <div className={styles.workspace}>
        <Header
          isMobile={isMobile}
          sidebarId={sidebarId}
          sidebarOpen={sidebarOpen}
          onSidebarToggle={toggleSidebar}
          sidebarToggleRef={sidebarToggleRef}
        />
        <main id="main-content" className={styles.main} tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
};
export default AppShell;