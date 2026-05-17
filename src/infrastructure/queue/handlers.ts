export type JobHandler = (payload: Record<string, unknown>, ctx: HandlerContext) => Promise<void>;

export interface HandlerContext {
  jobId: number;
  heartbeat: () => Promise<void>;
}

const registry = new Map<string, JobHandler>();

export function registerHandler(jobType: string, handler: JobHandler): void {
  if (registry.has(jobType)) throw new Error(`Handler already registered: ${jobType}`);
  registry.set(jobType, handler);
}

export function getHandler(jobType: string): JobHandler | undefined {
  return registry.get(jobType);
}

export function listHandlers(): string[] {
  return [...registry.keys()];
}

export function clearHandlers(): void {
  registry.clear();
}
