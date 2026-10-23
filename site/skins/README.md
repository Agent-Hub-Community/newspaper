# 全站皮肤

皮肤覆盖刊头、正文配色、版面导航、栏目标签、链接、榜单、弹窗和页脚。
正文内容、字号、行距和分栏结构保持原样，图片装饰只出现在刊头，不放在正文背后。
全站及皮肤默认实时跟随系统明暗模式，也可通过顶部图标切换浅色、深色或跟随系统。
选择保存在本地；`site/appearance.js` 统一解析为根元素的 `data-color-scheme`，皮肤不必管理偏好。

后续新增皮肤统一采用像素插画，正文保持现有字体。手机和桌面刊头背景铺满视口，
页面不设外框或外围装饰，阅读边距由内容区内部保留。
每套皮肤仍需独立提供亮暗配色，并验证窄屏、正常阅读和导出。

## 插件约定

每个皮肤在本目录（`site/skins/`）下占一个目录，构建时自动发现：

```text
site/skins/<id>/
  manifest.json
  light.css
  dark.css
  <image>.png
```

`manifest.json` 字段为 `id`、`name`、`eyebrow`、`label`、`message`、`image`，
可选 `ornament` 用于配图旁的植物等装饰。
文案使用纯文本，`image` 只允许同目录的 PNG/JPG/WebP 文件。
目录名与 `id` 一致，使用小写字母、数字和连字符；`default`、`auto` 为保留名称。

亮暗两套样式都是必需文件，缺失或为空时构建失败。`light.css` 是基础样式，
`dark.css` 在构建时包进 `:root[data-color-scheme="dark"]`，不要自行再包一层。
全站规则限定在 `body[data-skin="<id>"]`。使用 `body[data-skin="<id>"][data-view]`
覆盖日报默认变量 `--paper`、`--ink`、`--muted`、`--rule`、`--accent`。
刊头继承以下变量：

- `--skin-paper`、`--skin-ink`：背景、主文字。
- `--skin-muted`、`--skin-accent`、`--skin-rule`：次文字、题签、细线。

这是仓库内可信插件，不支持远程脚本、任意 HTML 或在线安装。
需要不同布局时可在插件 CSS 内增加限定在自身 `data-skin` 下的规则。
图片打包到本地并带内容哈希，离线及长图导出沿用现有能力。
`file://` 长图导出按需加载构建生成的 `export-images.js`，避免本地图片的画布读取限制；
HTTP 导出复用页面已加载图片，不额外请求该包。

## 活动排期

编辑 `config.json` 的 `campaigns`。`startsAt` 包含起点，`endsAt` 不含终点，
必须写有时区的 ISO 时间。以读者当前时间判断，不取正在阅读的日报日期；
同一时刻只能有一项活动，重叠排期会报错。空数组禁用全部活动。
页面打开期间也会自动开始/结束活动，返回后台页面时重新检查。

国庆 2026 活动排期为北京时间 10 月 1 日 00:00 至 10 月 8 日 00:00，已结束，之后恢复常规主题。
中秋 2026 活动已结束，原排期为北京时间
9 月 25 日 00:00 至 9 月 28 日 00:00。
不自动推算以后年份的农历节日，下一次活动需明确排期。

预览链接 `?skin=mid-autumn` 强制显示中秋，`?skin=default` 恢复全站常规样式；
移除查询参数恢复排期，未知名称也按正常排期处理。
国庆皮肤也可使用 `?skin=national-day` 显式查看，不受排期限制。

## 验收

新增皮肤应覆盖桌面与手机的亮暗截图，验证对比度、文字换行、日期按钮、
切群/翻期及长图导出。当前用 `node test/skins-browser.mjs` 验证中秋版本；
改用新的皮肤时补上对应测试。`npm test` 检查排期边界和亮暗文件契约。

## 中秋皮肤

仅保留最终选中的 `mid-autumn` 红金像素皮肤，提供全站亮暗配色与原创月亮、月饼 PNG。
`node test/skins-browser.mjs` 在 `output/playwright/skins/` 生成明暗截图；
使用 `dist/index.html?skin=mid-autumn` 预览实际日报。
图片生成源保留在皮肤目录。像素风只用于插画、边线与节令标签，不用于正文。

## 国庆皮肤

`national-day` 采用朱红刊头、金色题签与细线，以及原创像素礼花 `fireworks.png`，不使用地标建筑。
正文沿用常规主题的明暗配色、字体与分栏；插画独占刊头底部题签行的右侧，
手机缩为 48 × 30，不占用日期导航区域。深色模式单独降低刊头底色亮度。
活动排期见上方，预览可使用 `daily/2026-09-30/group-1/?skin=national-day`；
日报是否存在由内容构建决定，皮肤不会添加或修改日报。

`node site/skins/national-day/generate-art.mjs` 只重新生成同目录的 PNG。
插画沿用现有本地资源清单、内容哈希与 `export-images.js`，无需新增导出逻辑。
`node --test test/national-day.test.mjs` 是不写文件的契约测试；
`node test/national-day-browser.mjs` 在内存中使用源码夹具检查明暗、窄屏与导出，
不读取或重建 `dist/`，也不写截图。集成后的真实日报截图由完整预览验收。
