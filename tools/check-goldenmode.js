// 一命模式三态表（CCTOverlay.js 的 GOLDEN_MODE 分区）的自检脚本。
//
// 对应 issue #2：模式状态以前用一个布尔 goldenModeOn 表示（金/银另存一处），
// 「这个模式下我该怎样」的知识散在 8 个渲染函数里各自写 if；
// 「带金 / 带银」的文案重复 5 处。现在统一收进 GOLDEN_MODE 配置表（三态 + 显式字段）。
//
// ⚠️⚠️ 其中两个字段是**从真实 bug 换来的约束**，本脚本专门锁它们：
//      hideRoomInfoRow     —— 一命模式下 .room-info-row 必须**无条件**隐藏
//                             （加过「没走势数据就放出来」的兜底，反而出了 bug）
//      streakKeepWhenEmpty —— 一命模式下走势条没数据也要**保留整条**
//                             （换成一行文字会让这一行宽度跳动、第二张卡片空白）
//    谁把它们改成 false，这里就会红。
//
// 本脚本与 check-cctclient.js / cct-dump.js 用同一种方式加载：
// 读源文件 → 按切片标记取段 → 求值。所以 GOLDEN_MODE 必须是纯数据（零 DOM）。
//
// 用法（Git Bash）：node tools/check-goldenmode.js
// 退出码：0 = 全过，1 = 有失败项。

const fs = require('fs');
const path = require('path');

const results = [];
function check(name, ok, detail) {
    results.push({ name, ok });
    console.log((ok ? '  [通过] ' : '  [失败] ') + name + (detail ? '  → ' + detail : ''));
}

// ---- 与 cct-dump.js 相同的加载方式 ----
const OVERLAY = path.join(__dirname, '..', 'ExternalOverlay', 'CCTOverlay.js');
const src = fs.readFileSync(OVERLAY, 'utf8');

const begin = src.indexOf('// ==== GoldenMode BEGIN');
const end = src.indexOf('// ==== GoldenMode END');
check('切片标记存在且顺序正确', begin >= 0 && end > begin,
    'begin=' + begin + ' end=' + end);

const section = begin >= 0 && end > begin ? src.slice(begin, end) : '';
const { GOLDEN_MODE, goldenModeByName } =
    new Function(section + '\nreturn { GOLDEN_MODE: typeof GOLDEN_MODE === "undefined" ? null : GOLDEN_MODE, goldenModeByName: typeof goldenModeByName === "undefined" ? null : goldenModeByName };')();
check('切片可独立求值（纯数据、零 DOM）',
    !!GOLDEN_MODE && typeof goldenModeByName === 'function');

const FIELDS = ['name', 'challenge', 'isSilver', 'usesGoldenStats', 'usesStreak',
                'streakKeepWhenEmpty', 'hideRoomInfoRow', 'writesLegacyTimers',
                'badgeText', 'label', 'rateLabel', 'deathWord'];
const MODES = ['normal', 'gold', 'silver'];

console.log('=== 1. 三态齐全、字段不缺 ===');
{
    const names = Object.keys(GOLDEN_MODE);
    check('恰好三个模式：normal / gold / silver',
        names.length === 3 && names.join(',') === MODES.join(','), names.join(',') || '(空)');

    MODES.forEach(function (n) {
        const missing = FIELDS.filter(f => !Object.prototype.hasOwnProperty.call(GOLDEN_MODE[n] || {}, f));
        check('「' + n + '」字段齐全（' + FIELDS.length + ' 项）',
            missing.length === 0, missing.length ? '缺: ' + missing.join(', ') : 'ok');
    });
    check('每个模式的 name 与它的键一致',
        MODES.every(n => GOLDEN_MODE[n].name === n));
}

console.log('');
console.log('=== 2. ⚠️ 两条从 bug 换来的约束（别改成 false） ===');
{
    ['gold', 'silver'].forEach(function (n) {
        check('「' + n + '」hideRoomInfoRow = true（.room-info-row 无条件隐藏）',
            GOLDEN_MODE[n].hideRoomInfoRow === true);
        check('「' + n + '」streakKeepWhenEmpty = true（走势条没数据也保留整条）',
            GOLDEN_MODE[n].streakKeepWhenEmpty === true);
    });
    check('初见模式两条都是 false（那是挑战模式专属的布局约定）',
        GOLDEN_MODE.normal.hideRoomInfoRow === false
        && GOLDEN_MODE.normal.streakKeepWhenEmpty === false);
}

console.log('');
console.log('=== 3. 三态之间的差异符合预期 ===');
{
    check('normal 不在挑战中；gold / silver 在挑战中',
        GOLDEN_MODE.normal.challenge === false
        && GOLDEN_MODE.gold.challenge === true
        && GOLDEN_MODE.silver.challenge === true);
    check('只有 silver 挂银主题（isSilver）',
        GOLDEN_MODE.normal.isSilver === false
        && GOLDEN_MODE.gold.isSilver === false
        && GOLDEN_MODE.silver.isSilver === true);
    check('gold / silver 都拉成功率数据、都画走势条',
        GOLDEN_MODE.gold.usesGoldenStats === true && GOLDEN_MODE.gold.usesStreak === true
        && GOLDEN_MODE.silver.usesGoldenStats === true && GOLDEN_MODE.silver.usesStreak === true);
    check('normal 既不拉成功率也不画走势条',
        GOLDEN_MODE.normal.usesGoldenStats === false
        && GOLDEN_MODE.normal.usesStreak === false);
    check('「总用时 / 本面用时」只有初见模式才写（writesLegacyTimers）',
        GOLDEN_MODE.normal.writesLegacyTimers === true
        && GOLDEN_MODE.gold.writesLegacyTimers === false
        && GOLDEN_MODE.silver.writesLegacyTimers === false);
}

