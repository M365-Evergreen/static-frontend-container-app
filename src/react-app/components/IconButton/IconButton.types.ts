
import type { ReactNode, Ref } from 'react';
import type { ButtonProps } from 'react-aria-components/Button';

export interface IconButtonProps extends Omit<ButtonProps, 'children'> {
  children: ReactNode;
  tooltip?: string;
  ref?: Ref<HTMLButtonElement>;
}
