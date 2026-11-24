import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';

type ButtonVariant = 'primary' | 'secondary';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: ButtonVariant;
}

export function Button({
  children,
  variant = 'primary',
  type = 'button',
  className,
  ...rest
}: ButtonProps) {
  const variantClass = styles[variant];
  const combinedClassName = className
    ? `${styles.button} ${variantClass} ${className}`
    : `${styles.button} ${variantClass}`;

  return (
    <button type={type} className={combinedClassName} {...rest}>
      {children}
    </button>
  );
}