# v0.2.0

计时问题集中修复 + 动画与设计提升。

## 修复的 6 个计时 bug

| # | 症状 | 修复 |
| --- | --- | --- |
| 1 | 暂停时长漏进上一面用时 | `resumeTimer()` 改到房间结算**之前** |
| 2 | 换图后总用时虚高（多算暂停时间） | `saveChapterHistory` 改存「累计用时秒数」，恢复时反推 |
| 3 | 切图后当前房间那段时间丢失 | 存历史时把当前房间那段时间也一起结算 |
| 4 | 重新开始此章节不清零 | 用「进图前是否经过主页面」作判据；只有同一张图才清零 |
| 5 | 返回地图选不保存进度时不清零 | 用「重进后的房间 ≠ 上次离开的房间」作判据 |
| 6 | 从后面小节进入时不清零 | 去掉「必须是第一面」的条件（判据合并进了 #5） |

## 新增功能

- 右侧进度条：底部贯穿 4px 进度条 + 大号百分比
- 百分比带 1 位小数，进度变化时**数值平滑缓动**（先快后慢，620ms）
- 平均死亡 / 平均用时：卡片 1 右侧第三行小字号，按「已通过面数」算
- 调试开关 `DEBUG`：关掉时隐藏右侧调试面板、停止日志（代码全保留，将来改一个字母即可开启）
- 页面内调试面板（`DEBUG=true` 时显示）：标记 / 清空 / 抓 CCT 快照 / 复制全部

## 动画与设计

- 三张卡片入场：依次淡入上浮
- 方格动效：当前房间持续呼吸光晕、方格被攻克时爆闪
- 死亡时顶部卡片**红光一闪**（克制版，不位移）
- 攻下小节时卡片边缘**扫过一道光**
- 卡片 3 高度变化时**平滑缓动**
- 切换小节时旧小节向上飘出 → 新小节**从下方浮入**（方向相反形成接力感），不会每过一面就闪一次
- 三张卡片阴影加深

## 安装

1. 安装 [Everest](https://github.com/EverestAPI/Everest) 与 [ConsistencyTracker](https://github.com/viddie/ConsistencyTracker)
2. 下载 `LevelWatcher.zip`，解压到蔚蓝的 `Mods` 文件夹
3. 下载 `MapClearingStats-Overlay-v0.2.0.zip`，把里面的 `ExternalOverlay` 三个文件覆盖到
   `ConsistencyTracker/external-tools/ExternalOverlay/`（覆盖前建议先备份 CCT 自带文件）
4. 在 CCT 设置里给要直播的地图录一次路径
5. OBS 添加「浏览器」来源，选本地文件 `CCTOverlay.html`，**宽 620 / 高 400** 左右

## 依赖

- Celeste + Everest 1.5935.0+
- [ConsistencyTracker](https://github.com/viddie/ConsistencyTracker)（必装，数据来源）
- 建议 OBS 浏览器源里加 `?cacheless=1`（避免 CCT 的本地接口被强缓存）

本仓库不包含任何第三方 Mod 的代码。
