import { abortable } from "./session-stream.ts";

interface ContainerStartup {
  start(): Promise<void>;
  health(): Promise<Response>;
  ready(): Promise<void>;
}

export async function prepareContainer(
  startup: ContainerStartup,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  for (let attempt = 1; ; attempt++) {
    try {
      await abortable(startup.start(), signal);
      break;
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      const message = typeof error === "string"
        ? error
        : error instanceof Error ? error.message : "";
      if (attempt >= 3 || !message.includes("there is no container instance")) throw error;
      console.warn(JSON.stringify({ event: "container_start_retry", attempt }));
      await abortable(new Promise<void>((resolve) => setTimeout(resolve, 250)), signal);
    }
  }
  // Slow application startup must not hold the SDK's 30-second concurrency gate.
  while (true) {
    try {
      const health = await abortable(startup.health(), signal);
      await abortable(health.body?.cancel() ?? Promise.resolve(), signal);
      if (health.ok) break;
    } catch {
      if (signal.aborted) throw signal.reason;
    }
    console.warn(JSON.stringify({ event: "container_not_ready" }));
    await abortable(new Promise<void>((resolve) => setTimeout(resolve, 250)), signal);
  }
  await abortable(startup.ready(), signal);
}
