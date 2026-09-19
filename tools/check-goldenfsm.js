// 一命模式状态机（CCTOverlay.js 的 updateGoldenMode）的自检脚本。
//
// ⚠️ 这是全文件最复杂的纯逻辑：拿起 / 掉落冷却窗口 / 死亡立即退出 /
//    死亡后 2.5s 锁定期 / 金银类型后补 / 换章节重置。2026-09-19 全库审查时
//    它是零覆盖盲区（见 .scratch/architecture-review/issues/ 同期记录），
//    本脚本补上，不改产品代码。
//
// 加载方式与 check-goldenmode.js / check-cctclient.js 同源：读源文件 →
// GoldenMode 切片求值（拿 GOLDEN_MODE 表）→ 按函数边界提取 updateGoldenMode →
// 在受控作用域里求值（stub 掉 dlog 与 Date.now，状态变量由本脚本声明）。
//
// ⚠️ 调用约定：goldenType 参数是 readGoldenType 归一化后的值（0=金，2=银），
//    不是 CCT 的原始 goldenType——别拿 1 来测。
//
// 用法（Git Bash）：node tools/check-goldenfsm.js
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

// ---- 提取 GoldenMode 切片（同 check-goldenmode.js）----
const gmBegin = src.indexOf('// ==== GoldenMode BEGIN');
const gmEnd = src.indexOf('// ==== GoldenMode END');
check('GoldenMode 切片标记存在且顺序正确', gmBegin >= 0 && gmEnd > gmBegin,
    'begin=' + gmBegin + ' end=' + gmEnd);
const gmSection = gmBegin >= 0 && gmEnd > gmBegin ? src.slice(gmBegin, gmEnd) : '';
const { GOLDEN_MODE, goldenModeByName } =
    new Function(gmSection + '\nreturn { GOLDEN_MODE: typeof GOLDEN_MODE === "undefined" ? null : GOLDEN_MODE, goldenModeByName: typeof goldenModeByName === "undefined" ? null : goldenModeByName };')();
check('GoldenMode 切片可独立求值', !!GOLDEN_MODE && typeof goldenModeByName === 'function');

