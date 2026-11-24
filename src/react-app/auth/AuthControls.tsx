import { Button } from 'react-aria-components/Button';
import { LogIn, LogOut } from 'lucide-react';
import { useAuth } from './auth-context';
import styles from './AuthControls.module.css';

export function AuthControls({ collapsed = false }: { collapsed?: boolean }) {
  const auth = useAuth();
  return (
    <div className={styles.controls}>
      {!collapsed && auth.error && <p role="alert">{auth.error}</p>}
      {!collapsed && auth.account && <p className={styles.account}>{auth.account.name}</p>}
      {(!auth.account || auth.error) && (
        <Button
          className={styles.button}
          isDisabled={!auth.configured || auth.loading}
          onPress={() => void auth.signIn()}
          aria-label={auth.account ? 'Sign in again' : 'Sign in with Microsoft'}
        >
          <LogIn size={18} aria-hidden="true" />
          {!collapsed && (auth.loading ? 'Connecting...' : auth.account ? 'Sign in again' : 'Sign in with Microsoft')}
        </Button>
      )}
      {auth.account && (
        <Button className={styles.button} isDisabled={auth.loading} onPress={() => void auth.signOut()} aria-label="Sign out">
          <LogOut size={18} aria-hidden="true" />
          {!collapsed && 'Sign out'}
        </Button>
      )}
      {!collapsed && auth.loading && <p role="status">Connecting to Microsoft...</p>}
    </div>
  );
}
