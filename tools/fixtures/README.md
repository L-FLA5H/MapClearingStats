# tools/fixtures —— 自检用的夹具

`tools/check-anim.js` 需要这个夹具才能跑。**跟着仓库一起 clone 下来，不用额外准备。**

## `anim_case.html`

一个**静态的覆盖层页面副本**：DOM 结构和真实的 `CCTOverlay.html` 一样，
但数据是写死的假数据，不连 CCT、不开游戏。

它用相对路径引用真实的覆盖层文件：

```html
<link rel="stylesheet" href="../../ExternalOverlay/CCTOverlay.css">
<script src="../../ExternalOverlay/Timing.js"></script>
<script src="../../ExternalOverlay/CCTOverlay.js"></script>
```

所以 `check-anim.js` 测的是**仓库里当前这份代码**，不是副本。

页面里还挂了几个给测试用的小钩子（`window.__flip()` / `__gold()` / `__silver()` 等），
`check-anim.js` 通过 CDP 调它们来切换场景。

## 跑法

```bash
node tools/check-anim.js
```

需要 Edge（Chromium 内核，Windows 自带）+ node。脚本会自己起无头浏览器、跑完自己关。

## 为什么要单独放一个夹具

因为 `check-anim.js` 要验证的是**渲染行为**（动画、DOM 节点复用、走势条方块数量……），
这些用纯函数测不了，必须在真浏览器里跑一遍。

## ⚠️ 什么时候需要更新它

覆盖层改了 **DOM 结构**（加卡片、改 id、改 class）时，夹具要跟着改。
只改逻辑 / 样式不用动。

> 它原本由 `make_layout_preview.py` 生成（那个脚本还会顺带生成一批给人工看的布局预览页）。
> 现在这份是手工维护的精简版，只保留自检需要的最小结构。
