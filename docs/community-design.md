# 与社群主页共用的视觉语言

日报、周报、资料库、搜索、黑话词典和活跃榜共用 Agent Hub 主站的手绘字标。阅读区域使用浅色阅读底与午夜蓝、蓝色交互强调和统一的 Inter / Noto Sans SC 字体；页脚用深色底连接回社群。阅读布局、资料检索、讨论浮窗、榜单、订阅和图片分享沿用各自的功能。

主站的 3D 共建空间通过创作演绎的对话介绍 Benchmark、项目协作与社群交流，出版页面保持专注阅读。页面上的社群主页和 RSS 入口使用同源路径，因此在联合本地预览与正式域名下都能互相访问。

## 维护入口

| 文件 | 职责 |
| --- | --- |
| `lib/brand.mjs` | SVG 字标、主页入口、页脚和 favicon |
| `site/community.css` | 各出版页面共用的排版、颜色与响应式覆盖 |
| `site/brand/wordmark.json` | 与主站相同的自绘字标路径 |
| `site/brand/fonts.css` | 本地字体声明与中文 Unicode 分包 |
| `site/brand/font-source.json` | 字体来源、覆盖范围与产物校验信息 |
| `scripts/subset-publication-font.py` | 重新生成中文字体分包 |
| `site/appearance.js` | 与主站共用的明暗偏好 |

`community.css` 在页面自身的样式和 `color-scheme.css` 后加载；日报的节日皮肤随后加载。默认颜色仅作用于没有节日皮肤或指定 `default` 的页面，保留节日配色。

`agenthub-theme` 是两站共享的偏好键。日报兼容旧的 `agenthub-appearance`，保留跟随系统、浅色和深色三种模式，并响应同源其他标签页的变更。存储不可用时，当前页面仍能切换主题。

## 字体与品牌资源

Inter 与 Noto Sans SC 的许可位于 `site/brand/`，普通构建只复制仓库里的 WOFF2 文件，不依赖字体服务或外网下载。中文字体按字频分成互不重叠的 Unicode 范围；新增内容中尚未包含的字符由系统字体补齐。

要更新中文覆盖，先准备 Python 的 FontTools 与 Brotli，以及许可证允许分发的原始 Noto Sans SC 字体，再运行：

```sh
python3 -I scripts/subset-publication-font.py /path/to/NotoSansSC.ttf
npm run build
```

字标与 favicon 来自主站的原创品牌资源。后续修改字标时同步更新 `site/brand/wordmark.json`；不要另画一套相似字标。各页面通过 `brandWordmark` 共用路径，SVG 自带可访问名称。

## 验证

除单元测试和构建检查外，检查 320px、390px、768px 与 1440px 下的日报、周报、周报总览、资料库、搜索、词典和榜单，覆盖明暗主题、窄屏刊头、滚动筛选条与深色页脚。跨站主题检查应包括多标签页更新、清空偏好、系统主题变化和存储不可用。

浏览器测试的旧断言仍需按 `docs/testing.md` 与未修改的基线对照。部分脚本沿用旧的空版数据、工具栏或日期假设；节日测试把页脚文字与页面底色比较，也不再适用于独立深色页脚。验证对比度时使用元素实际叠加后的背景。

本次没有调整读者内容、数据结构、索引开关、Worker 配置或发布流程。
