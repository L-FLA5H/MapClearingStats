// ===== CCT 接口 =====
const CCT_BASE = "http://localhost:32270";
const LEVEL_WATCHER = "http://localhost:32271/";
const TICK_MS = 500;
const STORAGE_KEY = "mcs_session_v32";
const CHAPTERS_KEY = "mcs_chapters_v1";  // 按章节保存历史
const MANY_CP_THRESHOLD = 6;
const FREEZE_DURATION = 1000;
const TRANSITION_DURATION = 900;

// ===== 持久化存储 =====
// ⚠️⚠️ 原来用的是 sessionStorage —— 它的定义就是「关掉标签页就清空」，
// 所以关掉覆盖层网页 / 关掉游戏、第二天再开，数据全丢。
// 想要跨天保留必须用 localStorage（它才是「关掉浏览器也还在」）。
// 这里做一层适配：优先 localStorage，不可用时回落 sessionStorage，
// 保证在文件协议受限等环境下也不至于直接报错崩掉。
const store = (() => {
    try {
        const probe = "__mcs_probe__";
        localStorage.setItem(probe, "1");
        localStorage.removeItem(probe);
        return {
            get: k => localStorage.getItem(k),
            set: (k, v) => localStorage.setItem(k, v),
            remove: k => localStorage.removeItem(k),
            kind: "localStorage",
        };
    } catch (e) {
        return {
            get: k => sessionStorage.getItem(k),
            set: (k, v) => sessionStorage.setItem(k, v),
            remove: k => sessionStorage.removeItem(k),
            kind: "sessionStorage",
        };
    }
})();

// 一次性迁移：把老的 sessionStorage 数据搬到新存储（如果还在的话）
(function migrateStorage() {
    if (store.kind !== "localStorage") return;
    try {
        [STORAGE_KEY, CHAPTERS_KEY].forEach(k => {
            const old = sessionStorage.getItem(k);
            if (old && !localStorage.getItem(k)) {
                localStorage.setItem(k, old);
            }
        });
    } catch (e) {}
})();


const ROW_SIZE_MANY = 5;
const ROW_SIZE_SINGLE = 20;
const SINGLE_ORPHAN_MAX = 5;
const MANY_ORPHAN_MAX = 2;

// ===== 调试开关：排查计时问题时用，发布版为 false =====
const DEBUG = false;

// 日志同时输出到：① 浏览器控制台  ② 页面右侧的调试面板（不依赖控制台，可截图/复制）
const DEBUG_LOG = [];
const DEBUG_LOG_MAX = 600;

function pushLog(line) {
    const d = new Date();
    const ts = pad(d.getHours(), 2) + ":" + pad(d.getMinutes(), 2) + ":" + pad(d.getSeconds(), 2)
             + "." + pad(d.getMilliseconds(), 3);
    DEBUG_LOG.push(ts + "  " + line);
    if (DEBUG_LOG.length > DEBUG_LOG_MAX) DEBUG_LOG.shift();
    renderDebugPanel();
}

function renderDebugPanel() {
    if (!DEBUG || !document.body) return;
    let panel = document.getElementById("mcs-debug");
    if (!panel) {
        panel = document.createElement("div");
        panel.id = "mcs-debug";
        panel.style.cssText =
            "position:fixed;right:0;top:0;bottom:0;width:460px;box-sizing:border-box;"
            + "background:rgba(8,8,10,0.96);color:#e6e6e6;"
            + "font:11px/1.55 Consolas,'Courier New',monospace;"
            + "display:flex;flex-direction:column;"
            + "z-index:99999;user-select:text;"
            + "border-left:1px solid rgba(255,255,255,0.18);";

        const bar = document.createElement("div");
        bar.style.cssText =
            "flex:0 0 30px;box-sizing:border-box;"
            + "display:flex;align-items:center;gap:6px;padding:0 8px;"
            + "background:rgba(32,32,36,0.98);border-bottom:1px solid rgba(255,255,255,0.14);";

        const title = document.createElement("span");
        title.textContent = "MCS 调试日志";
        title.style.cssText = "color:#f1c40f;font-weight:bold;flex:1;";
        bar.appendChild(title);

        const mkBtn = (label, fn) => {
            const b = document.createElement("button");
            b.textContent = label;
            b.style.cssText = "font:11px Consolas,monospace;padding:2px 7px;cursor:pointer;";
            b.onclick = fn;
            bar.appendChild(b);
            return b;
        };

        mkBtn("标记", () => pushLog("────────  手动标记  ────────"));
        mkBtn("清空", () => { DEBUG_LOG.length = 0; renderDebugPanel(); });
        mkBtn("抓 CCT", async () => {
            try {
                const st = await fetchJson("/cct/state");
                pushLog("────────  CCT state 快照  ────────");
                pushLog("  顶层字段: " + Object.keys(st).join(", "));
                pushLog("  chapterName = " + JSON.stringify(st.chapterName));
                const cr = st.currentRoom || {};
                pushLog("  currentRoom 字段: " + Object.keys(cr).join(", "));
                pushLog("  currentRoom = " + JSON.stringify(cr).slice(0, 420));
                const rest = Object.assign({}, st);
                delete rest.currentRoom;
                pushLog("  其余字段 = " + JSON.stringify(rest).slice(0, 420));
                const p = await fetchJson("/cct/currentChapterPath");
                pushLog("  path.errorCode = " + p.errorCode
                      + "   checkpoints = "
                      + ((p.path && p.path.checkpoints) ? p.path.checkpoints.length : "无"));
            } catch (e) {
                pushLog("抓 CCT 失败: " + e.message);
            }
        });
        mkBtn("复制全部", (e) => {
            const ta = document.createElement("textarea");
            ta.value = DEBUG_LOG.join("\n");
            ta.style.cssText = "position:fixed;left:-9999px;top:0;";
            document.body.appendChild(ta);
            ta.select();
            let ok = false;
            try { ok = document.execCommand("copy"); } catch (err) {}
            document.body.removeChild(ta);
            e.target.textContent = ok ? "已复制" : "请手动选中";
            setTimeout(() => { e.target.textContent = "复制全部"; }, 1500);
        });

        panel.appendChild(bar);

        const body = document.createElement("div");
        body.id = "mcs-debug-body";
        body.style.cssText =
            "flex:1 1 auto;overflow-y:auto;padding:8px 10px;"
            + "white-space:pre-wrap;word-break:break-all;";
        panel.appendChild(body);
        document.body.appendChild(panel);
    }
    const body = document.getElementById("mcs-debug-body");
    if (body) {
        body.textContent = DEBUG_LOG.join("\n");
        body.scrollTop = body.scrollHeight;   // 只滚日志区，按钮栏固定不动
    }
}

function dlog(tag, data) {
    if (!DEBUG) return;
    console.log("[MCS] " + tag, data === undefined ? "" : data);
    let extra = "";
    if (data !== undefined) {
        extra = (typeof data === "string") ? "  " + data : "  " + JSON.stringify(data);
    }
    pushLog(tag + extra);
}

function dstate(label) {
    if (!DEBUG) return;
    const now = Date.now();
    const s = session;
    console.log("[MCS] ══════ " + label + " ══════", {
        "时刻": new Date(now).toLocaleTimeString() + "." + String(now % 1000).padStart(3, "0"),
        "章节": s.chapterName,
        "上次房间": s.lastRoom,
        "总用时(秒)": s.startTime ? +((now - s.startTime) / 1000).toFixed(3) : null,
        "进本房时刻": s.currentRoomEnterTime || null,
        "本房已待(秒)": +Timing.currentRoomStaySec(s, Timing.nowMs(s)).toFixed(3),
        "已结算房间用时": JSON.parse(JSON.stringify(s.roomTimes || {})),
        "房间死亡数": JSON.parse(JSON.stringify(s.roomDeaths || {})),
        "暂停中": s.isPaused,
        "暂停开始": s.pauseStartTime || null,
    });
    pushLog("───────── " + label + " ─────────");
    pushLog("  章节=" + (s.chapterName || "(空)")
          + "   上次房=" + (s.lastRoom || "(空)")
          + "   总用时=" + (s.startTime ? ((now - s.startTime) / 1000).toFixed(2) + "s" : "null"));
    pushLog("  进本房=" + (s.currentRoomEnterTime ? Timing.currentRoomStaySec(s, Timing.nowMs(s)).toFixed(2) + "s前" : "null")
          + "   暂停中=" + s.isPaused
          + "   暂停开始=" + (s.pauseStartTime ? new Date(s.pauseStartTime).toLocaleTimeString() : "0"));
    pushLog("  roomTimes=" + JSON.stringify(s.roomTimes || {}));
    pushLog("  roomDeaths=" + JSON.stringify(s.roomDeaths || {}));
}

let session = loadSession();

let lastShownTotalDeaths = 0;
let lastShownRoomDeaths = 0;
// 「第二张卡片右格」上一帧显示的数值。
// 初见模式是毫秒计时（小数），一命模式是连续成功次数（整数），共用一个比较基准，
// 用来判断「数值涨了」并播一次 bump 放大动画。
let lastShownRoomTimeValue = 0;
// 第二张卡片上一帧渲染时的房间名与模式。
// ⚠️ 这两个是「要不要重绘第二张卡片」的判据 ——
// renderRoomInfo 原来只在换房间时被调用，导致「在同一个房间拿起金草莓」
// 不会更新卡片。现在模式变化也会让它重绘（见 tick 里的 goldenChanged 分支）。
let lastRoomInfoRoom = "";
let lastRoomInfoGolden = false;
let lastShownRoom = "";
let lastShownCpIndex = -1;
let lastSectionsSignature = "";
let lastOutsideText = "";

let transition = null;
let displayedRoomDeaths = 0;
let displayedRoomTimeSec = 0;
let lastSceneType = null;
// 已通过的面数（用于算「平均死亡 / 平均用时」），由 renderSections 更新
let lastPassedRooms = 0;
// 每个方格上一帧的颜色，用来判断「刚刚被攻克」并播放爆闪
let lastBlockColors = {};
let deathFlashTimer = null;      // 死亡红光的收尾定时器
let sectionsSwapTimer = null;    // 小节切换时「旧元素淡出 → 再重建」的定时器
let cardHeightTimer = null;      // 卡片高度缓动的收尾定时器
// 已经播过入场动画的小节（cpIndex）。从 A → B → 回到 A 时不该重播。
let animatedCps = {};
// 百分比数字的缓动状态
let displayedPct = 0;
let pctAnimFrame = null;
let pctSnapTimer = null;
// 区分「退出地图后重进」和「重新开始此章节」：
//   进图前如果经过主页面(Overworld) → 是退出重进；没经过 → 是游戏内重开章节。
// transitionSeen 用来防止页面刚加载时误判（那时还没观察到任何场景切换）。
let sawOverworld = false;
let transitionSeen = false;
let pendingChapterRestart = false;
// 恢复历史后，暂存「上次离开时所在的房间」，等拿到当前房间再判断进度有没有被重置
let pendingResumeRoom = null;
// 走势条：当前显示的是哪个房间 + 已经渲染了多少个点
// （用来判断「有没有新的一次尝试」，只有新增才播弹出动画）
let lastStreakRoom = "";
let lastStreakCount = -1;
// 走势点序列的内容签名（如 "0011011"）。
// ⚠️ 必须比对内容，不能只比对数量 —— 见 renderStreak 里的说明。
let lastStreakSig = "";
// 重开章节 / 重新初始化后，强制 renderRoomInfo 重绘一次。
// ⚠️ 小闪：「在第一面重开章节时，死亡数会有残留清不空」。
//    根因：initSession 把 session.roomDeaths 清成 {}、lastShownRoomDeaths 也归 0，
//    于是 renderRoomInfo 的判据「房间没变 + 模式没变 + 死亡数没变」全部为假 →
//    **直接 return，DOM 里还留着旧数字**。
//    注意 displayedRoomDeaths 其实已经归 0 了，只是没人去写 DOM。
let forceRoomInfoRefresh = false;
// ⚠️⚠️ 刚重开章节 / 刚初始化后，detectDeaths 第一次只**记录基准**、不计数。
//    小闪：「先在第一面自杀一次，重新开始章节，还是会有一次死亡，没清空」。
//    根因：重开时 initSession 把 lastCurDeaths 清成 {}，
//    但 CCT 那边的 deathsInCurrentRun 还是**重开前那个值**（比如 1）。
//    于是 detectDeaths 看到 1 > 0 → delta=1 → 把这个「旧死亡」又加回去了。
//    所以重开后第一次检测必须只记基准。
let seedDeathsOnly = false;

