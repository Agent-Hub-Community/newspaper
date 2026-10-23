# 参与贡献

欢迎通过 issue 和 pull request 参与 AgentHub 日报。本仓库负责网站、读者数据和发布；群聊采集和模型写稿在 [bot-workflow](https://github.com/Agent-Hub-Community/bot-workflow)（即将开放）。

适合直接提 pull request 的改动：界面、无障碍、搜索和查询接口、构建脚本、测试、文档。
读者内容（日报、周报、资料库等）由维护者按审核流程更新，不接受直接修改内容的 pull request。内容有错误时，请提 issue。

## 提 issue

警告：issue 是公开的。请不要在 issue 里贴出原始聊天记录、群友的姓名或昵称、微信号、联系方式，或任何能认出某个人的信息。

| 类型 | 请写明 |
|---|---|
| 页面错误 | 页面地址、设备和浏览器（是否在微信内打开）、操作步骤、实际结果和期望结果。界面问题请附截图 |
| 内容错误 | 页面地址、第几条或哪一段、错在哪里。有公开来源时附上链接 |
| 删除个人内容 | 页面地址和需要删除的位置（第几条、哪段原话或哪个头像）。不用说明你是谁，也不要附上更多个人信息 |
| 功能建议 | 想解决什么问题、谁会用到。涉及新的数据或统计时，说明需要哪些字段 |

页面地址请复制浏览器地址栏里的完整地址，例如 `https://agent-hub-community.github.io/newspaper/daily/2026-10-22/group-1/`。原始讨论面板的地址带 `#discussion-N`，也请一起复制。

删除个人内容的承诺见 [CONTENT-NOTICE.md](CONTENT-NOTICE.md)。

## 开发

准备：Node.js 22 和 npm。浏览器测试另外需要本机安装 Chrome。

1. Fork 仓库，从 `main` 新建分支。
2. 安装依赖：`npm ci`。
3. 改动后运行单元测试：`npm test`。
4. 构建并在本机预览，方法见 [README](README.md#快速开始)。
5. 改动界面时，运行浏览器测试：`npm run test:browser`。失败时先看 [测试](docs/testing.md) 里已知失效的旧断言。

开始前请读这几篇文档：[架构](docs/architecture.md)、[界面规则](docs/ui.md)、[数据格式](docs/data-format.md)。

### 构建一致性检查

只改脚本、测试或文档的提交也会触发部署，但不应改变网页。这类改动请分别在 `main` 和你的分支上运行公开构建，确认两份 `dist/` 相同：

```sh
git worktree add /tmp/agenthub-main main
(cd /tmp/agenthub-main && npm ci && npm run build -- --public)
npm run build -- --public
diff -r /tmp/agenthub-main/dist dist && echo "dist unchanged"
git worktree remove --force /tmp/agenthub-main
```

`diff` 有输出时，在 pull request 里说明每处差异的原因。

### 改动时的约定

- 站点地址集中在 `lib/site.mjs`。浏览器端文件保留了字面副本，`test/site.test.mjs` 检查两者一致。改地址的规则见 [架构](docs/architecture.md#站点地址)。
- 群列表只在 `lib/groups.mjs` 里定义。脚本和页面不要另写一份群 id 或群名。
- 新增 Lucide 图标时，把名字写成字面量，构建会自动收录。
- 读者数据的字段有校验代码。新增字段时，同时改校验、[数据格式](docs/data-format.md) 和测试。
- 不提交 `dist/`、`dist-preview/`、`output/` 和 `scratch/`，它们已被 Git 忽略。

## Pull request

- 一个 pull request 只做一件事。标题和提交信息用英文，写清改了什么。
- 描述里写：为什么要改、怎样验证、有没有改变网页或数据。
- 改动界面时，附上桌面（1440px）和手机（390px）宽度的截图；涉及布局时再附 320px 和 768px。
- CI 在每个 pull request 上运行 `npm test`、公开构建和 `node test/build.mjs --public`，不运行浏览器测试。请在本机运行浏览器测试，并在描述里列出结果。
- 新增依赖、改变数据格式或改变数据边界前，请先开 issue 讨论。

## 需要维护者授权的改动

下列改动会公开内容、改变隐私边界或影响线上服务。请先开 issue，得到维护者同意后再提交：

| 改动 | 原因 |
|---|---|
| `data/` 下的读者内容：刊期、周报、外部资讯、资料库、机会、黑话、榜单快照和头像 | 只发布经过审核和发布授权的内容 |
| 搜索引擎收录：`lib/seo.mjs` 的 `INDEXED`、`robots.txt`、`sitemap.xml` | 收录会让社群内容进入搜索引擎 |
| “给 Agent 用”页面的开关：`lib/agent-docs.mjs` 的 `AGENTS_PAGE` | 决定是否公开这个入口 |
| 新的统计、上报或读者数据字段 | 改变数据边界，需要同时更新隐私说明 |
| 反馈 Worker 的数据表、`ALLOWED_ORIGIN`、部署配置 | 影响线上服务和已存数据 |
| 站点地址、GitHub Actions workflow | 影响部署 |
| [CONTENT-NOTICE.md](CONTENT-NOTICE.md) 的承诺 | 读者内容的使用条件 |

## 许可

提交到本仓库的代码使用 [MIT 许可](LICENSE)。读者内容不随 MIT 许可授权，见 [CONTENT-NOTICE.md](CONTENT-NOTICE.md)。
