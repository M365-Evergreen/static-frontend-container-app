export interface AgentComposerProps {
  prompt: string;
  busy: boolean;
  cancelling: boolean;
  disabled: boolean;
  onPromptChange: (value: string) => void;
  onSubmit: () => Promise<void>;
  onCancel: () => Promise<void>;
}
