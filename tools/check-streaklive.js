// 走势条「实时增量」逻辑（CCTOverlay.js 的 liveGolden / noteGoldenProgress /
// buildStreakAttempts）的自检脚本。
//
// 背景：CCT 的 previousAttempts 只在换房时刷新（带金挑战期间连死 N 次，
// 长度内容完全不变）。「暂停死亡追踪」开着时它更是完全不更新——所以覆盖层
// 拿 {room:goldenEntries}/{room:goldenSuccesses} 的增量推断每一局的成败，
// 拼在 previousAttempts 后面。这段增量推断 2026-09-19 全库审查时是零覆盖盲区，
// 本脚本补上，不改产品代码。
//
// 加载方式：读源文件 → 提取「const liveGolden 起、requestGoldenStats 止」
// 整段（含两个函数与共享状态）→ 求值，stub 掉 dlog。该段零 DOM，可以独立求值。
//
// 用法（Git Bash）：node tools/check-streaklive.js
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

// ---- 提取 ----
const start = src.indexOf('const liveGolden = {');
const end = src.indexOf('async function requestGoldenStats');
check('提取区间存在且顺序正确', start >= 0 && end > start,
    'start=' + start + ' end=' + end);
const region = (start >= 0 && end > start) ? src.slice(start, end) : '';
check('区间含 noteGoldenProgress 与 buildStreakAttempts',
    /function\s+noteGoldenProgress\s*\(/.test(region)
    && /function\s+buildStreakAttempts\s*\(/.test(region));

function mkLive() {
    const logs = [];
    const mod = new Function('dlog',
        region + '\nreturn { liveGolden, noteGoldenProgress, buildStreakAttempts };')(
        function () { logs.push(Array.prototype.join.call(arguments, ' ')); });
    return {
        note: (entries, succ, paused) => mod.noteGoldenProgress(String(entries), String(succ), paused === undefined ? true : paused),
        build: (room, base) => mod.buildStreakAttempts({
            room: room,
            previousAttempts: base || [],
        }),
        raw: mod,
        live: mod.liveGolden,
        logs: logs,
    };
}
const sig = (arr) => arr.map(v => v ? '1' : '0').join('');

console.log('=== 1. 暂停追踪下的增量推断 ===');
{
    const f = mkLive();
    f.note(75, 57);
    check('首次喂入只记基准，不产生增量', f.live.extra.length === 0,
        'extra=' + sig(f.live.extra));

    f.note(76, 57);
    check('进入+1、通过不变 → 一局失败（false）', sig(f.live.extra) === '0');

    f.note(77, 57);
    check('连死两次 → false,false', sig(f.live.extra) === '00');

    f.note(78, 58);
    check('进入+1 且通过+1 → 一局成功（true）', sig(f.live.extra) === '001');

    f.note(80, 59);
    check('一批 dEntry=2 dSucc=1 → 失败在前、成功在后（末尾连续通过的语义）',
        sig(f.live.extra) === '00101', 'extra=' + sig(f.live.extra));
}

console.log('=== 2. 异常输入的守卫 ===');
{
    const f = mkLive();
    f.note(75, 57);
    f.note(76, 57);
    const before = sig(f.live.extra);
    f.note(97, 57);            // dEntry=21 > 20 → 异常跳变
    check('dEntry > 20 → 整批丢弃，不污染序列', sig(f.live.extra) === before);
    f.note(98, 57);            // 基准已更新到 97，这次 dEntry=1 正常
    check('异常跳变后从新基准继续（不重复计数）', sig(f.live.extra) === before + '0',
        'extra=' + sig(f.live.extra));

    f.note(98, 57);            // dEntry=0
    check('数值没变 → 忽略', sig(f.live.extra) === before + '0');

    const f2 = mkLive();
    f2.note('x', 'y');         // parse 不了
    f2.note(7, 7);             // 应当作为首次喂入（基准）
    f2.note(8, 7);
    check('非数字输入被忽略，且不污染基准（后续正常推断）',
        sig(f2.live.extra) === '0', 'extra=' + sig(f2.live.extra));
}

console.log('=== 3. 没暂停 → 交给 previousAttempts，不双计 ===');
{
    const f = mkLive();
    f.note(75, 57, true);      // 暂停中，先记基准
    f.note(76, 57, true);
    check('暂停下正常推断', sig(f.live.extra) === '0');
    f.note(77, 57, false);     // 追踪恢复：previousAttempts 自己会刷新
    check('没暂停 → 增量基准被清空（lastEntries=null），extra 冻结不再增长',
        f.live.lastEntries === null && sig(f.live.extra) === '0');
    f.note(78, 57, true);      // 又暂停：重新记基准
    check('恢复暂停 → 先重新记基准（没有把 77 当成新基准前的跳变）',
        f.live.extra.length === 1, 'extra=' + sig(f.live.extra));
    f.note(79, 57, true);
    check('重新基准后继续正常推断', sig(f.live.extra) === '00',
        'extra=' + sig(f.live.extra));
}

console.log('=== 4. buildStreakAttempts：历史基准 + 增量拼接 ===');
{
    // ⚠️ 生产顺序是「先 build 建立基准，再喂增量，再 build 拼接」——
    // buildStreakAttempts 遇到换房/基准长度变化会先清空 extra，所以
    // 「先 note 后首次 build」会把增量冲掉，这是设计行为（换房即重置）。
    const f = mkLive();
    const base = [true, false, true];
    const first = f.build('a-02', base);
    check('首次 build（建立基准）→ 只返回基准', first.length === 3 && sig(first) === '101',
        'got=' + sig(first));

    f.note(75, 57);
    f.note(76, 57);            // extra = [false]
    const out = f.build('a-02', base);
    check('同房同基准 → 拼接结果 = 基准 + extra', out.length === 4 && sig(out) === '1010',
        'got=' + sig(out));
    check('不改动传入的基准数组', base.length === 3 && sig(base) === '101');

    check('snap 为 null → 空数组兜底不炸', f.raw.buildStreakAttempts(null).length === 0);

    f.build('a-03', base);     // 换房间
    check('换房间 → extra 清零（新房间从零观测）', f.live.extra.length === 0);

    const f2 = mkLive();
    f2.build('a-02', [true, false]);   // 建立基准（长度 2）
    f2.note(75, 57);
    f2.note(76, 57);
    f2.build('a-02', [true, false, true]);   // 同房间但 previousAttempts 刷新了
    check('同房间但基准刷新 → extra 清零（避免重复计数）',
        f2.live.extra.length === 0);
}

console.log('=== 5. 增量序列上限（防膨胀）===');
{
    const f = mkLive();
    f.note(0, 0);
    for (let i = 1; i <= 70; i++) f.note(i, 0);   // 每次 +1 进入、通过不变（全 false）
    check('extra 持续增长也被截在 60 以内', f.live.extra.length === 60,
        'length=' + f.live.extra.length);
    check('截断保留的是最近的增量（末尾是 false）', f.live.extra[f.live.extra.length - 1] === false);
}

console.log('=== 6. 提取护栏 ===');
{
    const f = mkLive();
    f.note(75, 57);
    f.note(76, 57);
    check('提取有效：note 确实写入了受控状态', f.live.extra.length === 1);
    check('提取有效：dlog 调用被捕获', f.logs.length > 0,
        'logs=' + f.logs.length + ' 条');
}

const failed = results.filter(r => !r.ok);
console.log('');
console.log(failed.length === 0
    ? '全部通过（' + results.length + ' 项）'
    : failed.length + ' / ' + results.length + ' 项失败');
process.exit(failed.length === 0 ? 0 : 1);
