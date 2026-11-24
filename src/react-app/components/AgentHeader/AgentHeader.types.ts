export interface AgentHeaderProps {
  disabled: boolean;
  resetting: boolean;
  onReset: () => Promise<void>;
}
