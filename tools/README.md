# tools —— 排查与自检工具

出问题的时候用这里的工具抓数据，比来回描述快得多。

---

## 给使用者（不用装任何东西）

### `diag.ps1` ★ 最常用

**记录一段时间内 CCT 数据的变化**，用来确认「哪个字段是活的」。

```powershell
# 游戏开着，跑 180 秒（跑的时候正常玩，故意死几次）
powershell -ExecutionPolicy Bypass -File "tools\diag.ps1" 180
```

跑完把 `tools\_diag.txt` 发出来即可。

它会记录 `previousAttempts` / `goldenEntries` / `successStreak` /
`deathsInCurrentRun` 等字段的变化，**只记变化**，所以日志很短很好读。

> 依赖 Windows 自带的 PowerShell，不需要 node。
> 文件本身是**纯 ASCII** —— `.ps1` 里写中文会被系统按 GBK 解读而崩掉。

### `diagnose.html`

**浏览器版诊断页**。双击打开，顶部会显示连接状态：

- 🟢 已连上 CCT(:32270) 和 LevelWatcher(:32271)
- 🔴 连不上（并显示每个接口的真实错误）

页面里有「下载日志」按钮。适合想看「当前一次性快照」的场景。

> ⚠️ 有些浏览器不允许 `file://` 页面请求本地服务，
> 所以连不上的话改用 `diag.ps1`。

---

## 给开发（需要 node）

> 这台机器上 node 不在 PATH 里。要跑下面两个的话，
> 用完整路径调用：`C:\Users\<用户名>\.workbuddy-ai\binaries\node\versions\<版本>\node.exe`

### `check-anim.js`

**覆盖层的自动化自检**，31 条断言，覆盖：

- 卡片入场 / 镀色扫光 / 数据变化动画
- 走势条的「实时增量」重建
- 走势条恒为 20 个方块
- 成功率数值补间 / 重开章节后的重置

```bash
node tools/check-anim.js
```

改动覆盖层之后**先跑这个**，能挡掉大部分低级错误。

> **依赖**：node + Edge（Chromium 内核，Windows 自带）。
> 脚本会自己起无头浏览器、跑完自己关，**不需要开游戏**。
>
> 夹具在 [`fixtures/`](fixtures/) 里，跟着仓库一起 clone 下来，不用额外准备。
> 它引用的是 `../ExternalOverlay/` 里**仓库当前这份代码**，所以测的永远是最新代码。

⚠️ **改了 DOM 结构**（加卡片、改 id、改 class）时，夹具要跟着改，
见 [`fixtures/README.md`](fixtures/README.md)。只改逻辑 / 样式不用动。

### `cct-dump.js`

一次性打印 CCT 的所有字段（含 `parseFormat` 逐项结果）。
查「某个占位符到底返回什么」时最直接。

```bash
node tools/cct-dump.js
```

### `deploy-overlay.ps1`

把 `ExternalOverlay/` 部署到游戏目录，自动做：检查游戏已关闭 → 备份 →
拷贝 → MD5 校验。

```powershell
powershell -ExecutionPolicy Bypass -File "tools\deploy-overlay.ps1"
```

---

## 相关文档

- [`docs/cct-api-notes.md`](../docs/cct-api-notes.md) —— CCT 接口速查（字段、单位、坑）
- [`调试方案.md`](../调试方案.md) —— 发布前的完整自检清单