// ===== 一命挑战（带金 / 带银）模式判定 =====
//
// ⚠️ 时序（这是整个功能的前提，别搞反）：
//   进图  →  走到开头  →  【拿下金草莓】或【不拿】  →  才知道是不是一命挑战
//   金草莓就在章节开头，拿了才是一命，不拿就是普通推图练习。
//   所以**不能**在「进图瞬间」判断 —— 那时玩家根本还没做选择。
//
// 实测（2026-09-15 探针日志）：
//   - goldenType 只在「已经拿下草莓」后才变成 1/2，有滞后；
//     在 ZZ-HeartSide 全程是 0，即使玩家 21:31:12 就拿起草莓了
//   - playerIsHoldingGolden 是**实时**的：拿起变 true、死亡落地变 false
//   → 所以：**以 playerIsHoldingGolden 的 false→true 跳变作为「已经拿了」的触发信号**，
//     再顺手记下 goldenType 作为金银区分。
//
// ⚠️ 关于「粘滞」：之前做的是「一旦开启就保持到换章节」，
// 目的是防止死亡掉草莓时布局闪回初见。但实测下来小闪觉得不对 ——
// 死亡掉草莓之后就应该退出带金状态（那一局已经结束了）。
// 所以现在改成**严格跟随 holdingGolden**：
//   holding=true  → 带金/带银布局
//   holding=false → 回到初见布局
// 死亡后玩家重新拿起草莓时，会再次切进带金布局（靠动画过渡，不会生硬）。
//
// 但有一个必须保留的例外：**死亡瞬间的短暂掉草莓**。
// 玩家撞刺死亡 → 草莓掉出去 → 但马上又走到开头拿起，
// 这个过程如果布局来回切会很花。用一个短冷却窗口吸收掉：
// 掉草莓后 N 毫秒内若重新拿起，视作同一次挑战，不退出也不重播动画。
// ===== CctClient：CCT 数据格式的唯一口径 =====
//
// CCT 的字段名、goldenType 的反直觉映射、抓占位符的坑——这些「格式知识」
// 以前散在主代码各处，还在 tools/cct-dump.js 里抄了一份。现在全部收进这个对象。
//
// 本区的规矩（tools 和测试靠这个约定工作）：
//   · **纯函数、零 DOM、零外部引用**（连 dlog 都不用）
//   · node 工具与测试按 BEGIN/END 标记切片求值复用（见 tools/cct-dump.js、
//     tools/check-cctclient.js）
//   · tools/diag.ps1 是给「没装 node 的用户」准备的诊断工具，刻意不依赖任何
//     JS，它的占位符表单独维护（PowerShell 无法加载 JS 模块）——改本区时请对照
// ==== CctClient BEGIN（切片标记，勿改此行）====
const CctClient = (function () {

    // ---- 占位符表 ----
    // ⚠️⚠️ 这几个占位符是**实测确认**的（2026-09-16 探针 + 直连 CCT）。
    //
    // ⚠️⚠️⚠️ 关键教训：CCT 的占位符表藏在 DLL 里，而且是 **UTF-16 编码**，
    //   用普通 strings / grep 搜不到。必须：
    //     strings -e l <dll> | grep -oE '\{[a-z]+:[a-zA-Z]+\}'
    //   一开始只从「CCT 自带覆盖层的默认格式串」里抄了一部分，
    //   结果把「进入率」错当成 {room:chokeRate}（那是**卡关率**），
    //   导致第一面的进入率显示 69.57% 而不是 100%。
    //
    // 实测对照（房间 a-02，带金通过 2 次 / 进入 11 次）：
    //   {room:goldenSuccessRate} = 18.18%  ← 带金成功率 = goldenSuccesses/goldenEntries
    //   {room:goldenSuccesses}   = 2       ← 带金通过数
    //   {room:goldenEntries}     = 11      ← 带金进入次数
    //   {room:goldenEntryChance} = 11.96%  ← **带金进入率**（草莓所在那面应为 100%）
    //   {room:chokeRate}         = 81.82%  ← 卡关率，**不是**进入率
    //   {run:currentPbStatusNumber} = "-"  ← 「局」要带 Number 后缀的版本

    // 覆盖层用（顺序即 requestGoldenStats / writeGoldenStats 里的下标含义，勿调换）：
    const GOLDEN_STATS_PLACEHOLDERS = [
        "{room:goldenSuccessRate}",          // 0 带金成功率
        "{room:goldenSuccesses}",            // 1 带金通过数
        "{room:goldenEntries}",              // 2 带金进入次数
        "{room:goldenEntryChance}",          // 3 带金进入率
        "{run:currentPbStatusNumber}",       // 4 局数（注意结尾的 Number）
        "{chapter:goldenDeaths}",            // 5 带金死亡（本章累计）
        "{chapter:goldenDeathsSession}",     // 6 带金死亡（本次会话）
    ];

    // 探针全量表（tools/cct-dump.js 用；diag.ps1 取其中 9 项子集、单独维护）：
    const PROBE_PLACEHOLDERS = [
        "{room:name}",
        "{room:debugName}",
        "{room:roomNumberInChapter}",
        "{room:goldenSuccessRate}",
        "{room:goldenSuccesses}",
        "{room:goldenEntries}",
        "{room:goldenEntryChance}",
        "{room:goldenEntryChanceSession}",
        "{room:chokeRate}",
        "{room:chokeRateSession}",
        "{checkpoint:chokeRate}",
        "{checkpoint:goldenSuccessRate}",
        "{run:currentPbStatusNumber}",
        "{run:currentPbStatusSessionNumber}",
        "{run:currentPbStatus}",
        "{room:goldenDeaths}",
        "{room:goldenDeathsSession}",
        "{chapter:goldenDeaths}",
        "{chapter:goldenDeathsSession}",
        "{room:successRate}",
        "{room:successes}",
        "{room:attempts}",
        "{room:currentStreak}",
        "{checkpoint:currentStreak}",
        "{chapter:roomCount}",
        "{pb:best}",
        "{pb:bestSession}",
    ];

    // ---- goldenType 映射 ----
    // CCT 的取值约定（据 DLL 里的 GoldenType 字段）：0 = 没拿 / 未确定，1 = 金，2 = 银。
    // ⚠️ 小闪反馈「带银时卡片没变银而是变金」—— 说明 CCT 报的 goldenType 可能一直是 0。
    //    所以做成**多来源 + 容错**：
    //      · 主来源 stats.chapterStats.goldenType
    //      · 备用 state.modState.goldenType（实测 modState 里没这个字段，
    //        但多读一处没有副作用，将来 CCT 补上了就能直接用）
    //      · 任何 > 1 的值都按银处理（万一 CCT 用 3 表示银）
    //
    // ⚠️⚠️ 映射关系是**实测**出来的（2026-09-16 探针日志），别再凭字段名猜：
    //     带银（Scroogle 章）      → goldenType = 1
    //     带金（ZZ-HeartSide 章）  → goldenType = 0
    //   而且它在**章节加载的那一刻就定下来了**（还没拿起草莓就已经是这个值），
    //   说明它是**章节级**属性，不是草莓级的。
    //   → 所以：0 = 金，非 0 = 银。
    // ⚠️ 之前写成「1 = 金、2 = 银」是错的，这正是小闪反馈
    //    「带银时卡片没变银而是变金」的根因。
    function goldenType(stats, state) {
        const a = (stats && stats.chapterStats) ? stats.chapterStats.goldenType : undefined;
        const b = (state && state.modState) ? state.modState.goldenType : undefined;
        const raw = (a !== undefined && a !== null) ? a
                  : (b !== undefined && b !== null) ? b
                  : 0;
        const n = Number(raw) || 0;
        const isSilver = (n !== 0);
        // 把两个来源的原始值一并带回，方便调用方打日志核对
        return { raw: n, isSilver, fromChapterStats: a, fromModState: b };
    }

    // ---- 快照归一化 ----
    // state.currentRoom / state.modState 的原始字段以前在 detectDeaths、
    // buildStreakAttempts、reconcileSession 等处各自直取；现在统一走这里，
    // null 安全，CCT 改字段名时只改这一处。
    // ⚠️ previousAttempts 实测**只在换房时刷新**（带金挑战期间连死 4 次，
    //    长度和内容完全不变）——覆盖层靠「实时增量」兜底（见 noteGoldenProgress）。
    function snapshot(state) {
        const room = (state && state.currentRoom) || {};
        const mod = (state && state.modState) || {};
        return {
            chapterName: (state && state.chapterName) || "",
            room: room.debugRoomName || "",
            holdingGolden: !!mod.playerIsHoldingGolden,
            trackingPaused: !!mod.deathTrackingPaused,
            deathsInCurrentRun: room.deathsInCurrentRun || 0,
            previousAttempts: Array.isArray(room.previousAttempts) ? room.previousAttempts : [],
            goldenBerryDeaths: room.goldenBerryDeaths || 0,
            goldenBerryDeathsSession: room.goldenBerryDeathsSession || 0,
            // streakBest 的历史基准（renderStreak 用）；streak 本身从拼好的序列末尾数
            successStreak: room.successStreak || 0,
            successStreakBest: room.successStreakBest || 0,
        };
    }

    return { goldenType, snapshot, GOLDEN_STATS_PLACEHOLDERS, PROBE_PLACEHOLDERS };
})();
// ==== CctClient END ====

let lastGoldenTypeRaw = null;
function readGoldenType(stats, state) {
    const gt = CctClient.goldenType(stats, state);

    if (lastGoldenTypeRaw !== gt.raw) {
        lastGoldenTypeRaw = gt.raw;
        dlog("◆ goldenType = " + gt.raw + "（按" + (gt.isSilver ? "银" : "金") + "渲染）"
             + "｜chapterStats=" + gt.fromChapterStats + " · modState=" + gt.fromModState);
    }

    // 归一化：金返回 0，银返回 2（上层用 `=== 2` 判银）
    return gt.isSilver ? 2 : 0;
}

// ==== GoldenMode BEGIN（切片标记，勿改此行）====
// 一命挑战的三个状态（normal / gold / silver），以及「每个状态下各处该怎么表现」。
//
// ⚠️ 为什么要这张表：原来用一个布尔 goldenModeOn 表示「是否在挑战中」，
//    金/银另由另一个变量承载 —— 状态被拆成两处表达，而「这个模式下我该怎样」的
//    知识又散在 8 个渲染函数里各自写 if。想加第四种模式，就得把这 8 处逐个找出来，
//    漏掉任何一处，画面就会出现「半新半旧」的怪状态。现在统一改成查表。
//
// ⚠️⚠️ 下面两个字段是**从真实 bug 换来的约束**，它们的注释里的故事不能丢：
//    hideRoomInfoRow     —— 一命模式下 .room-info-row 必须**无条件**隐藏。
//                           曾在这里加过「没走势数据就把这行放出来」的兜底，
//                           结果小闪反馈「带银时第二张卡片显示的是本面死亡和本面用时」——
//                           兜底把正确的布局顶掉了。
//    streakKeepWhenEmpty —— 一命模式下走势条即使没数据也要**保留整条**（同样画满 20 个空位）。
//                           换成一行文字会让这一行宽度跳动，而且第二张卡片会空白。
//    这两条都在 tools/check-goldenmode.js 里锁着，改成 false 测试会红。
//
// 表是**纯数据**（零 DOM、零外部引用），tools/check-goldenmode.js 按标记切片求值来单测。
const GOLDEN_MODE = {
    // ---- 初见推图（原来那些 if (!goldenModeOn) 的分支）----
    normal: {
        name: "normal",
        challenge: false,            // 是否处于一命挑战
        isSilver: false,             // 金/银（原来散落的 goldenTypeCache === 2）
        usesGoldenStats: false,      // 要不要拉 CCT 的成功率/进入率/局数
        usesStreak: false,           // 要不要走势条（初见用不到 previousAttempts）
        streakKeepWhenEmpty: false,
        hideRoomInfoRow: false,      // ⚠️ 见上方约束说明
        writesLegacyTimers: true,    // 「总用时 / 本面用时」两格由 timerLoop 写
        // 下面四个文案字段 normal 用不到，**故意留空**：
        // 万一哪天有代码在初见模式下读到它们，会立刻显出一个空字符串，而不是
        // 悄悄显示「带金」这种错文案。
        badgeText: "",
        label: "",
        rateLabel: "",
        deathWord: "",
    },
    // ---- 带金挑战 ----
    gold: {
        name: "gold",
        challenge: true,
        isSilver: false,
        usesGoldenStats: true,
        usesStreak: true,
        streakKeepWhenEmpty: true,   // ⚠️ 别改成 false
        hideRoomInfoRow: true,       // ⚠️ 别改成 false
        writesLegacyTimers: false,   // 一命模式下那两块是隐藏的，写了也看不见
        badgeText: "带金",
        label: "带金",
        rateLabel: "带金成功率",
        deathWord: "带金死亡",
    },
    // ---- 带银挑战 ----
    silver: {
        name: "silver",
        challenge: true,
        isSilver: true,
        usesGoldenStats: true,
        usesStreak: true,
        streakKeepWhenEmpty: true,   // ⚠️ 别改成 false
        hideRoomInfoRow: true,       // ⚠️ 别改成 false
        writesLegacyTimers: false,
        badgeText: "带银",
        label: "带银",
        rateLabel: "带银成功率",
        deathWord: "带银死亡",
    },
};

// 按名字取模式；名字非法/为空一律退回 normal（不因为一个字符串就把整页搞挂）
function goldenModeByName(name) {
    return GOLDEN_MODE[name] || GOLDEN_MODE.normal;
}
// ==== GoldenMode END ====

let goldenModeChapter = null;   // 当前判定的章节名
// 此刻处于哪个模式：normal / gold / silver
// ⚠️ 存**名字**而不是对象引用：各处统一用 curGoldenMode() 取配置，
//    避免出现「变量和表里某一行指向不同对象」这种失同步。
// ⚠️ 唯一的写入点是 updateGoldenMode()，别在别处改它。
let goldenModeName = "normal";
function curGoldenMode() { return goldenModeByName(goldenModeName); }
let goldenDropAt = 0;           // 最近一次「掉草莓」的时间戳（用于冷却窗口）
// 冷却窗口：掉草莓后这段时间内重新拿起，视作同一次挑战。
// ⚠️ 原来是 2500ms，小闪反馈「带金死了之后，卡片会过一段时间才回归正常」。
//    现在死亡有专门的即时退出通道（见 GOLDEN_DEATH_HOLD_MS），
//    这个窗口只负责「非死亡的意外掉草莓」，所以缩短到 500ms 就够。
const GOLDEN_DROP_GRACE_MS = 500;

// 「带金挑战期间死亡」的时间戳，以及它的作用时长。
//
// ⚠️⚠️ 为什么需要这个：CCT 的 playerIsHoldingGolden 是**滞后**的 ——
// 实测日志（2026-09-16 11:58）：
//     11:58:23.930  本命死亡 0 → 1        ← 死亡事件在这里就到了
//     11:58:25.193  手持金草莓 → 否        ← 手持标志 1.26 秒后才翻过来
// 如果只等手持标志翻 false 才退出，卡片就会「过一段时间」才回正常 ——
// 正是小闪抱怨的那 1 秒多。所以改成：**死亡事件一到就立刻退出**，
// 并用这个时间戳在那 1.26 秒里挡住「手持标志还是 true → 又切回带金」的抖动。
let goldenDiedAt = 0;
const GOLDEN_DEATH_HOLD_MS = 2500;   // 死亡后这段时间内不允许重新进入带金状态

// 「本次挑战用时」的自算累积器。
// CCT 的 timeSpentInRoomInRuns 是**单房间**累计，而且换个存档/重开就重置；
// 想要「这一轮一命挑战总共打了多久」，只能自己边打边攒。
let goldenRunSec = 0;
let goldenRunTickAt = 0;

// 每 tick 调用。返回 true 表示「模式刚发生变化，需要重绘 + 播切换动画」。
function updateGoldenMode(chapterName, goldenType, holdingGolden, diedNow) {
    // 换章节 → 重置，重新等这一次的「拿起草莓」
    if (chapterName !== goldenModeChapter) {
        goldenModeChapter = chapterName;
        goldenModeName = "normal";
        goldenDropAt = 0;
        goldenDiedAt = 0;
        goldenRunSec = 0;
        goldenRunTickAt = 0;
    }

    const gt = goldenType || 0;
    const now = Date.now();
    let changed = false;
    // gt 已被 readGoldenType 归一化成 0=金 / 2=银
    const seenMode = (gt === 2) ? "silver" : "gold";
    // ⚠️「在不在挑战中」一律问当前模式对象，不再直接读变量
    const inChallenge = curGoldenMode().challenge;

    // 带金挑战期间死亡 → 记下时刻。这一局已经结束了。
    // ⚠️ 只在「本来就在带金状态」时记录 —— 初见练习时的死亡跟一命挑战无关，
    //    不该挡住之后拿起草莓进入带金状态。
    if (diedNow && inChallenge) goldenDiedAt = now;

    // 死亡后的一小段「锁定期」：CCT 的手持标志要 1 秒多才翻 false，
    // 这期间必须挡住重新进入，否则会「退出 → 又进去」闪一下。
    const diedRecently = (goldenDiedAt > 0) && (now - goldenDiedAt < GOLDEN_DEATH_HOLD_MS);

    if (holdingGolden && !diedRecently) {
        // ---- 拿着草莓 ----
        if (!inChallenge) {
            const isRePick = (goldenDropAt > 0) && (now - goldenDropAt < GOLDEN_DROP_GRACE_MS);
            // 刚拿起时 gt 常常还是 0（CCT 那边还没算出来）→ 先按金起手，
            // 等下面「金/银后补」拿到 2 再换成银。与原来的行为一致。
            goldenModeName = seenMode;
            changed = true;
            dlog(isRePick
                ? "◆ 冷却窗口内重新拿起草莓 → 回到一命布局"
                : "◆ 拿起金草莓 → 切到一命挑战布局（goldenType=" + gt + "）");
        }
        goldenDropAt = 0;   // 拿着就清掉冷却计时
    } else {
        // ---- 没拿草莓，或者刚死 ----
        if (inChallenge) {
            if (diedRecently) {
                // 死亡 → **立刻**退出，不等冷却窗口。
                // 小闪：「带金死了之后，卡片会过一段时间才回归正常」——
                // 一命挑战里死了这一局就结束了，没有任何理由再等 1 秒多。
                // ⚠️ 日志用当前模式的文案再改状态 —— 原来是写死的「带金」，
                //    带银的时候打出来是错的。
                dlog("◆ " + curGoldenMode().deathWord + " → 立刻退出挑战状态，回到初见布局");
                goldenModeName = "normal";
                goldenDropAt = now;
                changed = true;
            } else if (goldenDropAt === 0) {
                goldenDropAt = now;
                dlog("◆ 草莓掉落 → 进入 " + (GOLDEN_DROP_GRACE_MS / 1000) + " 秒冷却窗口");
            } else if (now - goldenDropAt >= GOLDEN_DROP_GRACE_MS) {
                // 非死亡的意外掉草莓：等冷却窗口过完再退出
                dlog("◆ 冷却窗口结束仍未拿起 → 退出" + curGoldenMode().label + "状态，回到初见布局");
                goldenModeName = "normal";
                changed = true;
            }
        }
    }

    // 金/银类型后补：拿到非 0 的 goldenType 后修正模式（配色和文案都跟着换）
    if (goldenModeName !== "normal" && gt !== 0 && goldenModeName !== seenMode) {
        goldenModeName = seenMode;
        changed = true;
        dlog("◆ 金/银已确定 → goldenType=" + gt + "（" + (gt === 2 ? "银" : "金") + "）");
    }

    return changed;
}


