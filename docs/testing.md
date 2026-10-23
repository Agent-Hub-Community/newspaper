# 测试

仓库有三类测试：单元测试、构建产物检查和浏览器测试。pull request 的 CI 只运行前两类；改动界面时，请在本机运行浏览器测试。

| 类别 | 命令 | CI | 需要 |
|---|---|---|---|
| 单元测试 | `npm test` | 运行 | Node.js 22 |
| 构建产物检查 | `node test/build.mjs [--public \| --preview]` | 运行（`--public`） | 先构建 |
| 浏览器测试 | `npm run test:browser` 和 `test/` 下的单个脚本 | 不运行 | 本机 Chrome |

## 单元测试

```sh
npm test
```

`npm test` 运行 `test/*.test.mjs`（Node 自带的 `node --test`）。单元测试不访问网络，不需要浏览器，也不读取 `scratch/`。
它覆盖数据校验、渲染、搜索排序、Worker 的各个接口、站点地址一致性等。新增数据规则或接口行为时，在对应的 `*.test.mjs` 里加测试。

## 构建产物检查

```sh
npm run build && node test/build.mjs
npm run build -- --public && node test/build.mjs --public
```

[`test/build.mjs`](../test/build.mjs) 读取构建结果并检查：

- `data.js` 索引与 `issues/<date>.js` 一致，资源哈希正确；
- 周报、深链目录、404 页和给 agent 用的文件齐全；
- 日报 Markdown 里没有原始讨论原话，接口示例都是 ASCII；
- `INDEXED` 为空时每页都是 `noindex`，`AGENTS_PAGE` 关闭时没有页面链接“给 Agent 用”；
- 加 `--public` 时，确认是公开构建；加 `--preview` 时，检查 `dist-preview/`。

## 浏览器测试

浏览器测试使用本机的 Chrome 和 devDependencies 里固定版本的 Playwright，不下载浏览器。

```sh
npm ci
npm run test:browser
```

- 测试默认使用 macOS 的 Chrome 路径。其他系统用 `CHROME_PATH` 指定，例如 `CHROME_PATH=/usr/bin/google-chrome npm run test:browser`。
- `npm run test:browser` 先做普通构建，运行日期导航、页面、响应式、手机导航、资料、赞踩、讨论打开数、资料库、404、皮肤和明暗测试；再做公开构建，运行 `ranking-page` 和 `share-image-browser`。结束时 `dist/` 是公开构建。
- 截图写入被 Git 忽略的 `output/playwright/`。
- 浏览器测试覆盖手机和平板横竖屏、各断点和桌面宽屏，共 32 组尺寸。模拟器和无头浏览器的结果不等于微信内置浏览器的真机验收。

单个测试：

| 命令 | 检查 |
|---|---|
| `npm run test:date-navigation` | 日期导航和响应式交互 |
| `node test/responsive.mjs` | 对齐、溢出、触控目标和滑动方向 |
| `node test/mobile-navigation.mjs` | 深链、浏览历史、字号放大、日期底部弹层和焦点；报头过长时失败 |
| `node test/not-found-browser.mjs` | 按 GitHub Pages 的规则用 `404.html` 响应缺失路径 |
| `node test/four-groups-browser.mjs` | 多个群版面时的页签布局、缺稿版面和切换 |
| `node test/library-browser.mjs`、`node test/opportunities-browser.mjs` | 资料库的筛选、搜索、点心和机会区 |
| `node test/weekly-browser.mjs` | 周报静态页 |
| `node test/discussion-browser.mjs` | 原始讨论面板。先设置 `VERIFY_SITE` 和 `DISCUSSION_DATE`；`DISCUSSION_GROUPS=group-5` 可单独检查某个群 |
| `node test/external-page.mjs` | 外部资讯版。固定检查 2026-09-25 |
| `node test/share-image-browser.mjs` | 保存长图。`BROWSER=webkit` 时用 Safari 引擎 |
| `node test/cross-engine.mjs` | 在 WebKit 中检查六种尺寸，需要先安装 Playwright WebKit |
| `node test/agent-api-browser.mjs` | 资料库页和 `/library/search` 对同一查询的命中数和排序一致。先做公开构建 |
| `node test/search-tracking-browser.mjs` | 搜索记录的上报，请求全部拦截 |
| `node test/views-browser.mjs` | 浏览量的上报，请求全部拦截。先用设置了 `FEEDBACK_API_URL` 的公开构建；`BROWSER=webkit` 时用 WebKit |
| `node test/analytics-browser.mjs` | 统计加载器。需要 `CF_BEACON_FILE`，见文件头注释 |
| `node test/skins-browser.mjs`、`node test/color-scheme-browser.mjs` | 皮肤和明暗 |

需要维护者私有数据的测试：`daily-preview`、`five-day-preview` 和 `month-preview` 读取 `scratch/` 里的批次。

## 检查线上站点

下列测试访问或写入线上服务。只在需要验证部署结果时运行。

| 命令 | 说明 |
|---|---|
| `AGENT_HUB_SITE_URL=<站点地址> node test/browser.mjs` | 检查已部署的页面。`ranking-page` 也接受这个变量 |
| `node test/resources-browser.mjs --production` | 检查线上的资料链接 |
| `node test/feedback-live.mjs --live --production` | 向线上提交并撤回一张测试票 |
| `node test/search-tracking-browser.mjs --live` | 向线上写入两条测试搜索和一次点击 |

## 已知失效的旧断言

截至 2026-10-15，下列浏览器测试里还有早于当前界面的断言，例如三列布局、hash 路由、三个群时的页签数、虚拟时钟下的皮肤切换：

- `browser`
- `responsive`
- `resources-browser`
- `external-page`
- `ranking-page`
- `color-scheme-browser`
- `skins-browser`

这些测试失败时，先在你改动之前的提交上运行同一个测试作对照：改动前就失败的断言与你的改动无关。不要据此回退界面。修好其中的旧断言也欢迎提 pull request。

`date-navigation`、`mobile-navigation`、`feedback-browser`、`four-groups-browser` 和 `share-image-browser` 已与当前界面对齐。
