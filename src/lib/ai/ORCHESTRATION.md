# ARAT Orchestration

The orchestrator uses a durable execution record in `ai_executions`.

## Guarantees

- Stable task_key makes stage enqueue idempotent.
- Execution state is queued/running/succeeded/failed/cancelled.
- Temporary failures are retried up to three attempts.
- Terminal failure creates an AI Alert.
- Previous workflow state is preserved.
- Agent execution is separated from provider credentials and database service keys.

## Email flow

Incoming email:
1. provider adapter receives message
2. communication record is created
3. Email Response Agent determines match
4. reliable RFQ/reference match is preferred
5. unmatched messages go to Unmatched Emails
6. matched supplier response is handed to Quote Extraction

Outgoing RFQ:
1. RFQ draft
2. Admin approval
3. provider adapter send
4. communication record
5. RFQ becomes Sent

No AI agent receives email provider credentials.