// ===== 加载时的一次性入场动画 =====
// CSS 里入场动画挂在 #app.boot 上（见 CSS 里 `.top-card` 那段的注释）。
// 为什么要挪到标记类上、还必须在播完后摘掉：
//   常驻的 `.top-card { animation: cardIn }` 会和新加的
//   `#app.golden-enter .card { animation: goldenCardIn }` 抢 animation-name，
//   导致「一命切换时整面板弹一下」这个动画被顶掉、根本不播（实测验证过）。
//   摘掉 .boot 之后卡片上就没有 animation 了，切换动画才能干净生效。
//
// ⚠️ 别用 animationend 摘 —— 卡片有动画延迟，三张卡各发一次事件不好对齐；
//    而且万一动画被跳过（比如窗口没渲染）事件可能不来，标记会永远留着。
//    用固定定时器最稳：最晚的一张是 0.18s 延迟 + 0.55s 时长 = 0.73s，取 1.2s 富余。
function bootIn() {
    const app = document.getElementById("app");
    if (!app) return;
    app.classList.add("boot");
    setTimeout(() => app.classList.remove("boot"), 1200);
}

document.addEventListener('DOMContentLoaded', () => {
    renderDebugPanel();
    // 调试面板占住右侧，把覆盖层往左推，避免互相遮挡
    const app = document.getElementById("app");
    if (app && DEBUG) {
        app.style.marginLeft = "auto";
        app.style.marginRight = "500px";
    }
    pushLog("=== MCS 调试日志已启动（页面右侧面板）===");

    // ⚠️⚠️ 落盘的两道保险。
    // 小闪反馈「保存并退出后关掉蔚蓝和覆盖层，回来再打开没有保存到本面死亡数据」。
    // 原来的存档只在「死亡 / 换房 / 换章节」这些事件上触发，
    // 如果关窗口时正好处在两次事件之间，最后那段数据就丢了。
    //   ① 页面关闭前存一次
    //   ② 每 12 秒定期存一次（防 beforeunload 在某些情况下不触发）
    window.addEventListener("beforeunload", function () {
        saveSession();
        saveChapterHistory();
    });
    setInterval(function () {
        saveSession();
        saveChapterHistory();
    }, 12000);

    // 启动时把「恢复到了什么」记一条日志 —— 排查「关了再开数据丢了」时，
    // 先看这条就能分清是「没存进去」还是「存了没读出来」。
    const nDeaths = Object.keys(session.roomDeaths || {}).length;
    dlog("◆ 启动恢复：章节=" + (session.chapterName || "(空)")
         + " · 房间死亡记录=" + nDeaths + " 个"
         + (nDeaths ? " " + JSON.stringify(session.roomDeaths) : ""));

    bootIn();
    setInterval(tick, TICK_MS);
    requestAnimationFrame(timerLoop);
    tick();
});

// ===== tick 主循环：按顺序走完下面六步 =====
//
// ⚠️ 顺序不能乱，原因如下（以前靠注释守着，现在由函数结构固定）：
//   ① 一命模式翻转必须**立刻**换布局（不等 1.5 秒节流），所以判定排在渲染之前；
//   ② 上半渲染（头部 / 走势条）必须排在「房间切换结算」之前 ——
//      结算会改 roomTimes 与 transition，先渲染才能拿到翻转前的布局做动画过渡；
//   ③ 「结算」必须排在「恢复计时」之后 —— resumeTimer() 会把进房时刻往后推
//      来补偿暂停，顺序反了就会把暂停时长算进上一面。
//
//   pollScene → reconcileSession → resolveGoldenMode / renderUpper
//            → locateRoom → settleTiming → renderLower
async function tick() {
    // ① 看场景：现在人在关卡里吗
    const scene = await pollScene();
    if (!scene.inLevel) {
        handleOutsideLevel(scene.sceneType);
        return;
    }

    // ② 拉 CCT 数据 → 对齐会话（重开 / 换章 / 恢复历史 / 进度有没有保留）
    const data = await readCct();
    if (!data) return;
    const ctx = reconcileSession(data.state, data.path);

    // ③ 判定一命模式 + 上半渲染
    const mode = resolveGoldenMode(data.state, data.stats, ctx.currentRoom);
    renderUpper(data.state, data.stats, ctx.hasPath, ctx.currentRoom,
                mode.diedNow, mode.goldenChanged);

    // ④ 定位当前房间（没有录制路径、或不在路径上时，内部会处理渲染并放弃后续步骤）
    const place = locateRoom(data.path, ctx.currentRoom, ctx.hasPath);
    if (!place) return;

    // ⑤ 结算时间：补偿暂停 → 结算上一面 → 记下进本房时刻
    settleTiming(ctx.currentRoom);

    // ⑥ 下半渲染：房间信息卡 + 小节进度
    renderLower(data.path, data.state, ctx.hasPath, ctx.currentRoom,
                place.cpIndex, place.roomIndex, place.cp);
}

// ① 从 LevelWatcher 读当前场景
async function pollScene() {
    let inLevel = false;
    let sceneType = "";
    let gamePaused = false;
    try {
        const lw = await fetchJsonFrom(LEVEL_WATCHER);
        sceneType = lw.sceneType || "";
        inLevel = (sceneType === "Celeste.Level");
        // ⚠️ 游戏内的暂停菜单**不会改变场景类型**（还是 Celeste.Level），
        //    所以原来检测不到「暂停」，计时会继续跑。
        //    小闪：「暂停游戏不会使计时也暂停」。
        //    现在 LevelWatcher 额外暴露了 paused 字段（暂停或冻结时为 true）。
        //    老版本 LevelWatcher 没有这个字段 → undefined → false，
        //    退化成原来的行为，不会更糟。
        gamePaused = (lw.paused === true);
    } catch (e) {
        inLevel = false;
    }

    // ⚠️⚠️ 「游戏内暂停也让计时停住」这个改动**已经撤销**（2026-09-16）。
    //    小闪：「蔚蓝的暂停本来就是不停止计时器的，我根本没必要做这个」。
    //    也就是说游戏自己的计时在暂停期间照常走，覆盖层跟着走才是对的 ——
    //    强行停表反而和游戏对不上。
    //    LevelWatcher 那边仍然暴露 paused 字段（不占地方，将来要用可以直接读），
    //    但覆盖层这里不再据此停表。

    // 场景切换追踪：正式功能，与 DEBUG 无关（dlog/dstate 内部自己判断要不要打印）
    if (sceneType !== lastSceneType) {
        lastSceneType = sceneType;

        if (sceneType === "Celeste.Overworld") sawOverworld = true;
        if (sceneType === "Celeste.LevelExit") { sawOverworld = false; transitionSeen = true; }
        if (sceneType === "Celeste.Level") {
            if (transitionSeen) {
                pendingChapterRestart = !sawOverworld;
                dlog("进图 | 距上次离开关卡期间"
                     + (sawOverworld
                        ? "【经过了】主页面 → 退出地图后重进（保留数据）"
                        : "【没有经过】主页面 → 重新开始此章节（会清零）"));
            } else {
                pendingChapterRestart = false;
                dlog("进图 | 没观察到「关卡退出」（页面刚加载，或从大厅/编辑器直接进入），跳过重开判断");
            }
            transitionSeen = false;
            sawOverworld = false;
        }

        dlog("场景变化 → " + (inLevel ? "【在关卡内】" : "【不在关卡内】") + " " + sceneType);
        dstate("场景变化");
    }

    return { inLevel, sceneType, gamePaused };
}

// ① 的出口之一：不在关卡内 → 存档、停表、显示状态卡
function handleOutsideLevel(sceneType) {
    // 不在关卡内：保存当前章节数据到历史
    if (session.chapterName) {
        saveChapterHistory();
    }
    pauseTimer();
    showStatusCard(getStatusText(sceneType));
    saveSession();
}

// ② 拉 CCT 的三个接口；拿不到就放弃这一轮
async function readCct() {
    let state, path, stats;
    try {
        state = await fetchJson("/cct/state");
        path  = await fetchJson("/cct/currentChapterPath");
        stats = await fetchJson("/cct/currentChapterStats");
    } catch (e) {
        showStatusCard("CCT 未响应");
        pauseTimer();
        return null;
    }
    return { state, path, stats };
}

// ② 对齐会话：处理「重开本章」「换章节」「进度没保留」三种情况
function reconcileSession(state, path) {
    const chapterName = state.chapterName || "";
    const hasPath = path.errorCode === 0 && path.path && path.path.checkpoints && path.path.checkpoints.length > 0;

    // 「重新开始此章节」：同一张图 + 进图时没经过主页面 → 整张图从头算
    if (pendingChapterRestart) {
        pendingChapterRestart = false;
        if (session.chapterName && session.chapterName === chapterName) {
            dlog("⟲ 重新开始此章节 → 用时、死亡数、房间进度全部清零");
            dstate("清零前");
            initSession(chapterName, path.path);
            saveChapterHistory();   // 把历史也覆盖成清空后的状态
            dstate("清零后");
        }
    }

    // 章节变化：优先从历史恢复，没有才新建
    if (session.chapterName !== chapterName) {
        dlog("★ 章节变化: 「" + session.chapterName + "」 → 「" + chapterName + "」");
        dstate("章节变化-改之前");
        if (session.chapterName) saveChapterHistory();
        const restored = loadChapterHistory(chapterName);
        if (restored) {
            dlog("  → 从历史恢复了这张图的数据");
            session = restored;
            pendingResumeRoom = restored.resumedFromRoom || null;
            saveSession();
        } else {
            dlog("  → 没有历史，新建会话（计时归零）");
            initSession(chapterName, path.path);
        }
        dstate("章节变化-改之后");
    }

    const currentRoom = CctClient.snapshot(state).room;

    // 「返回地图时进度没保留」检测：
    // 走「返回地图」这条路时章节名会先变成大厅再变回来，所以必然会经过 loadChapterHistory。
    // 如果游戏保留了进度，重进时会把你放回**离开时所在的那个房间**（respawn point）；
    // 只要重进后不在那个房间，就说明进度没保留（选了不保存，或从 checkpoint 传送门跳着进）。
    // （走「保存并退出」时章节名不变，根本不会走到这里，所以不会误判）
    if (pendingResumeRoom) {
        const prevRoom = pendingResumeRoom;
        pendingResumeRoom = null;
        if (currentRoom && currentRoom !== prevRoom) {
            dlog("⟲ 进度没保留（上次离开在「" + prevRoom + "」，这次却从「"
                 + currentRoom + "」开始）→ 用时、死亡数、房间进度全部清零");
            dstate("清零前");
            initSession(chapterName, path.path);
            saveChapterHistory();
            dstate("清零后");
        } else {
            dlog("ℹ 从历史恢复数据（上次离开在「" + prevRoom + "」，这次也在「"
                 + currentRoom + "」→ 进度保留着）");
        }
    }

    return { hasPath, currentRoom };
}

// ③ 判定一命挑战模式（带金 / 带银），顺带累积「本次挑战用时」
function resolveGoldenMode(state, stats, currentRoom) {
    // 返回本次新增的死亡数 → 作为「刚刚死了」的信号传给一命模式判定，
    // 让它能立刻退出带金布局（不等 CCT 那个滞后 1 秒多的手持标志）。
    const diedNow = detectDeaths(state, stats, currentRoom) > 0;

    // ⚠️ 这里只在「刚拿起金草莓」或「金银类型确定」时才会返回 true，用来驱动一次重绘。
    //    平时返回 false，避免每 500ms 无谓重排。
    const snap = CctClient.snapshot(state);

    // CCT 是否暂停了死亡追踪 —— 每次 tick 刷新，供 requestGoldenStats 判断
    // 要不要用「实时增量」兜底（见 noteGoldenProgress 的注释）。
    // ⚠️ 实测小闪的 CCT 里「暂停死亡追踪」是开着的，
    //    此时 previousAttempts 完全不更新，只能靠带金增量兜底。
    lastTrackingPaused = snap.trackingPaused;
    // 金 / 银类型的容错与映射在 CctClient 里（见文件顶部 CctClient 分区）。
    const goldenType = readGoldenType(stats, state);
    const goldenChanged = updateGoldenMode(
        state.chapterName || "", goldenType, snap.holdingGolden, diedNow);

    // 「本次一命挑战累计用时」：只在真正带金挑战期间累积
    // ⚠️ 模式刚在 updateGoldenMode 里更新过，这里取到的已是本 tick 的最新值
    const mode = curGoldenMode();
    const now = Date.now();
    if (mode.challenge && !session.isPaused) {
        if (goldenRunTickAt > 0) {
            const dt = (now - goldenRunTickAt) / 1000;
            // 卡顿超过 3 秒（切场景、最小化）不计入，防止一次性灌进来一大段时间
            if (dt > 0 && dt < 3) goldenRunSec += dt;
        }
        goldenRunTickAt = now;
    } else {
        goldenRunTickAt = 0;
    }

    return { diedNow, goldenChanged };
}

// ③ 上半渲染：换主题 → 显示数据卡 → 头部与走势条
function renderUpper(state, stats, hasPath, currentRoom, diedNow, goldenChanged) {
    // 本 tick 的模式（updateGoldenMode 已更新过）—— 下面几处一律问它要答案
    const mode = curGoldenMode();
    applyGoldenTheme(mode);

    showDataCards();

    // ⚠️⚠️ 模式刚翻转时**不能**直接同步重绘 —— 那样布局是硬跳的，
    // 卡片高度会突然从旧值蹦到新值。改成走 animateLayoutSwap()：
    // 先让旧数据淡出，再换布局，然后把卡片高度缓动过去、新数据淡入。
    //
    // ⚠️ renderRoomInfo 正常只在「换房间」时被调用（见下面 room 切换那段），
    // 但拿金草莓几乎总发生在**同一个房间内**（草莓就在房间开头）——
    // 所以模式翻转时必须在这里主动调一次，否则第二张卡片会一直停在初见布局上。
    //
    // 注意：只有翻转的那一 tick 走编排分支；其余 tick 照常同步渲染，
    // 否则计时文字、走势条这些会每 500ms 停 240ms。
    if (goldenChanged) {
        animateLayoutSwap(function () {
            renderHeader(state, stats, hasPath);
            // 模式刚翻转 → 强制立刻刷新一次（不等 1.5 秒节流）
            if (mode.usesGoldenStats) requestGoldenStats(currentRoom, true);
            renderStreak(state, hasPath, currentRoom, mode);
            renderRoomInfo(state, hasPath, currentRoom, 0, null);
        });
    } else {
        renderHeader(state, stats, hasPath);
        // 一命模式下异步拉「成功率/进入率/局数」（走 CCT 的 parseFormat，有节流）
        // ⚠️ 刚死了也要强制刷一次 —— 死亡会让 CCT 那边立刻改数
        //    （带金死亡数 +1、尝试记录 +1），等 1.5 秒节流会让数字看起来「卡住」。
        //    小闪反馈过「带金死了之后成功率也没变」，就是刷新不够及时。
        if (mode.usesGoldenStats) requestGoldenStats(currentRoom, diedNow);
        // 走势条：只有「用走势条」的模式才画（见 GOLDEN_MODE 的 usesStreak）
        renderStreak(state, hasPath, currentRoom, mode);
    }
}

// ④ 在录制路径里定位当前房间；定位不到就自己收尾并返回 null
function locateRoom(path, currentRoom, hasPath) {
    if (!hasPath) {
        setNotice("");
        renderSectionsEmptyWithText("当前地图没有录制路径");
        pauseTimer();
        return null;
    }

    const { cpIndex, roomIndex, cp } = findCurrentRoom(path.path, currentRoom);
    const inPath = currentRoom && cpIndex >= 0;

    if (!inPath) {
        setNotice("");
        renderSectionsOutside();
        resumeTimer();
        session.isPaused = false;
        saveSession();
        return null;
    }

    return { cpIndex, roomIndex, cp };
}

