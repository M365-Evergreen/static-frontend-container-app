import { useEffect, useRef } from 'react';
import { ArrowUp, MessageSquare, Square } from 'lucide-react';
import { TextArea, TextField } from 'react-aria-components/TextField';
import { Text } from 'react-aria-components/Text';
import { Form, Label } from '../Form/Form';
import { IconButton } from '../IconButton/IconButton';
import { ContextMenu } from '../ContextMenu/ContextMenu';
import { promptError } from '../../chat/chat.types';
import type { AgentComposerProps } from './AgentComposer.types';
import styles from './AgentComposer.module.css';

export function AgentComposer({
  prompt, busy, cancelling, disabled, onPromptChange, onSubmit, onCancel,
}: AgentComposerProps) {
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const wasBusy = useRef(false);
  const error = promptError(prompt);
  const canSend = Boolean(prompt.trim()) && !error && !busy && !disabled;

  useEffect(() => {
    if (wasBusy.current && !busy && !disabled &&
        (document.activeElement === document.body || form.current?.contains(document.activeElement))) {
      input.current?.focus();
    }
    wasBusy.current = busy;
  }, [busy, disabled]);

  return (
    <Form
      ref={form}
      className={styles.composer}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) void onSubmit();
      }}
    >
      <TextField
        value={prompt}
        onChange={onPromptChange}
        isDisabled={busy || disabled}
        isInvalid={Boolean(error)}
        validationBehavior="aria"
        className={styles.field}
      >
        <Label className="sr-only">Message</Label>
        <TextArea
          ref={input}
          placeholder="Ask the agents..."
          rows={2}
          className={styles.input}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey &&
                !event.nativeEvent.isComposing && event.keyCode !== 229) {
              event.preventDefault();
              if (canSend) form.current?.requestSubmit();
            }
          }}
        />
        <Text slot="description" className="sr-only">
          Enter to send. Shift+Enter for a new line.
        </Text>
        {error && <Text slot="errorMessage" role="alert" className={styles.error}>{error}</Text>}
      </TextField>
      <div className={styles.actions}>
        <ContextMenu />
        <span className={styles.mode}><MessageSquare size={15} aria-hidden="true" />Chat</span>
        <span className={styles.contextNote}>Text only. Context tools unavailable.</span>
        {busy ? (
          <IconButton
            aria-label={cancelling ? 'Cancelling run' : 'Stop agents'}
            tooltip={cancelling ? 'Cancelling run' : 'Stop agents'}
            isDisabled={cancelling}
            onPress={() => void onCancel()}
            className={styles.send}
          >
            <Square size={16} aria-hidden="true" />
          </IconButton>
        ) : (
          <IconButton type="submit" aria-label="Send message" isDisabled={!canSend} className={styles.send}>
            <ArrowUp size={18} aria-hidden="true" />
          </IconButton>
        )}
      </div>
    </Form>
  );
}
