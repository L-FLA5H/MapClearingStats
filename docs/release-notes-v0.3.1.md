# v0.3.1

这一版**没有用户可见的变化** —— 全是内部的代码整理和文档补充。

装法和之前完全一样，直接从 Release 下 zip 覆盖过去即可。

---

## 重构（来自 PR [#4](https://github.com/L-FLA5H/MapClearingStats/pull/4)，感谢 [@glcoge](https://github.com/glcoge)）

**计时逻辑收敛到一处**

「当前房间停留了多久」这道公式原本在 `CCTOverlay.js` 里**写了四遍**
（切房结算、存档补算、每帧刷新、房间信息卡刷新），而且各用各的时钟口径。

现在全部收进新的 `ExternalOverlay/Timing.js`，全库只剩**一个**「现在几点」的口径。
以后再修计时问题，只需要改一个地方。

**主循环拆成六步管道**

```
pollScene → reconcileSession → resolveGoldenMode / renderUpper
         → locateRoom → settleTiming → renderLower
```

其中「先恢复计时、再结算上一面」这个顺序**以前靠注释守着**（顺序反了会把暂停时长
算进上一面）。现在这个顺序固定在函数结构里，调用方没法搞反。

**新增自检脚本**

`tools/check-timing.js`：22 条断言，纯 Node 运行，不需要浏览器、不需要开游戏。
覆盖暂停补偿、时钟回拨、存档不改原会话、与旧公式等价等。

**唯一的行为变化**

结算时长现在统一做**负值保护**（时钟回拨时按 0 计）。原来只有存档那条路径有这个保护，
现在两条路径一致，取更安全的一侧。

---

## 文档

- **安装说明**：说明覆盖层目录的正确位置是 `ConsistencyTracker\external-tools\ExternalOverlay\`，
  **不是** Mod 包里的 `Assets\ExternalOverlay\`（那份游戏不读）
- **常见问题**新增三条：
  - 覆盖层一直显示「CCT 未响应」→ 四步排查（**Everest 调试模式没开**是最常见的原因）
  - 我把文件放进了 `Assets\ExternalOverlay\`，但没效果
  - 找不到 `external-tools\ExternalOverlay\` 这个目录

---

## 安装

和之前相同。

| 文件 | 用途 |
| --- | --- |
| `LevelWatcher.zip` | 辅助 Mod，解压后放进蔚蓝的 `Mods` 文件夹 |
| `MapClearingStats-Overlay-v0.3.1.zip` | 覆盖层页面，解压后**整个 `ExternalOverlay` 文件夹**覆盖到 CCT 的覆盖层目录 |

1. 安装 [Everest](https://github.com/EverestAPI/Everest) 与 [ConsistencyTracker](https://github.com/viddie/ConsistencyTrackerMod)
2. 下载 `LevelWatcher.zip`，解压到蔚蓝的 `Mods` 文件夹
3. 下载 `MapClearingStats-Overlay-v0.3.1.zip`，把里面的 `ExternalOverlay` 文件夹**整个覆盖**到
   `<Celeste 安装目录>\ConsistencyTracker\external-tools\ExternalOverlay\`
   （**覆盖前建议先备份** CCT 自带文件）
4. 在 CCT 设置里给要直播的地图录一次路径
5. OBS 添加「浏览器」来源，选本地文件 `CCTOverlay.html`，宽 620 高 400

> ⚠️ **这一版覆盖层多了 `Timing.js`**（共 4 个文件）。请**整个文件夹一起覆盖**，
> 不要只挑几个文件 —— `CCTOverlay.js` 依赖 `Timing.js`，缺了会报错。

> ⚠️ **`LevelWatcher` 无改动**，沿用 v0.3.0 的包即可。

### 两个设置要注意

1. **走势条想实时刷新的话**，要把 CCT 的 `暂停死亡追踪`（Pause Death Tracking）设为 **关**。
   开着的时候 CCT 不记录房间尝试，走势条就不会更新。
2. **更新文件后要在覆盖层窗口里按 `Ctrl + R`** —— 浏览器页面不会自动加载新代码。

## 依赖

- Celeste + Everest 1.5935.0+
- [ConsistencyTracker](https://github.com/viddie/ConsistencyTrackerMod)（必装，数据来源）

本仓库不包含任何第三方 Mod 的代码。

## 已知限制

- 方格进度依赖 CCT 的路径录制，没录过路径的地图只会显示提示文字
- 「局数」这个数据 CCT 只在拿着金草莓的那一刻短暂提供，没拿时是空的 ——
  覆盖层在拿不到时会退回显示「带金死亡」
- 覆盖层是浏览器页面，**更新文件后必须按 `Ctrl + R` 重新加载**才会生效
