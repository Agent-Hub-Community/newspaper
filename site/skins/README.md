# 节日皮肤（`site/skins/`）

节日皮肤用来在特定节日期间替换刊头插画、眉题和全站配色，不改动正文内容、字号、行距和分栏结构。全站（含皮肤）默认跟随系统的浅色／深色模式，也可以点右上角的按钮手动切换；[`site/appearance.js`](../appearance.js) 会在根元素上设置 `data-color-scheme`，皮肤样式直接按这个属性匹配即可。

## 插件目录结构

每个皮肤在本目录下占一个子目录，构建脚本会自动扫描打包：

```text
site/skins/<id>/
  manifest.json
  light.css
  dark.css
  <image>.png
```

- `manifest.json` 必填字段：`id`、`name`、`eyebrow`、`label`、`message`、`image`，可选填 `ornament`（配图旁的小装饰图）。图片只允许放同目录下的本地 PNG/JPG/WebP，不加载外部远程脚本或远程图片。
- 每个皮肤都要同时提供 `light.css` 和 `dark.css`，缺一个构建就会报错。`dark.css` 在构建时会自动包进 `:root[data-color-scheme="dark"]` 里，文件内部不用再套一层。
- 样式选择器统一限定在 `body[data-skin="<id>"]` 下，通过覆盖 `--paper`、`--ink`、`--muted`、`--rule`、`--accent` 和 `--skin-*` 变量来换色。

## 排期与手动预览

活动排期配在 [`config.json`](config.json) 的 `campaigns` 数组里：

- `startsAt`（含）和 `endsAt`（不含）写带时区的 ISO 时间，前端按读者当前的设备时间判断是否生效，到期自动恢复常规样式。同一时间段只允许排一个活动。
- 本地调试或回看旧皮肤时，直接在网址后面加 `?skin=mid-autumn`、`?skin=national-day` 强制打开对应皮肤，或加 `?skin=default` 强制切回常规版。

目前已收录两套像素插画皮肤：

- `mid-autumn`（中秋红金像素月饼与月亮）：跑 `node test/skins-browser.mjs` 可检查亮暗模式截图。
- `national-day`（国庆朱红刊头与像素礼花）：跑 `node --test test/national-day.test.mjs` 和 `node test/national-day-browser.mjs` 可验证契约、窄屏排版与长图导出。
