# Agent API tiny bench v1.1

这个基准用 16 个固定案例，检查 agent 按接口文档调用查询接口（`/library/search`、`/content/*`）时能否完成任务。案例由真实的访问任务派生，结果是确定性的。
对照结果见 [comparison.md](comparison.md)，第一轮验证的说明见 [VALIDATION.md](VALIDATION.md)。

本基准里的提交 SHA（包括固定的源码 SHA `4f6160e`）都指开源前的内部仓库历史，在公开仓库里查不到。冻结的语料和源码已保存在本目录。

## 冻结的文件

| 文件 | 内容 |
|---|---|
| `corpus.json` | 当时的 168 条资料、已发布的日报和周报 Markdown、浏览器搜索索引 |
| `baseline-src/` | 旧的 HTTP handler，所以基准不受之后生产代码修改的影响 |
| `cases.json` | 16 个案例和标准答案 |
| `freeze.json` | corpus、cases 和基准源码的 SHA-256。冻结文件变化时，运行器拒绝运行 |

正文源文件或候选条目集合变化时，运行器拒绝比较。新增语料应建立新版本的评测，不覆盖本版的冻结文件。

## 指标

主指标 `fixed_api_flow_pass_rate` 是固定接口流程的成功数除以 16。检索任务要在前 5 个结果里命中强相关的标准答案，并返回原始链接，才算成功。

对已有答案的 8 个查询，另报 Hit@5、MRR@5 和 nDCG@5：

- 标准答案是读过的条目，不是全库穷尽的相关性标注，所以不能称为全库 recall。
- 强相关 gain=2，相邻 gain=1，其他 gain=0。相邻项不满足任务成功。
- Hit@5：前 5 项至少有一项强相关。
- MRR@5：首个强相关结果名次的倒数，未命中计 0，再按查询取均值。
- nDCG@5：`DCG = sum((2^gain - 1) / log2(rank + 1))`，除以已标注相关条目按理想顺序排列时的 DCG。
- 名次从 1 开始。

资料库质量只比较原来就能查询的 6 个案例，另外 2 个内容查询单独报告。已有资料库排序的 6 个案例与新增的内容发现、关联和读取的 6 个能力案例分别统计，避免把新增覆盖说成排序改进。

其他规则：

- 过滤和分页按固定的 ID 全集核验。
- 缺失的接口记为 unsupported，另计 `unsupported_attempts`，不当作已调用的 HTTP 请求。
- 无答案任务只断言固定语料里的具体无匹配字符串，报告误报数，不推断完整的群聊历史。
- 完整任务路径使用明确的接口调用。纯讨论检索从内容接口开始，资料查询从资料接口开始。不通过整库扫描给缺失的接口制造成功。

成本与质量分开报告：

- 每项报告响应字节、本地耗时和调用次数，成本不混入质量分。
- 字节数是响应正文的 UTF-8 大小，不含 HTTP 头和压缩。调用次数是本地 Request/Response handler 的调用次数。
- 计时混合了首次加载和缓存请求，只供诊断。

## 结果的解释边界

- 协议不运行模型。它测的是按接口文档执行固定流程的可用性，不能说成真实用户或开放式 agent 的成功率。
- 单轮精确命中不是读者任务的最终要求。面向 agent 的任务允许在预算内改写查询、多轮搜索和补读来源。首次零结果后取得足够证据，也可以完成任务；同时记录总请求数、响应字节和引用完整性。
- 单轮 Hit、MRR、nDCG 用于定位检索问题，不代替多轮任务的完成度。独立读者场景已经包含改写后恢复的路径。
- 旧接口通过下载索引或整库 JSON，也可能完成缺刊查日期、精确 ID 查询等用户任务。unsupported 只说明这个固定接口能力不存在。

## 运行

在仓库根目录运行：

1. 运行 `npm run build -- --public`，生成候选目录。
2. 依次运行下面三个命令：

   ```sh
   node bench/agent-api/run.mjs baseline                    # 旧 HTTP handler
   node bench/agent-api/run.mjs candidate                   # 当前 handler 和当前构建的 catalog，cases 和标准答案不变
   node bench/agent-api/run.mjs candidate-baseline-ranker   # 只换回旧 BM25，保留新接口和词表（消融）
   ```

3. 运行 `node bench/agent-api/compare.mjs`，更新对比报告。

请求使用内存里的 fixture，不发线上请求，没有外部延迟，也不写统计。

## 独立读者场景

独立读者场景保存在 `heldout-reader-audit.json`，说明见 [heldout-reader-audit.md](heldout-reader-audit.md)。

公开构建后，运行 `node bench/agent-api/replay-reader.mjs`，按记录的 URL 和顺序重放 23 次请求。

- 脚本禁止外网，只忽略响应里的加载时间 `source_loaded_at`，其余正文和状态应一致，不一致时脚本报错。
- `reader-replay.json` 保存当前源码哈希、逐请求比较和预算检查结果。
- 重放不选择新的查询，也不衡量模型独立完成任务的能力。

## v1.1 的更正

v1.1 在比较前纠正了原始标注的一处事实错误：`agent skills` 登记的别名是 `agent 技能`，没有单独登记 `技能`。
这处修改来自冻结词表的核查，不来自优化结果。原 cases 的哈希保存在 `freeze.json` 的 `corrections` 里。
