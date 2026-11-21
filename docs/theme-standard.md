# Agent Hub 主题插件标准（Theme Pack v2）

本文档定义 Agent Hub 特殊日子与知识专题主题的**正式设计规范、数据协议、安全性能红线与制作流程**。无论是人工制作还是交给 AI Agent 一键生成，都以本标准与 [`theme.schema.json`](../site/skins/theme.schema.json) 为唯一准绳，并通过 `npm run theme:check` 自动验收。

---

## 一、三级主题分级（按需选型，避免过度设计）

| 级别 | 定位 | 典型场景 | 所需文件 | 建议耗时 |
|---|---|---|---|---|
| **Tier 1 · 节日皮肤** | 轻量视觉氛围 | 元旦、端午、中秋、国庆、圣诞、跨年 | `theme.json` + `doodle.svg`（或 PNG） | 5 分钟 |
| **Tier 2 · 知识/事件特刊** | 视觉 + 知识联动 + 首页同步 | AI/科学里程碑、顶会季（ICLR/NeurIPS）、重磅模型发布、社区周年 | `theme.json` + `doodle.svg`（0 行 CSS/JS） | 15 分钟 |
| **Tier 3 · 互动特刊** | Tier 2 + 懒加载微彩蛋 | 极少数值得珍藏的大事件（如黎曼猜想特刊、跨年烟花） | `theme.json` + `doodle.svg` + `widget.js` | 30 分钟 |

> 原则：**90% 的主题停留在 Tier 1 / Tier 2（零手写 CSS、零手写 JS）**；只有互动体验本身能直接解释事件或带来明确乐趣时，才升级到 Tier 3。

---

## 二、全站槽位与边界（什么可变，什么绝不能动）

### 允许插件定制的槽位
1. **刊头带（全站统一）**：眉题 `eyebrow`、主题签 `label`、一句话寄语 `message`、插画 `art`（支持点击打开速览）、特刊印章 `seal`、轻量氛围底纹 `ambient.preset`。
2. **色板力度（`palette.scope` 三档）**：
   - `masthead-only`：只换刊头带，正文完全保持常规阅读色（最克制，推荐日常节日）；
   - `masthead-and-accent`：刊头带 + 强调色 / 链接 / 重点荧光笔（推荐知识特刊）；
   - `full-paper`：全纸面换色（仅用于强节日氛围，需格外注意长文阅读舒适度）。
3. **总览页专题导读条（`knowledge.banner`）**：默认 `placement: "overview-only"`，**只出现在日报/周报总览页**，绝不打扰单群正文首屏阅读；支持用户关闭（`sessionStorage` 记住）。
4. **跨群相关讨论自动关联（`knowledge.related`）**：构建期由 [`lib/themes.mjs`](../lib/themes.mjs) 扫描全部日报，**事件档期/绑定日期当期的讨论绝对优先**并标「当期」，不足时自动跨群回溯历史高相关话题。
5. **特刊速览弹窗（`masthead.story` + 可选 `masthead.widget`）**：960px 宽屏「上双栏等高 + 下通栏 2×3 网格」杂志布局。
6. **细节触点**：相关故事卡片角标（`knowledge.highlight`）、页脚与长图导出定制尾注（`masthead.footerNote`）、长图导出底部特刊角章（`masthead.seal`）、往期目录特刊标（`editions`）、搜索页推荐占位词（`knowledge.searchExamples`）、自动生成 1200×630 分享封面（`social-card.svg`）、主题档案馆（`/newspaper/themes/`）。
7. **官网首页联动（`home`）**：通过 `/newspaper/themes.json` 运行时同步，无需重编首页——可联动顶部特刊胶囊、今日日报特刊条、ASCII 双手开场配色与自定义字符集 `glyphBands`、以及讨论星空特刊星点 `starKeywords`。