// ⑤ 结算时间：恢复计时 → 结算上一面 → 记下进本房时刻
function settleTiming(currentRoom) {
    // ⚠️ 恢复计时必须放在「房间切换结算」之前：
    // resumeTimer() 会把 currentRoomEnterTime 往后推（补偿暂停时长），
    // 而下面结算房间用时用的就是这个时间戳。顺序反了就会把暂停的时间算进上一面。
    resumeTimer();

    // 房间切换
    if (currentRoom !== session.lastRoom && session.lastRoom) {
        if (session.currentRoomEnterTime) {
            const stay = Timing.settleRoomStay(session, Timing.nowMs(session));
            dlog("☆ 切房间: " + session.lastRoom + " → " + currentRoom
                 + " | 结算上一房停留 " + stay.toFixed(3) + " 秒"
                 + " → roomTimes[" + session.lastRoom + "] = "
                 + session.roomTimes[session.lastRoom].toFixed(3));
        }

        // 是否首次访问新房间
        const isNewRoom = !session.visitedRooms[currentRoom];

        const frozenDeaths = session.roomDeaths[session.lastRoom] || 0;
        const frozenTime = (session.roomTimes[session.lastRoom] || 0);
        const targetDeaths = session.roomDeaths[currentRoom] || 0;
        const targetTime = session.roomTimes[currentRoom] || 0;

        transition = {
            startTime: Date.now(),
            fromDeaths: frozenDeaths,
            toDeaths: targetDeaths,
            fromTime: frozenTime,
            toTime: targetTime,
            frozenDeaths: frozenDeaths,
            frozenTime: frozenTime,
            playFreeze: isNewRoom,  // 只有首次访问才播放金色定格
        };
        displayedRoomDeaths = frozenDeaths;
        displayedRoomTimeSec = frozenTime;
    }

    setNotice("");
    session.isPaused = false;

    if (currentRoom !== session.lastRoom) {
        if (!session.visitedRooms[currentRoom]) {
            session.visitedRooms[currentRoom] = true;
        }
        session.lastRoom = currentRoom;
        session.currentRoomEnterTime = Timing.nowMs(session);
        saveSession();
    }
}

// ⑥ 下半渲染：房间信息卡 + 小节进度
function renderLower(path, state, hasPath, currentRoom, cpIndex, roomIndex, cp) {
    renderRoomInfo(state, hasPath, currentRoom, cpIndex, cp);
    renderSections(path.path, currentRoom, cpIndex, roomIndex, cp);
}

function updateTransition() {
    if (!transition) return;

    const now = Date.now();
    const elapsed = now - transition.startTime;

    const el = document.getElementById("room-deaths");
    const el2 = document.getElementById("room-time");

    // 冻结阶段（仅首次访问）
    const freezeMs = transition.playFreeze ? FREEZE_DURATION : 0;

    if (elapsed < freezeMs) {
        displayedRoomDeaths = transition.frozenDeaths;
        displayedRoomTimeSec = transition.frozenTime;

        if (el) { el.textContent = String(transition.frozenDeaths); el.classList.add("frozen"); }
        if (el2) { el2.textContent = formatMS(transition.frozenTime); el2.classList.add("frozen"); }
        return;
    }

    const t = Math.min(1, (elapsed - freezeMs) / TRANSITION_DURATION);
    const eased = 1 - Math.pow(1 - t, 3);

    const targetDeaths = transition.toDeaths;
    const fromDeaths = transition.frozenDeaths;
    if (targetDeaths !== fromDeaths) {
        const diff = targetDeaths - fromDeaths;
        displayedRoomDeaths = Math.round(fromDeaths + diff * eased);
    } else {
        displayedRoomDeaths = fromDeaths;
    }

    const targetTime = transition.toTime;
    const fromTime = transition.frozenTime;
    displayedRoomTimeSec = fromTime + (targetTime - fromTime) * eased;

    if (el) { el.textContent = String(displayedRoomDeaths); el.classList.remove("frozen"); }
    if (el2) { el2.textContent = formatMS(displayedRoomTimeSec); el2.classList.remove("frozen"); }

    if (t >= 1) {
        transition = null;
        displayedRoomDeaths = targetDeaths;
        displayedRoomTimeSec = targetTime;
    }
}

function getStatusText(sceneType) {
    if (!sceneType) return "加载中";
    if (sceneType === "Celeste.Overworld") return "主页面";
    if (sceneType === "Celeste.Editor") return "编辑器";
    if (sceneType === "Celeste.TitleScreen") return "标题画面";
    if (sceneType === "Celeste.Oui") return "菜单";
    if (sceneType.indexOf("Loader") >= 0) return "加载中";
    return "加载中";
}

function showStatusCard(text) {
    const app = document.getElementById("app");
    const overlay = document.getElementById("status-overlay");
    const statusValue = document.getElementById("status-value");

    // 统一模糊整块 #app（不要逐张卡片加 blur，见 CSS 注释）
    if (app) app.classList.add("blurred");
    if (overlay) overlay.classList.add("visible");
    if (statusValue) statusValue.textContent = text;
}

function showDataCards() {
    const app = document.getElementById("app");
    const overlay = document.getElementById("status-overlay");

    if (app) app.classList.remove("blurred");
    if (overlay) overlay.classList.remove("visible");
}

function renderOutsideText(text) {
    const sectionsEl = document.getElementById("sections");
    const cpProgressEl = document.getElementById("cp-progress");
    const roomProgressEl = document.getElementById("room-progress");
    const titleEl = document.querySelector(".progress-title");

    if (titleEl) titleEl.textContent = "进度";
    if (cpProgressEl) cpProgressEl.parentElement.style.display = "none";
    if (roomProgressEl) roomProgressEl.textContent = "-";

    if (!sectionsEl) return;
    if (text === lastOutsideText) return;

    lastOutsideText = text;
    sectionsEl.classList.remove("single");
    sectionsEl.classList.remove("many");
    sectionsEl.classList.remove("rooms-medium");
    sectionsEl.classList.remove("rooms-large");
    sectionsEl.classList.remove("rooms-huge");
    sectionsEl.innerHTML = "";
    const div = document.createElement("div");
    div.className = "sections-outside enter";
    div.textContent = text;
    sectionsEl.appendChild(div);
    lastSectionsSignature = "";
}

function renderSectionsEmptyWithText(text) { renderOutsideText(text); }
function renderSectionsOutside() { renderOutsideText("当前不在路径中"); }

function detectDeaths(state, stats, currentRoom) {
    const curDeaths = CctClient.snapshot(state).deathsInCurrentRun;
    if (!session.lastCurDeaths) session.lastCurDeaths = {};
    const prevCur = session.lastCurDeaths[currentRoom] || 0;
    let delta = 0;

    // ⚠️ 重开章节后的第一次检测：只记录基准，不计数（见 seedDeathsOnly 的注释）
    if (seedDeathsOnly) {
        seedDeathsOnly = false;
        session.lastCurDeaths[currentRoom] = curDeaths;
        dlog("⟲ 重开后首次检测：只记基准 deathsInCurrentRun=" + curDeaths + "，不计数");
        return 0;
    }

    if (curDeaths > prevCur) {
        delta += curDeaths - prevCur;
        session.lastCurDeaths[currentRoom] = curDeaths;
    } else if (curDeaths < prevCur) {
        // 这是正常现象：CCT 在新的一条命开始时会把「本命死亡数」清零，
        // 所以玩家离开房间再回来时会看到它变小。已经累加过的死亡数不会丢。
        dlog("ℹ 死亡计数归零: 房间 " + currentRoom + " " + prevCur + " → " + curDeaths
             + "（CCT 开了新的一条命，正常现象）");
        session.lastCurDeaths[currentRoom] = curDeaths;
    }

    if (delta > 0) {
        session.roomDeaths[currentRoom] = (session.roomDeaths[currentRoom] || 0) + delta;
        dlog("💀 死亡 +" + delta + " 房间 " + currentRoom
             + " → 本房累计 " + session.roomDeaths[currentRoom]);

        // 死亡时顶部卡片红光一闪（靠 transition 淡入淡出，比 keyframes 更好控制）
        const topCard = document.querySelector(".top-card");
        if (topCard) {
            topCard.classList.add("death-flash");
            clearTimeout(deathFlashTimer);
            deathFlashTimer = setTimeout(() => topCard.classList.remove("death-flash"), 340);
        }

        saveSession();
    }

    // 返回本次新增的死亡数。
    // ⚠️ 这是「死亡事件」最可靠的信号，而且比 CCT 的 playerIsHoldingGolden 快得多：
    //    实测日志里死亡计数在 11:58:23.930 就变了，手持标志到 11:58:25.193 才翻 false。
    //    一命挑战要靠它做到「死了立刻回正常状态」。
    return delta;
}

function pauseTimer() {
    if (!session.isPaused) {
        session.isPaused = true;
        session.pauseStartTime = Date.now();
        dlog("⏸ 暂停计时 (pauseStartTime = " + new Date(session.pauseStartTime).toLocaleTimeString() + ")");
        dstate("暂停");
        saveSession();
    }
}

function resumeTimer() {
    if (session.isPaused) {
        if (session.pauseStartTime && session.currentRoomEnterTime) {
            const pausedDuration = Date.now() - session.pauseStartTime;
            session.currentRoomEnterTime += pausedDuration;
            if (session.startTime) session.startTime += pausedDuration;
            dlog("▶ 恢复计时 | 暂停了 " + (pausedDuration / 1000).toFixed(3) + " 秒"
                 + " | startTime 和 currentRoomEnterTime 都往后推了同样的时长");
        } else {
            dlog("▶ 恢复计时（但没有 pauseStartTime / currentRoomEnterTime，没做补偿）",
                 { pauseStartTime: session.pauseStartTime, currentRoomEnterTime: session.currentRoomEnterTime });
        }
        session.isPaused = false;
        session.pauseStartTime = 0;
        dstate("恢复");
        saveSession();
    }
}

function initSession(chapterName, path) {
    session = {
        chapterName: chapterName,
        path: path,
        startTime: Date.now(),
        lastRoom: "",
        currentRoomEnterTime: Date.now(),
        roomTimes: {},
        visitedRooms: {},
        roomDeaths: {},
        lastCurDeaths: {},
        isPaused: false,
        pauseStartTime: 0,
    };
    saveSession();
    lastShownTotalDeaths = 0;
    lastShownRoomDeaths = 0;
    lastShownRoom = "";
    lastShownCpIndex = -1;
    lastSectionsSignature = "";
    lastOutsideText = "";
    lastBlockColors = {};
    animatedCps = {};
    stopPctAnim();
    displayedPct = 0;
    transition = null;
    displayedRoomDeaths = 0;
    displayedRoomTimeSec = 0;
    // 让下一次 renderRoomInfo 无条件重绘（见 forceRoomInfoRefresh 的注释）
    forceRoomInfoRefresh = true;
    resetRateTween();
    // 重开后第一次死亡检测只记基准（见 seedDeathsOnly 的注释）
    seedDeathsOnly = true;
}

// ===== 章节历史持久化 =====
// 存「累计用时(秒)」而不是「开始时间戳」：
// 时间戳在暂停期间不会推进，直接存它会让恢复后的用时把暂停时长也算进去。
//
// ⚠️ 「现在几点」统一用 Timing.nowMs(session)（见 Timing.js）。
//    原来这里那个 effNow() 已经合并进去 —— 全库只剩一个时钟口径。

function saveChapterHistory() {
    if (!session.chapterName) return;
    try {
        const all = JSON.parse(store.get(CHAPTERS_KEY) || "{}");
        const now = Timing.nowMs(session);

        // 当前房间那段还没结算，一起存进去，避免切图后丢失。
        // ⚠️ 用 settledRoomTimes 拿副本：还没切房，这段不能写回当前会话
        const roomTimes = Timing.settledRoomTimes(session, now);

        all[session.chapterName] = {
            totalSec: session.startTime ? (now - session.startTime) / 1000 : 0,
            roomTimes: roomTimes,
            visitedRooms: session.visitedRooms,
            roomDeaths: session.roomDeaths,
            lastCurDeaths: session.lastCurDeaths,
            lastRoom: session.lastRoom,   // 离开时在哪个房间，用来判断进度有没有被游戏重置
            savedAt: Date.now(),          // 存时间戳，load 时用来判断「隔了多久」
        };
        store.set(CHAPTERS_KEY, JSON.stringify(all));
    } catch (e) {}
}

function loadChapterHistory(chapterName) {
    try {
        const all = JSON.parse(store.get(CHAPTERS_KEY) || "{}");
        const data = all[chapterName];
        if (!data) return null;
        const now = Timing.nowMs(session);
        return {
            chapterName: chapterName,
            path: session.path,
            // 用「累计用时」反推开始时间戳，这样暂停/在别的图待的时间不会被算进来
            // （兼容旧格式：老数据存的是 startTime）
            startTime: (data.totalSec !== undefined)
                ? now - data.totalSec * 1000
                : (data.startTime || now),
            lastRoom: "",
            currentRoomEnterTime: now,
            roomTimes: data.roomTimes || {},
            visitedRooms: data.visitedRooms || {},
            roomDeaths: data.roomDeaths || {},
            lastCurDeaths: data.lastCurDeaths || {},
            isPaused: false,
            pauseStartTime: 0,
            resumedFromRoom: data.lastRoom || "",   // 上次离开时所在的房间
        };
    } catch (e) { return null; }
}

function timerLoop() {
    const mode = curGoldenMode();
    updateTransition();
    updateRateTween();      // 成功率的数值补间

    if (session.chapterName && !session.isPaused) {
        // ⚠️ 一命模式下「总死亡 / 总用时」整块是隐藏的（见 renderHeaderGolden），
        // 所以不要再去写那两格 —— 写了也看不见，还会跟新模式抢 DOM。
        // 该不该写由 GOLDEN_MODE 的 writesLegacyTimers 字段决定。
        if (mode.writesLegacyTimers) {
            const totalSec = (Date.now() - session.startTime) / 1000;
            const el = document.getElementById("total-time");
            if (el) el.textContent = formatHMS(totalSec);
        }

        // 第二张卡片的右格：一命模式下整行都隐藏了，不用管
        if (!transition && mode.writesLegacyTimers && session.lastRoom && session.currentRoomEnterTime) {
            const currentStay = Timing.currentRoomStaySec(session, Timing.nowMs(session));
            const accumulated = session.roomTimes[session.lastRoom] || 0;
            const el2 = document.getElementById("room-time");
            const v = accumulated + currentStay;
            if (el2) el2.textContent = formatMS(v);
            lastShownRoomTimeValue = v;
        }
    }
    requestAnimationFrame(timerLoop);
}

function renderHeader(state, stats, valid) {
    const name = (stats.chapterStats && stats.chapterStats.chapterName)
        || (state.chapterName || "-");
    const el = document.getElementById("chapter-name");
    if (el) {
        el.textContent = name;
        let weight = 0;
        for (const ch of name) weight += (ch.charCodeAt(0) > 255) ? 2 : 1;
        let level;
        if (weight <= 6) level = 1;
        else if (weight <= 10) level = 2;
        else if (weight <= 14) level = 3;
        else if (weight <= 18) level = 4;
        else if (weight <= 24) level = 5;
        else if (weight <= 32) level = 6;
        else if (weight <= 44) level = 7;
        else level = 8;
        for (let i = 1; i <= 8; i++) el.classList.remove("len-" + i);
        el.classList.add("len-" + level);
    }

    // ===== 一命挑战模式：换一套数据 =====
    // 走哪套由模式对象决定 —— 这里是**唯一**的模式分派点，别在别处再判一次
    const mode = curGoldenMode();
    if (mode.challenge) {
        renderHeaderGolden(state, stats, valid, mode);
        return;
    }

    // ===== 初见模式（原来的逻辑）=====
    // ⚠️ 从一命切回初见时要把布局改回来（换章节、或重开）：
    //    隐藏「带金成功率」行，恢复「总死亡 / 总用时 / 平均」三行
    show("#golden-line", false);
    show("#golden-subline", false);
    show(".total-line", true);
    show("#avg-line", true);
    setLabel("label-deaths", "总死亡");
    setLabel("label-time", "总用时");
    setLabel("avg-label-1", "平均死亡");
    setLabel("avg-label-2", "平均用时");
    setIcon("blk1-icon", "💀");
    setLabel("blk1-label", "本面死亡");
    setIcon("blk2-icon", "⏱️");
    setLabel("blk2-label", "本面用时");
    show("#avg-line", true);

    let total = 0;
    for (const v of Object.values(session.roomDeaths)) total += v;

    // 平均死亡 / 平均用时（按已通过的面数算，和百分比的「含当前面」口径区分开）
    updateAverages(valid ? total : null);

    const el2 = document.getElementById("total-deaths");
    if (el2) {
        const newText = valid ? String(total) : "-";
        if (el2.textContent !== newText) {
            el2.textContent = newText;
            if (total > lastShownTotalDeaths && valid) {
                el2.classList.remove("bump");
                void el2.offsetWidth;
                el2.classList.add("bump");
            }
        }
    }
    lastShownTotalDeaths = total;
}

