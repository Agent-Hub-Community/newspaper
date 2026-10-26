# 群聊黑话审核规范

群聊黑话词典（`/glossary/`）用来收群里天天挂在嘴边、但新进群的读者或 Agent 可能看不明白的缩写、模型外号、梗和圈内行话。它同时也是站内搜索和资料库搜索的同义词扩展表（规则见[搜索与词表](../search.md)）。

每周随周报更新时，先由 [bot-workflow](https://github.com/Agent-Hub-Community/bot-workflow) 把群聊切成脱敏文本块 `scratch/glossary/chunk-NN.txt`，审核 agent 通读后提取新词，编辑合并进 `data/glossary.json`。

## 收什么、不收什么

判断标准很简单：一位刚进群的研究者看日报或翻聊天记录时，会不会因为不认识这个词而卡壳？会就收：

- `缩写`：如 `oai`、`cc`、`ds`、`ddl`；
- `代号`：群里给模型、公司或产品起的外号、谐音和简称（包括调侃各家大厂和模型的谐音叫法，如把 Google Gemini 叫“哈基米”、把 Anthropic 叫“A社”等，照常收录，用来帮读者和搜索认出指代的是哪家）；
- `梗`：群里反复拿来指代某类测试或现象的固定说法；
- `行话`：Agent 与强化学习圈子里的常用简写或黑话，如 `harness`、`RSI`、`OPD`；
- `网络用语`：只在群里有特定技术语境含义时才收。

不收这三类：

1. 任何指向具体群友个人的外号、昵称、玩笑、单位或身份线索——词典里的词只能指代公开的模型、公司、产品或技术概念，绝不能让人联想到某位群成员；
2. 针对个人或群体的侮辱、歧视性词汇；
3. 只某天随口冒出来一两次、离了那句聊天就没人用的临时缩写，或者 `AI`、`LLM`、`GPU` 这种人人都懂的基础词。

## 输出格式

每个分块的审核结果写到 `scratch/glossary/found-NN.json`：

```json
[
  {
    "term": "oai",
    "variants": ["OAI", "oa"],
    "meaning": "OpenAI 的缩写。",
    "category": "缩写",
    "refersTo": "OpenAI",
    "count": 12,
    "evidence": ["2026-09-29 三群 01:24"],
    "confidence": "high",
    "note": ""
  }
]
```

- `term` 填群里最常用的写法，其他大小写或变体放进 `variants`（不含 `term` 本身）。
- `meaning` 用一句平实的中文解释清楚（≤40 个汉字），只写客观指代，不抄群里的情绪评价。
- `refersTo` 写出对应的正式名称（如官方模型名、公司名）。
- 如果看上下文拿不准意思，把 `confidence` 标成 `"low"` 并在 `note` 说明，合并时再核对或剔除。

## 编辑合并入库

1. 把各分块找到的同一词条合起来，`variants` 取并集，删掉证据不足的 `low` 词条。
2. 逐条检查，确认没有任何指向具体群友个人的词。
3. 如果某个词条正好对应资料库已有的规范关键词，在词条里填上 `keyword` 字段，搜索时它的写法就会自动作为该关键词的别名。
4. 注意词条的写法不能和 `data/search-synonyms.json` 里的普通同义词重复；如果旧同义词表里已经有这个词，先从 `search-synonyms.json` 删掉再合进 `data/glossary.json`。
5. 跑 `npm test` 和 `npm run build` 验证通过。