// ---- 提取 updateGoldenMode 函数本体 ----
// 下一处顶级 function 声明之前的整段就是它（函数体内没有嵌套 function 声明）。
const fnStart = src.indexOf('function updateGoldenMode');
const fnEnd = src.indexOf('\nfunction ', fnStart);
const fnSrc = (fnStart >= 0 && fnEnd > fnStart) ? src.slice(fnStart, fnEnd) : '';
check('updateGoldenMode 函数提取成功', fnSrc.length > 0
    && /function\s+updateGoldenMode\s*\(/.test(fnSrc));

// 冷却窗口 / 锁定期的时长从源码里抠出来——源码改了数值，测试自动跟随，
// 不在本脚本里另抄一份常量。
const graceM = src.match(/const\s+GOLDEN_DROP_GRACE_MS\s*=\s*(\d+)/);
const holdM = src.match(/const\s+GOLDEN_DEATH_HOLD_MS\s*=\s*(\d+)/);
check('GOLDEN_DROP_GRACE_MS / GOLDEN_DEATH_HOLD_MS 能从源码提取',
    !!graceM && !!holdM, 'grace=' + (graceM && graceM[1]) + ' hold=' + (holdM && holdM[1]));
const GRACE = graceM ? Number(graceM[1]) : 500;
const HOLD = holdM ? Number(holdM[1]) : 2500;

// ---- 受控工厂：每次造一台全新的状态机（隔离各用例的状态）----
// Date 用假时钟替换（函数内只调 Date.now()），dlog 收进 logs。
function mkFsm(t0) {
    let t = t0;
    const logs = [];
    const prelude = [
        'let goldenModeChapter = null;',
        'let goldenModeName = "normal";',
        'let goldenDropAt = 0;',
        'let goldenDiedAt = 0;',
        'let goldenRunSec = 0;',
        'let goldenRunTickAt = 0;',
        'const GOLDEN_DROP_GRACE_MS = ' + GRACE + ';',
        'const GOLDEN_DEATH_HOLD_MS = ' + HOLD + ';',
        'function curGoldenMode() { return goldenModeByName(goldenModeName); }',
    ].join('\n');
    const fn = new Function('GOLDEN_MODE', 'goldenModeByName', 'dlog', 'Date',
        prelude + '\n' + fnSrc + '\n' +
        'return { update: updateGoldenMode, snap: function () { return { name: goldenModeName, chapter: goldenModeChapter, dropAt: goldenDropAt, diedAt: goldenDiedAt }; } };');
    const api = fn(GOLDEN_MODE, goldenModeByName, function () { logs.push(Array.prototype.join.call(arguments, ' ')); }, { now: () => t });
    return {
        update: api.update,
        snap: api.snap,
        logs: logs,
        tick: (ms) => { t += ms; },   // 时间前进
    };
}

const GOLD = 'gold', SILVER = 'silver', NORMAL = 'normal';

console.log('=== 1. 拿起草莓 → 进入一命模式 ===');
{
    const f = mkFsm(10000);
    let changed = f.update('Ch1', 0, true, false);
    check('拿起金草莓（gt=0）→ gold 且 changed=true', f.snap().name === GOLD && changed === true);
    changed = f.update('Ch1', 0, true, false);
    check('持续拿着 → changed=false（不重播切换动画）', changed === false && f.snap().name === GOLD);

    const f2 = mkFsm(10000);
    changed = f2.update('Ch1', 2, true, false);
    check('拿起时 gt 已是 2 → 直接 silver', f2.snap().name === SILVER && changed === true);

    const f3 = mkFsm(10000);
    f3.update('Ch1', 0, true, false);
    f3.tick(60000);
    changed = f3.update('Ch1', 2, true, false);
    check('金银后补：gold 途中拿到 gt=2 → 切 silver 且 changed=true',
        f3.snap().name === SILVER && changed === true);
    changed = f3.update('Ch1', 2, true, false);
    check('后补完成后不再翻动（changed=false）', changed === false && f3.snap().name === SILVER);

    const f4 = mkFsm(10000);
    changed = f4.update('Ch1', 2, false, false);
    check('没拿草莓时 gt=2 不会把初见切去银（后补只对挑战态生效）',
        f4.snap().name === NORMAL && changed === false);
}

console.log('=== 2. 死亡 → 立即退出 + 锁定期 ===');
{
    const f = mkFsm(10000);
    f.update('Ch1', 0, true, false);
    let changed = f.update('Ch1', 0, true, true);
    check('挑战中死亡 → 立即回 normal（不等手持标志滞后）',
        f.snap().name === NORMAL && changed === true);
    check('死亡时刻被记录（goldenDiedAt）', f.snap().diedAt === 10000);

    f.tick(1000);
    changed = f.update('Ch1', 0, true, false);
    check('锁定期（<' + HOLD + 'ms）内重新拿起 → 被挡住，保持 normal',
        f.snap().name === NORMAL && changed === false);

    f.tick(HOLD - 1000 + 100);   // 越过锁定期
    changed = f.update('Ch1', 0, true, false);
    check('锁定期过后拿起 → 重新进入 gold',
        f.snap().name === GOLD && changed === true);

    const f2 = mkFsm(10000);
    f2.update('Ch1', 0, true, false);
    f2.update('Ch1', 0, false, true);   // 死亡瞬间草莓已掉（holding=false 也要退）
    check('死亡瞬间手持标志已是 false → 同样立即退出',
        f2.snap().name === NORMAL);

    const f3 = mkFsm(10000);
    f3.update('Ch1', 0, false, true);   // 初见练习中的死亡
    check('初见时的死亡不设锁（diedAt 不记录）', f3.snap().diedAt === 0);
    changed = f3.update('Ch1', 0, true, false);
    check('练习死亡后立刻拿起 → 不被挡，直接进 gold',
        f3.snap().name === GOLD && changed === true);
}

console.log('=== 3. 非死亡掉草莓 → 冷却窗口（' + GRACE + 'ms）===');
{
    const f = mkFsm(10000);
    f.update('Ch1', 0, true, false);
    let changed = f.update('Ch1', 0, false, false);
    check('掉草莓瞬间 → 记冷却起点，模式暂不变（changed=false）',
        f.snap().name === GOLD && f.snap().dropAt === 10000 && changed === false);

    f.tick(GRACE - 100);
    changed = f.update('Ch1', 0, true, false);
    check('窗口内重新拿起 → 回到原模式，不重播（changed=false）',
        f.snap().name === GOLD && f.snap().dropAt === 0 && changed === false);

    const f2 = mkFsm(10000);
    f2.update('Ch1', 0, true, false);
    f2.update('Ch1', 0, false, false);
    f2.tick(GRACE + 100);
    changed = f2.update('Ch1', 0, false, false);
    check('窗口过后仍没拿起 → 退回 normal 且 changed=true',
        f2.snap().name === NORMAL && changed === true);
}

console.log('=== 4. 换章节 → 全量重置 ===');
{
    const f = mkFsm(10000);
    f.update('Ch1', 0, true, false);
    f.update('Ch1', 0, true, true);          // 死亡，diedAt 已记录
    f.tick(100);                              // 仍在锁定期内
    let changed = f.update('Ch2', 0, true, false);
    check('换章节后（锁定期内）拿草莓 → 能立即进入（证明 diedAt/dropAt 被清）',
        f.snap().name === GOLD && changed === true && f.snap().diedAt === 0 && f.snap().dropAt === 0);

    const f2 = mkFsm(10000);
    f2.update('Ch1', 0, true, false);
    changed = f2.update('Ch2', 0, false, false);
    check('换章节但没拿草莓 → 停在 normal，不误进挑战',
        f2.snap().name === NORMAL && changed === false);
}

console.log('=== 5. 提取护栏：状态机真的在操作本脚本声明的状态 ===');
{
    // 防止提取手法悄悄失效（比如函数被改名/搬走后拿到空壳，上面的断言全在测空转）。
    // 用一个「必然改变状态」的序列验证 snap 能看到变化。
    const f = mkFsm(10000);
    check('提取有效：拿起后 snap.name 确实变化',
        (f.update('Ch1', 0, true, false), f.snap().name) === GOLD);
    check('提取有效：dlog 调用被捕获（非静默空转）', f.logs.length > 0,
        'logs=' + f.logs.length + ' 条');
    const f2 = mkFsm(10000);
    (f2.update('Ch1', 0, true, false), f2.update('Ch1', 0, false, false));
    check('提取有效：冷却起点写进了受控状态', f2.snap().dropAt === 10000);
}

const failed = results.filter(r => !r.ok);
console.log('');
console.log(failed.length === 0
    ? '全部通过（' + results.length + ' 项）'
    : failed.length + ' / ' + results.length + ' 项失败');
process.exit(failed.length === 0 ? 0 : 1);
