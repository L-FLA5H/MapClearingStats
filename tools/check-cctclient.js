// CCT 数据格式收敛模块（CCTOverlay.js 的 CctClient 分区）的自检脚本。
//
// 覆盖 issue #3：CCT 的字段名、goldenType 反直觉映射、占位符表以前散在
// 主代码和 tools 里各抄一份，现在全部收进 CctClient 分区（切片标记之内）。
// 本脚本与 tools/cct-dump.js 用同一种方式加载它：读源文件 → 按标记切片 → 求值。
//
// 用法（Git Bash）：node tools/check-cctclient.js
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

const begin = src.indexOf('// ==== CctClient BEGIN');
const end = src.indexOf('// ==== CctClient END');
check('切片标记存在且顺序正确', begin >= 0 && end > begin,
    'begin=' + begin + ' end=' + end);

const section = src.slice(begin, end);
const CctClient = new Function(section + '\nreturn CctClient;')();
check('切片可独立求值（纯函数、零外部引用）', !!CctClient
    && typeof CctClient.goldenType === 'function'
    && typeof CctClient.snapshot === 'function');

console.log('=== 1. goldenType：反直觉映射与容错 ===');
{
    const mk = (cs, mod) => ({
        stats: cs === undefined ? undefined : { chapterStats: cs },
        state: mod === undefined ? undefined : { modState: mod },
    });

    let r = CctClient.goldenType(mk({ goldenType: 0 }).stats, mk().state);
    check('goldenType=0 → 金', r.raw === 0 && r.isSilver === false);

    r = CctClient.goldenType(mk({ goldenType: 1 }).stats, mk().state);
    check('goldenType=1 → 银（实测映射，别再写反）', r.raw === 1 && r.isSilver === true);

    r = CctClient.goldenType(mk({ goldenType: 2 }).stats, mk().state);
    check('goldenType=2 → 银', r.raw === 2 && r.isSilver === true);

    r = CctClient.goldenType(mk({ goldenType: 3 }).stats, mk().state);
    check('goldenType=3 → 按银处理（万一 CCT 用 3 表示银）', r.raw === 3 && r.isSilver === true);

    r = CctClient.goldenType(mk({ goldenType: "2" }).stats, mk().state);
    check('字符串 "2" → 转 Number 后按银', r.raw === 2 && r.isSilver === true);

    r = CctClient.goldenType(undefined, undefined);
    check('两个来源都缺 → 默认金', r.raw === 0 && r.isSilver === false);

    r = CctClient.goldenType({ chapterStats: null }, { modState: null });
    check('来源对象为 null → 默认金，不抛错', r.raw === 0 && r.isSilver === false);

    r = CctClient.goldenType(mk(undefined, { goldenType: 1 }).stats, mk(undefined, { goldenType: 1 }).state);
    check('备用来源 modState.goldenType=1 → 银', r.raw === 1 && r.isSilver === true);

    r = CctClient.goldenType(mk({ goldenType: 0 }, { goldenType: 1 }).stats, mk({ goldenType: 0 }, { goldenType: 1 }).state);
    check('主来源 0 优先于备用 1（0 是合法值，不是缺省）', r.raw === 0 && r.isSilver === false);

    r = CctClient.goldenType(mk({ goldenType: 7 }).stats, mk().state);
    check('原始值带回（fromChapterStats=7）', r.fromChapterStats === 7);
}

console.log('=== 2. snapshot：字段归一化与 null 安全 ===');
{
    const full = {
        chapterName: 'ZZ-HeartSide',
        currentRoom: {
            debugRoomName: 'a-02',
            deathsInCurrentRun: 3,
            previousAttempts: [true, false, true],
            goldenBerryDeaths: 5,
            goldenBerryDeathsSession: 2,
            successStreak: 4,
            successStreakBest: 7,
        },
        modState: { playerIsHoldingGolden: true, deathTrackingPaused: true },
    };
    let s = CctClient.snapshot(full);
    check('chapterName 归一化', s.chapterName === 'ZZ-HeartSide');
    check('room ← debugRoomName', s.room === 'a-02');
    check('holdingGolden ← playerIsHoldingGolden', s.holdingGolden === true);
    check('trackingPaused ← deathTrackingPaused', s.trackingPaused === true);
    check('deathsInCurrentRun 直通', s.deathsInCurrentRun === 3);
    check('previousAttempts 数组直通', Array.isArray(s.previousAttempts) && s.previousAttempts.length === 3);
    check('带金死亡字段直通', s.goldenBerryDeaths === 5 && s.goldenBerryDeathsSession === 2);
    check('successStreak/Best 直通（streakBest 的历史基准，缺了会悄悄退化）',
        s.successStreak === 4 && s.successStreakBest === 7);

    s = CctClient.snapshot(null);
    check('null state → 全空快照，不抛错',
        s.room === '' && s.holdingGolden === false && s.deathsInCurrentRun === 0
        && Array.isArray(s.previousAttempts) && s.previousAttempts.length === 0
        && s.successStreak === 0 && s.successStreakBest === 0);

    s = CctClient.snapshot({ currentRoom: { previousAttempts: '不是数组' } });
    check('previousAttempts 非数组 → 空数组兜底', Array.isArray(s.previousAttempts) && s.previousAttempts.length === 0);
}

