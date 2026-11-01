const WORKER_INTERVAL_MS = 5_000;
const WORKER_STATE_KEY = '__aratWorkflowWorkerStarted__';

type GlobalWithWorker = typeof globalThis & {
  [WORKER_STATE_KEY]?: boolean;
};

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NODE_ENV !== 'development') return;
  // Frontend-only development should not repeatedly start a worker that
  // cannot authenticate. Do not process jobs until server credentials exist.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)) return;

  const globalState = globalThis as GlobalWithWorker;
  if (globalState[WORKER_STATE_KEY]) return;
  globalState[WORKER_STATE_KEY] = true;

  const { processQueuedWorkflow } = await import('@/lib/ai/workflow');

  const run = async () => {
    try {
      const result = await processQueuedWorkflow(5);
      if (result.processed > 0) {
        console.log('[ARAT][workflow-worker]', JSON.stringify(result));
      }
    } catch (error) {
      console.error('[ARAT][workflow-worker] failed', error);
    }
  };

  console.log('[ARAT][workflow-worker] started (local development)');
  void run();
  setInterval(run, WORKER_INTERVAL_MS).unref();
}