// ---- 一命挑战模式下的第一张卡片 ----
// 小闪要的四个数（都用 CCT 的 parseFormat 取，口径和 CCT 自己面板一致）：
//   带金成功率 xx%（通过数/进入数）   ← {room:successRate} + {room:successes}/{room:attempts}
//   进入率 xx%                       ← {room:chokeRate}
//   局数 #N                           ← {run:currentPbStatus}
//   （连续通过在第二张卡片的走势条上，那里本来就有）
//
// ⚠️ 别再自己拿 previousAttempts 去算了 —— 那是「CCT 记录的尝试结果数组」，
// 和 CCT 面板显示的成功率口径可能有出入。既然 CCT 直接给了算好的，
// 就直接用它的，省得对不上号。
//
// ⚠️ 小闪明确说过：不要「本面进入」那种自己数出来的东西 ——
// CCT 本来就有进入率。所以之前那个 roomEnterCounts 自算方案已废弃。
function renderHeaderGolden(state, stats, valid, mode) {
    // 隐藏初见那三行
    show(".total-line", false);        // 会隐藏两条（总死亡、总用时）
    show("#avg-line", false);
    // 显示成功率行 + 副行
    show("#golden-line", true);
    show("#golden-subline", true);

    // 文案一律从模式表取 —— 「带金 / 带银」只写在 GOLDEN_MODE 那一处
    setLabel("golden-label", mode.rateLabel);

    // 值由 requestGoldenStats() 异步写入，这里只负责把布局切对。
    // 拿不到数据时显示占位符，避免上一张图的旧数字残留。
    if (!goldenStats.ready) {
        setText("golden-rate", "-");
        setText("golden-detail", "");
        setText("golden-runs", "进入率 -");
        setText("golden-enter", mode.deathWord + " -");
    }
}

// 高亮阈值：成功率高 → 绿，低 → 红
function applyRateColor(el, pct) {
    if (!el) return;
    el.classList.toggle("good", pct >= 70);
    el.classList.toggle("bad", pct <= 30);
}

// 一命模式下要拉的数据。异步取，取到了直接写 DOM。
// ⚠️ 有节流：parseFormat 是 POST，不能每 500ms 都发一次。
const GOLDEN_STATS_INTERVAL_MS = 1500;
// busy 卡住的保护时长。fetch 万一直不返回，超过这个时间就强制解锁，
// 否则数据会永久停止刷新（见 requestGoldenStats 里的说明）。
const GOLDEN_STATS_BUSY_TIMEOUT_MS = 4000;
let goldenStats = { ready: false, at: 0, busyAt: 0, chapter: null, room: null, busy: false };

// ===== 走势条的「实时增量」 =====
// ⚠️⚠️ 为什么需要这个（2026-09-16 21:03 实测，用 tools/diag.ps1 抓的）：
//   带金挑战期间连死 4 次，CCT 的 previousAttempts **长度和内容完全不变**
//   （一直是 17 项）。它只在**换房间**时才刷新：
//       21:03:53 死亡 → gDeaths 57→58，gEntry 75→76，paLen 仍是 17
//       21:03:59 死亡 → gDeaths 58→59，gEntry 76→77，paLen 仍是 17
//       21:04:50 换房间 → paLen 17 → 29
//   所以走势条光靠 previousAttempts **永远不可能实时** —— 这不是刷新逻辑的问题，
//   之前几轮一直在改刷新判据，方向就错了。
//
//   同一份日志暴露了正确的实时数据源：
//     {room:goldenEntries}    75 → 76 → 77 → 78 → 79   ← 每次进入 +1
//     {room:goldenDeaths}     57 → 58 → 59 → 60 → 61   ← 每次死亡 +1
//     {room:goldenSuccesses}  18                        ← 每次通过 +1
//   而且实测 goldenEntries = goldenSuccesses + goldenDeaths（75 = 18 + 57 ✓）。
//
//   做法：拿 previousAttempts 当**历史基准**，再把本次观测到的增量接在后面。
//   一次进入 = 一次尝试；进入数 +1 而通过数没 +1 → 这次失败，否则成功。
// CCT 当前是否暂停了死亡追踪（tick 每次刷新）。
let lastTrackingPaused = false;

// ===== 成功率的「加数减数」缓动 =====
// 小闪：「进入率和局数可以保留弹跳的动画，但成功率要改成类似本房用时和
//        本房死亡的加数减数缓动」。
// 所以 golden-rate 不再走 .bump（缩放弹跳），改成**数值补间**：
// 从当前显示的数字平滑滚到新数字（先快后慢），和本面死亡 / 本面用时一致。
// 进入率（golden-runs）和局数（golden-enter）保持原来的弹跳动画。
const RATE_TWEEN_MS = 620;      // 和 updateTransition 的时长保持一致
let rateTween = null;           // { startTime, from, to, decimals }
let displayedRate = null;       // 当前显示的数字（null = 还没初始化）

// 从 "18.18%" / "24%" 这种字符串里抠出数字和小数位数
function parseRate(str) {
    const m = String(str || "").match(/(\d+(?:\.\d+)?)/);
    if (!m) return null;
    return { value: parseFloat(m[1]), decimals: (m[1].split(".")[1] || "").length };
}

function writeRateText(v, decimals) {
    const el = document.getElementById("golden-rate");
    if (el) el.textContent = v.toFixed(decimals) + "%";
}

// 收到新成功率 → 起一段补间（从当前显示值滚过去）
function tweenRate(rateStr) {
    const el = document.getElementById("golden-rate");
    if (!el) return;
    const p = parseRate(rateStr);
    if (p === null) {
        // 拿不到数字（比如 "-"）→ 直接写，不补间
        rateTween = null;
        displayedRate = null;
        el.textContent = rateStr || "-";
        return;
    }
    // ⚠️ 从「当前正在显示的数字」接着补，而不是从上一次的终点 ——
    //    否则连续变化时（过面 + 立刻又死）会跳一下。
    const from = (displayedRate === null) ? p.value : displayedRate;
    rateTween = { startTime: Date.now(), from: from, to: p.value, decimals: p.decimals };
    displayedRate = from;
}

// 每帧调用（挂在 timerLoop 里）
function updateRateTween() {
    if (!rateTween) return;
    const t = Math.min(1, (Date.now() - rateTween.startTime) / RATE_TWEEN_MS);
    // 和 updateTransition 用同一条缓动曲线（先快后慢）
    const eased = 1 - Math.pow(1 - t, 3);
    const v = rateTween.from + (rateTween.to - rateTween.from) * eased;
    displayedRate = v;
    writeRateText(v, rateTween.decimals);
    if (t >= 1) {
        displayedRate = rateTween.to;
        writeRateText(rateTween.to, rateTween.decimals);
        rateTween = null;
    }
}

// 重置补间（切换模式 / 初始化时用）
function resetRateTween() {
    rateTween = null;
    displayedRate = null;
}

const liveGolden = {
    room: "",        // 基准对应的房间
    baseLen: -1,     // 基准数组长度（用来发现 previousAttempts 被刷新了）
    lastEntries: null,
    lastSucc: null,
    extra: [],       // 本次观测到的增量（true = 通过）
};

// ⚠️⚠️ paused = CCT 的「死亡追踪被暂停」状态（modState.deathTrackingPaused）。
//    实测（2026-09-16）小闪的 CCT 里「暂停死亡追踪」是**开着**的，
//    此时 CCT **不记录房间尝试**（previousAttempts 一直不动），
//    但「始终追踪带金死亡」让他仍然记录带金数据。
//    → 暂停时用增量兜底；没暂停时 previousAttempts 本身就是实时的，
//      再用增量会**重复计数**，所以必须加这个守卫。
function noteGoldenProgress(entriesStr, succStr, paused) {
    if (!paused) { liveGolden.lastEntries = null; return; }   // 没暂停 → 交给 previousAttempts
    const entries = parseInt(String(entriesStr || "").trim(), 10);
    const succ = parseInt(String(succStr || "").trim(), 10);
    if (!isFinite(entries) || !isFinite(succ)) return;

    if (liveGolden.lastEntries === null) {
        liveGolden.lastEntries = entries;
        liveGolden.lastSucc = succ;
        return;
    }
    const dEntry = entries - liveGolden.lastEntries;
    const dSucc = succ - liveGolden.lastSucc;
    liveGolden.lastEntries = entries;
    liveGolden.lastSucc = succ;

    if (dEntry <= 0 || dEntry > 20) return;   // 没变 / 异常跳变就不管
    // 新增 dEntry 次进入，其中 dSucc 次通过。
    // ⚠️ 顺序无法从计数还原，但实测每次死亡都是逐个发生的（dEntry 基本恒为 1），
    //    所以把成功排在后面 —— 这样「末尾连续通过」的语义是对的。
    for (let i = 0; i < dEntry; i++) liveGolden.extra.push(i >= dEntry - dSucc);
    if (liveGolden.extra.length > 60) liveGolden.extra = liveGolden.extra.slice(-60);
    dlog("◆ 走势实时增量：进入+" + dEntry + " 通过+" + dSucc
         + " → " + liveGolden.extra.map(v => v ? "1" : "0").join(""));
}

// 把「历史基准 + 本次增量」拼成完整的尝试序列
function buildStreakAttempts(snap) {
    // 传入 CctClient.snapshot(state)（previousAttempts 已做数组化兜底）
    const base = snap ? snap.previousAttempts : [];
    const room = snap ? snap.room : "";

    if (room !== liveGolden.room || base.length !== liveGolden.baseLen) {
        if (room !== liveGolden.room) {
            dlog("◆ 走势条换房间：「" + liveGolden.room + "」→「" + room + "」，重置实时增量");
        } else {
            dlog("◆ previousAttempts 刷新了（" + liveGolden.baseLen + " → " + base.length
                 + " 项），重置实时增量");
        }
        liveGolden.room = room;
        liveGolden.baseLen = base.length;
        liveGolden.extra = [];
    }
    return base.concat(liveGolden.extra);
}

async function requestGoldenStats(roomName, force) {
    const now = Date.now();

    // ⚠️⚠️ 必须给 busy 加超时保护。
    //    parseFormats 是个 fetch，万一 CCT 那边一直不返回（卡住 / 超时），
    //    busy 会永远停在 true，之后所有刷新都被下面那句 `if (busy) return` 挡掉 ——
    //    表现就是「数据再也不更新了」（小闪反馈「带金死了之后成功率也没变」）。
    if (goldenStats.busy && now - goldenStats.busyAt > GOLDEN_STATS_BUSY_TIMEOUT_MS) {
        dlog("⚠ 取带金统计卡住超过 " + (GOLDEN_STATS_BUSY_TIMEOUT_MS / 1000)
             + " 秒，强制解锁（否则数据会一直不刷新）");
        goldenStats.busy = false;
    }
    if (goldenStats.busy) return;

    // 换房间 / 换章节 / 死亡 / 模式翻转时立刻刷新，否则按节流走
    const roomChanged = (roomName !== goldenStats.room);
    if (!force && !roomChanged && now - goldenStats.at < GOLDEN_STATS_INTERVAL_MS) return;

    goldenStats.busy = true;
    goldenStats.busyAt = now;
    goldenStats.at = now;
    goldenStats.room = roomName;
    try {
        // 占位符表在 CctClient.GOLDEN_STATS_PLACEHOLDERS（单一来源，
        // 实测对照与「UTF-16 抓取」的教训都记在那边）。
        // 下标含义：0 成功率 / 1 通过数 / 2 进入次数 / 3 进入率 / 4 局数 /
        //           5 带金死亡（本章）/ 6 带金死亡（本次会话）
        const out = await parseFormats(CctClient.GOLDEN_STATS_PLACEHOLDERS);
        writeGoldenStats(out);
        // 走势条用这两个量做「实时增量」——见 liveGolden 那段注释
        // ⚠️ 只在 CCT 暂停死亡追踪时才需要（否则 previousAttempts 本身就是实时的，
        //    再用增量会重复计数）。lastTrackingPaused 由 tick 每次写入。
        noteGoldenProgress(out[2], out[1], lastTrackingPaused);
        goldenStats.ready = true;
    } catch (e) {
        goldenStats.ready = false;
        dlog("✗ 取带金统计失败：" + e.message);
    } finally {
        goldenStats.busy = false;
    }
}

function writeGoldenStats(out) {
    // 文案从模式表取 —— 「带金死亡 / 带银死亡」只写在 GOLDEN_MODE 那一处
    const deathWord = curGoldenMode().deathWord;

    const rate   = (out[0] || "").trim();   // 带金成功率
    const ok     = (out[1] || "").trim();   // 带金通过数
    const total  = (out[2] || "").trim();   // 带金进入次数
    const enter  = (out[3] || "").trim();   // 带金进入率
    const runNo  = (out[4] || "").trim();   // 局数
    const gd     = (out[5] || "").trim();   // 带金死亡（本章累计）
    const gdSess = (out[6] || "").trim();   // 带金死亡（本次会话）

    // 成功率 +（通过数/进入数）
    // ⚠️ 这里用 setTextBump 而不是 setText —— 小闪要「带金过面时，
    //    对应数据变化时也要加上动画」。setTextBump 只在值真的变了时才播动画，
    //    所以 1.5 秒一次的节流刷新不会让它一直闪。
    // ⚠️ 成功率走数值补间，不走 .bump 弹跳（小闪明确要求）
    tweenRate(rate);
    setTextBump("golden-detail", (ok && total) ? "（" + ok + "/" + total + "）" : "");

    // 颜色：从 "18.18%" 里抠出数字
    const m = rate.match(/(\d+(?:\.\d+)?)/);
    applyRateColor(document.getElementById("golden-rate"), m ? parseFloat(m[1]) : NaN);

    // 副行：进入率 · 局数（拿不到局数时退回显示带金死亡）
    setTextBump("golden-runs", "进入率 " + (enter || "-"));
    let tail;
    if (runNo && runNo !== "-") {
        tail = "局数 #" + runNo.replace(/^#/, "");
    } else {
        // ⚠️ {run:currentPbStatusNumber} 实测经常返回 "-"（CCT 只在特定时机才有值），
        //    这时退回显示带金死亡，总比显示一个「局数 -」有用。
        tail = deathWord + " " + (gd || "-");
        if (gdSess) tail += " (" + gdSess + ")";
    }
    setTextBump("golden-enter", tail);
}

// 写文本，并在**值真的变化**时播一下「变了」的提示动画。
// ⚠️ 值没变必须直接 return —— requestGoldenStats 是每 1.5 秒轮询一次，
//    不加这个判断的话数字会一直闪。
// ⚠️ 连续变化时（比如连着过两面）要「先摘类 + 强制重排 + 再加类」，
//    否则同一个类连续加两次浏览器看不出变化，动画只会播第一次。
function setTextBump(id, text) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.textContent === text) return;        // 值没变 → 不折腾
    el.textContent = text;
    el.classList.remove("bump");
    void el.offsetWidth;
    el.classList.add("bump");
    el.addEventListener("animationend", function onEnd() {
        el.classList.remove("bump");
        el.removeEventListener("animationend", onEnd);
    });
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el && el.textContent !== text) el.textContent = text;
}

