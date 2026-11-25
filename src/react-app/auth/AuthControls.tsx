import { Button } from 'react-aria-components/Button';
import { LogIn } from 'lucide-react';
import { useAuth } from './auth-context';
import styles from './AuthControls.module.css';

export function AuthControls({ collapsed = false }: { collapsed?: boolean }) {
  const auth = useAuth();
  return (
    <div className={styles.controls}>
      {!collapsed && auth.error && <p role="alert">{auth.error}</p>}
      {!collapsed && auth.account && <p className={styles.account}>{auth.account.name}</p>}
      {!auth.account && (
        <Button
          className={styles.button}
          isDisabled={auth.loading}
          onPress={() => window.location.reload()}
          aria-label="Retry Cloudflare Access sign-in"
        >
          <LogIn size={18} aria-hidden="true" />
          {!collapsed && (auth.loading ? 'Connecting...' : 'Sign in with Cloudflare Access')}
        </Button>
      )}
      {!collapsed && auth.loading && <p role="status">Connecting to Cloudflare Access...</p>}
    </div>
  );
}
