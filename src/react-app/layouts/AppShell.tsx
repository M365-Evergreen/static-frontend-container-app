import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Container } from '../components/Container/Container';
import styles from './AppShell.module.css';

interface NavItem {
  label: string;
  to: string;
}

interface AppShellProps {
  children: ReactNode;
}

const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Home', to: '/' },
  { label: 'About', to: '/about' },
];

export function AppShell({ children }: AppShellProps) {
  return (
    <div className={styles.shell}>
      <a href="#main-content" className={styles.skipLink}>
        Skip to main content
      </a>

      <header className={styles.header}>
        <Container className={styles.headerInner}>
          <NavLink to="/" className={styles.brand}>
            Paulibaby
          </NavLink>

          <nav aria-label="Primary">
            <ul className={styles.navList}>
              {NAV_ITEMS.map((item) => (
                <li key={item.to}>
                  <NavLink to={item.to} className={styles.navLink} end={item.to === '/'}>
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </Container>
      </header>

      <main id="main-content" className={styles.main} tabIndex={-1}>
        <Container>{children}</Container>
      </main>

      <footer className={styles.footer}>
        <Container>
          <p>StaticApp &copy; {new Date().getFullYear()}. Built for high contrast and accessibility.</p>
        </Container>
      </footer>
    </div>
  );
}