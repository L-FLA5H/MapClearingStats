// 死亡判定核心（CCTOverlay.js 的 detectDeathsCore）的自检脚本。
//
// 覆盖 issue 04：死亡增量判定（重开首测只记基准 / 正常增量 / 归零重基准 /
// 跨房间隔离）此前零测试——它与 session 全局、DOM（死亡红光）、saveSession
// 耦合，切片手法测不了。2026-09-19 已把纯判定部分抽成 detectDeathsCore
// （零 DOM、零存档、零日志），红光与存档留在外壳 detectDeaths。
// 本脚本按函数边界提取核心函数求值（手法同 check-goldenfsm.js）。
//
// 用法（Git Bash）：node tools/check-deaths.js
// 退出码：0 = 全过，1 = 有失败项。

const fs = require('fs');
const path = require('path');

const results = [];
function check(name, ok, detail) {
    results.push({ name, ok });
    console.log((ok ? '  [通过] ' : '  [失败] ') + name + (detail ? '  → ' + detail : ''));
}

const OVERLAY = path.join(__dirname, '..', 'ExternalOverlay', 'CCTOverlay.js');
const src = fs.readFileSync(OVERLAY, 'utf8');

// ---- 提取核心函数（下一个顶级 function 之前的整段；核心体内无嵌套 function）----
const fnStart = src.indexOf('function detectDeathsCore');
const fnEnd = src.indexOf('\nfunction ', fnStart);
const fnSrc = (fnStart >= 0 && fnEnd > fnStart) ? src.slice(fnStart, fnEnd) : '';
check('detectDeathsCore 函数提取成功',
    /function\s+detectDeathsCore\s*\(/.test(fnSrc));

// 核心必须零 DOM、零存档、零日志（红光/save/dlog 属外壳，混进来就测不了）
check('核心零 DOM / 零存档 / 零日志',
    !/\bdocument\b/.test(fnSrc) && !/\bsaveSession\b/.test(fnSrc) && !/\bdlog\b/.test(fnSrc));

// 外壳还在、且确实把 session.lastCurDeaths 交给了核心（防止核心被架空）
check('外壳 detectDeaths 存在并调用核心',
    /function\s+detectDeaths\s*\(/.test(src)
    && /detectDeathsCore\s*\(\s*session\.lastCurDeaths/.test(src));

const { detectDeathsCore } =
    new Function(fnSrc + '\nreturn { detectDeathsCore: typeof detectDeathsCore === "undefined" ? null : detectDeathsCore };')();
check('核心可独立求值（纯函数）', typeof detectDeathsCore === 'function');

function run(map, room, cur, seed) {
    return detectDeathsCore(map, room, cur, !!seed);
}

console.log('=== 1. 种子基准：重开后的第一次检测只记基准、不计数 ===');
{
    const map = {};
    const r = run(map, 'a-01', 5, true);
    check('种子调用 → delta=0', r.delta === 0);
    check('种子调用 → 只把当前值记为基准', map['a-01'] === 5);
    check('种子调用 → seedOnly 标志翻回 false', r.seedOnly === false && r.rebased === false);

    const r2 = run(map, 'a-01', 7, false);
    check('种子之后的真实增量正常计数（5 → 7 → delta=2）', r2.delta === 2);
}

console.log('=== 2. 正常增量与无变化 ===');
{
    const map = { 'a-01': 0 };
    let r = run(map, 'a-01', 1, false);
    check('0 → 1：delta=1（死亡事件）', r.delta === 1 && map['a-01'] === 1);
    r = run(map, 'a-01', 3, false);
    check('1 → 3：一次跨两次死亡的跳变也如实累计（delta=2）', r.delta === 2 && map['a-01'] === 3);
    r = run(map, 'a-01', 3, false);
    check('数值没变 → delta=0，rebased=false', r.delta === 0 && r.rebased === false);
}

console.log('=== 3. 归零重基准：CCT 开新命把计数清零 ===');
{
    const map = { 'a-01': 3 };
    let r = run(map, 'a-01', 0, false);
    check('3 → 0：delta=0（不产生负数）', r.delta === 0);
    check('3 → 0：rebased=true（外壳据此打「计数归零」日志）', r.rebased === true);
    check('3 → 0：基准更新为 0', map['a-01'] === 0);
    r = run(map, 'a-01', 1, false);
    check('归零后再死一次 → 照常计数（0 → 1 → delta=1）', r.delta === 1);
    check('归零重基准不带出 prev 之外的 delta', r.delta === 1 && r.prev === 0);
}

console.log('=== 4. 跨房间隔离：A 房的基准不影响 B 房的判定 ===');
{
    const map = { 'a-01': 2 };   // 之前在 a-01 攒下 2
    const r = run(map, 'a-02', 1, false);
    check('首次进入 a-02（prev=0）→ cur=1 全额计入 a-02', r.delta === 1);
    check('a-01 的基准原封不动', map['a-01'] === 2);
    check('a-02 的基准已记录', map['a-02'] === 1);

    const r2 = run(map, 'a-01', 1, false);
    check('回到 a-01：当前命在 a-01 的死亡数(1) < 基准(2) → 归零重基准，不误计',
        r2.delta === 0 && r2.rebased === true && map['a-01'] === 1);
}

console.log('=== 5. 边界与防炸 ===');
{
    const r = run(null, 'a-01', 3, false);
    check('状态袋为 null → 不炸，按 prev=0 处理', r.delta === 3);

    const map = {};
    const r2 = run(map, '', 2, false);
    check('房间名为空串 → 不炸，按独立键处理', r2.delta === 2 && map[''] === 2);

    const map3 = { 'a-01': 4 };
    const r3 = run(map3, 'a-01', 4, false);
    check('cur === prev（恰好相等）→ delta=0 且不算 rebased', r3.delta === 0 && r3.rebased === false);
}

const failed = results.filter(r => !r.ok);
console.log('');
console.log(failed.length === 0
    ? '全部通过（' + results.length + ' 项）'
    : failed.length + ' / ' + results.length + ' 项失败');
process.exit(failed.length === 0 ? 0 : 1);
