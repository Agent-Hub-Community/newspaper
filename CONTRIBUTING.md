# 参与贡献

欢迎提 issue 或 pull request。本仓库放的是网站前端、公开读者数据和发布脚本；微信群聊采集与模型写稿在旁边的 [bot-workflow](https://github.com/Agent-Hub-Community/bot-workflow)。

- 界面样式、无障碍、站内搜索、查询 API、构建脚本、测试和文档，欢迎直接提 pull request。
- 日报、周报、资料库等读者内容（`data/`）由维护者按审稿流程更新，不直接合并改内容的 pull request。发现错别字、事实错误或想撤下个人内容，请提 issue。

## 提 issue

警告：GitHub issue 是公开的。提单时不要贴原始聊天截图、群友真名或昵称、微信号、手机号等个人信息。

| 什么事 | 提单时写清楚 |
|---|---|
| 页面显示或交互坏了 | 页面完整地址、设备与浏览器（比如是不是在微信里点开的）、怎么复现、截图 |
| 内容或链接写错了 | 页面地址、哪一版第几条、哪里不对（有公开出处的话顺手附上链接） |
| 想撤下自己的发言或头像 | 页面地址和具体位置（第几条、哪句原话或哪个头像）。不用证明你是谁，也别贴更多个人资料 |
| 功能建议 | 想解决什么阅读或检索问题；如果涉及新数据字段，写明需要什么 |

删改个人内容的处理规则见 [`CONTENT-NOTICE.md`](CONTENT-NOTICE.md)。

## 本地开发步骤

环境要求：Node.js 22 以上和 npm。跑浏览器测试还需要本机装有 Chrome。

1. Fork 本仓库，从 `main` 切出新分支。
2. 安装依赖：`npm ci`。
3. 改完代码先跑单元测试：`npm test`。
4. 按 [`README.md` 的说明](README.md#在本地跑起来)构建并在浏览器里看一眼。
5. 如果改了样式或前端交互，跑浏览器测试：`npm run test:browser`（部分老测试脚本有已知过时断言，见 [`docs/testing.md`](docs/testing.md#已知过时的旧断言)）。

动手前建议先翻翻这三篇文档：[架构说明](docs/architecture.md)、[界面规则](docs/ui.md)、[数据格式](docs/data-format.md)。

### 确认没误改线上构建产物

如果你只改了维护脚本、测试或 Markdown 文档，按理说生成的静态网站 `dist/` 应该一字不变。提交前可以用 worktree 对比一下改动前后的公开构建结果：

```sh
git worktree add /tmp/agenthub-main main
(cd /tmp/agenthub-main && npm ci && npm run build -- --public)
npm run build -- --public
diff -qr /tmp/agenthub-main/dist dist && echo "dist unchanged"
git worktree remove --force /tmp/agenthub-main
```

如果 `diff` 有输出，请在 pull request 里说明为什么会变。

### 几条代码约定

- 站点域名和路径前缀统一定义在 `lib/site.mjs`；浏览器端几个静态文件留了字面量副本，由 `test/site.test.mjs` 自动检查两边是否一致。
- 群列表只认 `lib/groups.mjs`，不要在脚本或页面里硬编码群 ID 和群名。
- 用新的 Lucide 图标时，在代码里直接写图标名字面量（比如 `data-lucide="book-open"`），构建脚本会自动把它打进 `icons.js`。
- 给读者数据加字段时，同步更新校验函数、[`docs/data-format.md`](docs/data-format.md) 和单元测试。
- 不要提交 `dist/`、`dist-preview/`、`output/` 和 `scratch/`。

## 提 pull request 的要求

- 一个 PR 只做一件事，写清楚改了什么、为什么改、怎么验证的。
- 改了界面时，附上桌面（1440px）和手机（390px）截图；动到排版布局时再补一张 320px 和 768px。
- GitHub Actions 会自动跑 `npm test`、公开构建和 `node test/build.mjs --public`，但不会跑浏览器测试；改了前端请在本地跑完浏览器测试并把结果贴在 PR 描述里。
- 想引新 npm 依赖、改数据 schema 或改隐私边界，请先开 issue 聊一下再动手。

## 哪些改动要先找维护者商量

下面这些地方涉及读者内容、隐私或线上服务配置，动之前请先提 issue：

| 位置 | 原因 |
|---|---|
| `data/` 下的刊期、周报、资料库、机会、黑话、榜单与头像 | 属于读者内容，走审稿和当期发布流程 |
| `lib/seo.mjs` 的 `INDEXED`、`robots.txt`、`sitemap.xml` | 控制是否放开搜索引擎抓取 |
| `lib/agent-docs.mjs` 的 `AGENTS_PAGE` | 控制导航栏里显不显示“给 Agent 用”页面 |
| `feedback/` 下的 D1 表结构、`ALLOWED_ORIGIN`、`wrangler.jsonc` | 影响线上赞踩与查询服务 |
| `lib/site.mjs`、`.github/workflows/deploy.yml` | 影响全站部署地址与流水线 |
| `CONTENT-NOTICE.md` | 读者内容声明与撤稿承诺 |

## 许可证

提交到本仓库的代码按 [MIT 许可证](LICENSE)开源；读者内容见 [`CONTENT-NOTICE.md`](CONTENT-NOTICE.md)。
