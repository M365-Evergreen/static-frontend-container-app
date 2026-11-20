
import type { ReactNode } from 'react';
import type { ButtonProps } from 'react-aria-components/Button';

export interface IconButtonProps extends Omit<ButtonProps, 'children'> {
  children: ReactNode;
  tooltip?: string;
}
