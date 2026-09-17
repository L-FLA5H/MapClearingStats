// 房间用时计时的**唯一口径**。
//
// 以前这段计算在 CCTOverlay.js 里写了四遍（tick 结算、存档补算、
// 每帧刷新、房间信息卡刷新），各用各的时钟。现在全部收到这里：
//
//   nowMs(session)              现在几点（暂停时冻结在暂停那一刻）
//   currentRoomStaySec(s, now)  当前房间已停留多少秒（还没结算进 roomTimes 的那段）
//   settleRoomStay(s, now)      把这段停留结算进 s.roomTimes，返回结算了多少秒
//   settledRoomTimes(s, now)    返回**副本**，含这段停留，但不改动传入的 session
//
// 这个模块不碰 DOM、不碰网络，所以 tools/check-timing.js 可以在 Node 里直接测它。
//
// ⚠️ 时钟口径说明：
//   蔚蓝自己的计时在暂停期间照常走，覆盖层跟着走才对得上（见 tick 里的说明）。
//   这里的「暂停」指的是覆盖层自己停表（pauseTimer）—— 那时 currentRoomEnterTime
//   会被 resumeTimer() 往后推来补偿，所以结算时直接用 nowMs() 就不会把暂停时长算进去。

(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) {
        module.exports = api;          // Node：tools/check-timing.js
    } else {
        root.Timing = api;             // 浏览器：挂在 window 上给 CCTOverlay.js 用
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {

    // 现在几点（毫秒）。
    // 暂停中 → 停在暂停那一刻，让「已用时间」不再往前涨。
    function nowMs(session) {
        if (session && session.isPaused && session.pauseStartTime) {
            return session.pauseStartTime;
        }
        return Date.now();
    }

    // 当前房间已停留多少秒（尚未结算进 roomTimes 的那一段）。
    // 没有进房时刻时返回 0；时钟回拨导致的负值也按 0 处理。
    function currentRoomStaySec(session, now) {
        if (!session || !session.currentRoomEnterTime) return 0;
        const sec = (now - session.currentRoomEnterTime) / 1000;
        return sec > 0 ? sec : 0;
    }

    // 把当前房间尚未结算的停留累加进 session.roomTimes（会改动传入的 session）。
    // 返回这次结算了多少秒，方便打日志。
    function settleRoomStay(session, now) {
        const room = session && session.lastRoom;
        if (!room || !session.currentRoomEnterTime) return 0;

        const stay = currentRoomStaySec(session, now);
        if (!session.roomTimes) session.roomTimes = {};
        session.roomTimes[room] = (session.roomTimes[room] || 0) + stay;
        return stay;
    }

    // 返回一份 roomTimes 副本，里面已补上当前房间尚未结算的停留。
    // 不改传入的 session —— 存档时用这个，避免把「还没切房」的时间写进会话。
    function settledRoomTimes(session, now) {
        const out = Object.assign({}, (session && session.roomTimes) || {});
        const room = session && session.lastRoom;
        if (!room || !session.currentRoomEnterTime) return out;

        out[room] = (out[room] || 0) + currentRoomStaySec(session, now);
        return out;
    }

    return { nowMs, currentRoomStaySec, settleRoomStay, settledRoomTimes };
});
