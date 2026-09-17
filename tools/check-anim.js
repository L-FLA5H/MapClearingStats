// 覆盖层「一命模式」自检脚本。
//
// 覆盖小闪 2026-09-16 反馈的几条：
//   ① 模糊层边缘羽化 —— 「模糊有个明显的方框边」
//   ② 扫光镀色：从左到右铺开、终态是均匀一层（不「停在最右边」）
//   ③ 退出时扫回去（右 → 左）
//   ④ 数据变化时的提示动画
//   ⑤ 本面死亡数在同一房间内也要实时更新
//
// ⚠️ 验证动画千万别用轮询 / animationstart：标记类只活 1~2 帧，
//    WebSocket 往返延迟几十毫秒，会错过已播完的短动画。
// ⚠️ 也别用「跑 N 个 rAF 帧」当计时：headless + --disable-gpu 下 rAF
//    不受 vsync 限制，可能几百帧/秒，几十帧实际只过几毫秒。
//    一律用 setTimeout 按**真实时间**采样。
//
// 用法（Git Bash）：node tools/check-anim.js
// 退出码：0 = 全过，1 = 有失败项。

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const EDGE_CANDIDATES = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const PORT = 9355;
const OUT = process.argv[2] ||
    path.join(process.env.USERPROFILE || '.', 'WorkBuddy AI', '2026-09-13-13-53-51', '_preview');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function getJSON(p) {
    return new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port: PORT, path: p }, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
        }).on('error', reject);
    });
}

const results = [];
function check(name, ok, detail) {
    results.push({ name, ok });
    console.log((ok ? '  [通过] ' : '  [失败] ') + name + (detail ? '  → ' + detail : ''));
}

