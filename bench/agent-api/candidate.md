# candidate tiny bench

Source 4f6160efeb59d87e01c97867f08cc424daa0092c; corpus 6f7047e748f22e35fdbefea7719d3798b3251c00137037585240099d2e2428c7; cases d58a66a7d4003054855b52f7229634fed414f64c75d74cc30d72a85e3481a41b.

Fixed API flow pass rate 16/16; known-answer Hit@5 100.0%; MRR@5 0.938; nDCG@5 0.833.

Existing library quality (6 queries): Hit@5 100.0%; MRR@5 0.917; nDCG@5 0.778. Capability cases 6/6.

| Case | Success | Unsupported | Requests | Bytes | Local ms |
|---|---:|---:|---:|---:|---:|
| exact-osworld | true | false | 1 | 5154 | 25.85 |
| drawing-colloquial | true | false | 1 | 12296 | 6.87 |
| drawing-formal | true | false | 1 | 12296 | 1.27 |
| harness-alias | true | false | 1 | 7711 | 2.27 |
| keyword-alias | true | false | 1 | 22506 | 0.61 |
| research-experience | true | false | 1 | 10625 | 1.41 |
| distillation-direction | true | false | 1 | 5609 | 2.06 |
| type-topic-filter | true | false | 1 | 7400 | 0.34 |
| no-answer | true | false | 1 | 2441 | 1.41 |
| complete-pagination | true | false | 9 | 278734 | 2.01 |
| resource-weekly-citation | true | false | 2 | 4958 | 62.85 |
| daily-drawing | true | false | 2 | 4412 | 14.11 |
| weekly-research | true | false | 2 | 4179 | 2.56 |
| topic-read | true | false | 2 | 4412 | 3.75 |
| missing-edition | true | false | 1 | 2010 | 6.62 |
| exact-related-id | true | false | 1 | 3487 | 0.09 |

Quality uses known gold, not exhaustive relevance judgments. Local ms excludes network and is diagnostic only. The deterministic API flow pass rate is not open-ended user or agent task success: legacy whole-file reads can sometimes complete the same user task. Unsupported attempts are not HTTP requests. Per-case JSON separates search, read, detail and discovery bytes.
