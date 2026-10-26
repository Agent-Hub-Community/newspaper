# 测试说明

本仓库有三类测试：单元测试、构建产物检查和 Playwright 浏览器测试。GitHub Actions 在每次 push 和 PR 时会自动跑前两类；如果你改了样式或前端交互，请在本机跑一遍浏览器测试。

| 类别 | 命令 | CI 跑不跑 | 环境要求 |
|---|---|---|---|
| 单元测试 | `npm test` | 自动跑 | Node.js 22+ |
| 构建产物检查 | `node test/build.mjs [--public \| --preview]` | 自动跑（`--public`） | 先跑完构建 |
| 浏览器测试 | `npm run test:browser` 或单跑 `node test/xxx.mjs` | 不跑（需本地跑） | 本机装有 Chrome |

## 1. 单元测试

```sh
npm test
```

执行 `test/*.test.mjs`（基于 Node 内置的 `node --test`），不联网、不起浏览器、也不读 `scratch/`。覆盖 schema 校验、静态页渲染、BM25 搜索与同义词扩展、Worker 各路由逻辑以及站点地址一致性检查。

## 2. 构建产物检查

```sh
npm run build && node test/build.mjs
npm run build -- --public && node test/build.mjs --public
```

[`test/build.mjs`](../test/build.mjs) 会扫描生成的 `dist/`（或 `--preview` 下的 `dist-preview/`），确认：

- `data.js` 索引和 `issues/<date>.js` 对得上，静态资源哈希完整；
- 周报、深链目录、`404.html`、`llms.txt` 等 Agent 导出文件齐全；
- 给 Agent 读的 Markdown 里没有混进原始讨论原话，接口调用示例全是合法的 ASCII 编码；
- `INDEXED` 为空时所有页面都带 `noindex`，`AGENTS_PAGE` 关闭时没有任何页面指向“给 Agent 用”。

## 3. 浏览器测试

浏览器测试直接调本机安装的 Chrome（非 macOS 环境可通过 `CHROME_PATH=/usr/bin/google-chrome` 指定路径）：

```sh
npm run test:browser
```

也可以按改动的模块单跑某个脚本：

| 命令 | 测什么 |
|---|---|
| `npm run test:date-navigation` | 往期目录切换与响应式交互 |
| `node test/responsive.mjs` | 多视口下的对齐、水平溢出、触控热区与滚动 |
| `node test/mobile-navigation.mjs` | 手机深链、前进后退、字号放大与日期弹层（报头太长把首屏正文挤出视野时会报错） |
| `node test/not-found-browser.mjs` | 缺失路径返回 `404.html` |
| `node test/four-groups-browser.mjs` | 多群页签布局、缺稿置灰与自动回退 |
| `node test/library-browser.mjs`、`node test/opportunities-browser.mjs` | 资料库筛选、搜索、点心与页底机会区 |
| `node test/weekly-browser.mjs` | 周报静态页、窄屏导航与分享图导出 |
| `VERIFY_SITE=... DISCUSSION_DATE=... node test/discussion-browser.mjs` | 原始讨论浮窗的打开、关闭、引用定位与深链 |
| `node test/share-image-browser.mjs` | 保存本版 PNG 长图（加 `BROWSER=webkit` 可测 Safari 引擎） |
| `node test/agent-api-browser.mjs` | 验证资料库前端搜索与 Worker `/library/search` 对同一查询结果一致 |
| `node test/skins-browser.mjs`、`node test/color-scheme-browser.mjs` | 节日皮肤与明暗主题切换 |

## 4. 线上巡检命令

部署完成后，按需跑下面几条命令核对线上站点（注意后两条会往线上 D1 写测试记录，平时不要乱跑）：

| 命令 | 说明 |
|---|---|
| `AGENT_HUB_SITE_URL=<站点地址> node test/ranking-page.mjs` | 检查线上活跃榜页面 |
| `node test/resources-browser.mjs --production` | 检查线上资料链接卡片 |
| `node test/feedback-live.mjs --live --production` | 向线上投出一张测试赞踩票并立即撤回 |
| `node test/search-tracking-browser.mjs --live` | 向线上写入两条带测试标记的搜索与点击记录 |

## 已知过时的旧断言

下面几个早期写的浏览器测试脚本里，还留着改版前的旧假设（比如三列布局、旧 hash 路由、只有三个群时的页签数）：

- `browser.mjs`、`responsive.mjs`、`resources-browser.mjs`、`external-page.mjs`、`ranking-page.mjs`、`color-scheme-browser.mjs`、`skins-browser.mjs`

如果你跑它们遇到报错，先切回 `main` 跑一次同一个脚本对比——改动前就已经挂掉的断言不是你的问题，不用为了迁就旧断言把界面改回去。也欢迎顺手提 PR 更新这些旧测试。
