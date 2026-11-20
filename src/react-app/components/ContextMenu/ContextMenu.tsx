import { Globe, Paperclip, Plus, Telescope, Terminal } from 'lucide-react';
import { Menu, MenuItem, MenuTrigger } from 'react-aria-components/Menu';
import { Popover } from 'react-aria-components/Popover';
import { Text } from 'react-aria-components/Text';
import { IconButton } from '../IconButton/IconButton';
import styles from './ContextMenu.module.css';

const CAPABILITIES = [
  { id: 'files', label: 'Add Photos & Files', description: 'Attachments are not supported by the chat API.', Icon: Paperclip },
  { id: 'research', label: 'Deep Research', description: 'Extended research tools are not implemented.', Icon: Telescope },
  { id: 'search', label: 'Web Search', description: 'The agents use model-only analysis, without live browsing.', Icon: Globe },
  { id: 'commands', label: 'Run Commands', description: 'There is no command execution environment.', Icon: Terminal },
];

export function ContextMenu() {
  return (
    <MenuTrigger>
      <IconButton aria-label="Add context (features unavailable)">
        <Plus size={18} aria-hidden="true" />
      </IconButton>
      <Popover className={styles.popover} placement="top start">
        <p className={styles.note}>Context features are unavailable in this version.</p>
        <Menu aria-label="Unavailable context features" className={styles.menu} disabledKeys={CAPABILITIES.map(({ id }) => id)}>
          {CAPABILITIES.map(({ id, label, description, Icon }) => (
            <MenuItem key={id} id={id} textValue={label} className={styles.item}>
              <Icon size={18} aria-hidden="true" />
              <div>
                <Text slot="label">{label} <span className={styles.badge}>Unavailable</span></Text>
                <Text slot="description" className={styles.description}>{description}</Text>
              </div>
            </MenuItem>
          ))}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}
