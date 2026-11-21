# 特殊日子与知识专题主题系统（Theme Pack v2 · `site/skins/`）

Agent Hub 主题插件体系用来在节日、AI/科学里程碑或社区专题期间，为**日报全站**（日报、周报、资料库、黑话、活跃榜、搜索、给 Agent 用、分享长图）以及**官网首页**提供统一的视觉换肤、刊头 Doodle、事件速览与知识专题联动，同时严守正文排版不变、明暗模式双适配、WCAG AA 对比度与零外链 CSP 护栏。

核心构建与校验逻辑位于 [`lib/themes.mjs`](../../lib/themes.mjs)，正式 Schema 见 [`theme.schema.json`](theme.schema.json)。

## 新建一个 v2 主题包（推荐，0 行 CSS 起步）

每个主题在 `site/skins/<id>/` 下自包含一个目录：

```text
site/skins/<id>/
  theme.json          # 【必填】声明式主题清单（元数据、色板、刊头 Doodle、背景故事、知识条、首页联动）
  doodle.svg          # 【可选】本地 SVG 或 PNG/JPG/WebP 插画（构建期自动做 SVG 安全检查）
  ornament.svg / .png # 【可选】副装饰图
  extra.css           # 【可选】补充样式（必须限定在 body[data-skin="<id>"] 内，禁止外链）
```

### `theme.json` 核心字段

- `version`: 固定为 `2`
- `id`: 与目录名一致，小写字母/数字/连字符
- `kind`: `holiday`（节日）| `milestone`（纪念日/里程碑）| `knowledge`（知识专题）| `community`（社区活动）
- `targets`: 生效范围，支持 `daily`、`weekly`、`library`、`glossary`、`rank`、`search`、`agents`、`home`
- `masthead`:
  - `eyebrow` / `label` / `message`: 眉题、主题签、一句话寄语
  - `art`: 本地插画（支持 SVG 轻量 CSS 动画，自动尊重 `prefers-reduced-motion`）
  - `seal`: 特刊印章（在刊头与长图导出中展示）
  - `story`: 点击刊头“事件速览”弹出的背景故事、关键数据（`facts`）与站内推荐链接
- `palette`:
  - `scope`: `masthead-only`（只换刊头带）| `masthead-and-accent`（刊头 + 强调色/高亮笔）| `full-paper`（全纸面换色）
  - `light` & `dark`: 必填语义色板，构建期自动校验 **WCAG AA ≥ 4.5:1 对比度**并自动编译全站 CSS
- `ambient`: 仅作用于刊头背景的轻量装饰预设（如 `critical-line`、`stardust`、`snow`、`lantern`）
- `knowledge`:
  - `banner`: 刊头下方的可关闭专题导读条（支持打开 `story` 弹窗或跳转站内检索/资料库）
  - `highlight`: 按关键词自动给相关故事卡片打上专题角标（无需手改历史期 JSON）
- `home`: 官网首页联动参数（ASCII 双手配色与自定义字符集 `glyphBands`、星空色、顶部专题提示）

> 旧版 v1 皮肤（`manifest.json` + `light.css` + `dark.css`，如 `mid-autumn`、`national-day`）完全向下兼容。

## 排期、按期绑定与预览

统一配置在 [`config.json`](config.json)：

- `campaigns`: 实时活动时间窗口（`startsAt` 含、`endsAt` 不含，带时区 ISO 时间，不可重叠）
- `editions`: 按期永久绑定表（如 `"2026-11-20": "riemann-proof"`），历史翻看该期日报时自动还原特刊版面
- 手动预览：在任意页面 URL 后加 `?theme=<id>`（兼容 `?skin=<id>`），加 `?theme=default` 强制恢复常规样式

## 已收录主题

- `riemann-proof`（v2 · 黎曼猜想形式化证明特刊：临界线 `Re(s)=1/2` 动态 SVG Doodle、事件速览、知识专题条、关键词角标与首页 ASCII 数学字符联动）
- `national-day`（v1 · 国庆朱红刊头与像素礼花）
- `mid-autumn`（v1 · 中秋红金像素月饼与月亮）
