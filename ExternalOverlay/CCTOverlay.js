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

let session = loadSession();

let lastShownTotalDeaths = 0;
let lastShownRoomDeaths = 0;
let lastShownRoom = "";
let lastShownCpIndex = -1;
let lastSectionsSignature = "";
let lastOutsideText = "";
let lastCpForAnimation = -1;

let transition = null;
let displayedRoomDeaths = 0;
let displayedRoomTimeSec = 0;

document.addEventListener('DOMContentLoaded', () => {
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

    // 章节变化：优先从历史恢复，没有才新建
    if (session.chapterName !== chapterName) {
        if (session.chapterName) saveChapterHistory();
        const restored = loadChapterHistory(chapterName);
        if (restored) {
            session = restored;
            saveSession();
        } else {
            initSession(chapterName, path.path);
        }
    }

    const currentRoom = state.currentRoom?.debugRoomName || "";

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

    // 房间切换
    if (currentRoom !== session.lastRoom && session.lastRoom) {
        if (session.currentRoomEnterTime) {
            const stay = (Date.now() - session.currentRoomEnterTime) / 1000;
            session.roomTimes[session.lastRoom] = (session.roomTimes[session.lastRoom] || 0) + stay;
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

    resumeTimer();
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
        session.lastCurDeaths[currentRoom] = curDeaths;
    }

    if (delta > 0) {
        session.roomDeaths[currentRoom] = (session.roomDeaths[currentRoom] || 0) + delta;
        saveSession();
    }
}

function pauseTimer() {
    if (!session.isPaused) {
        session.isPaused = true;
        session.pauseStartTime = Date.now();
        saveSession();
    }
}

function resumeTimer() {
    if (session.isPaused) {
        if (session.pauseStartTime && session.currentRoomEnterTime) {
            const pausedDuration = Date.now() - session.pauseStartTime;
            session.currentRoomEnterTime += pausedDuration;
            if (session.startTime) session.startTime += pausedDuration;
        }
        session.isPaused = false;
        session.pauseStartTime = 0;
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
    lastCpForAnimation = -1;
    transition = null;
    displayedRoomDeaths = 0;
    displayedRoomTimeSec = 0;
}

// ===== 章节历史持久化 =====
function saveChapterHistory() {
    if (!session.chapterName) return;
    try {
        const all = JSON.parse(sessionStorage.getItem(CHAPTERS_KEY) || "{}");
        all[session.chapterName] = {
            startTime: session.startTime,
            roomTimes: session.roomTimes,
            visitedRooms: session.visitedRooms,
            roomDeaths: session.roomDeaths,
            lastCurDeaths: session.lastCurDeaths,
        };
        sessionStorage.setItem(CHAPTERS_KEY, JSON.stringify(all));
    } catch (e) {}
}

function loadChapterHistory(chapterName) {
    try {
        const all = JSON.parse(sessionStorage.getItem(CHAPTERS_KEY) || "{}");
        const data = all[chapterName];
        if (!data) return null;
        return {
            chapterName: chapterName,
            path: session.path,
            startTime: data.startTime || Date.now(),
            lastRoom: "",
            currentRoomEnterTime: Date.now(),
            roomTimes: data.roomTimes || {},
            visitedRooms: data.visitedRooms || {},
            roomDeaths: data.roomDeaths || {},
            lastCurDeaths: data.lastCurDeaths || {},
            isPaused: false,
            pauseStartTime: 0,
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
    const shouldAnimateBlocks = cpChanged && lastCpForAnimation !== cpIndex;
    lastCpForAnimation = cpIndex;

    sectionsEl.innerHTML = "";

    let currentGlobal = -1;
    if (cpIndex >= 0) {
        currentGlobal = 0;
        for (let ci = 0; ci < cpIndex; ci++) currentGlobal += checkpoints[ci].rooms.length;
        currentGlobal += roomIndex;
    }

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
                for (let k = 0; k < rowCount; k++) {
                    const j = idx++;
                    const roomName = c.rooms[j].debugRoomName;
                    const block = document.createElement("div");
                    block.className = "block";
                    if (j < roomIndex) block.classList.add("green");
                    else if (j === roomIndex) block.classList.add("yellow");
                    else block.classList.add(session.visitedRooms[roomName] ? "green" : "gray");
                    if (shouldAnimateBlocks) {
                        block.classList.add("enter");
                        block.style.animationDelay = (j * 0.04) + "s";
                    }
                    if (j === roomIndex && currentRoom !== lastShownRoom) block.classList.add("pulse");
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

        sectionsEl.appendChild(section);
    }

    lastShownRoom = currentRoom;
    lastShownCpIndex = cpIndex;
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