import {mergeProps} from 'react-aria/mergeProps';
import {useFocus} from 'react-aria/useFocus';
import {useTextField, type AriaTextFieldProps} from 'react-aria/useTextField';
import {useRef, useState} from 'react';
import styles from './TextField.module.css';
// import './Form.css';

export interface TextFieldProps extends AriaTextFieldProps {
  label?: React.ReactNode;
}

export function TextField(props: TextFieldProps) {
  let ref = useRef<HTMLInputElement>(null);
  let {labelProps, inputProps} = useTextField(props, ref);
  let [isFocused, setFocused] = useState(false);
  let {focusProps} = useFocus({onFocusChange: setFocused});

  return (
    <div className={styles.textField}>
      <label className={styles.label} {...labelProps}>
        {props.label}
      </label>
      <input
        {...mergeProps(inputProps, focusProps)}
        ref={ref}
        className={styles.input}
        data-focused={isFocused || undefined}
      />
    </div>
  );
}
