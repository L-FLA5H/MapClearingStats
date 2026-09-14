// ===== CCT 接口 =====
const CCT_BASE = "http://localhost:32270";
const LEVEL_WATCHER = "http://localhost:32271/";
const TICK_MS = 500;
const STORAGE_KEY = "mcs_session_v32";
const CHAPTERS_KEY = "mcs_chapters_v1";  // 按章节保存历史
const MANY_CP_THRESHOLD = 6;
const FREEZE_DURATION = 1000;
const TRANSITION_DURATION = 900;

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
        "本房已待(秒)": s.currentRoomEnterTime ? +((now - s.currentRoomEnterTime) / 1000).toFixed(3) : null,
        "已结算房间用时": JSON.parse(JSON.stringify(s.roomTimes || {})),
        "房间死亡数": JSON.parse(JSON.stringify(s.roomDeaths || {})),
        "暂停中": s.isPaused,
        "暂停开始": s.pauseStartTime || null,
    });
    pushLog("───────── " + label + " ─────────");
    pushLog("  章节=" + (s.chapterName || "(空)")
          + "   上次房=" + (s.lastRoom || "(空)")
          + "   总用时=" + (s.startTime ? ((now - s.startTime) / 1000).toFixed(2) + "s" : "null"));
    pushLog("  进本房=" + (s.currentRoomEnterTime ? ((now - s.currentRoomEnterTime) / 1000).toFixed(2) + "s前" : "null")
          + "   暂停中=" + s.isPaused
          + "   暂停开始=" + (s.pauseStartTime ? new Date(s.pauseStartTime).toLocaleTimeString() : "0"));
    pushLog("  roomTimes=" + JSON.stringify(s.roomTimes || {}));
    pushLog("  roomDeaths=" + JSON.stringify(s.roomDeaths || {}));
}

let session = loadSession();

let lastShownTotalDeaths = 0;
let lastShownRoomDeaths = 0;
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

document.addEventListener('DOMContentLoaded', () => {
    renderDebugPanel();
    // 调试面板占住右侧，把覆盖层往左推，避免互相遮挡
    const app = document.getElementById("app");
    if (app && DEBUG) {
        app.style.marginLeft = "auto";
        app.style.marginRight = "500px";
    }
    pushLog("=== MCS 调试日志已启动（页面右侧面板）===");
    setInterval(tick, TICK_MS);
    requestAnimationFrame(timerLoop);
    tick();
});

async function tick() {
    let inLevel = false;
    let sceneType = "";
    try {
        const lw = await fetchJsonFrom(LEVEL_WATCHER);
        sceneType = lw.sceneType || "";
        inLevel = (sceneType === "Celeste.Level");
    } catch (e) {
        inLevel = false;
    }

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

    if (!inLevel) {
        // 不在关卡内：保存当前章节数据到历史
        if (session.chapterName) {
            saveChapterHistory();
        }
        pauseTimer();
        showStatusCard(getStatusText(sceneType));
        saveSession();
        return;
    }

    let state, path, stats;
    try {
        state = await fetchJson("/cct/state");
        path  = await fetchJson("/cct/currentChapterPath");
        stats = await fetchJson("/cct/currentChapterStats");
    } catch (e) {
        showStatusCard("CCT 未响应");
        pauseTimer();
        return;
    }

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

    const currentRoom = state.currentRoom?.debugRoomName || "";

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
            dlog("ℹ 从历史恢复数据（上次离开在「" + prevRoom + "」，这次也在「" + currentRoom
                 + "」→ 进度保留着）");
        }
    }

    detectDeaths(state, stats, currentRoom);

    showDataCards();
    renderHeader(state, stats, hasPath);

    if (!hasPath) {
        setNotice("");
        renderSectionsEmptyWithText("当前地图没有录制路径");
        pauseTimer();
        return;
    }

    const { cpIndex, roomIndex, cp } = findCurrentRoom(path.path, currentRoom);
    const inPath = currentRoom && cpIndex >= 0;

    if (!inPath) {
        setNotice("");
        renderSectionsOutside();
        resumeTimer();
        session.isPaused = false;
        saveSession();
        return;
    }

    // ⚠️ 恢复计时必须放在「房间切换结算」之前：
    // resumeTimer() 会把 currentRoomEnterTime 往后推（补偿暂停时长），
    // 而下面结算房间用时用的就是这个时间戳。顺序反了就会把暂停的时间算进上一面。
    resumeTimer();

    // 房间切换
    if (currentRoom !== session.lastRoom && session.lastRoom) {
        if (session.currentRoomEnterTime) {
            const stay = (Date.now() - session.currentRoomEnterTime) / 1000;
            session.roomTimes[session.lastRoom] = (session.roomTimes[session.lastRoom] || 0) + stay;
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
        session.currentRoomEnterTime = Date.now();
        saveSession();
    }

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
    const topCard = document.querySelector(".top-card");
    const roomCard = document.getElementById("room-info-card");
    const sectionsCard = document.getElementById("sections-card");
    const overlay = document.getElementById("status-overlay");
    const statusValue = document.getElementById("status-value");

    [topCard, roomCard, sectionsCard].forEach(c => { if (c) c.classList.add("blurred"); });
    if (overlay) overlay.classList.add("visible");
    if (statusValue) statusValue.textContent = text;
}

