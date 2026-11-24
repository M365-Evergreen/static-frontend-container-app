import { useId } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Dialog } from 'react-aria-components/Dialog';
import { Modal, ModalOverlay } from 'react-aria-components/Modal';
import { FileText, Settings,  PanelLeftClose, PanelLeftOpen,  BotMessageSquareIcon } from 'lucide-react';
import { IconButton } from '../IconButton/IconButton';
import styles from './Sidebar.module.css';

const buttons = [
  { to: "/agent", label: "Chat", icon: BotMessageSquareIcon, end: true },
  { to: "/documents", label: "Files", icon: FileText },

  { to: "/admin/dashboard/settings", label: "Settings", icon: Settings, end: true },
];

interface Props {
  id?: string;
  isOpen?: boolean;
  isMobile?: boolean;
  heading?: string;
  onToggle: () => void;
  items?: typeof buttons;
  onNavLinkClick?: () => void;
}

export function Sidebar({ id, isOpen = false, isMobile = false, heading, onToggle, items = buttons, onNavLinkClick }: Props) {
  const generatedId = useId();
  const collapsed = !isMobile && !isOpen;
  const content = (
    <div className={styles.content}>
      <div className={styles.heading}>
        {heading ? <h2 hidden={collapsed}>{heading}</h2> : (
          <Link to="/" className={styles.brand} onClick={onNavLinkClick} hidden={collapsed}>Paulibaby</Link>
        )}
        <IconButton
          onPress={onToggle}
          aria-label={collapsed ? 'Show sidebar' : 'Hide sidebar'}
          tooltip={collapsed ? 'Show sidebar' : 'Hide sidebar'}
          aria-expanded={isOpen}
          aria-controls={id ?? generatedId}
          className={styles.close}
        >
          {collapsed
            ? <PanelLeftOpen size={20} aria-hidden="true" />
            : <PanelLeftClose size={20} aria-hidden="true" />}
        </IconButton>
      </div>
      <nav aria-label="Admin navigation" className={styles.navigation}>
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={label}
            to={to}
            end={end}
            onClick={onNavLinkClick}
            title={collapsed ? label : undefined}
            className={({ isActive }) => `${styles.navLink} ${isActive ? styles.navActive : ''}`}
          >
            <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
            <span className={styles.label}>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );

  if (isMobile) {
    return (
      <ModalOverlay
        isOpen={isOpen}
        onOpenChange={(open) => { if (!open) onToggle(); }}
        isDismissable
        className={styles.backdrop}
      >
        <Modal className={styles.drawer}>
          <Dialog id={id ?? generatedId} aria-label={heading ?? 'Admin navigation'} className={styles.dialog}>
            {content}
          </Dialog>
        </Modal>
      </ModalOverlay>
    );
  }

  return (
    <aside
      id={id ?? generatedId}
      className={`${styles.sidebar} ${isOpen ? styles.sidebarOpen : ''}`}
      aria-label="Admin navigation"
    >
      {content}
    </aside>
  );
}