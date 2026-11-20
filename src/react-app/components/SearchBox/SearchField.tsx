import {
  Button,
  Input,
  SearchField as AriaSearchField,
  type SearchFieldProps as AriaSearchFieldProps,
  type ValidationResult
} from 'react-aria-components/SearchField';
import {Label, FieldError, Description} from '../../components/Form/Form';
import {Search, X} from 'lucide-react';
import styles from './SearchBox.module.css';

export interface SearchFieldProps extends AriaSearchFieldProps {
  label?: string;
  description?: string;
  errorMessage?: string | ((validation: ValidationResult) => string);
  placeholder?: string;
}

export function SearchField({
  label,
  description,
  errorMessage,
  placeholder,
  ...props
}: SearchFieldProps) {
  return (
    <AriaSearchField {...props}>
      {label && <Label className={styles.searchLabel}>{label}</Label>}
      <Search size={18} />
      <Input placeholder={placeholder} className={styles.searchInput} />
      <Button className={styles.clearButton}>
        <X size={14} />
      </Button>
      {description && <Description>{description}</Description>}
      <FieldError>{errorMessage}</FieldError>
    </AriaSearchField>
  );
}
