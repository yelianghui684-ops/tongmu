---
version: alpha
name: 同幕 TongMu
description: 深色影院风设计系统——放映厅的仪式感，工具的克制
colors:
  # 背景层次（由深到浅 = 由远到近）
  bg: "#0b0c10"
  bg-raised: "#14161d"
  bg-panel: "#1b1e27"
  bg-hover: "#232733"
  # 描边
  border: "#2a2e3a"
  border-strong: "#3a4050"
  # 文字
  text: "#ece9e2"
  text-dim: "#9095a1"
  text-faint: "#5c6170"
  # 品牌琥珀（放映机灯光）
  accent: "#e8a33d"
  accent-bright: "#f5bc62"
  accent-dim: "#a87627"
  accent-glow: "#e8a33d26"
  on-accent: "#1c1405"
  # 语义色
  ok: "#6fc95e"
  warn: "#e8a33d"
  danger: "#ef6b6b"
typography:
  display:
    fontFamily: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif
    fontSize: 44px
    fontWeight: 700
    letterSpacing: 10px
  title:
    fontFamily: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif
    fontSize: 15px
    fontWeight: 600
  body:
    fontFamily: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.6
  caption:
    fontFamily: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif
    fontSize: 12.5px
    fontWeight: 400
  mono:
    fontFamily: ui-monospace, "SF Mono", Menlo, Consolas, monospace
    fontSize: 13px
    fontWeight: 500
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  2xl: 36px
rounded:
  sm: 6px
  md: 10px
  lg: 16px
  xl: 22px
  full: 9999px
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.md}"
    hoverBackground: "{colors.accent-bright}"
  button-ghost:
    backgroundColor: transparent
    textColor: "{colors.text}"
    borderColor: "{colors.border}"
    rounded: "{rounded.md}"
    hoverBorder: "{colors.accent-dim}"
  input:
    backgroundColor: "{colors.bg}"
    borderColor: "{colors.border}"
    rounded: "{rounded.md}"
    focusBorder: "{colors.accent-dim}"
    focusRing: "{colors.accent-glow}"
  card:
    backgroundColor: "{colors.bg-raised}"
    borderColor: "{colors.border}"
    rounded: "{rounded.xl}"
  panel:
    backgroundColor: "{colors.bg-panel}"
    borderColor: "{colors.border}"
    rounded: "{rounded.md}"
  badge:
    rounded: "{rounded.full}"
    textColor: "{colors.text-dim}"
    borderColor: "{colors.border}"
  chat-bubble:
    backgroundColor: "{colors.bg-panel}"
    rounded: "{rounded.lg}"
  chat-bubble-mine:
    backgroundColor: "#33270f"
    borderColor: "{colors.accent-dim}"
    rounded: "{rounded.lg}"
---

## Overview

同幕是"一键同步放映厅"：朋友之间共享一场电影的私密空间。视觉基调是**熄了灯的影院**——近黑的暖调深色打底，唯一的亮色是琥珀色，隐喻放映机投出的那束光。界面是舞台的边框而非主角：一切装饰都要为"画面"让位，克制、安静、有仪式感。

## Colors

- **背景四层**（`bg` → `bg-raised` → `bg-panel` → `bg-hover`）：亮度递增表示"离观众更近"。舞台区永远纯黑 `#000`，让视频的黑边隐形。
- **琥珀 accent** 是唯一品牌色：主按钮、房间码、进度条、聚焦态。同屏的琥珀实心元素不超过一个（主 CTA），其余用描边/文字形式。`accent-glow` 只用于聚焦光晕与氛围渐变。
- **语义色**只在徽章和提示里出现：`ok` 就绪/在线，`warn` 等待/重连，`danger` 错误。不要用语义色做装饰。
- 文字三级：正文 `text`，辅助 `text-dim`，占位/禁用 `text-faint`。

## Typography

系统中文字体栈（PingFang / 雅黑），不引入网络字体——放映厅要秒开。`display` 仅用于首页 logo「同幕」，配合宽字距营造片头字幕感；房间码、时间码、偏差值一律用 `mono`，等宽让数字跳动不抖动。正文行高 1.6 保证聊天可读性。

## Layout

- 首页：单卡片垂直居中，卡片宽 400px，背景铺**琥珀径向氛围光**（极淡，透明度 ≤8%），像银幕未亮时的余晖。
- 房间：`header（48px）+ 主区`，主区 = `舞台（flex:1，纯黑）+ 侧栏（300px）`。侧栏 = 成员（固定）+ 聊天（弹性滚动）。720px 以下侧栏折到底部。
- 间距用 spacing 刻度，不写魔法数字；组件内紧（sm/md），组件间松（lg/xl）。

## Elevation & Depth

深色系里**用亮度而非阴影**表达层级：越浮起的表面越亮。阴影只给两处——首页卡片（`0 24px 60px #00000066` 的深投影）和悬浮层（手势遮罩、缓冲提示，用半透明黑 + 模糊背景）。禁止给平铺面板加阴影。

## Shapes

圆角语言"外大内小"：页面级卡片 `xl`，面板/输入框/按钮 `md`，徽章和头像 `full`。滑杆轨道细（4px）而拇指圆（14px），像调音台推子。

## Components

- **button-primary**：琥珀实心，按下微沉（translateY 1px）。一个视图最多一个。
- **button-ghost**：透明底描边，悬停时描边转 `accent-dim`——"被光扫过"的反馈。
- **input**：底色用最深的 `bg`（凹进去的感觉），聚焦时琥珀描边 + 3px `accent-glow` 光环。
- **badge**：胶囊形，默认灰描边；`ok`/`warn` 变体只改文字与描边色，不填充。
- **成员头像**：昵称首字圆形，背景从固定色板按成员 id 取，饱和度低（影院观众席的暗色轮廓）。
- **chat-bubble**：对方灰面板色，自己琥珀暗调（`#33270f`）——像黑暗里亮起的手机屏。
- **control-bar**：舞台底部通栏，播放键是唯一大目标（40px 圆形琥珀描边），时间码 mono，进度滑杆占满余宽。
- **progress**（传输）：轨道 `bg-panel`，填充琥珀，完成瞬间不闪烁不弹跳。

## Do's and Don'ts

- ✅ 新增颜色/间距先加 token 再使用；CSS 里引用 `var(--…)`，禁止裸色值（`#000` 舞台除外）。
- ✅ 过渡统一 `0.15s ease`，只过渡 color/border/background/transform。
- ✅ 空状态给一句人话 + 一个动作，不放大段说明。
- ❌ 不要浅色模式——影院不开灯。
- ❌ 不要让琥珀大面积铺开（背景、大色块），它是光束不是墙漆。
- ❌ 不要引入图标库和插画；emoji（🎬）+ 字符图形足够，保持零依赖。
