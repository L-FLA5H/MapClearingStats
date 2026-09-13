# v0.1.0

简单发一下。嘻嘻。

## 包含内容

- **ExternalOverlay** —— 直播覆盖层（`CCTOverlay.html` / `.js` / `.css`），需要替换CCT已有的文件
  - 全局卡片：地图名、当前房间名、总死亡、总用时
  - 本面卡片：本面死亡、本面用时
  - 进度卡片：小节与房间进度、房间方格（绿=已通过 / 黄=当前 / 灰=未到达）
  - 过图时定格上一面数据并变色，随后用「先快后慢」的滚动动画过渡
- **LevelWatcher** —— 辅助 Mod（`LevelWatcher.zip`），暴露当前场景类型，用于判断玩家是否在关卡内

## 安装

本 Release 提供两个压缩包：

| 文件 | 用途 |
| --- | --- |
| `LevelWatcher.zip` | 辅助 Mod，解压后放进蔚蓝的 `Mods` 文件夹 |
| `MapClearingStats-Overlay-v0.1.0.zip` | 覆盖层页面，解压后覆盖到 CCT 的覆盖层目录 |

步骤：

1. 安装 [Everest](https://github.com/EverestAPI/Everest) 与 [ConsistencyTracker](https://github.com/viddie/ConsistencyTrackerMod)
2. 下载 `LevelWatcher.zip`，解压到蔚蓝的 `Mods` 文件夹
3. 下载 `MapClearingStats-Overlay-v0.1.0.zip`，把里面的 `ExternalOverlay` 三个文件覆盖到
   `ConsistencyTracker/external-tools/ExternalOverlay/`（覆盖前建议先备份 CCT 自带文件）
4. 在 CCT 设置里给要直播的地图录一次路径
5. OBS 添加「浏览器」来源，选本地文件 `CCTOverlay.html`，宽 620 高 400

详细步骤见 [README](https://github.com/L-FLA5H/MapClearingStats#安装)。

## 依赖

- Celeste + Everest 1.5935.0+
- [ConsistencyTracker](https://github.com/viddie/ConsistencyTrackerMod)（必装，数据来源）

本仓库不包含任何第三方 Mod 的代码。

## 已知限制

- 方格进度依赖 CCT 的路径录制，没录过路径的地图只会显示提示文字
- 数据存在浏览器会话里（`sessionStorage`），关掉浏览器后清空，不做跨会话的历史统计
