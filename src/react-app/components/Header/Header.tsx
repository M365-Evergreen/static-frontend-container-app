import type { Ref } from 'react';
import styles from './Header.module.css';
import { Home, Info, PanelLeftOpen, User, Wrench, File } from 'lucide-react';
import { IconButton } from '../IconButton/IconButton';
import { Link, NavLink } from 'react-router-dom';
const NAV_ITEMS = [
  { label: 'Home', to: '/', icon: <Home /> },
  { label: 'About', to: '/about', icon: <Info /> },
  { label: 'Agent', to: '/agent', icon: <User /> },
  { label: 'Browser tools', to: '/browser-tools', icon: <Wrench /> },
  { label: 'Files', to: '/documents', icon: <File /> },
];




interface HeaderProps {
  isMobile: boolean;
  sidebarId: string;
  sidebarOpen: boolean;
  onSidebarToggle: () => void;
  sidebarToggleRef?: Ref<HTMLButtonElement>;
}

const Header = ({ isMobile, sidebarId, sidebarOpen, onSidebarToggle, sidebarToggleRef }: HeaderProps) => {
  return (
    <header className={styles.header}>
      {isMobile && (
        <IconButton
          ref={sidebarToggleRef}
          onPress={onSidebarToggle}
          aria-controls={sidebarId}
          aria-expanded={sidebarOpen}
          aria-label={sidebarOpen ? 'Close Drawer' : 'Open Drawer'}
          tooltip={sidebarOpen ? 'Close Drawer' : 'Open Drawer'}
          className={styles.toggle}
        >
          <PanelLeftOpen size={20} aria-hidden="true" />
        </IconButton>
      )}
      <Link to="/" className={styles.brand}>
        <img
          src="https://blog.paulibaby.com/paulibaby.png"
          alt="Paulibaby logo"
          className={styles.siteLogo}
        />
        <div className={styles.siteTitle}>Paulibaby</div>
      </Link>

      <nav aria-label="Primary">
        <ul className={styles.navList}>
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink to={item.to} className={styles.navLink} end={item.to === '/'} title={item.label}>
                {item.icon}
                <span>{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
};

export default Header;