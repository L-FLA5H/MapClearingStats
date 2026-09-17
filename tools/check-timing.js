// 房间用时计时模块（ExternalOverlay/Timing.js）的自检脚本。
//
// 覆盖 issue #1：以前「当前房间停留多久」这道公式写在 CCTOverlay.js 的四处，
// 各用各的时钟。现在全部收到 Timing.js，这里用纯 Node 验证它的行为。
//
// 用法（Git Bash）：node tools/check-timing.js
// 退出码：0 = 全过，1 = 有失败项。

const fs = require('fs');
const path = require('path');

const Timing = require(path.join(__dirname, '..', 'ExternalOverlay', 'Timing.js'));

const results = [];
function check(name, ok, detail) {
    results.push({ name, ok });
    console.log((ok ? '  [通过] ' : '  [失败] ') + name + (detail ? '  → ' + detail : ''));
}

function near(a, b, eps) {
    return Math.abs(a - b) < (eps === undefined ? 1e-6 : eps);
}

// 造一个最小会话对象
function mkSession(over) {
    return Object.assign({
        chapterName: 'test',
        lastRoom: 'a-01',
        currentRoomEnterTime: 0,
        roomTimes: {},
        visitedRooms: {},
        isPaused: false,
        pauseStartTime: 0,
        startTime: 0,
    }, over || {});
}

console.log('=== 1. nowMs：统一的时钟口径 ===');
{
    const s = mkSession({ isPaused: false, pauseStartTime: 123 });
    const before = Date.now();
    const got = Timing.nowMs(s);
    const after = Date.now();
    check('未暂停 → 返回真实当前时间', got >= before && got <= after);

    const p = mkSession({ isPaused: true, pauseStartTime: 6000 });
    check('暂停中 → 冻结在暂停那一刻', Timing.nowMs(p) === 6000);

    const p2 = mkSession({ isPaused: true, pauseStartTime: 0 });
    check('暂停但没有 pauseStartTime → 退回真实时间（和旧 effNow 一致）',
        Timing.nowMs(p2) > 0 && Timing.nowMs(p2) !== 0);
}

console.log('=== 2. currentRoomStaySec：当前房间已停留秒数 ===');
{
    const s = mkSession({ currentRoomEnterTime: 1000 });
    check('正常：停留 4 秒', near(Timing.currentRoomStaySec(s, 5000), 4));
    check('没进过房（enterTime 为 0）→ 0', Timing.currentRoomStaySec(mkSession(), 5000) === 0);
    check('时钟回拨（now < enterTime）→ 0，不产生负数',
        Timing.currentRoomStaySec(mkSession({ currentRoomEnterTime: 9000 }), 5000) === 0);
    check('null session 不炸', Timing.currentRoomStaySec(null, 5000) === 0);
}

console.log('=== 3. settleRoomStay：结算并写回 session ===');
{
    const s = mkSession({ currentRoomEnterTime: 1000, roomTimes: { 'a-01': 2 } });
    const stay = Timing.settleRoomStay(s, 5000);
    check('返回本次结算秒数', near(stay, 4), 'stay=' + stay);
    check('累加进 roomTimes', near(s.roomTimes['a-01'], 6), 'roomTimes=' + JSON.stringify(s.roomTimes));

    const s2 = mkSession({ currentRoomEnterTime: 1000, roomTimes: {} });
    Timing.settleRoomStay(s2, 5000);
    check('房间第一次结算 → 从 0 起算', near(s2.roomTimes['a-01'], 4));

    const s3 = mkSession({ lastRoom: '', currentRoomEnterTime: 1000, roomTimes: {} });
    check('没有 lastRoom → 不结算，返回 0', Timing.settleRoomStay(s3, 5000) === 0);
    check('没有 lastRoom → roomTimes 没被污染', Object.keys(s3.roomTimes).length === 0);

    const s4 = mkSession({ currentRoomEnterTime: 1000 });
    delete s4.roomTimes;
    check('roomTimes 缺失 → 自动创建，不抛错', Timing.settleRoomStay(s4, 5000) === 4);
}

console.log('=== 4. settledRoomTimes：存档用，不改动原会话 ===');
{
    const s = mkSession({ currentRoomEnterTime: 1000, roomTimes: { 'a-01': 2 } });
    const snap = JSON.stringify(s.roomTimes);
    const out = Timing.settledRoomTimes(s, 5000);
    check('副本里补上了未结算的停留', near(out['a-01'], 6), 'out=' + JSON.stringify(out));
    check('原 session 没被改动（存档不该写回会话）', JSON.stringify(s.roomTimes) === snap);

    const s2 = mkSession({ lastRoom: '', currentRoomEnterTime: 1000, roomTimes: { 'a-01': 2 } });
    check('没有 lastRoom → 原样返回副本', near(Timing.settledRoomTimes(s2, 5000)['a-01'], 2));
}

console.log('=== 5. 暂停补偿：暂停时长不能被算进用时 ===');
{
    // 1000 进房，6000 暂停，现在真实时间 11000
    // 旧逻辑（存档路径）用 effNow() → 6000，所以算出来的停留是 5 秒，而不是 10 秒。
    const s = mkSession({
        currentRoomEnterTime: 1000,
        isPaused: true,
        pauseStartTime: 6000,
        roomTimes: {},
    });
    check('暂停中结算 → 只算到暂停那一刻（5 秒），不含暂停后的 5 秒',
        near(Timing.currentRoomStaySec(s, Timing.nowMs(s)), 5),
        'got=' + Timing.currentRoomStaySec(s, Timing.nowMs(s)));

    // 恢复后 resumeTimer() 把进房时刻往后推 5000，再结算应同样是 5 秒
    const s2 = mkSession({ currentRoomEnterTime: 1000 + 5000, isPaused: false, roomTimes: {} });
    check('恢复后（进房时刻已补偿）结算 → 同样是 5 秒',
        near(Timing.currentRoomStaySec(s2, 11000), 5),
        'got=' + Timing.currentRoomStaySec(s2, 11000));
}

console.log('=== 6. 与旧公式等价（未暂停时） ===');
{
    const enter = 1000, now = 8500, accumulated = 3;
    const s = mkSession({ currentRoomEnterTime: enter, roomTimes: { 'a-01': accumulated } });
    const oldFormula = accumulated + (now - enter) / 1000;          // 旧 tick / 显示用的算法
    const newFormula = accumulated + Timing.currentRoomStaySec(s, now);
    check('未暂停时新旧算法结果一致', near(oldFormula, newFormula), oldFormula + ' vs ' + newFormula);
}

console.log('=== 7. 结构检查：CCTOverlay.js 里不该再有这道公式 ===');
{
    const src = fs.readFileSync(
        path.join(__dirname, '..', 'ExternalOverlay', 'CCTOverlay.js'), 'utf8');
    const rawFormula = /Date\.now\(\)\s*-\s*session\.currentRoomEnterTime/;
    check('CCTOverlay.js 里已无手写的停留时间公式', !rawFormula.test(src));
    check('CCTOverlay.js 里已无 effNow()', !/effNow\s*\(/.test(src.replace(/effNow\(\) 已经合并/g, '')));
    check('CCTOverlay.html 已引入 Timing.js',
        /Timing\.js/.test(fs.readFileSync(
            path.join(__dirname, '..', 'ExternalOverlay', 'CCTOverlay.html'), 'utf8')));
}

const failed = results.filter(r => !r.ok);
console.log('');
console.log(failed.length === 0
    ? '全部通过（' + results.length + ' 项）'
    : failed.length + ' / ' + results.length + ' 项失败');
process.exit(failed.length === 0 ? 0 : 1);