console.log('');
console.log('=== 4. 文案只写一处：金 / 银别写反，normal 故意留空 ===');
{
    check('gold 的四处文案都是「带金…」',
        GOLDEN_MODE.gold.badgeText === '带金'
        && GOLDEN_MODE.gold.label === '带金'
        && GOLDEN_MODE.gold.rateLabel === '带金成功率'
        && GOLDEN_MODE.gold.deathWord === '带金死亡');
    check('silver 的四处文案都是「带银…」',
        GOLDEN_MODE.silver.badgeText === '带银'
        && GOLDEN_MODE.silver.label === '带银'
        && GOLDEN_MODE.silver.rateLabel === '带银成功率'
        && GOLDEN_MODE.silver.deathWord === '带银死亡');
    check('gold / silver 的文案两两不同（防复制粘贴时忘改）',
        GOLDEN_MODE.gold.badgeText !== GOLDEN_MODE.silver.badgeText
        && GOLDEN_MODE.gold.label !== GOLDEN_MODE.silver.label
        && GOLDEN_MODE.gold.rateLabel !== GOLDEN_MODE.silver.rateLabel
        && GOLDEN_MODE.gold.deathWord !== GOLDEN_MODE.silver.deathWord);
    check('normal 的文案字段故意留空（误用会立刻显形，而不是悄悄显示「带金」）',
        GOLDEN_MODE.normal.badgeText === '' && GOLDEN_MODE.normal.label === ''
        && GOLDEN_MODE.normal.rateLabel === '' && GOLDEN_MODE.normal.deathWord === '');
}

console.log('');
console.log('=== 5. 取用入口：未知名字一律退回 normal ===');
{
    check('按名字取到的就是表里那条（同一个对象）',
        goldenModeByName('gold') === GOLDEN_MODE.gold
        && goldenModeByName('silver') === GOLDEN_MODE.silver);
    check('未知名字 / 空值 / 不传 → 退回 normal，不抛错',
        goldenModeByName('nope').name === 'normal'
        && goldenModeByName('').name === 'normal'
        && goldenModeByName().name === 'normal'
        && goldenModeByName(null).name === 'normal');
}

console.log('');
console.log('=== 6. 状态只剩一处：旧的布尔双变量必须彻底消失 ===');
{
    // 去掉注释再查，避免说明性文字误伤
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    check('代码里已无 goldenModeOn（旧的「是否在挑战中」布尔）',
        !/\bgoldenModeOn\b/.test(code));
    check('代码里已无 goldenTypeCache（金/银另存的那一处）',
        !/\bgoldenTypeCache\b/.test(code));
    check('三态变量 goldenModeName 存在，取值统一走 curGoldenMode()',
        /\blet\s+goldenModeName\s*=\s*"normal"/.test(code)
        && /function\s+curGoldenMode\s*\(/.test(code));

    // 唯一写入点：所有赋值都应在 updateGoldenMode 函数体内（声明那处除外）
    const fnStart = code.indexOf('function updateGoldenMode');
    const fnEnd = code.indexOf('\nfunction ', fnStart + 1);
    const fnBody = fnStart < 0 ? '' : code.slice(fnStart, fnEnd < 0 ? code.length : fnEnd);
    const all = (code.match(/\bgoldenModeName\s*=/g) || []).length;
    const inside = (fnBody.match(/\bgoldenModeName\s*=/g) || []).length;
    check('goldenModeName 的写入只在 updateGoldenMode 内（外加声明一处）',
        fnStart >= 0 && all === inside + 1,
        '全文 ' + all + ' 处 · 函数内 ' + inside + ' 处');
}

console.log('');
console.log('=== 7. 文案不再散落（静态扫描整份源码） ===');
{
    // 「带金 / 带银」开头的字符串字面量，只允许出现在 GoldenMode 切片以内
    const re = /"带[金银][^"]*"/g;
    const outside = [];
    let m;
    while ((m = re.exec(src)) !== null) {
        if (m.index < begin || m.index >= end) outside.push(m[0]);
    }
    check('「带金 / 带银」字面量只出现在 GoldenMode 切片内',
        outside.length === 0,
        outside.length ? '切片外还有: ' + [...new Set(outside)].join(', ') : '切片外 0 处');
}

const failed = results.filter(r => !r.ok);
console.log('');
console.log(failed.length === 0
    ? '全部通过（' + results.length + ' 项）'
    : failed.length + ' / ' + results.length + ' 项失败');
process.exit(failed.length === 0 ? 0 : 1);