console.log('=== 3. 占位符表：顺序即下标含义，勿调换 ===');
{
    const G = CctClient.GOLDEN_STATS_PLACEHOLDERS;
    const expected = [
        '{room:goldenSuccessRate}',      // 0 带金成功率
        '{room:goldenSuccesses}',        // 1 带金通过数
        '{room:goldenEntries}',          // 2 带金进入次数
        '{room:goldenEntryChance}',      // 3 带金进入率
        '{run:currentPbStatusNumber}',   // 4 局数
        '{chapter:goldenDeaths}',        // 5 带金死亡（本章累计）
        '{chapter:goldenDeathsSession}', // 6 带金死亡（本次会话）
    ];
    check('覆盖层表共 7 项', G.length === 7, '实际 ' + G.length);
    check('顺序与 writeGoldenStats 的下标含义一致',
        expected.every((p, i) => G[i] === p), JSON.stringify(G));

    const P = CctClient.PROBE_PLACEHOLDERS;
    check('探针表共 27 项', P.length === 27, '实际 ' + P.length);
    check('探针表覆盖覆盖层表的每一项',
        G.every(p => P.includes(p)),
        '缺失: ' + G.filter(p => !P.includes(p)).join(', '));
    check('两张表内部均无重复项',
        new Set(G).size === G.length && new Set(P).size === P.length);
    check('chokeRate 只出现在探针表（它是卡关率，不是进入率）',
        !G.includes('{room:chokeRate}') && P.includes('{room:chokeRate}'));
}

console.log('=== 4. 部署结构不变：HTML 两脚本、$FILES 四项 ===');
{
    const html = fs.readFileSync(
        path.join(__dirname, '..', 'ExternalOverlay', 'CCTOverlay.html'), 'utf8');
    const scripts = html.match(/<script src="[^"]+"><\/script>/g) || [];
    check('HTML 只引 Timing.js 与 CCTOverlay.js 两个脚本', scripts.length === 2
        && scripts.some(x => x.includes('Timing.js'))
        && scripts.some(x => x.includes('CCTOverlay.js')), JSON.stringify(scripts));

    const deploy = fs.readFileSync(path.join(__dirname, '..', 'tools', 'deploy-overlay.ps1'), 'utf8');
    const m = deploy.match(/\$FILES\s*=\s*@\(([^)]+)\)/);
    check('deploy-overlay.ps1 的 $FILES 仍是 4 项（Timing + 三件套）',
        !!m && (m[1].match(/"/g) || []).length === 8, m ? m[1].trim() : '未找到 $FILES');

    check('切片标记各只出现一次',
        src.split('// ==== CctClient BEGIN').length === 2
        && src.split('// ==== CctClient END').length === 2);
}

console.log('=== 5. diag.ps1 保持独立，但其占位符都是主表的子集 ===');
{
    const diag = fs.readFileSync(path.join(__dirname, '..', 'tools', 'diag.ps1'), 'utf8');
    const used = diag.match(/\{[a-z]+:[a-zA-Z]+\}/g) || [];
    const uniq = [...new Set(used)];
    const missing = uniq.filter(p => !CctClient.PROBE_PLACEHOLDERS.includes(p));
    check('diag.ps1 用到的占位符都在主表内', missing.length === 0,
        missing.length ? '不在主表: ' + missing.join(', ') : uniq.length + ' 项全部命中');
    check('diag.ps1 没有依赖 JS 模块（保持零 node 依赖，注释里提到分区名不算）',
        !/\brequire\s*\(/.test(diag) && !/CctClient\s*\./.test(diag));
}

const failed = results.filter(r => !r.ok);
console.log('');
console.log(failed.length === 0
    ? '全部通过（' + results.length + ' 项）'
    : failed.length + ' / ' + results.length + ' 项失败');
process.exit(failed.length === 0 ? 0 : 1);
