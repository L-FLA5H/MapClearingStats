# MapClearingStats

[![Release](https://img.shields.io/github/v/release/L-FLA5H/MapClearingStats?label=%E4%B8%8B%E8%BD%BD)](https://github.com/L-FLA5H/MapClearingStats/releases/latest)
[![License](https://img.shields.io/github/license/L-FLA5H/MapClearingStats?label=%E5%8D%8F%E8%AE%AE)](LICENSE)

> 蔚蓝（Celeste）直播用 实时数据覆盖层
> 
> **推图进度**和 **一命挑战（带金/带银）** 二合一

用于蔚蓝直播的可视化悬浮层，实时读取游戏内的实时数据，按当前的项目自动切换两种模式：

**推图模式** —— 用方格画出当前攻克进度（**绿色 = 已拿下，黄色 = 坐牢中，灰色 = 还没打**），
并实时显示总死亡、总用时、本面死亡与本面用时。

**一命挑战模式** —— 带起金草莓或银草莓时自动进入，整块面板「镀」成金色 / 银色，
只显示**这一命**的数据：带金成功率、进入率、带金死亡，以及本面最近 20 次的通过情况。

**[⬇ 下载最新版](https://github.com/L-FLA5H/MapClearingStats/releases/latest)** —— 装法见下方[安装](#安装)。

| 一命挑战（带金） | 一命挑战（带银） | 推图模式 |
| :---: | :---: | :---: |
| ![一命挑战（带金）](docs/preview-gold.png) | ![一命挑战（带银）](docs/preview-silver.png) | ![推图模式](docs/preview-normal.png) |

---

## 注意事项

- 这是本人第一次做蔚蓝的相关工具，制作初心与其说是 **「制作好用的工具让大家一起来用」** ，不如说是 **「为自己直播间设计一套推图 / 炼金炼银的 UI，顺便看看有没有其他人用得到」** ，有什么设计缺陷还请多多包涵。
- 本工具包含一个用于抓取游戏状态的单独 mod（[LevelWatcher](LevelWatcher/)）和几个可视化文件，本质上是对 CCT (ConsistencyTrackerMod) 中的悬浮层文件进行了修改。如要使用本工具，你需要先在任意的蔚蓝mod管理工具中安装 CCT。
- 本工具的功能设计、测试与迭代由 [L_FLA5H](https://github.com/L_FLA5H) 完成，代码开发由 AI 完成。
- 如果 CCT 更新导致本工具出现异常，我会尽快修复。
- 覆盖层是浏览器页面：更新文件之后要在窗口里按 `Ctrl + R` 重新加载，否则跑的还是旧代码。

## 功能

**卡片 1 —— 全局信息**

- 地图名
- 当前房间名
- 总死亡数（每次死亡缩放 + 略微变红）
- 精确到毫秒的总用时

**卡片 2 —— 本面信息**

- 本面的死亡数
- 本面的用时
- 过图时，定格上一面数据并变色，随后用「先快后慢」的缓动动画过渡到新房间的数据

**卡片 3 —— 进度方格**

- 多小节地图：只展开玩家当前所在的小节，其余小节显示为房间数
- 单小节地图：整张图的房间一次性铺开（20 个一行）
- 小节数量过多时，离当前小节越远的越小越淡（逐渐淡出，不做硬截断），始终把当前位置放在视觉重心
- 已通过的小节显示为绿色，一眼能看出打到哪了
- 换行时最后一行不足的方格会自动并入上一行，避免出现孤零零的一格

**置顶悬浮（不直播的时候用）**

如果你不直播、只想自己看着玩，可以点右下角的「**置顶悬浮**」按钮：

- 覆盖层会放进一个**始终置顶**的小窗口里，可以**拖动**、可以**缩放**
- 同时还能正常看游戏、看别的窗口，不用来回切
- 再点一下窗口里的「**还原**」就回到浏览器页面

> 按钮平时是**隐藏的**，鼠标移到页面上才会浮出来 —— 直播时观众看不到它。
> 需要 Chrome / Edge 116 或更高版本；不支持的环境下按钮不会出现（OBS 的浏览器源就是这种）。

---

**一命挑战模式（带金 / 带银）**

拿起金草莓或银草莓时自动进入，整块面板会「镀」成金色 / 银色并切换布局：

- **镀色动画** —— 金色 / 银色从卡片左边缘往右扫上来；死亡退出时往右扫走并渐隐
- **挑战徽章** —— 右上角显示「带金」/「带银」
- **带金成功率** —— `通过数 / 进入数`，例如 `18.18%（2/11）`
- **进入率** —— 从开头带金到当前面的几率
- **带金死亡** —— 本章累计 + 本次会话
- **本面近 20 次通过情况走势条** —— 20 个方块：绿=通过、红=失败、空心=还没记录；
  左端「较早」、右端「近期」
- **连续通过 / 最高连续通过**

> ⚠️ 如果想让走势条实时刷新，需要把 CCT 的 `暂停死亡追踪` 设为**关**。
> 开着的时候 CCT 不记录房间尝试，走势条就不会更新。

**状态感知**

- 玩家不在关卡内（主页面、加载中）时，卡片整体模糊并淡入提示文字，不会直接隐藏
- 模糊层边缘羽化处理，不会出现硬方框边
- 当前地图没有录制路径时，方格区域会明确提示

> ⚠️ 覆盖层是浏览器页面，**更新文件后要在窗口里按 `Ctrl + R`** 才会加载新代码。

---

## 工作原理

本工具本身**不修改游戏、不读取存档**，它只是一个前端页面，轮询两个本地 HTTP 接口：

```mermaid
flowchart LR
    A["Celeste + Everest"] --> B["ConsistencyTracker (CCT)"]
    A --> C["LevelWatcher (本仓库)"]
    B -->|":32270/cct/state<br/>/cct/currentChapterPath<br/>/cct/currentChapterStats"| D["ExternalOverlay<br/>(本仓库)"]
    C -->|":32271/ 返回 sceneType"| D
    D --> E["OBS 浏览器源"]
```

- **ConsistencyTracker** 负责真正把数据抓出来：玩家在哪个房间、每个房间的死亡数、每个房间的用时，以及这张图的完整小节 / 房间顺序。本工具只是展示它已经算好的数据。
- **LevelWatcher** 是本仓库附带的一个极简 Mod（约 80 行 C#）。它唯一的功能是在本机 `32271` 端口返回当前场景类型（`Celeste.Level` 还是 `Celeste.Overworld`）。因为 CCT 在玩家退出地图后会把状态冻结在最后一帧，前端只靠 CCT 无法判断玩家在不在地图里，所以需要它来补齐这一块。

> 本仓库不包含 ConsistencyTracker 或任何其他第三方 Mod 的代码。CCT 是独立的依赖 Mod，需要你自行安装。

### 它和 CCT 自带的窗口是什么关系

**CCT 本身就带一个外置窗口** —— 就是游戏内设置里的「游戏外展示窗口」。
它把统计数据渲染成一张网页，让你能在浏览器或 OBS 里看。

**本工具本质上就是把那个窗口换了一种（也许更好看的）形式。**
同样是读 CCT 的数据、同样是一张网页，只是重新设计了布局和样式，
另外加了一些 CCT 自带窗口没有的东西（进度方格、走势条、一命挑战模式）。

所以你可以理解成：**它是 CCT 外置窗口的一个「皮肤 + 增强版」**，不是独立的软件。

> **配置要求：无。** 只要你的电脑能打开浏览器，就能用。
> 不需要额外装运行时、不需要开服务、对显卡也没有额外要求。

---

## 安装

### 前置条件

| 项目 | 说明 |
| --- | --- |
| Celeste | Steam / itch.io 版本均可 |
| Everest | 1.5935.0 或更高版本（见 `LevelWatcher/everest.yaml`） |
| [ConsistencyTracker] | 即 CCT，必装。本工具的数据全部来自它 |

> **对电脑配置没有要求** —— 能打开浏览器就行。不需要额外安装任何运行时。

### 第 1 步：安装 LevelWatcher

下载 [Release](https://github.com/L-FLA5H/MapClearingStats/releases/latest) 里的 `LevelWatcher.zip`。

#### ⚠️ 关于「这个 Mod 要解压」

蔚蓝的 Mod 通常**直接把 zip 丢进 `Mods` 文件夹就行，不用解压** ——
所以看到这一步会有点奇怪，这里说清楚：

- **本工具其实也支持直接丢 zip**（和 CCT 一样，Everest 会自己处理）
- 但我们**推荐解压**，原因有两个：
  1. 出问题时能**直接看到文件**，一眼确认版本对不对、有没有装重复
  2. 不用去翻 Everest 的缓存目录（zip 加载的 Mod 会被解压到 `Mods\Cache\`）

**解压后的目录长这样**（注意 `everest.yaml` 要**直接**在文件夹里，别再套一层）：

```
<Celeste 安装目录>\Mods\LevelWatcher\
├── everest.yaml
└── bin\
    ├── LevelWatcher.dll
    └── LevelWatcher.pdb
```

> 常见的装错方式：解压出来变成 `Mods\LevelWatcher\LevelWatcher\everest.yaml`
> —— 多套了一层，Everest 找不到。**`everest.yaml` 必须和 `bin` 文件夹同级。**

启动游戏，在 Everest 的 Mod 列表里确认 `LevelWatcher` 已经加载。日志里会出现：

```
[LevelWatcher] LevelWatcher loaded on http://localhost:32271/
```

> 想自己从源码编译的话，见下方[自己编译 LevelWatcher](#自己编译-levelwatcher)。

### 第 2 步：配置覆盖层页面

将 zip 里的 `ExternalOverlay` 文件夹**整个覆盖**到 CCT 的覆盖层目录：

```
<Celeste 安装目录>\ConsistencyTracker\external-tools\ExternalOverlay\
```

覆盖完之后，那个目录里应该是这些文件（**数量随版本变化，以 zip 里的为准**）：

| 文件 | 说明 |
| --- | --- |
| `CCTOverlay.html` | 页面结构 |
| `CCTOverlay.js` | 主逻辑 |
| `CCTOverlay.css` | 样式 |
| `Timing.js` | 房间用时计时模块 |
| `img/` | CCT 自带的图片资源，**不用动** |

> ⚠️ **要整个文件夹一起覆盖，别只挑几个文件。** 文件之间是有依赖的
> （比如 `CCTOverlay.js` 需要 `Timing.js`），缺一个就会报错、界面出不来。

> ⚠️ **找不到这个目录？** 如果你是第一次装 CCT，**先启动一次游戏**。
> CCT 会在启动时自动创建这个目录，并把自带的覆盖层文件复制进去。

#### ⚠️ 别放错地方：`Assets\ExternalOverlay\` 是没用的

CCT 的 Mod 包里有**两份**同名文件，很容易搞混：

| 位置 | 是什么 | 游戏读它吗 |
| --- | --- | --- |
| `Mods\...ConsistencyTracker.zip` 里的 `Assets\ExternalOverlay\` | CCT **自带的原始副本**，只用来做首次复制 | ❌ **不读** |
| `ConsistencyTracker\external-tools\ExternalOverlay\` | CCT 运行时复制出来的**工作目录** | ✅ **读这个** |

**判断方法**：看这个目录的上一级是不是 `ConsistencyTracker\`（**和 `Mods` 平级，
在游戏根目录下**）。如果上面是 `Assets\`，那就放错了。

> ⚠️ CCT 自带同名的 `CCTOverlay.html / .js / .css`，这是 CCT 自带的 UI 界面，本工具的主要改动也就在于此，覆盖前请先备份原文件，否则想用回 CCT 自带界面时会找不回来。

### 第 3 步：在游戏里录制一次路径

这一步是**必须的**。CCT 需要先知道这张图有多少小节、多少房间、顺序是什么，方格进度才能画出来。
有关路径录制的相关信息请查阅 CCT 的使用说明，此处不做赘述。

### 第 4 步：在直播软件添加浏览器源

以 OBS 为例：

1. 来源 → `+` → **浏览器**
2. 勾选 **本地文件**，选择 `CCTOverlay.html`
3. **宽度 `620`、高度 `400`**（界面最大宽度是 620px，高度按需要增减）
4. 勾选 **透明背景**（`自定义 CSS` 里留空即可，页面本身已经是透明背景）
5. 建议勾选「源不可见时关闭浏览器」以节省资源

界面会出现在画面的**中间偏上**位置，可以自由拖动。

---

## 常见问题

### 覆盖层一直显示「CCT 未响应」／「无法获取」

这是最常见的反馈，按顺序排查：

**1. CCT 装了吗？**

本工具的数据**全部**来自 [ConsistencyTracker]，没装的话覆盖层拿不到任何数据。见上方[前置条件](#前置条件)。

**2. Everest 的「调试模式」开了吗？** ⚠️ **最容易忽略的一条**

CCT 的 API 只在 Everest 的调试模式为 **「仅Everest」或「开」** 时才对外可用。
如果设成了「关」，覆盖层**永远**连不上，且不会有任何别的症状。

> 位置：游戏内 `Everest 设置` → `调试模式` → 选「仅Everest」或「开」

**3. 游戏在运行吗？**

覆盖层是从游戏进程里读数据的。游戏没开，就没有数据。

**4. 自己测一下 API 通不通**

浏览器打开 <http://localhost:32270/>

- **能打开页面** → API 正常，问题在覆盖层这边。试试在覆盖层窗口按 `Ctrl + R`
- **打不开** → API 不可用，回到上面第 1、2 条

> 第 2、4 条来自 CCT 自带的常见问题：
> 游戏内 `Mod选项` → `稳定性追踪器` → `常见问题` → `游戏外工具`

---

### 我把文件放进了 `Assets\ExternalOverlay\`，但没效果

**放错地方了。** CCT 的 Mod 包里有**两份**同名文件：

| 位置 | 是什么 | 游戏读它吗 |
| --- | --- | --- |
| `Mods\...ConsistencyTracker\Assets\ExternalOverlay\`<br>（或在 `ConsistencyTracker.zip` 里） | CCT **自带的原始副本**，只在首次启动时被复制一次 | ❌ **不读** |
| `<Celeste 安装目录>\ConsistencyTracker\external-tools\ExternalOverlay\` | CCT 运行时复制出来的**工作目录** | ✅ **读这个** |

**正确的目录长这样：**

```
D:\Steam\steamapps\common\Celeste\
├── Mods\                          ← Mod 都在这
│   └── ...ConsistencyTracker.zip  ← 里面有 Assets\ExternalOverlay\（别动这个）
└── ConsistencyTracker\            ← ⚠️ 和 Mods 平级，在游戏根目录下
    └── external-tools\
        └── ExternalOverlay\       ← ✅ 覆盖层文件放这里
            ├── CCTOverlay.html
            ├── CCTOverlay.js
            ├── CCTOverlay.css
            └── Timing.js
```

**判断方法**：往上翻一级，看是 `ConsistencyTracker\` 还是 `Assets\`。
是 `Assets\` 就放错了。

---

### 找不到 `external-tools\ExternalOverlay\` 这个目录

**先启动一次游戏。** CCT 会在启动时自动创建这个目录，并把自带的覆盖层文件复制进去。

如果你已经启动过游戏还是没有，检查：

1. CCT 装好了吗？（在 Everest 的 Mod 列表里能看到 `ConsistencyTracker`）
2. 有没有别的 CCT 版本把目录建在别处

> 参考：`external-tools` 这个目录名是写死在 CCT 里的（CCT 2.9.8 实测）。

---

### 方格进度不显示／提示「当前地图没有录制路径」

进度方格依赖 CCT 的**路径**——也就是「这张图的房间按什么顺序通过」。
原版地图自带预设路径，**Mod 自制图需要自己录一次**。

**录制方法（游戏内）：**

1. 进入要记录的第一个房间
2. 打开 CCT 的 `路径记录` 菜单，点 `开始路径记录`
3. 像正常一样把图跑完（需要的话可以用无敌等辅助功能）
4. 在最后一个房间点 `保存路径`；或者通关后会自动保存

**也可以用调试地图录：**

`路径记录` → `通过调试地图开始路径记录` → 按 `F6` 进入调试地图 → 按跑图顺序点所有房间 → `保存路径`

> 详见 CCT 游戏内 `常见问题` → `路径管理`

---

### 走势条不刷新

需要把 CCT 的 **`暂停死亡追踪`** 设为 **`关`**。

开着的时候 CCT **不记录房间尝试**，走势条就不会更新。
（「始终追踪带金死亡」开着的话，带金数据仍然会被记录。）

> 位置：游戏内 `Mod选项` → `稳定性追踪器` → `暂停死亡追踪` → 选 `关`

---

### 更新了覆盖层文件，但界面没变化

覆盖层是个浏览器页面，**跑的是「打开那一刻的代码」**，不会自动重新加载。

在覆盖层窗口按 **`Ctrl + R`**，或者关掉窗口重新打开。

---

### 我想确认数据到底有没有在更新

用 `tools/diag.ps1`（Windows 自带 PowerShell，不用装东西）：

```powershell
powershell -ExecutionPolicy Bypass -File "tools\diag.ps1" 120
```

它会记录 120 秒内 CCT 数据的变化，输出到 `tools\_diag.txt`。只记变化，所以日志很短。

### 找不到「置顶悬浮」按钮

按钮是**默认隐藏**的 —— 鼠标移到页面上，右下角才会浮出来（这样直播时观众看不到它）。

鼠标移上去也没有的话，说明你的浏览器不支持这个功能：需要 **Chrome / Edge 116 或更高版本**。
OBS 的浏览器源同样不支持，所以直播时它本来就不会出现 —— 这是故意的，不影响直播。

### 点了「置顶悬浮」，弹出一个空白窗口 / 什么也没发生

大概率是浏览器不支持 Document Picture-in-Picture。已知 **QQ 浏览器（极速内核）** 有这个问题：
它会打开一个窗口，但里面的内容显示不出来。

**换 Chrome 或 Edge 打开本页面**就好了。

> 如果你习惯用别的浏览器：也可以把覆盖层放在普通窗口里，
> 然后用 [PowerToys](https://learn.microsoft.com/windows/powertoys/) 的 **Always On Top**（`Win + Ctrl + T`）把它置顶 —— 效果差不多。

### 悬浮窗口只有三张卡片，标题栏能不能去掉

标题栏是**浏览器自己画的**，网页改不了 —— 去不掉，而且 Edge 显示的是一长串文件路径。

能做的是：把窗口拖成刚好包住卡片的大小，看起来就没那么多空。
（拖动窗口边缘时，卡片会**自动缩放**去适应。）

## 已知局限

- 方格进度依赖 CCT 的路径录制，没录过路径的地图只会显示提示文字，不会出错
- 数据存在浏览器本地（`localStorage`），关掉浏览器再打开也还在（v0.2.0 之前用的是 `sessionStorage`，关标签页就清空）
- **「局数」这个数据拿不到**：CCT 只在拿着金草莓的那一刻短暂提供，没拿时是空的。覆盖层在拿不到时会退回显示「带金死亡」
- **如果想要走势条实时刷新**，需要把 CCT 的「暂停死亡追踪」设为**关**（开着的时候 CCT 不记录房间尝试）

> v0.3.1 是内部重构 + 文档补充，**没有用户可见的变化**（计时逻辑收敛到 `Timing.js`，主循环拆成六步管道）。
> 详见 [Release notes](docs/release-notes-v0.3.1.md)。
>
> v0.3.0 新增了**一命挑战模式（带金 / 带银）**，并重做模糊层，修了一批动画与数据刷新的问题。
> 详见 [Release notes](docs/release-notes-v0.3.0.md)。
>
> v0.2.0 集中修复了此前 README 列出的 6 个计时 bug（保存退出、重新开始此章节、
> 返回地图选不保存进度、换图时间虚高等）。详见 [Release notes](docs/release-notes-v0.2.0.md)。
## 进阶

下面这些是**想折腾的时候才需要**的，正常用不到。

| 内容 | 在哪 |
| --- | --- |
| 排查工具（抓数据用） | [`tools/`](tools/) —— 见 [tools/README.md](tools/README.md) |
| CCT 接口速查（字段名 / 单位 / 坑） | [`docs/cct-api-notes.md`](docs/cct-api-notes.md) |
| 历史版本说明 | [`docs/release-notes-*.md`](docs/) |

### 自己编译 LevelWatcher

需要 .NET 8 SDK。把 `LevelWatcher` 文件夹放进 `<Celeste 安装目录>\Mods\` 后：

```bash
cd <Celeste 安装目录>\Mods\LevelWatcher\Source
dotnet build
```

编译产物会自动复制到 `LevelWatcher\bin\`。Release 配置下还会额外打包出 `LevelWatcher.zip`：

```bash
dotnet build -c Release
```

如果不想把项目放进 Mods 目录，也可以手动指定蔚蓝的安装路径：

```bash
dotnet build -p:CelestePrefix="D:\Steam\steamapps\common\Celeste"
```

---

## 致谢

- [Everest] —— 蔚蓝的 Mod 加载器与 API，本工具运行的基础
- [ConsistencyTracker] —— 数据来源。没有它，本工具无法得知房间列表与逐房间的死亡 / 用时

## 声明

- 本工具是独立开发的第三方覆盖层，与 Celeste、Everest、ConsistencyTracker 官方无关。
- 本仓库**不包含**任何第三方 Mod 的代码或资源。ConsistencyTracker 的版权归其作者 viddie 所有，需自行安装。
- 安装时会覆盖 ConsistencyTracker 自带的同名覆盖层文件，覆盖前请先备份。

## 许可

[MIT](LICENSE) © L_FLA5H

<!-- 引用式链接的定义（正文里用 [Everest] / [ConsistencyTracker] 引用） -->
[Everest]: https://github.com/EverestAPI/Everest
[ConsistencyTracker]: https://github.com/viddie/ConsistencyTrackerMod
