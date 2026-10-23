# Agent API tiny bench v1.1

固定 source SHA `4f6160e`，16 个由真实访问任务派生的确定性案例。
本基准里的提交 SHA 都指开源前的内部仓库历史，在公开仓库里查不到；冻结的语料和源码已保存在本目录。
`corpus.json` 保存当时 168 条资料和已发布日周报 Markdown、浏览器搜索索引。
`baseline-src` 保存旧 HTTP handler，基准不受随后生产代码修改影响。
`freeze.json` 记录 corpus、cases 和基准源码 SHA-256；运行器拒绝冻结文件发生变化。

主指标 fixed_api_flow_pass_rate 为固定接口流程成功数 / 16。检索任务先命中前 5 的强相关 gold，并返回原始链接才成功。
对已有答案的 8 个查询另报 Hit@5、MRR@5、nDCG@5。gold 为已读条目，不是全库穷尽相关性标注；不得称全库 recall。
强相关 gain=2，相邻 gain=1，其他项 gain=0。相邻项不满足任务成功。
Hit@5 表示前 5 项至少有一项强相关。MRR@5 是首个强相关结果名次的倒数，未命中计 0，再按查询取均值。
nDCG@5 使用 `DCG = sum((2^gain - 1) / log2(rank + 1))`，除以已标注相关条目理想排序的 DCG。
所有名次从 1 开始。资料库质量只比较原来就能查询的 6 个案例；另外 2 个内容查询单独报告。
过滤和分页按固定 ID 全集核验。缺失接口记 unsupported，不能当作已调用 HTTP。
无答案任务只断言固定语料的具体无匹配字符串，报告误报数，不推断完整群历史。

运行 `node bench/agent-api/run.mjs baseline` 可执行旧 HTTP handler。
运行 `node bench/agent-api/run.mjs candidate` 使用当前 handler 和当前构建 catalog；原始 cases/gold 不变。
运行 `node bench/agent-api/run.mjs candidate-baseline-ranker` 只替换为旧 BM25，保留新接口与词表，报告消融结果。
请求使用内存 fixture，无线上请求、外部延迟和统计写入。每项报告响应字节、本地耗时和调用次数，成本不混入质量分。
字节数是响应正文的 UTF-8 大小，不含 HTTP 头或压缩。调用次数是本地 Request/Response handler 的调用次数。
缺失接口另计 unsupported_attempts，不伪装成真实 HTTP 调用。计时混合首次加载和缓存请求，仅供诊断。
完整任务路径使用明确接口调用。纯讨论检索从内容接口开始，资料查询从资料接口开始；禁止通过整库扫描给缺失接口制造成功。
协议不运行模型，测试的是按接口文档执行固定流程的可用性，不能宣称真实用户或开放式 agent 成功率。
单轮精确命中不是读者任务的最终要求。面向 agent 的任务允许在预算内改写查询、多轮搜索和补读来源。
首次零结果后取得足够证据，可以完成任务；同时记录总请求数、响应字节和引用完整性。
单轮 Hit/MRR/nDCG 用于定位检索问题，不代替多轮任务完成度。独立读者场景已经包含改写恢复路径。
旧接口通过下载索引或整库 JSON 也可能完成缺刊查日期、精确 ID 查询等用户任务；unsupported 只说明该固定接口能力不存在。
已有资料库排序的 6 个案例与新内容发现/关联/读取的 6 个能力案例分别统计，避免把新增覆盖说成排序改进。

从 `newspaper` 目录复现：

1. 运行 `npm run build -- --public`，生成候选目录。
2. 依次运行上述 baseline、candidate、candidate-baseline-ranker 三个命令。
3. 运行 `node bench/agent-api/compare.mjs`，更新对比报告。

正文源文件或候选条目集合变化时，运行器拒绝比较。新增语料应建立新版本评测，不能覆盖本版冻结文件。

独立读者场景保存在 `heldout-reader-audit.json`。公开构建后运行
`node bench/agent-api/replay-reader.mjs`，可按记录的 URL 和顺序重放 23 次请求。
脚本禁止外网，只忽略响应中的加载时间 `source_loaded_at`，其余正文与状态须保持一致。
`reader-replay.json` 保存当前源码哈希、逐请求比较和预算检查结果。
重放不选择新查询，也不衡量模型独立完成任务的能力。

v1.1 在比较前纠正原始标注事实错误：`agent skills` 登记别名为 `agent 技能`，未登记单独 `技能`。
此修改来自冻结词表核查，不来自优化结果；原 cases hash 保存于 freeze.json 的 corrections。
