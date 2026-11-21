import { Outlet } from 'react-router-dom';
import { Container } from '../components/Container/Container';
import styles from './AppShell.module.css';
import Header from '../components/Header/Header';

export const AppShell = () => {
  return (
    <div className={styles.shell}>
      <a href="#main-content" className={styles.skipLink}>
        Skip to main content
      </a>

      <Header />

      <main className={styles.main} tabIndex={-1}>
        <Container>
          <Outlet />
        </Container>
      </main>
    </div>
  );
}
export default AppShell;