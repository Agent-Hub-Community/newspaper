# candidate-baseline-ranker tiny bench

Source 4f6160efeb59d87e01c97867f08cc424daa0092c; corpus 6f7047e748f22e35fdbefea7719d3798b3251c00137037585240099d2e2428c7; cases d58a66a7d4003054855b52f7229634fed414f64c75d74cc30d72a85e3481a41b.

Fixed API flow pass rate 15/16; known-answer Hit@5 100.0%; MRR@5 0.938; nDCG@5 0.833.

Existing library quality (6 queries): Hit@5 100.0%; MRR@5 0.917; nDCG@5 0.778. Capability cases 6/6.

| Case | Success | Unsupported | Requests | Bytes | Local ms |
|---|---:|---:|---:|---:|---:|
| exact-osworld | true | false | 1 | 5954 | 21.98 |
| drawing-colloquial | true | false | 1 | 12296 | 6.03 |
| drawing-formal | true | false | 1 | 12296 | 1.24 |
| harness-alias | true | false | 1 | 7711 | 3.63 |
| keyword-alias | true | false | 1 | 22506 | 0.71 |
| research-experience | true | false | 1 | 10625 | 1.36 |
| distillation-direction | true | false | 1 | 10864 | 2.67 |
| type-topic-filter | true | false | 1 | 7400 | 0.23 |
| no-answer | false | false | 1 | 5453 | 1.36 |
| complete-pagination | true | false | 9 | 278734 | 3.37 |
| resource-weekly-citation | true | false | 2 | 4958 | 76.90 |
| daily-drawing | true | false | 2 | 4412 | 7.70 |
| weekly-research | true | false | 2 | 4179 | 2.60 |
| topic-read | true | false | 2 | 4412 | 3.27 |
| missing-edition | true | false | 1 | 2010 | 6.14 |
| exact-related-id | true | false | 1 | 3487 | 0.08 |

Quality uses known gold, not exhaustive relevance judgments. Local ms excludes network and is diagnostic only. The deterministic API flow pass rate is not open-ended user or agent task success: legacy whole-file reads can sometimes complete the same user task. Unsupported attempts are not HTTP requests. Per-case JSON separates search, read, detail and discovery bytes.