function setLabel(id, text) {
    const el = document.getElementById(id);
    if (el && el.textContent !== text) el.textContent = text;
}
function setIcon(id, text) {
    const el = document.getElementById(id);
    if (el && el.textContent !== text) el.textContent = text;
}
// 显隐辅助。
// ⚠️ 两个坑：
//   ① 必须用 querySelectorAll —— .total-line 有两条（总死亡 / 总用时），
//      用 querySelector 只会改到第一条，第二条留着不隐藏。
//   ② 恢复显示时不能只把内联 display 清空（""）—— 如果 CSS 里该元素默认是
//      display:none（比如 .golden-line），清空内联样式后会回落到 none，等于没显示。
//      所以下面用一张显式的表记下每种元素「显示时该是什么 display」。
const SHOW_DISPLAY = {
    ".total-line": "flex",
    ".avg-line": "block",
    ".golden-line": "flex",
    "#golden-subline": "flex",
    ".room-info-row": "flex",
};

function show(sel, on) {
    const display = on ? (SHOW_DISPLAY[sel] || "block") : "none";
    document.querySelectorAll(sel).forEach(el => { el.style.display = display; });
}

// ===== 一命挑战模式：整张卡浅镀金 / 浅镀银 + 显眼指示器 =====
// 徽章文案只用「带金 / 带银」两个词 —— 多一个「挑战」字在 OBS 小窗里会显得挤。
//
// 切换动效一共三件事（小闪 2026-09-16 明确要的）：
//   ① 扫光 → sweepFly("in" / "out")，见下面那段说明。
//   ② 「各个卡片要改高度的缓动改过去」→ animateLayoutSwap() 里的 FLIP 补间。
//   ③ 「数据该消失的消失，该出现的出现」→ 换布局前后给内容块加 / 摘 .row-out。
//
// ⚠️ 徽章另有一条 .pop（badgePop 关键帧），先摘类 + 强制重排保证能重播。
//    用 animation 而不是 transition，因为徽章是从 display:none 变过来的，
//    display 变化浏览器不做过场，transition 会直接跳终态。

// ===== 扫光：进入和退出是**两个相反方向**，所以分成两段动画 =====
// 小闪要的：
//   · 进入 ——「从左到右镀一层」（金色从左边缘盖上来）
//   · 退出 ——「扫到右边去」（金色往右滑走、从右边缘离开）
//
// ⚠️⚠️ 走过的弯路（别再改回去）：
//   ① 用 transform 从 -100% 滑到 0 —— 方向对，但为了让扫光看得见在右边缘加了
//      亮带，扫完之后亮带**永久停在卡片最右边**（小闪：「扫得没到位」）。
//   ② 改用 mask-position 位移 —— 终态干净了，但 mask 是**单向**的：
//      退出时只能原路退回，金色从右边先消失、**左边缘永远残留一截金边**
//      （小闪：「卡片左侧也会有一个浅浅的金边，这个应该是要扫到右边去的」）。
//      这不是参数问题，是那个机制的方向限制。
//   ③ 现在：两段独立关键帧，各走各的方向（CSS 里的 flyInFromLeft / flyOutToRight）。
//      图层本身是**均匀**的（没有亮带），终态干净、退出也能真的扫到右边去。
//
// ⚠️ 动画挂在卡片自己的持久类上（.fly-in / .fly-out），由这里加、
//    animationend 里摘。不要挂在 #app 的一次性标记类上 ——
//    标记一摘选择器就不匹配，浏览器会立刻取消动画。
let sweepFlyTimer = null;
function sweepFly(direction) {
    // direction: "in" = 从左往右镀上；"out" = 扫到右边去
    const cls = (direction === "in") ? "fly-in" : "fly-out";
    const anim = (direction === "in") ? "flyInFromLeft" : "flyOutToRight";
    const cards = document.querySelectorAll(".card");
    if (!cards.length) return;

    // ⚠️⚠️ 退出时要把银色的「锁」也加上。
    //    .card::after 的默认背景是**金色**，只有 #app.silver-mode 在的时候才是银色。
    //    退出流程里 applyGoldenTheme 会先把 .silver-mode 摘掉，
    //    于是图层瞬间变回金色 —— 小闪看到的就是
    //    「带银死亡时不是镀的银淡出，而是突然镀成金的，然后淡出」。
    //    所以 fly-out 期间给卡片挂 .silver-layer 把银色锁住（见 CSS），
    //    动画结束再摘掉。
    const lockSilver = (direction === "out") && curGoldenMode().isSilver;

    cards.forEach(function (card) {
        card.classList.remove("fly-in", "fly-out");
        void card.offsetWidth;              // 强制重排：保证二次切换能重播
        if (lockSilver) card.classList.add("silver-layer");
        card.classList.add(cls);
        card.addEventListener("animationend", function onEnd(e) {
            // 只认自己那条动画，别被卡片上其他动画误触发
            if (e.animationName !== anim) return;
            card.classList.remove(cls, "silver-layer");
            card.removeEventListener("animationend", onEnd);
        });
    });

    // ⚠️ 兜底：覆盖层窗口被游戏遮住时浏览器会挂起渲染，animationend 可能不来。
    // 类名残留会让下一次切换的「先摘再加」失效 → 动画不再重播。
    // 兜底时长要**明显大于**动画时长（0.55s），否则会提前摘类把动画掐断。
    if (sweepFlyTimer) clearTimeout(sweepFlyTimer);
    sweepFlyTimer = setTimeout(function () {
        document.querySelectorAll(".card").forEach(function (c) {
            c.classList.remove("fly-in", "fly-out", "silver-layer");
        });
        sweepFlyTimer = null;
    }, 1300);
}

// ===== 布局切换的过渡编排 =====
// 小闪要「各个卡片要改高度的缓动改过去，数据该消失的消失、该出现的出现」。
// 三件事必须按顺序做，缺一件都会显得生硬：
//   ① 旧数据淡出
//   ② 换布局（就是原来那些 display 切换）+ 卡片高度缓动
//   ③ 新数据淡入
//
// ⚠️ 高度为什么必须手写 FLIP 补间：卡片高度是 auto，
//    而 CSS transition 对 height:auto 无效（两端没有可插值的具体值）。
//    只能先量旧高度 → 改完布局量新高度 → 把 height 从旧值补间到新值，
//    补完再把内联 height 清掉、回到 auto
//    （不清的话以后内容再变化，高度会被这个内联值钉死）。
const SWAP_FADE_SELECTORS = [".top-right", "#streak-strip"];
const SWAP_FADE_MS = 240;      // 要和 CSS 里的 --row-dur 对上

function fadeSwapTargets(out) {
    document.querySelectorAll(SWAP_FADE_SELECTORS.join(",")).forEach(function (el) {
        el.classList.add("row-fade");
        el.classList.toggle("row-out", !!out);
    });
}

// 记录三张卡片当前高度（换布局**前**调用）
function captureCardHeights() {
    const map = new Map();
    document.querySelectorAll(".card").forEach(function (c) {
        map.set(c, c.getBoundingClientRect().height);
    });
    return map;
}

// 把卡片高度从记录值补间到当前值（换布局**后**调用）
function flipCardHeights(prev) {
    document.querySelectorAll(".card").forEach(function (card) {
        const h0 = prev.get(card);
        if (h0 === undefined) return;
        const h1 = card.getBoundingClientRect().height;
        if (Math.abs(h1 - h0) < 0.5) return;        // 高度没变就别折腾

        card.style.transition = "none";
        card.style.height = h0 + "px";
        void card.offsetHeight;                     // 提交起点，否则补间不会发生
        card.style.transition = "height var(--card-dur, 0.42s) var(--card-ease, ease)";
        card.style.height = h1 + "px";

        card.addEventListener("transitionend", function onEnd(e) {
            if (e.propertyName !== "height") return;
            card.style.transition = "";
            card.style.height = "";                 // 回到 auto
            card.removeEventListener("transitionend", onEnd);
        });
    });
}

// 换布局的统一入口。mutate() 里做实际的 display 切换
// （renderHeader / renderStreak / renderRoomInfo 那几件）。
function animateLayoutSwap(mutate) {
    const prev = captureCardHeights();
    fadeSwapTargets(true);                          // ① 旧数据淡出

    setTimeout(function () {
        mutate();                                   // ② 换布局
        flipCardHeights(prev);                      // ③ 高度缓动过去
        // ⚠️ 这里必须强制一次重排，把「新内容已显示但 opacity 还是 0」这一帧提交掉。
        //    不提交的话，摘 .row-out 和上一步的 display 切换会在同一帧里合并，
        //    浏览器只看到 opacity 1 → 1，淡入效果直接消失。
        void document.body.offsetHeight;
        fadeSwapTargets(false);                     // ④ 新数据淡入
    }, SWAP_FADE_MS);
}

function applyGoldenTheme(mode) {
    const app = document.getElementById("app");
    const badge = document.getElementById("golden-badge");
    const badgeText = document.getElementById("badge-text");

    // 模式是否真的发生了变化 —— 只有变化才播动画，
    // 否则 500ms 轮询里每帧都会重播（会看到徽章一直在闪）。
    const wasOn = app ? app.classList.contains("golden-mode") : false;
    const wasSilver = app ? app.classList.contains("silver-mode") : false;

    if (app) {
        // 两个类都由模式表决定：silver-mode 只在银模式下挂
        app.classList.toggle("golden-mode", mode.challenge);
        app.classList.toggle("silver-mode", mode.isSilver);
    }
    if (badge) badge.classList.toggle("visible", mode.challenge);
    if (badgeText && mode.challenge) {
        // 徽章文案从模式表取（「带金 / 带银」只写一处）
        const text = mode.badgeText;
        if (badgeText.textContent !== text) badgeText.textContent = text;
    }

    // ---- 切换动画 ----
    const turnedOn = mode.challenge && !wasOn;                  // 初见 → 带金/带银
    const typeSwapped = mode.challenge && wasOn && (mode.isSilver !== wasSilver); // 金银互换
    if (turnedOn || typeSwapped) {
        if (badge) {
            badge.classList.remove("pop");
            void badge.offsetWidth;                 // 强制重排，让动画能重新播
            badge.classList.add("pop");
            // ⚠️ 动画播完必须把 .pop 摘掉。
            // 不摘的话这个类会一直挂在元素上，下次切换时「先 remove 再 add」
            // 在同一帧里做，浏览器看不出变化，动画就不会重播了（只有第一次有动画）。
            // 用 animationend 精确对齐动画结束，比 setTimeout 猜时长可靠。
            badge.addEventListener("animationend", function onEnd() {
                badge.classList.remove("pop");
                badge.removeEventListener("animationend", onEnd);
            });
        }
        // 扫光：从左往右镀上来。
        // ⚠️ 只在「真的从无到有」时扫（turnedOn）；金银互换不重扫 ——
        //    金色本来就在那儿，再扫一遍会显得莫名其妙。
        if (turnedOn) sweepFly("in");
        dlog("◆ 播放「" + mode.label + "」扫光" +
             (typeSwapped ? "（金银互换，只换色不重扫）" : ""));
    } else if (wasOn && !mode.challenge) {
        // ---- 退出挑战模式（带金/带银 → 回到初见）----
        // 小闪要「死了之后扫到右边去」：金色往右滑走 + 渐隐，从右边缘离开。
        // ⚠️ 必须是独立的 flyOutToRight 动画，不能靠上面那段的原路退回 ——
        //    原路退回会让左边缘残留一截金边（小闪截图确认过）。
        sweepFly("out");
        dlog("◆ 退出挑战模式：金色扫到右边去");
    }
}

// ===== 近期表现走势条 =====
// 数据来自 CCT 的 previousAttempts：一个布尔数组，记录该房间最近每次尝试是否成功。
// 从**右往左**取（最近的在右边），最多渲染 STREAK_MAX_DOTS 个，多余的丢掉。
//
// ⚠️ 走势条只在「带金 / 带银」模式下显示 —— 由 GOLDEN_MODE 的 **usesStreak** 字段决定。
// previousAttempts 记录的是**带金挑战**的每次尝试，初见推图根本用不到它
// （初见时的通过与否由「方格是否被攻克」表达，不需要再看这个）。
// 小闪：「对应位置保证只留 20 个方块」。
// ⚠️ 这个数字要和 HTML 里标题的「本面近 20 次通过情况」保持一致 ——
//    标题现在是 renderStreak 里动态写的（见下面），所以改这里就够了。
const STREAK_MAX_DOTS = 20;

