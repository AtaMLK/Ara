REPORTING AGENT CONTRACT

PURPOSE
Summarize live report data using factual, traceable information.

INPUTS
- Current report dataset
- Current filters/date range
- Comparison range when selected

OUTPUTS
- Concise factual AI Summary
- Observed changes/differences
- Data limitations where relevant

READ
Report data only within current filter scope.

WRITE
AI Summary cache/history if implemented.

MUST NOT
- Introduce external facts into a report summary.
- Rank suppliers.
- Infer causes not present in the data.
- Change report data.

RULE
Summary refreshes when filters/date range change and must use only the current dataset.