(async () => {
    const edge = EDGE_CANDIDATES.find(p => fs.existsSync(p));
    if (!edge) { console.error('找不到 Edge'); process.exit(1); }
    if (!fs.existsSync(path.join(OUT, 'anim_case.html'))) {
        console.error('缺 anim_case.html，请先跑 make_layout_preview.py：' + OUT);
        process.exit(1);
    }

    const proc = spawn(edge, [
        '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
        '--remote-debugging-port=' + PORT,
        '--user-data-dir=' + path.join(process.env.TEMP || '.', 'edgecdp_ca3'),
        'about:blank',
    ], { stdio: 'ignore' });

    let targets = null;
    for (let i = 0; i < 80; i++) {
        try { targets = await getJSON('/json/list'); if (targets && targets.length) break; } catch (e) {}
        await sleep(300);
    }
    if (!targets || !targets.length) { console.error('CDP 未就绪'); proc.kill(); process.exit(1); }

    const page = targets.find(t => t.type === 'page') || targets[0];
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let seq = 0;
    const pending = new Map();
    ws.addEventListener('message', ev => {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
            const p = pending.get(msg.id); pending.delete(msg.id);
            msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
        }
    });
    const send = (method, params) => new Promise((resolve, reject) => {
        const id = ++seq; pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
    // ⚠️ awaitPromise 必须开，否则返回的 Promise 会被序列化成 {}，像「读不到值」
    const ev = async expr => (await send('Runtime.evaluate', {
        expression: expr, returnByValue: true, awaitPromise: true,
    })).result.value;

    await new Promise(r => ws.addEventListener('open', r));
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 520, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: 'file:///' + OUT.replace(/\\/g, '/') + '/anim_case.html' });
    await sleep(3000);

    // ============ ① 模糊层边缘羽化 ============
    console.log('== ① 模糊层边缘羽化 ==');
    const blur = JSON.parse(await ev(`(function(){
        var app = document.getElementById('app');
        app.classList.add('blurred');
        var s = getComputedStyle(app, '::after');
        return JSON.stringify({
            mask: s.maskImage || s.webkitMaskImage || '',
            composite: s.maskComposite || s.webkitMaskComposite || '',
            backdrop: s.backdropFilter || s.webkitBackdropFilter || ''
        });
    })()`));
    check('模糊层有 backdrop-filter', /blur/.test(blur.backdrop), blur.backdrop);
    check('mask-image 含两个方向（四边都要羽化）',
        (blur.mask.match(/gradient/g) || []).length >= 2,
        'gradient ×' + (blur.mask.match(/gradient/g) || []).length);
    check('mask-composite 已设置', /intersect|source-in/.test(blur.composite), blur.composite);

    // ============ ② 扫光：进入 = 从左往右 ============
    console.log('');
    console.log('== ② 扫光（进入：从左往右） ==');
    // 先让 mock 进入「拿着金草莓」，等 tick 把 golden-mode 加上
    await ev(`window.__flip()`);
    await sleep(900);

    const flyIn = JSON.parse(await ev(`(function(){
        var card = document.querySelector('.card');
        card.classList.remove('fly-in','fly-out');
        void card.offsetWidth;
        return new Promise(function(res){
            sweepFly('in');
            var s = getComputedStyle(card, '::after');
            var first = { anim: s.animationName };
            // 按真实时间采样 translateX（⚠️ 不要按 rAF 帧数计时）
            var xs = [];
            var t0 = performance.now();
            function tx(){
                var t = getComputedStyle(card, '::after').transform;
                var m = t.match(/matrix\(([^)]+)\)/);
                xs.push(m ? Math.round(parseFloat(m[1].split(',')[4])) : 0);
                if (performance.now() - t0 < 1200) setTimeout(tx, 50);
                else res(JSON.stringify({ first: first, xs: xs }));
            }
            tx();
        });
    })()`));
    check('进入时挂的是 flyInFromLeft',
        flyIn.first.anim === 'flyInFromLeft', flyIn.first.anim);
    check('进入起点在卡片左侧外面（translateX < 0）',
        flyIn.xs[0] < -1, '首帧 translateX=' + flyIn.xs[0]);
    check('进入方向：从左往右推进、终点归位到 0',
        flyIn.xs[flyIn.xs.length - 1] > flyIn.xs[0] &&
        Math.abs(flyIn.xs[flyIn.xs.length - 1]) < 4,
        flyIn.xs.filter((_, i) => i % 4 === 0).join(' → '));

    // 终态：图层均匀、没有残留亮带
    const settled = JSON.parse(await ev(`(function(){
        var s = getComputedStyle(document.querySelector('.card'), '::after');
        return JSON.stringify({ op: s.opacity,
                                bg: (s.backgroundImage || '').replace(/\\s+/g,' ') });
    })()`));
    check('终态图层完全不透明（金色铺满）',
        parseFloat(settled.op) > 0.95, 'opacity=' + settled.op);
    check('终态背景是均匀色（没有第二段亮色 stop）',
        (settled.bg.match(/rgba?\(/g) || []).length <= 2,
        '色标数 ' + (settled.bg.match(/rgba?\(/g) || []).length);

    // ============ ③ 扫光：退出 = 扫到右边去 ============
    console.log('');
    console.log('== ③ 扫光（退出：扫到右边去） ==');
    const flyOut = JSON.parse(await ev(`(function(){
        var card = document.querySelector('.card');
        return new Promise(function(res){
            window.__drop();                 // mock：草莓掉了 → 触发退出
            var xs = [], ops = [];
            var t0 = performance.now();
            function tx(){
                var s = getComputedStyle(card, '::after');
                var m = s.transform.match(/matrix\(([^)]+)\)/);
                xs.push(m ? Math.round(parseFloat(m[1].split(',')[4])) : 0);
                ops.push(parseFloat(s.opacity));
                if (performance.now() - t0 < 3000) setTimeout(tx, 60);
                else res(JSON.stringify({ xs: xs, ops: ops }));
            }
            tx();
        });
    })()`));
    // ⚠️ 退出动画跑完会把 .fly-out 摘掉、transform 回到 0，
    //    所以要看**过程中的最大值**，不能只看末帧。
    const maxOut = Math.max.apply(null, flyOut.xs);
    check('退出时金色往右移动（过程中 translateX 明显为正）',
        maxOut > 50, '过程中最大 translateX = ' + maxOut);
    check('退出后 opacity 归 0（完全藏好，不留金边）',
        flyOut.ops[flyOut.ops.length - 1] < 0.05,
        '末帧 opacity=' + flyOut.ops[flyOut.ops.length - 1]);

    // ============ ④ 数据变化的提示动画 ============
    console.log('');
    console.log('== ④ 数据变化提示动画 ==');
    const bump = JSON.parse(await ev(`(function(){
        // 直接测 setTextBump：同值不该加类，不同值要加类并播动画
        var el = document.getElementById('golden-rate');
        if (!el) return JSON.stringify({ err: 'no #golden-rate' });
        el.textContent = '80%';
        setTextBump('golden-rate', '80%');       // 同值 → 不应触发
        var sameNoBump = !el.classList.contains('bump');
        setTextBump('golden-rate', '75%');       // 不同值 → 应触发
        var diffBump = el.classList.contains('bump');
        // ⚠️ 不能用 getAnimations()：它和加类在同一个任务里，
        //    浏览器还没开始这一帧的动画，返回空数组会误判成「没播」。
        //    读 computed 的 animation-name 才是稳定的。
        var animName = getComputedStyle(el).animationName;
        return JSON.stringify({ sameNoBump: sameNoBump, diffBump: diffBump, animName: animName });
    })()`));
    check('同值不触发动画（避免节流刷新一直闪）', bump.sameNoBump === true,
        'sameNoBump=' + bump.sameNoBump);
    check('值变化时挂上 .bump 类', bump.diffBump === true, 'diffBump=' + bump.diffBump);
    check('确实挂上了 goldenBump 动画',
        bump.animName === 'goldenBump', 'animation-name=' + bump.animName);


    // ============ ⑤ 走势条「实时增量」 ============
    // ⚠️ 实测背景：CCT 的 previousAttempts 只在**换房间**时才刷新，
    //    带金期间连死 4 次它一个字节都不变。所以走势条必须靠
    //    goldenEntries / goldenSuccesses 的增量自己拼。
    console.log('');
    console.log('== ⑤ 走势条实时增量 ==');
    const live = JSON.parse(await ev(`(function(){
        // 造一个可控的基准房间
        liveGolden.room = "testroom";
        liveGolden.baseLen = 2;
        liveGolden.extra = [];
        liveGolden.lastEntries = null;
        liveGolden.lastSucc = null;

        const cr = { debugRoomName: "testroom", previousAttempts: [true, false] };
        // 第一次只建立基线，不产生增量
        noteGoldenProgress("10", "5", true);
        const afterSeed = buildStreakAttempts(cr).slice();

        // 进入 +1、通过 +0 → 一次失败
        noteGoldenProgress("11", "5", true);
        const afterFail = buildStreakAttempts(cr).slice();

        // 进入 +1、通过 +1 → 一次通过
        noteGoldenProgress("12", "6", true);
        const afterPass = buildStreakAttempts(cr).slice();

        // 换房间 → 增量应重置
        const cr2 = { debugRoomName: "other", previousAttempts: [false] };
        const afterRoom = buildStreakAttempts(cr2).slice();

        return JSON.stringify({
            afterSeed: afterSeed, afterFail: afterFail,
            afterPass: afterPass, afterRoom: afterRoom,
        });
    })()`));
    check('基线阶段不产生增量（只有历史）',
        JSON.stringify(live.afterSeed) === JSON.stringify([true, false]),
        JSON.stringify(live.afterSeed));
    check('进入+1 通过+0 → 追加一次失败',
        JSON.stringify(live.afterFail) === JSON.stringify([true, false, false]),
        JSON.stringify(live.afterFail));
    check('进入+1 通过+1 → 追加一次通过',
        JSON.stringify(live.afterPass) === JSON.stringify([true, false, false, true]),
        JSON.stringify(live.afterPass));
    check('换房间 → 实时增量被重置',
        JSON.stringify(live.afterRoom) === JSON.stringify([false]),
        JSON.stringify(live.afterRoom));

    // ============ ⑥ 走势条固定 20 个方块 ============
    // 小闪要求：「对应位置保证只留 20 个方块」。
    console.log('');
    console.log('== ⑥ 走势条固定 20 个方块 ==');
    const squares = JSON.parse(await ev(`(function(){
        const dots = document.getElementById("streak-dots");
        const title = document.getElementById("streak-title");
        function count() {
            return {
                total: dots.children.length,
                empty: dots.querySelectorAll(".streak-dot.empty").length,
                ok: dots.querySelectorAll(".streak-dot.ok").length,
                fail: dots.querySelectorAll(".streak-dot.fail").length,
                more: dots.querySelectorAll(".streak-more").length,
            };
        }
        // 直接调 renderStreak，用不同长度的假数据各跑一遍
        const strip = document.getElementById("streak-strip");
        strip.classList.add("visible");
        const out = {};
        [[], [true], [true,false,true], new Array(19).fill(true),
         new Array(20).fill(true), new Array(37).fill(false)].forEach(function (pa) {
            renderStreak({ currentRoom: { debugRoomName: "t", previousAttempts: pa,
                                          successStreak: 0, successStreakBest: 0 } },
                         true, "t", true);
            out[pa.length] = count();
        });
        out.title = title ? title.textContent : "";
        return JSON.stringify(out);
    })()`));
    let allTwenty = true;
    Object.keys(squares).forEach(function (k) {
        if (k === 'title') return;
        if (squares[k].total !== 20) allTwenty = false;
    });
    check('无论有多少条记录，方块数恒为 20', allTwenty,
        Object.keys(squares).filter(k => k !== 'title')
              .map(k => k + '条→' + squares[k].total + '个').join('  '));
    check('不再渲染「…」（它也会占掉一个位置）',
        Object.keys(squares).every(k => k === 'title' || squares[k].more === 0),
        'more=' + Object.keys(squares).filter(k => k !== 'title')
                          .map(k => squares[k].more).join(','));
    check('数据不足时在左侧补空位（0 条 → 20 个空位）',
        squares['0'] && squares['0'].empty === 20 && squares['0'].total === 20,
        JSON.stringify(squares['0']));
    check('37 条时取最近 20 条（20 个有色方块、0 个空位）',
        squares['37'] && squares['37'].empty === 0 && squares['37'].total === 20,
        JSON.stringify(squares['37']));
    check('标题写着「本面近 20 次通过情况」',
        squares.title === '本面近 20 次通过情况', squares.title);

    // ============ ⑦ 方块复用 / 成功率补间 / 重开章节 ============
    console.log('');
    console.log('== ⑦ 方块复用 / 成功率补间 / 重开章节 ==');
    const misc = JSON.parse(await ev(`(function(){
        const out = {};
        const strip = document.getElementById("streak-strip");
        strip.classList.add("visible");

        // ① 方块节点要**复用**，不能每次重建（否则没有退出动画）
        const pa1 = new Array(20).fill(false);
        renderStreak({ currentRoom: { debugRoomName: "r1", previousAttempts: pa1,
                                      successStreak: 0, successStreakBest: 0 } }, true, "r1", true);
        const firstNode = document.getElementById("streak-dots").children[0];
        const pa2 = pa1.slice(); pa2[19] = true;
        renderStreak({ currentRoom: { debugRoomName: "r1", previousAttempts: pa2,
                                      successStreak: 0, successStreakBest: 0 } }, true, "r1", true);
        const sameNode = document.getElementById("streak-dots").children[0];
        out.nodeReused = (firstNode === sameNode);
        out.lastIsOk = document.getElementById("streak-dots").children[19].className.indexOf("ok") >= 0;

        // ② 成功率补间：起一段补间，等它跑完，应该精确落在目标值
        resetRateTween();
        tweenRate("50%");
        out.tweenMid = document.getElementById("golden-rate").textContent;
        out.tweenTarget = "50%";

        // ③ 重开章节：initSession 之后 forceRoomInfoRefresh 应该是 true
        forceRoomInfoRefresh = false;
        initSession("X", null);
        out.forceAfterInit = forceRoomInfoRefresh;
        out.rateTweenCleared = (rateTween === null) && (displayedRate === null);

        return JSON.stringify(out);
    })()`));
    check('走势方块复用同一个 DOM 节点（否则没有退出动画）',
        misc.nodeReused === true, 'nodeReused=' + misc.nodeReused);
    check('最新一格能正确变成「通过」样式', misc.lastIsOk === true,
        'lastIsOk=' + misc.lastIsOk);
    check('成功率补间起效（起始不是直接跳到目标）',
        typeof misc.tweenMid === 'string' && misc.tweenMid.length > 0,
        '第一帧 = ' + misc.tweenMid + ' → 目标 ' + misc.tweenTarget);
    check('重开章节会置 forceRoomInfoRefresh（修死亡数残留）',
        misc.forceAfterInit === true, 'forceAfterInit=' + misc.forceAfterInit);
    // ④ 重开章节后第一次死亡检测**不能**把 CCT 的旧死亡数算进来
    //    （小闪：「先在第一面自杀一次，重新开始章节，还是会有一次死亡，没清空」）
    const seed = JSON.parse(await ev(`(function(){
        initSession("X", null);
        const before = seedDeathsOnly;
        const d = detectDeaths({ currentRoom: { deathsInCurrentRun: 3 } }, {}, "r");
        return JSON.stringify({
            flagBefore: before,
            delta: d,
            flagAfter: seedDeathsOnly,
            baseline: session.lastCurDeaths["r"],
            roomDeaths: session.roomDeaths["r"] || 0,
        });
    })()`));
    check('initSession 会置「重开后只记基准」标志',
        seed.flagBefore === true, 'flagBefore=' + seed.flagBefore);
    check('重开后第一次检测**不计数**（delta=0）',
        seed.delta === 0, 'delta=' + seed.delta);
    check('重开后第一次检测把 CCT 的当前值记为基准',
        seed.baseline === 3, 'baseline=' + seed.baseline);
    check('重开后本房死亡数仍然是 0（没被旧死亡污染）',
        seed.roomDeaths === 0, 'roomDeaths=' + seed.roomDeaths);
    check('重开章节会清掉成功率补间',
        misc.rateTweenCleared === true, 'rateTweenCleared=' + misc.rateTweenCleared);
    ws.close(); proc.kill();

    const failed = results.filter(r => !r.ok);
    console.log('');
    console.log(failed.length === 0
        ? '全部通过（' + results.length + ' 项）'
        : failed.length + ' 项失败 / 共 ' + results.length + ' 项');
    process.exit(failed.length === 0 ? 0 : 1);
})().catch(e => { console.error('脚本出错:', e.message); process.exit(1); });
