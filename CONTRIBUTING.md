# 参与贡献

欢迎提 Issue 和 PR。

---

## 提 PR 之前：把这七套自检跑一遍

改动覆盖层之后，**先在本地跑通再提 PR**，能挡掉大部分低级错误：

```bash
node tools/check-anim.js        # 71 条：渲染、动画、DOM 复用、走势条、进度小节、金银文案、置顶悬浮
node tools/check-timing.js      # 22 条：房间用时计时
node tools/check-cctclient.js   # 33 条：CCT 字段映射与占位符表
node tools/check-goldenmode.js  # 28 条：一命模式三态表与两条布局约束
node tools/check-goldenfsm.js   # 25 条：一命模式状态机（拿起/死亡锁/冷却窗口/换章重置）
node tools/check-streaklive.js  # 25 条：走势条实时增量（暂停追踪下的成败推断与拼接）
node tools/check-deaths.js      # 23 条：死亡判定核心（种子基准/增量/归零重基准/跨房隔离）
```

**依赖**：node + Edge（Chromium 内核，Windows 自带）。
脚本会自己起无头浏览器、跑完自己关，**不需要开游戏、不需要装 CCT**。

> `check-anim.js` 的夹具在 `tools/fixtures/` 里，跟着仓库一起 clone 下来，
> 不用额外准备。它引用的是 `../ExternalOverlay/` 里**当前这份代码**。

### 改到这些地方要额外注意

| 改动 | 要跑/要看 |
| --- | --- |
| `ExternalOverlay/` 下的任何文件 | 七套全跑 |
| DOM 结构（加卡片、改 id/class） | 还要同步改 `tools/fixtures/anim_case.html` |
| `CCTOverlay.js` 的 CctClient 分区 | `check-cctclient.js` 会校验切片标记和表顺序 |
| `CCTOverlay.js` 的 GoldenMode 分区 | `check-goldenmode.js` 会校验三态字段、两条布局约束、文案是否又散落出去 |
| `CCTOverlay.js` 的 `updateGoldenMode` 状态机 | `check-goldenfsm.js` 按函数边界提取验证（改函数名/搬位置要同步提取方式） |
| `CCTOverlay.js` 的 `liveGolden` 实时增量 | `check-streaklive.js` 按区间提取验证 |
| `CCTOverlay.js` 的 `detectDeathsCore` 判定核心 | `check-deaths.js` 按函数边界提取验证；核心必须保持零 DOM / 零存档 / 零日志 |
| 加一种新模式 | 在 `GOLDEN_MODE` 里加一条即可，各渲染函数不用逐个改；`hideRoomInfoRow` / `streakKeepWhenEmpty` 按新模式的布局定 |
| 占位符表 | 同步 `tools/diag.ps1`（它是独立维护的，测试会校验它没漂移） |

---

## 改代码时的几条硬约束

这些约束**是从真实 bug 里换来的**，改的时候别弄丢：

1. **`tick()` 里「先恢复计时、再结算上一面」的顺序不能反。**
   `resumeTimer()` 会把进房时刻往后推来补偿暂停，顺序反了会把暂停时长算进上一面。

2. **一命模式下 `.room-info-row` 必须无条件隐藏。**
   不要加「没走势数据就放出来」的兜底 —— 加过，反而出了 bug。
   现在是 `GOLDEN_MODE` 里的 `hideRoomInfoRow: true` 字段，`check-goldenmode.js` 锁着它。

3. **一命模式下走势条即使没数据也要保留整条**，且同样画满 20 个空位。
   换成文字会让这一行宽度跳动，而且第二张卡片会空白。
   现在是 `GOLDEN_MODE` 里的 `streakKeepWhenEmpty: true` 字段，`check-goldenmode.js` 锁着它。

4. **`goldenType` 是 `0 = 金`、`1 = 银`**，和直觉相反。
   统一走 `CctClient.goldenType()`，别在别处直接读字段。

5. **抓 CCT 占位符要禁缓存**，否则数据不更新。

---

## 提交信息

写清楚「改了什么、为什么」。不用很长，但别只写 "fix bug"。

---

## 本地跑游戏验证

自检跑过之后，**建议再进游戏实际看一遍**（自检覆盖不了真实的 CCT 数据流）：

| 场景 | 确认什么 |
| --- | --- |
| 普通推图 | 本面死亡 / 本面用时正常 |
| 拿起金草莓 | 镀金扫光、徽章、成功率行、走势条出现 |
| 拿起银草莓 | 是银色不是金色 |
| 带金过一面 | 成功率滚动、走势条右边多一个绿方块 |
| 带金死一次 | 数字立刻变、走势条右边多一个红方块 |
| 换房间 | 走势条换成新房间的数据 |
| 重开章节 | 本面死亡归 0，不留残影 |

> ⚠️ 覆盖层是浏览器页面，**更新文件之后要在窗口里按 `Ctrl + R`**，
> 否则跑的还是旧代码。