// mode = GOLDEN_MODE 里的一条（normal / gold / silver）
function renderStreak(state, valid, currentRoom, mode) {
    const strip = document.getElementById("streak-strip");
    const dotsEl = document.getElementById("streak-dots");
    const bestEl = document.getElementById("streak-best");
    const bestMaxEl = document.getElementById("streak-bestmax");
    const rateEl = document.getElementById("streak-rate");
    if (!strip || !dotsEl) return;

    // 不在关卡内 / CCT 没数据 / 换了房间 / 这个模式不用走势条 → 隐藏并重置状态
    // 「用不用」问模式表，这里不判模式本身
    const snap = (valid && mode.usesStreak) ? CctClient.snapshot(state) : null;
    // ⚠️ 不能直接用 snap.previousAttempts —— 它只在换房间时才刷新（见 liveGolden 注释）。
    //    这里用「历史基准 + 本次观测到的实时增量」拼出完整序列。
    const attempts = snap ? buildStreakAttempts(snap) : null;

    if (!attempts || attempts.length === 0) {
        // ⚠️⚠️ 一命模式下**即使没有数据也要把整条留着**，只是内容显示占位。
        //    不然第二张卡片会彻底空白（小闪为此反馈过两次）。
        //    这里才是「第二张卡片空白」的真正解法 —— 不要在 renderRoomInfo 里
        //    靠「放出 .room-info-row」来兜底，那会把一命模式的布局顶掉。
        //
        // ⚠️ 而且必须**同样画满 20 个空位**，不能换成一行文字 ——
        //    小闪要求「对应位置保证只留 20 个方块」，
        //    换成文字会让这一行的宽度和位置跳动（有数据/没数据两种布局）。
        // ⚠️⚠️ 这个模式**即使没数据也要保留整条**（同样画满 20 个空位）——
        //    由 GOLDEN_MODE 的 streakKeepWhenEmpty 字段决定，**别改成 false**：
        //    换成一行文字会让这一行的宽度和位置跳动，第二张卡片还会整个空白。
        const keepVisible = (valid && mode.streakKeepWhenEmpty);
        strip.classList.toggle("visible", keepVisible);
        strip.classList.remove("hot");
        // ⚠️ 这里也走「复用节点」—— 从有数据切到没数据时，
        //    旧方块应该**平滑褪成空心**，而不是被瞬间抹掉重画。
        //    （见下面正常分支的说明）
        while (dotsEl.children.length < STREAK_MAX_DOTS) {
            dotsEl.appendChild(document.createElement("span"));
        }
        while (dotsEl.children.length > STREAK_MAX_DOTS) {
            dotsEl.removeChild(dotsEl.lastChild);
        }
        for (let i = 0; i < STREAK_MAX_DOTS; i++) {
            const pad = dotsEl.children[i];
            if (pad.className !== "streak-dot empty") pad.className = "streak-dot empty";
            if (pad.title !== "还没有记录") pad.title = "还没有记录";
        }
        if (bestEl) bestEl.textContent = "0";
        if (bestMaxEl) bestMaxEl.textContent = "0";
        if (rateEl) { rateEl.textContent = "-"; rateEl.classList.remove("good", "bad"); }
        const titleEl0 = document.getElementById("streak-title");
        if (titleEl0) {
            titleEl0.textContent = "本面近 " + STREAK_MAX_DOTS + " 次通过情况";
            titleEl0.title = "本面还没有尝试记录";
        }
        lastStreakRoom = valid ? currentRoom : "";
        lastStreakCount = -1;
        lastStreakSig = "";
        return;
    }

    strip.classList.add("visible");

    // 真正的「连续成功」看 CCT 的 successStreak（best 是历史最高）
    // 连续通过：从**拼好的序列**末尾数连续 1。
    // ⚠️ 不用 snap.successStreak —— 那是 CCT 基于旧的 previousAttempts 算的，
    //    我们接了实时增量之后，末尾可能已经多出几次尝试了。
    let streak = 0;
    for (let i = attempts.length - 1; i >= 0 && attempts[i]; i--) streak++;
    const streakBest = Math.max(snap.successStreakBest || 0, streak);
    if (bestEl) bestEl.textContent = String(streak);
    // 最高连续通过（小闪要学 CCT 的「近期/最高」格式）
    if (bestMaxEl) bestMaxEl.textContent = String(streakBest);

    // 连续成功达到 8 次以上，整条点亮（金色呼吸）
    strip.classList.toggle("hot", streak >= 8);

    // 最近 N 次尝试的通过率（CCT 自己也有 lastTenRate，但这里按实际点的数量算，
    // 保证「条上看到什么、百分比就是什么」，不会前后不一致）
    const shown = attempts.slice(-STREAK_MAX_DOTS);
    const okCount = shown.filter(Boolean).length;
    const rate = okCount / shown.length * 100;
    if (rateEl) {
        rateEl.textContent = "近 " + shown.length + " 次通过 " + okCount + " · " + rate.toFixed(0) + "%";
        rateEl.classList.toggle("good", rate >= 70);
        rateEl.classList.toggle("bad", rate <= 30);
    }

    // ⚠️⚠️ 这里不能只看「点的数量变没变」！
    //    小闪反馈「带金死了之后近期情况没变」，根因就在这行 ——
    //    shown 被 slice(-STREAK_MAX_DOTS) **截断**了，房间尝试次数一旦超过 28，
    //    shown.length 就**永远等于 28**，于是死了人也不会重画。
    //    改成比对**内容签名**（每个点通过 / 失败的序列），
    //    这样即使点数不变，只要序列变了（新的一次尝试把最老的点挤出去）也会重画。
    // ⚠️⚠️ 这里**不再做「没变化就跳过」的优化**。
    //    原因：这个优化已经出过两次问题 ——
    //      ① 第一版拿「点数」当判据，点数被截断成固定 28 个，永远不变 → 不重绘
    //      ② 第二版改成比对内容签名，逻辑对了，但小闪仍然反馈「没刷新」
    //    权衡下来：重绘 28 个 span 的成本极低（每 500ms 一次），
    //    而「看起来没刷新」的代价很高（要来回排查好几轮）。
    //    所以直接每次重绘，只在**真的新增了一次尝试**时才播弹出动画。
    //    ⚠️ 弹出动画必须单独判断 —— 否则每 500ms 重绘会让最后一个点一直闪。
    const sig = shown.map(function (v) { return v ? "1" : "0"; }).join("");
    const isNewRoom = (currentRoom !== lastStreakRoom);
    // 「新增了一次尝试」= 同房间 + 签名变长，或者（长度被截断后）签名变了且末尾是新的
    const grew = !isNewRoom && (sig !== lastStreakSig) &&
                 (sig.length > lastStreakSig.length || shown.length >= STREAK_MAX_DOTS);

    lastStreakRoom = currentRoom;
    lastStreakCount = shown.length;
    lastStreakSig = sig;

    // ⚠️ 小闪要求「对应位置保证只留 20 个方块」。
    //    做法：不足 20 个时在**左边**补空心方块（左边 = 较早），
    //    这样「近期」永远贴在最右边，两侧的「较早 / 近期」标签才不会骗人。
    //    ⚠️ 这里不渲染「…」—— 它也会占掉一个位置，就不是恰好 20 个了。
    //
    // ⚠️⚠️ 关键：**复用已有的方块节点，只更新 class，绝不重建**。
    //    小闪反馈「近期通过情况的方格只有进入动画，没有退出动画」。
    //    根因就是这里原来每次都 `dotsEl.innerHTML = ""` 再重建 ——
    //    新节点只会播「进入」动画，旧节点是被**瞬间抹掉**的，根本没有「退出」。
    //    改成复用之后，背景色 / 边框的变化会走 CSS transition，
    //    两个方向都有过渡（红→灰、灰→绿都会平滑变）。
    while (dotsEl.children.length < STREAK_MAX_DOTS) {
        dotsEl.appendChild(document.createElement("span"));
    }
    while (dotsEl.children.length > STREAK_MAX_DOTS) {
        dotsEl.removeChild(dotsEl.lastChild);
    }

    const padCount = Math.max(0, STREAK_MAX_DOTS - shown.length);
    for (let i = 0; i < STREAK_MAX_DOTS; i++) {
        const node = dotsEl.children[i];
        const isPad = i < padCount;
        const idx = i - padCount;
        const ok = isPad ? false : !!shown[idx];
        const want = "streak-dot" + (isPad ? " empty" : (ok ? " ok" : " fail"));
        // 只在真的变了时才写 className，避免每帧触发样式重算
        if (node.className.indexOf(want) < 0 || node.className.length !== want.length) {
            node.className = want;
        }

        // 序号按「从旧到新」算，和视觉顺序一致
        const seq = idx + 1;
        const tip = isPad ? "还没有记录" : ("第 " + seq + " 次：" + (ok ? "成功" : "失败"));
        if (node.title !== tip) node.title = tip;

        // ⚠️ 小闪：「这个动画相当于是直接覆盖上去了，前后不够明显」。
        //    根因：固定 20 格 + 内容整体左移，20 格会**同时**变色，
        //    看起来就像被整块覆盖了一层。
        //    改法：让颜色变化**从右往左依次错开**（越靠右越先变），
        //    视觉上就是「新的一次尝试从右边推进来」，
        //    而不是整行一起翻。
        const delay = (STREAK_MAX_DOTS - 1 - i) * 0.016;   // 右边先，左边后
        if (node.style.transitionDelay !== delay + "s") {
            node.style.transitionDelay = delay + "s";
        }

        // 弹出动画：只有**最新那一格**在真的新增时播；换房间时整条一起弹（有接力感）
        const isNewest = (i === STREAK_MAX_DOTS - 1);
        if (isNewest && (isNewRoom || grew)) {
            node.classList.remove("pop");
            void node.offsetWidth;          // 强制重排，保证能重播
            node.classList.add("pop");
            node.style.animationDelay = isNewRoom ? (idx * 0.022) + "s" : "0s";
        }
    }

    // 标题写成实际的次数（和 STREAK_MAX_DOTS 保持一致，改常量时不用再改 HTML）
    const titleEl = document.getElementById("streak-title");
    if (titleEl) {
        const t = "本面近 " + STREAK_MAX_DOTS + " 次通过情况";
        if (titleEl.textContent !== t) titleEl.textContent = t;
        titleEl.title = "共记录 " + attempts.length + " 次尝试"
                      + (attempts.length > STREAK_MAX_DOTS
                         ? "，这里显示最近 " + STREAK_MAX_DOTS + " 次" : "");
    }
}

function renderRoomInfo(state, valid, currentRoom, cpIndex, cp) {
    if (transition) {
        const el2 = document.getElementById("room-name-inline");
        if (el2) el2.textContent = currentRoom || "-";
        return;
    }

    // ⚠️ 本函数原来只在「换房间」时被调用，导致「在同一个房间里拿起金草莓」
    // 这件事永远不反映到第二张卡片上（拿草莓基本都发生在同一房间内）。
    // 现在有两种进入方式：
    //   ① 换房间时由 tick 尾部调用
    //   ② 模式刚翻转时由 tick 主动调用一次（见 tick 里的 goldenChanged 分支）
    // 为避免 ② 被这里的判据挡掉，判据只看「房间变了没 + 模式变了没」，
    // 两者都没变就直接 return，省掉每 500ms 的重排。
    //
    // ⚠️⚠️ 但「本面死亡数」也必须进判据！(2026-09-16 小闪反馈)
    //   小闪：「本面死亡数现在也没实时更新了，只在过面的时候会显示出真实数据」。
    //   根因就是这个提前 return：同一个房间内死了人，
    //   roomChanged 和 modeChanged 都是 false → 直接返回 → 数字不更新；
    //   只有换房间时 roomChanged 变 true 才刷一次。
    //   注意「本面用时」不受影响 —— 它是 timerLoop 每帧直接写 DOM 的，
    //   不走这个函数，所以只有死亡数会卡住。
    const mode = curGoldenMode();
    const roomChanged = (currentRoom !== lastRoomInfoRoom);
    // 只比「在不在挑战中」这一个布尔位（lastRoomInfoGolden 存的也是它）：
    // 金 ↔ 银 互换不改变这里的布局，不需要额外重绘
    const modeChanged = (mode.challenge !== lastRoomInfoGolden);
    const deathsChanged = ((session.roomDeaths[currentRoom] || 0) !== lastShownRoomDeaths);
    // ⚠️ forceRoomInfoRefresh 是「重开章节」那种情况的逃生口 ——
    //    那时新旧值都是 0，靠上面的判据永远发现不了「DOM 还是旧的」。
    if (!forceRoomInfoRefresh && !roomChanged && !modeChanged && !deathsChanged) return;
    forceRoomInfoRefresh = false;
    lastRoomInfoRoom = currentRoom;
    lastRoomInfoGolden = mode.challenge;

    // ===== 一命挑战模式：整行数据都藏掉，只留走势条 =====
    // 小闪的要求：本面死亡 / 本面用时 都不显示，
    // 成功率统一放在第一张卡片的「带金成功率」行里。
    // 所以一命模式下把 .room-info-row 整行隐藏，第二张卡片只剩走势条 —— 高度也降下来了。
    //
    // ⚠️⚠️ 隐藏与否由 GOLDEN_MODE 的 **hideRoomInfoRow** 字段决定，这里不再判模式。
    //    该字段在一命模式下为 true，且必须**无条件**生效 ——
    //    不要加「没走势数据就把这行放出来」的兜底：上一版加过那个兜底，
    //    结果小闪反馈「带银时第二张卡片还是显示的本面死亡和本面用时，不是近期情况」，
    //    兜底把正确的布局顶掉了。第二张卡片空白的真正解法在 renderStreak 里
    //    （没数据时保留走势条、画满 20 个空位，见那边注释与 streakKeepWhenEmpty 字段）。
    show(".room-info-row", !mode.hideRoomInfoRow);
    if (mode.hideRoomInfoRow) {
        displayedRoomTimeSec = 0;
    } else {
        setLabel("blk1-label", "本面死亡");
        setIcon("blk1-icon", "💀");
        setLabel("blk2-label", "本面用时");
        setIcon("blk2-icon", "⏱️");

        // ⚠️ 从一命切回初见时，右格要从「整数次数」恢复成「时间」格式，
        // 否则会残留一个光秃秃的数字（没有 00:00.000 的格式）
        const rtReset = document.getElementById("room-time");
        if (rtReset) {
            rtReset.textContent = "00:00.000";
            lastShownRoomTimeValue = 0;
        }

        const deaths = session.roomDeaths[currentRoom] || 0;
        displayedRoomDeaths = deaths;

        const el = document.getElementById("room-deaths");
        if (el) {
            const newText = valid ? String(deaths) : "-";
            if (el.textContent !== newText) {
                el.textContent = newText;
                if (deaths > lastShownRoomDeaths && valid) {
                    el.classList.remove("bump");
                    void el.offsetWidth;
                    el.classList.add("bump");
                }
            }
        }
        lastShownRoomDeaths = deaths;

        if (valid && session.lastRoom && session.currentRoomEnterTime) {
            const currentStay = Timing.currentRoomStaySec(session, Timing.nowMs(session));
            const accumulated = session.roomTimes[session.lastRoom] || 0;
            displayedRoomTimeSec = accumulated + currentStay;
        } else {
            displayedRoomTimeSec = 0;
        }
    }

    const el2 = document.getElementById("room-name-inline");
    if (el2) el2.textContent = currentRoom || "-";
}

function findCurrentRoom(path, currentRoom) {
    if (!path || !path.checkpoints) return { cpIndex: -1, roomIndex: -1, cp: null };
    for (let i = 0; i < path.checkpoints.length; i++) {
        const rooms = path.checkpoints[i].rooms;
        for (let j = 0; j < rooms.length; j++) {
            if (rooms[j].debugRoomName === currentRoom) {
                return { cpIndex: i, roomIndex: j, cp: path.checkpoints[i] };
            }
        }
    }
    return { cpIndex: -1, roomIndex: -1, cp: null };
}

function splitRows(total, rowSize, orphanMax) {
    if (total <= 0) return [];
    let fullRows = Math.floor(total / rowSize);
    let remainder = total % rowSize;
    if (remainder > 0 && remainder <= orphanMax && fullRows > 0) {
        fullRows--;
        remainder += rowSize;
    }
    const rows = [];
    let remaining = total;
    for (let i = 0; i < fullRows; i++) { rows.push(rowSize); remaining -= rowSize; }
    if (remaining > 0) rows.push(remaining);
    return rows;
}

