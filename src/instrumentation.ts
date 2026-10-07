const WORKER_INTERVAL_MS = 5_000;
const WORKER_STATE_KEY = '__aratWorkflowWorkerStarted__';

type GlobalWithWorker = typeof globalThis & {
  [WORKER_STATE_KEY]?: boolean;
};

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NODE_ENV !== 'development') return;

  const globalState = globalThis as GlobalWithWorker;
  if (globalState[WORKER_STATE_KEY]) return;
  globalState[WORKER_STATE_KEY] = true;

  const { processQueuedWorkflow } = await import('@/lib/ai/workflow');
  const { pollImapInbox } = await import('@/lib/email/imap-inbound');

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

  const runEmailPoll = async () => {
    try {
      const result = await pollImapInbox();
      console.log('[ARAT][email-worker]', JSON.stringify(result));
    } catch (error) {
      console.error('[ARAT][email-worker] failed', error);
    }
  };

  console.log('[ARAT][workflow-worker] started (local development)');
  console.log('[ARAT][email-worker] started (local development)');
  void run();
  void runEmailPoll();
  setInterval(run, WORKER_INTERVAL_MS).unref();
  setInterval(runEmailPoll, 60_000).unref();
}

