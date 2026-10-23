# baseline tiny bench

Source 4f6160efeb59d87e01c97867f08cc424daa0092c; corpus 6f7047e748f22e35fdbefea7719d3798b3251c00137037585240099d2e2428c7; cases d58a66a7d4003054855b52f7229634fed414f64c75d74cc30d72a85e3481a41b.

Fixed API flow pass rate 7/16; known-answer Hit@5 50.0%; MRR@5 0.438; nDCG@5 0.385.

Existing library quality (6 queries): Hit@5 66.7%; MRR@5 0.583; nDCG@5 0.514. Capability cases 0/6.

| Case | Success | Unsupported | Requests | Bytes | Local ms |
|---|---:|---:|---:|---:|---:|
| exact-osworld | true | false | 1 | 5860 | 25.60 |
| drawing-colloquial | false | false | 1 | 2320 | 3.55 |
| drawing-formal | false | false | 1 | 2320 | 0.53 |
| harness-alias | true | false | 1 | 6371 | 0.77 |
| keyword-alias | true | false | 1 | 15947 | 0.46 |
| research-experience | true | false | 1 | 7080 | 0.60 |
| distillation-direction | true | false | 1 | 6672 | 0.72 |
| type-topic-filter | true | false | 1 | 7306 | 0.16 |
| no-answer | false | false | 1 | 4331 | 0.58 |
| complete-pagination | true | false | 9 | 185210 | 1.93 |
| resource-weekly-citation | false | false | 1 | 3265 | 0.68 |
| daily-drawing | false | true | 0 | 0 | 0.00 |
| weekly-research | false | true | 0 | 0 | 0.00 |
| topic-read | false | false | 1 | 12284 | 0.32 |
| missing-edition | false | true | 0 | 0 | 0.00 |
| exact-related-id | false | true | 0 | 0 | 0.00 |

Quality uses known gold, not exhaustive relevance judgments. Local ms excludes network and is diagnostic only. The deterministic API flow pass rate is not open-ended user or agent task success: legacy whole-file reads can sometimes complete the same user task. Unsupported attempts are not HTTP requests. Per-case JSON separates search, read, detail and discovery bytes.