function renderSections(path, currentRoom, cpIndex, roomIndex, cp) {
    const sectionsEl = document.getElementById("sections");
    const cpProgressEl = document.getElementById("cp-progress");
    const roomProgressEl = document.getElementById("room-progress");
    const titleEl = document.querySelector(".progress-title");

    if (!path || !path.checkpoints) {
        if (sectionsEl) sectionsEl.innerHTML = "";
        if (cpProgressEl) cpProgressEl.textContent = "-";
        if (roomProgressEl) roomProgressEl.textContent = "-";
        const pctEl0 = document.getElementById("progress-pct");
        const fillEl0 = document.getElementById("sections-fill");
        stopPctAnim();
        displayedPct = 0;
        if (pctEl0) {
            pctEl0.innerHTML = '-' + '<span class="unit">%</span>';
            pctEl0.classList.remove("full");
        }
        if (fillEl0) fillEl0.style.width = "0%";
        lastSectionsSignature = "";
        return;
    }

    const checkpoints = path.checkpoints;
    const isSingle = (checkpoints.length === 1);
    const isMany = (checkpoints.length > MANY_CP_THRESHOLD);

    if (sectionsEl) {
        sectionsEl.classList.toggle("single", isSingle);
        sectionsEl.classList.toggle("many", isMany && !isSingle);
    }

    if (sectionsEl && isSingle && cp) {
        const roomCount = cp.rooms.length;
        sectionsEl.classList.remove("rooms-medium", "rooms-large", "rooms-huge");
        if (roomCount > 60) sectionsEl.classList.add("rooms-huge");
        else if (roomCount > 30) sectionsEl.classList.add("rooms-large");
        else if (roomCount > 15) sectionsEl.classList.add("rooms-medium");
    }

    if (isSingle) {
        if (titleEl) titleEl.textContent = "房间进度";
        if (cpProgressEl) cpProgressEl.parentElement.style.display = "none";
        if (roomProgressEl) {
            if (cpIndex >= 0 && cp) roomProgressEl.textContent = (roomIndex + 1) + "/" + cp.rooms.length;
            else roomProgressEl.textContent = "-";
        }
    } else {
        if (titleEl) titleEl.textContent = "进度";
        if (cpProgressEl) {
            cpProgressEl.parentElement.style.display = "";
            if (cpIndex >= 0) cpProgressEl.textContent = (cpIndex + 1) + "/" + checkpoints.length;
            else cpProgressEl.textContent = "-/" + checkpoints.length;
        }
        if (roomProgressEl) {
            if (cpIndex >= 0 && cp) roomProgressEl.textContent = (roomIndex + 1) + "/" + cp.rooms.length;
            else roomProgressEl.textContent = "-";
        }
    }

    if (!sectionsEl) return;

    const signature = checkpoints.length + "|" + cpIndex + "|" + roomIndex;
    if (signature === lastSectionsSignature) return;
    lastSectionsSignature = signature;
    lastOutsideText = "";

    const cpChanged = (cpIndex !== lastShownCpIndex);
    // 只有「第一次进入这个小节」才播入场动画。
    // 从 A → B → 再回到 A 时，A 已经播过了，不再重播。
    const firstVisitCp = cpIndex >= 0 && !animatedCps[cpIndex];
    if (cpIndex >= 0) animatedCps[cpIndex] = true;
    const shouldAnimateBlocks = cpChanged && firstVisitCp;

    // buildSections 是延迟执行的，先把「上一帧的房间」固定住，
    // 否则它读到的 lastShownRoom 已经被更新了，脉冲动画会判错。
    const prevShownRoom = lastShownRoom;

    let currentGlobal = -1;
    if (cpIndex >= 0) {
        currentGlobal = 0;
        for (let ci = 0; ci < cpIndex; ci++) currentGlobal += checkpoints[ci].rooms.length;
        currentGlobal += roomIndex;
    }
    lastPassedRooms = Math.max(0, currentGlobal);   // 已通过的面数（当前面还没打完）

    // ---- 总进度：底部贯穿进度条 + 右侧百分比（一位小数 + 数值缓动）----
    let totalRooms = 0;
    for (const c of checkpoints) totalRooms += c.rooms.length;

    if (currentGlobal >= 0 && totalRooms > 0) {
        animatePct(Math.min(100, (currentGlobal + 1) / totalRooms * 100));
    } else {
        stopPctAnim();
        displayedPct = 0;
        const pctEl0 = document.getElementById("progress-pct");
        const fillEl0 = document.getElementById("sections-fill");
        if (pctEl0) {
            pctEl0.innerHTML = '-' + '<span class="unit">%</span>';
            pctEl0.classList.remove("full");
        }
        if (fillEl0) fillEl0.style.width = "0%";
    }

    // ---- 攻下一个小节：卡片边缘扫过一道光 ----
    if (cpChanged && cpIndex > lastShownCpIndex && lastShownCpIndex >= 0) {
        const card = document.getElementById("sections-card");
        if (card) {
            card.classList.remove("cleared-flash");
            void card.offsetWidth;          // 强制重排，让动画能重新播放
            card.classList.add("cleared-flash");
        }
    }

    // ---- 小节节点构建（抽成函数，才能做「旧元素先淡出、再替换」）----
    const sectionsCard = document.getElementById("sections-card");
    const buildSections = () => {
        const fromH = sectionsCard ? sectionsCard.offsetHeight : 0;
        sectionsEl.innerHTML = "";

        // ---- 小节太多时不做硬截断，让远端的小节逐渐淡出 ----
        // 原来两端打省略号太生硬；改成保留小节本身，靠字号 + 透明度过渡。
        // 最远显示到 dist-4（左右各 4 个）—— 再远的已经几乎全透明，不渲染也看不出来。
        const FAR = 4;
        const visStart = (cpIndex >= 0) ? Math.max(0, cpIndex - FAR) : 0;
        const visEnd = (cpIndex >= 0)
            ? Math.min(checkpoints.length - 1, cpIndex + FAR)
            : Math.min(checkpoints.length - 1, FAR * 2);

        for (let i = visStart; i <= visEnd; i++) {
            const c = checkpoints[i];
            const isCurrent = (i === cpIndex);
            const dist = Math.abs(i - cpIndex);

            const section = document.createElement("div");
            section.className = "section";

            if (isCurrent) {
                section.classList.add("current");
            } else if (isMany) {
                if (dist === 1) section.classList.add("dist-1");
                else if (dist === 2) section.classList.add("dist-2");
                else if (dist === 3) section.classList.add("dist-3");
                else if (dist === 4) section.classList.add("dist-4");
                else if (dist === 5) section.classList.add("dist-5");
                else if (dist === 6) section.classList.add("dist-6");
                else section.classList.add("dist-7");
            }

            const nameEl = document.createElement("div");
            nameEl.className = "name";
            if (isSingle) nameEl.style.display = "none";
            else nameEl.textContent = c.abbreviation || c.name || ("CP" + (i + 1));
            section.appendChild(nameEl);

            if (isCurrent) {
                if (shouldAnimateBlocks) nameEl.classList.add("flash");

                const blocksEl = document.createElement("div");
                blocksEl.className = "blocks";

                const total = c.rooms.length;
                const rowSize = isSingle ? ROW_SIZE_SINGLE : ROW_SIZE_MANY;
                const orphanMax = isSingle ? SINGLE_ORPHAN_MAX : MANY_ORPHAN_MAX;
                const rows = splitRows(total, rowSize, orphanMax);

                let idx = 0;
            for (const rowCount of rows) {
                const rowEl = document.createElement("div");
                rowEl.className = "blocks-row";
                // 告诉 CSS 这一行有几个方格，宽度按此算出（放不下就自动变小，不会溢出）
                rowEl.style.setProperty("--per-row", rowCount);
                    for (let k = 0; k < rowCount; k++) {
                        const j = idx++;
                        const roomName = c.rooms[j].debugRoomName;
                        const block = document.createElement("div");
                        block.className = "block";

                        const isGreen = (j < roomIndex) || (j !== roomIndex && session.visitedRooms[roomName]);
                        if (j === roomIndex) block.classList.add("yellow");
                        else block.classList.add(isGreen ? "green" : "gray");

                        // 刚被攻克（上一帧还不是绿的）→ 爆闪一下
                        const justCleared = isGreen && lastBlockColors[roomName] &&
                                            lastBlockColors[roomName] !== "green";
                        lastBlockColors[roomName] = isGreen ? "green" : "gray";

                        if (justCleared) {
                            block.classList.add("burst");
                        } else if (shouldAnimateBlocks) {
                            block.classList.add("enter");
                            block.style.animationDelay = (j * 0.04) + "s";
                        }
                        if (j === roomIndex && currentRoom !== prevShownRoom) block.classList.add("pulse");
                        block.title = roomName;
                        rowEl.appendChild(block);
                    }
                    blocksEl.appendChild(rowEl);
                }
                section.appendChild(blocksEl);
            } else {
                const countEl = document.createElement("div");
                countEl.className = "count";

                // 用 <= 判定该小节是否已完成
                let allCleared = false;
                if (currentGlobal >= 0 && i !== cpIndex) {
                    let sectionLastGlobal = 0;
                    for (let ci = 0; ci < i; ci++) sectionLastGlobal += checkpoints[ci].rooms.length;
                    sectionLastGlobal += c.rooms.length - 1;
                    allCleared = sectionLastGlobal <= currentGlobal;
                }

                countEl.textContent = c.rooms.length;
                if (allCleared) section.classList.add("cleared");
                section.appendChild(countEl);
            }

        // 过小节时：新小节整体从下方浮入，和旧小节向上飘出的方向相反 —— 视觉上是「接力」
        if (cpChanged) {
            section.classList.add("entering");
            section.style.animationDelay = (i * 0.035) + "s";
        }

        sectionsEl.appendChild(section);
        }


        // 内容变了 → 卡片高度缓动过去，而不是一步到位
        animateCardHeight(sectionsCard, fromH);
    };

    // 只有「过小节」才做「旧元素淡出 → 再替换」。
    // 同一小节内换面也走这里的话，每过一面都会闪一下（签名里含 roomIndex）。
    if (cpChanged && sectionsEl.children.length > 0) {
        Array.from(sectionsEl.children).forEach(el => el.classList.add("leaving"));
        clearTimeout(sectionsSwapTimer);
        // 与 .section.leaving 的 0.2s 对齐：动画刚播完就替换，新元素紧接着从下方浮入
        sectionsSwapTimer = setTimeout(buildSections, 200);
    } else {
        clearTimeout(sectionsSwapTimer);
        buildSections();
    }

    lastShownRoom = currentRoom;
    lastShownCpIndex = cpIndex;
}

// ===== 百分比：一位小数 + 数值缓动 =====
// 数字文本没法用 CSS transition，只能在 JS 里逐帧插值
function renderPct(v) {
    const el = document.getElementById("progress-pct");
    if (el) {
        el.innerHTML = v.toFixed(1) + '<span class="unit">%</span>';
        el.classList.toggle("full", v >= 99.95);
    }
    const fill = document.getElementById("sections-fill");
    if (fill) fill.style.width = v + "%";
}

function stopPctAnim() {
    if (pctAnimFrame) { cancelAnimationFrame(pctAnimFrame); pctAnimFrame = null; }
    if (pctSnapTimer) { clearTimeout(pctSnapTimer); pctSnapTimer = null; }
}

function animatePct(target) {
    stopPctAnim();
    const start = displayedPct;
    const delta = target - start;
    if (Math.abs(delta) < 0.05) { displayedPct = target; renderPct(target); return; }

    // 注意：t0 和每帧的时间都必须来自同一个时钟。
    // rAF 回调给的时间戳和 performance.now() 在无头浏览器里可能不同源，
    // 混用会算出负数（曾经出现过 -0.4%）。这里统一用 Date.now()。
    const t0 = Date.now();
    const dur = 620;
    const step = () => {
        const k = Math.max(0, Math.min(1, (Date.now() - t0) / dur));
        const eased = 1 - Math.pow(1 - k, 3);      // 先快后慢
        const v = Math.max(0, Math.min(100, start + delta * eased));
        displayedPct = v;
        renderPct(v);
        if (k < 1) {
            pctAnimFrame = requestAnimationFrame(step);
        } else {
            displayedPct = target;
            renderPct(target);
            pctAnimFrame = null;
        }
    };
    pctAnimFrame = requestAnimationFrame(step);

    // 兜底：OBS 里浏览器源不可见时 rAF 会被节流甚至暂停，
    // 用定时器保证最终一定落到目标值（并清掉 rAF 循环）。
    pctSnapTimer = setTimeout(() => {
        pctSnapTimer = null;
        if (pctAnimFrame) { cancelAnimationFrame(pctAnimFrame); pctAnimFrame = null; }
        displayedPct = target;
        renderPct(target);
    }, dur + 140);
}

// ===== 卡片高度缓动 =====
// height:auto 不能直接 transition：先量出旧高度写成显式 px，
// 强制重排后再改成新高度，过渡结束把 inline height 清掉（回到 auto）。
function animateCardHeight(card, fromH) {
    if (!card) return;
    card.style.height = "auto";
    const toH = card.offsetHeight;
    if (!fromH || fromH === toH) { card.style.height = ""; return; }
    card.style.height = fromH + "px";
    void card.offsetHeight;
    card.style.height = toH + "px";
    clearTimeout(cardHeightTimer);
    cardHeightTimer = setTimeout(() => { card.style.height = ""; }, 400);
}

// ===== 平均死亡 / 平均用时 =====
// 口径：总死亡 ÷ 已通过的面数、总用时 ÷ 已通过的面数
function formatAvgTime(sec) {
    if (sec < 60) return sec.toFixed(1) + "秒";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ":" + pad(s, 2);
}

function updateAverages(totalDeaths) {
    const elD = document.getElementById("avg-deaths");
    const elT = document.getElementById("avg-time");
    if (!elD && !elT) return;

    if (totalDeaths === null || lastPassedRooms <= 0) {
        if (elD) elD.textContent = "-";
        if (elT) elT.textContent = "-";
        return;
    }
    const totalSec = session.startTime ? (Timing.nowMs(session) - session.startTime) / 1000 : 0;
    if (elD) elD.textContent = (totalDeaths / lastPassedRooms).toFixed(1);
    if (elT) elT.textContent = formatAvgTime(totalSec / lastPassedRooms);
}

function setNotice(msg) {
    const el = document.getElementById("notice");
    if (!el) return;
    if (msg) { el.textContent = msg; el.style.display = "block"; }
    else el.style.display = "none";
}

function saveSession() {
    try { store.set(STORAGE_KEY, JSON.stringify(session)); } catch (e) {}
}
function loadSession() {
    try {
        const raw = store.get(STORAGE_KEY);
        if (raw) {
            const s = JSON.parse(raw);
            return s;
        }
    } catch (e) {}
    return {
        chapterName: "", path: null, startTime: 0, lastRoom: "",
        currentRoomEnterTime: 0, roomTimes: {}, visitedRooms: {}, roomDeaths: {},
        lastCurDeaths: {}, isPaused: false, pauseStartTime: 0,
    };
}

async function fetchJson(endpoint) {
    const res = await fetch(CCT_BASE + endpoint, { headers: { "Accept": "application/json" } });
    return await res.json();
}
async function fetchJsonFrom(url) {
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    return await res.json();
}

// ===== CCT 的格式串解析接口 =====
// ⚠️⚠️ 这是本覆盖层取「进入率 / 局数」等统计的**唯一正确姿势**。
//
// CCT 自带的那份覆盖层**不自己算**这些数，而是把带占位符的格式串
// POST 给 /cct/parseFormat，由 CCT 在服务端填好返回。可用占位符
// （从作者自带覆盖层的默认格式串里扒出来的，已核实）：
//   {room:chokeRate}         本面进入率
//   {checkpoint:chokeRate}   小节进入率
//   {run:currentPbStatus}    当前是第几局（带金挑战）
//   {room:successRate}       本面成功率
//   {room:successes} {room:attempts}  本面通过数 / 总进入数
//   {room:currentStreak} {checkpoint:currentStreak}  连续通过
//   {chapter:goldenDeaths} {chapter:goldenDeathsSession}
//   {room:goldenDeaths}
//   {chapter:goldenChance} {checkpoint:goldenChance}
//   {room:name} {chapter:successRate} {checkpoint:successRate}
//   {pb:best} {pb:bestSession} {pb:bestRoomNumber} ...
// 好处：口径和 CCT 自己的面板**完全一致**，不用去猜字段名，也不会算错。
async function parseFormats(formats) {
    const res = await fetch(CCT_BASE + "/cct/parseFormat", {
        method: "POST",
        // ⚠️ 必须禁用缓存。小闪反馈过「带金数据没有正常更新」，
        //    虽然 POST 默认一般不入缓存，但 CCT 服务端如果回了
        //    可缓存的响应头，浏览器有可能复用上一次的结果 ——
        //    那样数字就会「卡住不变」。加上 no-store 把这个可能性彻底排掉。
        cache: "no-store",
        body: JSON.stringify({ formats: formats }),
    });
    const j = await res.json();
    if (j.errorCode !== 0) throw new Error("parseFormat errorCode=" + j.errorCode);
    return j.formats || [];
}

function formatMS(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return pad(m,2) + ":" + pad(s,2) + "." + pad(ms,3);
}
function formatHMS(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return pad(h,2) + ":" + pad(m,2) + ":" + pad(s,2) + "." + pad(ms,3);
}
function pad(n, len) { return String(n).padStart(len, "0"); }

// ===== 调试工具：在浏览器控制台里直接敲 =====
window.mcs = {
    // mcs.mark("场景1 结束")   在日志里插一条醒目的分隔线，方便分段
    mark: (text) => {
        console.log("%c\n══════════ " + text + " ══════════\n",
                    "color:#f1c40f;font-weight:bold;font-size:14px");
        pushLog("");
        pushLog("══════════ " + text + " ══════════");
        return "已标记：" + text;
    },
    // mcs.dump()           打印当前会话状态
    dump: () => { dstate("手动打印"); return "已打印到控制台 ↑"; },
    // mcs.state()          返回当前会话状态的原始对象
    state: () => JSON.parse(JSON.stringify(session)),
    // await mcs.cct()      拉一份 CCT 的原始数据（state / path / stats）
    cct: async () => ({
        state: await fetchJson("/cct/state"),
        path:  await fetchJson("/cct/currentChapterPath"),
        stats: await fetchJson("/cct/currentChapterStats"),
    }),
    // await mcs.lw()       看 LevelWatcher 说的当前场景
    lw: async () => await fetchJsonFrom(LEVEL_WATCHER),
    // 注意：这里故意不提供 mcs.reset()。
    // 调试辅助函数一旦带「清空数据」这种副作用，只要浏览器重放控制台命令就会反复触发。
    // 需要清空数据时，用 DevTools → Application → Session Storage → 右键 Clear。
};