function showDataCards() {
    const topCard = document.querySelector(".top-card");
    const roomCard = document.getElementById("room-info-card");
    const sectionsCard = document.getElementById("sections-card");
    const overlay = document.getElementById("status-overlay");

    [topCard, roomCard, sectionsCard].forEach(c => { if (c) c.classList.remove("blurred"); });
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
    const curDeaths = state.currentRoom?.deathsInCurrentRun || 0;
    if (!session.lastCurDeaths) session.lastCurDeaths = {};
    const prevCur = session.lastCurDeaths[currentRoom] || 0;
    let delta = 0;

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
}

// ===== 章节历史持久化 =====
// 存「累计用时(秒)」而不是「开始时间戳」：
// 时间戳在暂停期间不会推进，直接存它会让恢复后的用时把暂停时长也算进去。
function effNow() {
    // 暂停中 → 「游戏内经过的时间」应该停在暂停那一刻
    return (session.isPaused && session.pauseStartTime) ? session.pauseStartTime : Date.now();
}

function saveChapterHistory() {
    if (!session.chapterName) return;
    try {
        const all = JSON.parse(sessionStorage.getItem(CHAPTERS_KEY) || "{}");
        const now = effNow();

        // 当前房间那段还没结算，一起存进去，避免切图后丢失
        const roomTimes = Object.assign({}, session.roomTimes);
        if (session.lastRoom && session.currentRoomEnterTime) {
            const stay = (now - session.currentRoomEnterTime) / 1000;
            if (stay > 0) {
                roomTimes[session.lastRoom] = (roomTimes[session.lastRoom] || 0) + stay;
            }
        }

        all[session.chapterName] = {
            totalSec: session.startTime ? (now - session.startTime) / 1000 : 0,
            roomTimes: roomTimes,
            visitedRooms: session.visitedRooms,
            roomDeaths: session.roomDeaths,
            lastCurDeaths: session.lastCurDeaths,
            lastRoom: session.lastRoom,   // 离开时在哪个房间，用来判断进度有没有被游戏重置
        };
        sessionStorage.setItem(CHAPTERS_KEY, JSON.stringify(all));
    } catch (e) {}
}

function loadChapterHistory(chapterName) {
    try {
        const all = JSON.parse(sessionStorage.getItem(CHAPTERS_KEY) || "{}");
        const data = all[chapterName];
        if (!data) return null;
        const now = Date.now();
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
    updateTransition();

    if (session.chapterName && !session.isPaused) {
        const totalSec = (Date.now() - session.startTime) / 1000;
        const el = document.getElementById("total-time");
        if (el) el.textContent = formatHMS(totalSec);

        if (!transition && session.lastRoom && session.currentRoomEnterTime) {
            const currentStay = (Date.now() - session.currentRoomEnterTime) / 1000;
            const accumulated = session.roomTimes[session.lastRoom] || 0;
            const el2 = document.getElementById("room-time");
            if (el2) el2.textContent = formatMS(accumulated + currentStay);
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

function renderRoomInfo(state, valid, currentRoom, cpIndex, cp) {
    if (transition) {
        const el2 = document.getElementById("room-name-inline");
        if (el2) el2.textContent = currentRoom || "-";
        return;
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
        const currentStay = (Date.now() - session.currentRoomEnterTime) / 1000;
        const accumulated = session.roomTimes[session.lastRoom] || 0;
        displayedRoomTimeSec = accumulated + currentStay;
    } else {
        displayedRoomTimeSec = 0;
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

        for (let i = 0; i < checkpoints.length; i++) {
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
                else section.classList.add("dist-5");
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
    const totalSec = session.startTime ? (effNow() - session.startTime) / 1000 : 0;
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
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session)); } catch (e) {}
}
function loadSession() {
    try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
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