### 绝对禁止触碰的红线（Invariants）
- **版式不可变**：禁止修改正文字号、行距、分栏结构、导航顺序和按钮最小触控尺寸（≥ 44px）。
- **对比度强制达标**：亮/暗模式**必须成对提供**；刊头前景与正文前景的 WCAG AA 对比度均 **≥ 4.5:1**（建议正文 ≥ 7:1），构建期自动阻断不合格色板。
- **零外链与 CSP 安全**：严禁任何远程图片、字体、脚本或 `fetch`/`WebSocket`/`eval`/`new Function`；SVG 禁止 `<script>`、内联事件（`onload=` 等）与 `<foreignObject>`。
- **性能与零空转**：
  - `widget.js` 单文件 **≤ 24 KB**，仅在用户点开速览弹窗时按需懒加载（首屏 0 字节）；
  - 静止状态下必须 **0 FPS**（事件驱动重绘，禁止无交互的后台无限动画循环），弹窗关闭必须通过返回值 `cleanup()` 清理所有监听器与定时器；
  - 所有 CSS/SVG/Canvas 动效必须尊重 `prefers-reduced-motion: reduce`。

---

## 三、文案与排版预算（保证桌面端一屏无滚动条）

为了让 960px 特刊弹窗、移动端刊头和分享封面在任何分辨率下都不爆版、不溢出：

| 字段 | 硬上限（构建校验） | 推荐视觉最佳值 |
|---|---|---|
| `masthead.eyebrow` | 80 字符 | `18–38` 字符（全大写英文 + 简短符号） |
| `masthead.label` | 40 字符 | `4–8` 个汉字 |
| `masthead.message` | 100 字符 | `16–32` 个汉字（一句完整的话） |
| `masthead.seal.text` | 24 字符 | `4–12` 字符短印记（如公式/年份/节气） |
| `story.title` | 100 字符 | `14–24` 个汉字（一行不折行） |
| `story.body` | 1–4 段 | **2 段，每段 80–130 字**（左右与 Widget 等高） |
| `story.facts` | 0–6 项 | **2 项或 4 项（偶数）**，保证 `2×2` 网格对称 |
| `knowledge.related.limit` | 1–12 | **6 条**（`2×3` 网格铺满，零留白） |
| `doodle.svg` viewBox | 本地安全 SVG | `180 × 96`（横幅比例 ≈ `1.88:1`），透明背景 |

---

## 四、触发优先级与排期规范（`site/skins/config.json`）

浏览器按以下优先级决定当前生效的主题：

1. **URL 显式预览**（最高）：`?theme=<id>`（兼容 `?skin=<id>`）；`?theme=default` 强制恢复常规版；
2. **实时活动档期（`campaigns`）**：带时区 ISO 时间，`startsAt`（含）到 `endsAt`（不含），不同活动不可重叠；
3. **按期永久绑定（`editions`）**：`"YYYY-MM-DD": "<id>"`，仅在读者翻看该历史日期日报时自动呈现特刊记忆。

---

## 五、标准制作与验收命令

```bash
# 1. 一键生成合规主题脚手架（默认 Tier 2；可选 --tier=1 或 --tier=3）
npm run theme:new -- spring-festival --kind=holiday --tier=2

# 2. 编辑 site/skins/<id>/theme.json 与 doodle.svg（并在 config.json 挂档期）

# 3. 跑全项主题体检（Schema + 亮暗 WCAG 对比度 + 资产安全体积 + 跨群讨论命中预览）
npm run theme:check -- spring-festival

# 4. 跑完整测试与构建
npm run test:themes && npm run build
```

---

## 六、给 AI Agent 的一键制作指令清单

下次遇到节日或重大事件，让 Agent 制作新主题时遵循以下 5 步即可一次达标：

1. 先运行 `npm run theme:new -- <id> --kind=<kind> --tier=<1|2|3>` 创建目录骨架；
2. 按「第三节文案预算」填写 `theme.json`，精心设计亮/暗双色板与本地矢量 `doodle.svg`（`viewBox="0 0 180 96"`，含 `prefers-reduced-motion` 静态降级）；
3. 若为 Tier 2/3，补全 `knowledge.related.keywords`、`knowledge.searchExamples` 与 `home` 联动配置；
4. 在 `site/skins/config.json` 中添加不重叠的 `campaigns` 档期及可选 `editions` 绑定；
5. 运行 `npm run theme:check -- <id> && npm run test:themes && npm run build`，确认 0 错误 0 对比度告警后再交付预览链接 `?theme=<id>`。
