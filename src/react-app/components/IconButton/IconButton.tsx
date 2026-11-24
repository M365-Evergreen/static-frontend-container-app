import { Button } from 'react-aria-components/Button';
import { Tooltip, TooltipTrigger } from 'react-aria-components/Tooltip';
import type { IconButtonProps } from './IconButton.types';
import styles from './IconButton.module.css';

export function IconButton({ children, tooltip, className, ...props }: IconButtonProps) {
  const button = (
    <Button
      {...props}
      className={(state) => [styles.button,
        typeof className === 'function' ? className(state) : className].filter(Boolean).join(' ')}
    >
      {children}
    </Button>
  );
  return tooltip ? (
    <TooltipTrigger delay={400}>
      {button}
      <Tooltip className={styles.tooltip}>{tooltip}</Tooltip>
    </TooltipTrigger>
  ) : button;
}
