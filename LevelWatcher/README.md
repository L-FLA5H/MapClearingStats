# LevelWatcher

[MapClearingStats](../README.md) 的配套辅助 Mod。

## 它做什么

两件事，都在本机 `32271` 端口：

**① 返回当前场景类型**（覆盖层靠它判断「人在不在地图里」）

```
GET http://localhost:32271/
→ {"sceneType":"Celeste.Level"}
```

玩家在关卡内时返回 `Celeste.Level`，在主页面、加载界面等任何其他场景下返回对应的类型名（例如 `Celeste.Overworld`）。

**② 把覆盖层本身也用 http 发出去**（v0.4.0 起）

```
GET http://localhost:32271/overlay/
→ CCTOverlay.html（以及同目录下的 .js / .css）
```

文件读的是 `<Celeste>\ConsistencyTracker\external-tools\ExternalOverlay\`，不复制、不搬家。

> **为什么需要这条**：OBS 的浏览器源（CEF）加载 `file://` 页面时，会**禁掉页面里发出的请求**。
> 于是同一个 `CCTOverlay.html` 在 Chrome 里正常、放进 OBS 就永远显示「加载中」。
> 从 http 地址打开，页面和接口同源，就没有这个问题 —— OBS 里填
> `http://localhost:32271/overlay/` 即可。

## 为什么需要它？

直播覆盖层会使用 ConsistencyTracker（CCT）的数据来显示死亡数与用时。但 CCT 在玩家退出地图后，会把它暴露的状态**冻结在最后一帧**——`currentRoom`、`chapterName` 都不再变化。所以前端光靠 CCT 无法判断「玩家还在不在地图里」，也就没法在出图时自动停表。所以这个 Mod 补上了这一块信息。

## 安装

下载 [Release](https://github.com/L-FLA5H/MapClearingStats/releases/latest) 里的 `LevelWatcher.zip`，解压到蔚蓝的 Mods 目录：

```
<Celeste 安装目录>\Mods\LevelWatcher\
```

## 编译

需要 .NET 8 SDK：

```bash
cd Source
dotnet build
```

产物会自动复制到 `bin/LevelWatcher.dll`。Release 配置下会额外打包出 `LevelWatcher.zip`：

```bash
dotnet build -c Release
```

不在 Mods 目录里时，手动指定蔚蓝安装路径：

```bash
dotnet build -p:CelestePrefix="D:\Steam\steamapps\common\Celeste"
```

## 端口冲突

默认端口是 `32271`。如果被占用，改 `Source/LevelWatcherModule.cs` 里 `httpListener.Prefixes.Add(...)` 的地址，同时把 `ExternalOverlay/CCTOverlay.js` 顶部的 `LEVEL_WATCHER` 常量改成同样的端口。
