# Delivery 3: bounded provider requests and interrupted-worker detection

## Behavior

- Model requests time out after 120 seconds per attempt; Serper requests after 30
  seconds. Deadlines include reading response bodies and abort the request.
- A claimed workflow execution receives a unique lease token and a heartbeat every
  30 seconds while its stage runs. Timers are cleaned up when the stage finishes.
- At each worker invocation, running executions without a heartbeat for five minutes
  become failed with `WORKER_INTERRUPTED`, preserving their input and partial output.
  Legacy running rows fall back to started_at, then created_at.
- The failure and urgent admin alert are recorded atomically. Repeated scans do not
  create duplicate alerts; fresh heartbeats and queued jobs are unaffected.
- Interrupted stages do not replay through normal enqueue/poll/recovery paths.
  Admin must inspect partial results before using the existing explicit retry action.
- Lease tokens fence late heartbeats, success and failure updates from an older
  attempt after a new attempt has claimed the same execution.

## Verification

- 63 Node tests passed: workflow, competing claims, stale ownership, interrupted
  enqueue blocking, aborted model/search body reads and request cleanup.
- Live Supabase transaction test passed and rolled back all fixtures:
  `supabase/tests/worker_heartbeat_recovery.sql`. It checks stale/legacy jobs,
  heartbeat protection, inquiry isolation, retained output, idempotent alerts and
  service-only RPC privileges. The migration was applied to the ARAT project.
- TypeScript and production build passed. Security advisors introduced no new
  findings; previously documented auth/helper advisories remain.
- Commands: `npm run test:supplier-workflow`, `npm run test:worker-recovery`.

## Operational boundaries

Detection occurs when the worker next runs, not through a separate scheduler.
The worker/cron must remain configured. A stage that continues sending heartbeats
is considered alive; there is no overall stage runtime limit in this delivery.
Provider deadlines cover model/Serper HTTP calls, not every storage/database/CPU task.
An ownership token protects execution state, not every intermediate business write;
this is not a guarantee of exactly-once processing. That is why interrupted stages
require Admin review before replay. Existing ordinary error retries remain unchanged.
No alternate AI model is selected automatically and no email was sent for testing.

The recovery RPC is SECURITY INVOKER with an empty search path and EXECUTE limited
to service_role, following the database-function permission guidance:
https://supabase.com/docs/guides/database/functions
