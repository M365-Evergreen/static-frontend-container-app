import {Form as RACForm} from 'react-aria-components/Form';
import type {ComponentProps} from 'react';
import {type LabelProps, Label as RACLabel} from 'react-aria-components/Label';
import {type FieldErrorProps, FieldError as RACFieldError} from 'react-aria-components/FieldError';
import {type ButtonProps, Button} from 'react-aria-components/Button';
import {type TextProps} from 'react-aria-components/Text';
import styles from './Form.module.css';
import {Text} from './Content';

export function Form(props: ComponentProps<typeof RACForm>) {
  return <RACForm {...props} />;
}

export function Label(props: LabelProps) {
  return <RACLabel {...props} />;
}

export function FieldError(props: FieldErrorProps) {
  return <RACFieldError {...props} />;
}

export function Description(props: TextProps) {
  return <Text slot="description" className={styles.fieldDescription} {...props} />;
}

export function FieldButton(props: ButtonProps) {
  return <Button {...props} className={styles.fieldButton} />;
}
