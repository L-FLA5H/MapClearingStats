# CCT 接口速查

> ConsistencyTracker (CCT) 的本地 HTTP 接口实测记录。
> 写覆盖层 / 排查取数问题时先看这一页，**不用再去猜字段语义**。
>
> 最后更新：2026-09-17（CCT 2.9.8 / overlayVersion 2.0.0）

---

## ⚠️ 三条必读的坑

### 1. 请求头：少了就返回空

```js
// 直连 127.0.0.1 会 400 Invalid Hostname，Host 必须是 localhost
// 少了 Accept 会返回 200 但 body 是空的 —— 最难查的一种失败
fetch("http://localhost:32270/cct/state", {
    headers: { "Accept": "application/json" },   // ⚠️ 必须
});
```

### 2. 字段单位是 .NET `TimeSpan` 的 ticks

`timeSpentInRoom` / `timeSpentInRoomFirstPlaythrough` / `timeSpentInRoomInRuns`
的单位是 **ticks（1 tick = 100ns）**：

```js
const sec = ticks / 10_000_000;
```

### 3. 金 / 银的取值是 `0 = 金`、`1 = 银`

`goldenType` 容易记反 —— 实测 `0 = 金`、`1 = 银`。

---

## 一、`GET /cct/state`

### `currentRoom`

| 字段 | 含义 |
|---|---|
| `debugRoomName` | 房间的内部名（如 `a02_skunkynator`） |
| `goldenBerryDeaths` / `goldenBerryDeathsSession` | 该房间带金死亡（累计 / 本次会话） |
| `previousAttempts` | 布尔数组，最近每次尝试是否通过 |
| `lastFiveRate` / `lastTenRate` / `lastTwentyRate` | 近 5 / 10 / 20 次通过率 |
| `maxRate` | 历史最佳通过率 |
| `successStreak` / `successStreakBest` | 当前 / 最佳连续通过次数 |
| `deathsInCurrentRun` | 本条命内死亡数 |
| `timeSpentInRoom` | 该房间累计耗时（ticks） |
| `timeSpentInRoomFirstPlaythrough` | 初见耗时（ticks） |
| `timeSpentInRoomInRuns` | 带金挑战耗时（ticks，与初见正交） |

### `modState`

| 字段 | 含义 |
|---|---|
| `playerIsHoldingGolden` | 玩家当前是否手持金草莓 |
| `goldenDone` / `chapterCompleted` | 本章金草莓是否完成 / 本章是否通关 |
| `deathTrackingPaused` | 死亡统计是否被暂停 |
| `chapterHasPath` | 本章是否有路径数据 |
| `modVersion` | CCT 版本（实测 `2.9.8`） |

### ⚠️ `previousAttempts` 的两个陷阱

**① 它是「最近 X 次尝试」，X 由 mod 选项决定**（实测能到 100 条）。
显示时要自己 `slice(-N)`。

**② CCT 的「暂停死亡追踪」打开时，这个数组完全不更新。**
不是「不实时」，是**根本没在记录**。

- 设置项在 `Saves/modsettings-ConsistencyTracker.celeste` 里的
  `PauseDeathTracking`
- 对应语言文件说明：「**始终追踪带金死亡**：当你暂停死亡追踪，
  此功能将让带金死亡依旧被记录」—— 反过来说，**其他数据都不记录**
- 现象：连死 4 次，`previousAttempts` 一个字节都不变，但
  `goldenBerryDeaths` / `goldenEntries` 正常增长

**③ `successStreak` 可能是负数。** 设置里 `TrackNegativeStreaks: true` 时，
CCT 用**负数表示连续失败**（如 `-30` = 连续失败 30 次）。
想自己算的话，从 `previousAttempts` 末尾数连续 `true` 更稳。

---

## 二、`GET /cct/currentChapterStats`

额外提供：

| 字段 | 含义 |
|---|---|
| `goldenCollectedCount` / `goldenCollectedCountSession` | 金草莓收集数 |
| `goldenType` | **0 = 金，1 = 银** |
| `rooms{}` | **字典，每个房间一份完整的 `currentRoom` 数据** |

**`rooms{}` 是关键** —— 能一次拿到**所有房间**的带金数据，不用逐房间请求。

---

## 三、`GET /cct/getPlaceholderList` ★ 字段说明书

**接 CCT 数据之前先调这个。** 返回每个占位符的**官方中文说明**：

```json
{ "placeholders": [
    { "name": "{room:successRate}",
      "description": "当前房间在过去X次尝试中的成功率 (计算 尝试成功/总尝试)" },
    ...
]}
```

常用几条：

| 占位符 | 官方说明 |
|---|---|
| `{room:successRate}` | 当前房间在**过去 X 次尝试**中的成功率（尝试成功/总尝试） |
| `{room:successes}` / `{room:attempts}` | 最后 X 次尝试内通过次数 / 计算最多 X 次 |
| `{room:currentStreak}` / `{room:currentStreakBest}` | 连续一命通过次数 / 最佳连续一命通过次数 |
| `{room:chokeRate}` | 当前房间的失败率（带金死于该房间 / 带金进入该房间） |
| `{room:goldenSuccessRate}` | 带金成功率（带金通过 / 带金进入） |
| `{room:goldenEntries}` / `{room:goldenSuccesses}` | 带金进入次数 / 带金通过次数 |
| `{room:goldenEntryChance}` | 从开头到当前房间的几率（从所有带金局中计算） |
| `{run:currentPbStatusNumber}` | 局数 —— **⚠️ 只在拿着金草莓的那一刻有值**，没拿是空的 |

⚠️ 实测 **`goldenEntries = goldenSuccesses + goldenDeaths`**，
可以据此用增量推出「这次是成功还是失败」。

---

## 四、其他接口

| 接口 | 用途 |
|---|---|
| `/cct/currentChapterPath` | 本章路径（小节的房间列表），画进度方格用 |
| `/cct/recentChapterData` | 最近章节/房间的完整数据 |
| `/cct/getFormat` `/cct/getFormatsList` `/cct/saveFormat` | 格式模板 |
| `/cct/getFileContent` `/cct/madelineScreenPosition` `/cct/getPhysicsLogList` | 其他 |

**不存在的接口**（返回 `ERROR: Endpoint not found.`）：
`/cct/modState`、`/cct/roomHistory`、`/cct/version`
（`modState` 已包含在 `/cct/state` 里）。

---

## 五、LevelWatcher（本仓库的辅助 Mod，端口 32271）

```json
{ "sceneType": "Celeste.Level", "paused": false }
```

| 字段 | 含义 |
|---|---|
| `sceneType` | 当前场景类型。`Celeste.Level` = 在关卡内；`Celeste.Overworld` = 在地图；`Celeste.LevelExit` = 关卡退出动画 |
| `paused` | 暂停或冻结（`Scene.FrozenOrPaused`）。⚠️ **游戏内暂停菜单不改变 `sceneType`**，所以只能靠这个字段判断 |

> ⚠️ 蔚蓝自己的计时**在暂停期间照常走**，所以覆盖层不需要据此停表 ——
> 这个字段目前只是暴露出来备用。
