import { CheckCircle2, ChevronRight, Circle, LoaderCircle, OctagonX } from 'lucide-react';
import { Button } from 'react-aria-components/Button';
import { Disclosure, DisclosurePanel } from 'react-aria-components/Disclosure';
import { Heading } from 'react-aria-components/Heading';
import { Markdown } from '../Markdown/Markdown';
import type { AgentTraceProps } from './AgentTrace.types';
import styles from './AgentTrace.module.css';

const STAGES = [
  { id: 'planner_agent', label: 'Planner' },
  { id: 'research_agent', label: 'Researcher (model-only)' },
  { id: 'synthesizer_agent', label: 'Synthesizer' },
] as const;

export function AgentTrace({ progress, status = 'done' }: AgentTraceProps) {
  const active = status === 'starting' || status === 'running' || status === 'cancelling';
  const nextIndex = progress.length;
  return (
    <div className={styles.trace} aria-label="Agent stages">
      {status === 'starting' && <p className={styles.note}>Connecting to the agents. The container may need to start.</p>}
      {STAGES.map((stage, index) => {
        const result = progress.find((event) => event.agent === stage.id);
        const running = active && index === nextIndex;
        const stopped = !active && status !== 'done' && index === nextIndex;
        const label = result ? 'Completed' : running ? 'Waiting for result' : stopped ? 'Stopped' : 'Not run';
        const Icon = result ? CheckCircle2 : running ? LoaderCircle : stopped ? OctagonX : Circle;
        const title = (
          <>
            <Icon className={running ? styles.spinner : undefined} size={16} aria-hidden="true" />
            <span>{stage.label}</span>
            <span className={styles.status}>{label}</span>
          </>
        );
        return result ? (
          <Disclosure key={stage.id} className={styles.disclosure}>
            <Heading level={3} className={styles.heading}>
              <Button slot="trigger" className={styles.row}>
                {title}<ChevronRight className={styles.chevron} size={16} aria-hidden="true" />
              </Button>
            </Heading>
            <DisclosurePanel className={styles.panel}>
              <Markdown>{result.output}</Markdown>
            </DisclosurePanel>
          </Disclosure>
        ) : <div key={stage.id} className={styles.row}>{title}</div>;
      })}
    </div>
  );
}
