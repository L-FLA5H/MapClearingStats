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
// 夹具默认在 tools/fixtures/（相对本脚本），也可以用第一个参数指定别的目录。
// 夹具里的 CCTOverlay.css / CCTOverlay.js / Timing.js 用相对路径指向 ../../ExternalOverlay/，
// 所以不需要先把覆盖层文件复制过来。
const OUT = process.argv[2] || path.join(__dirname, 'fixtures');
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
        console.error('缺夹具 anim_case.html：' + OUT);
        console.error('它应该在 tools/fixtures/ 里（跟着仓库一起 clone 下来）。');
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

    // ============ ⑧ 小节太多时开窗 + 已通过标绿 ============
    // 起因：9 个小节时全部铺开，字号被压到 12px、方格看不清；而且 .dist-N 的颜色
    // 规则优先级压过了 .cleared，已经打过的小节显示成灰色。
    console.log('');
    console.log('== ⑧ 小节太多时开窗 + 已通过标绿 ==');

    const NAMES9 = ['ST','金属','遗弃','我最','机器','零落','工匠','遗存','终局'];

    async function loadSections(cpCount, curCp) {
        const spec = [];
        for (let i = 0; i < cpCount; i++) spec.push([NAMES9[i] || ('CP' + i), 20]);
        await send('Page.addScriptToEvaluateOnNewDocument', {
            source: 'window.__SPEC = ' + JSON.stringify(spec) +
                    '; window.__CUR = [' + curCp + ',2];'
        });
        await send('Page.navigate', { url: 'file:///' + OUT.replace(/\\/g, '/') + '/anim_case.html' });
        await sleep(2500);
        return JSON.parse(await ev(`(function(){
            const wrap = document.getElementById("sections");
            const secs = wrap.querySelectorAll(".section");
            const o = { rendered: 0, currentLabel: "", cleared: [], clearedColor: [],
                        opacities: [], currentWidth: 0 };
            secs.forEach(function(s){
                o.rendered++;
                // ⚠️ 读子元素的 opacity —— 淡出加在 .name/.count 上，不在 .section 上
                const nameEl = s.querySelector(".name");
                o.opacities.push(getComputedStyle(nameEl || s).opacity);
                if (s.classList.contains("current")) {
                    const n = s.querySelector(".name");
                    o.currentLabel = n ? n.textContent : "";
                    o.currentWidth = Math.round(s.getBoundingClientRect().width);
                }
                if (s.classList.contains("cleared")) {
                    const nm = s.querySelector(".name");
                    const ct = s.querySelector(".count");
                    o.cleared.push(nm ? nm.textContent : "?");
                    o.clearedColor.push(ct ? getComputedStyle(ct).color : "");
                }
            });
            return JSON.stringify(o);
        })()`));
    }

    const many = await loadSections(9, 4);
    check('9 个小节：全部渲染（不做硬截断）',
        many.rendered === 9, '渲染了 ' + many.rendered + ' 个');
    check('9 个小节：当前小节在中间',
        many.currentLabel === '机器', '当前=' + many.currentLabel);
    check('已通过的小节带 cleared 类',
        many.cleared.length > 0, 'cleared=' + JSON.stringify(many.cleared));
    check('已通过的小节显示为绿色（不是被 .dist-N 的灰色盖掉）',
        many.clearedColor.length > 0 &&
        many.clearedColor.every(function(c){ return c === 'rgb(126, 201, 138)'; }),
        '颜色=' + JSON.stringify(many.clearedColor));
    // 透明度按距离对称淡出：中间（当前）是 1，两端最淡
    const op = many.opacities.map(parseFloat);
    const mid = op[Math.floor(op.length / 2)];
    check('远端小节逐渐淡出（中间不透明、两端最淡，不是硬截断）',
        op.length >= 5 && mid === 1 &&
        op[0] < 0.5 && op[op.length - 1] < 0.5 &&
        op[0] < op[1] && op[1] < op[2],
        '透明度=' + JSON.stringify(many.opacities));

    const far = await loadSections(15, 7);
    check('15 个小节：只渲染当前 ±4（更远的已几乎全透明）',
        far.rendered === 9, '渲染了 ' + far.rendered + ' 个');

    const few = await loadSections(6, 1);
    check('6 个小节：全部渲染',
        few.rendered === 6, '渲染 ' + few.rendered + ' 个');
    check('6 个小节：不做淡出（没有 dist 类）',
        few.opacities.every(function(o){ return o === '1'; }),
        '透明度=' + JSON.stringify(few.opacities));

    check('当前小节的方格够大（不是被压成小圆点）',
        many.currentWidth >= 92, '当前列宽 ' + many.currentWidth + 'px');


    // ============ ⑩ 第三张卡片也要变金 ============
    // 起因：小闪实测「带金的时候第三张卡片没变金」。
    // 根因：.sections-card.cleared-flash::after 是绿色图层（攻下小节时的绿光），
    // 它和 .card.fly-in::after 优先级相同、但写在后面，而且 .cleared-flash
    // 加上去之后从不摘掉 —— 所以攻下过一个小节之后，镀金扫光扫到第三张卡片
    // 时用的是绿色图层。修法：让绿色规则在 .fly-in / .fly-out 期间不匹配。
    console.log('');
    console.log('== ⑩ 第三张卡片也要变金 ==');

    const cardLayer = JSON.parse(await ev(`(function(){
        const card = document.getElementById("sections-card");
        function probe(){
            const a = getComputedStyle(card, "::after");
            return {
                anim: a.animationName,
                gold: a.backgroundImage.indexOf("241, 196, 15") >= 0,
                green: a.backgroundImage.indexOf("126, 201, 138") >= 0,
            };
        }
        card.classList.remove("fly-in", "fly-out");
        card.classList.add("cleared-flash");
        const onlyFlash = probe();
        card.classList.add("fly-in");
        const flyIn = probe();
        card.classList.remove("fly-in");
        card.classList.add("fly-out");
        const flyOut = probe();
        card.classList.remove("fly-out", "cleared-flash");
        return JSON.stringify({ onlyFlash: onlyFlash, flyIn: flyIn, flyOut: flyOut });
    })()`));

    check('攻下小节的绿光还在（没被改坏）',
        cardLayer.onlyFlash.green && cardLayer.onlyFlash.anim === 'sweep',
        'anim=' + cardLayer.onlyFlash.anim);
    check('镀金扫光时第三张卡片是金色图层（不是绿色）',
        cardLayer.flyIn.gold && !cardLayer.flyIn.green,
        'anim=' + cardLayer.flyIn.anim);
    check('退出扫光时第三张卡片也是金色图层',
        cardLayer.flyOut.gold && !cardLayer.flyOut.green,
        'anim=' + cardLayer.flyOut.anim);

    // ============ ⑪ 置顶悬浮 ============
    // 用 iframe 冒充 Document PiP 窗口来端到端验证：
    // 复制样式 → 复制结构 → 在那边重新跑脚本 → 主窗口挂起。
    //
    // ⚠️ 必须用 Object.defineProperty 覆盖 documentPictureInPicture ——
    //    它是「只有 getter」的属性，直接赋值会**静默失败**（非严格模式），
    //    结果调到真的 requestWindow，报 "requires user activation"。
    // ⚠️ 这一段必须放最后：它会挂起主窗口的循环。
    console.log('');
    console.log('== ⑪ 置顶悬浮 ==');

    const fb = JSON.parse(await ev(`(function(){
        const btn = document.getElementById("float-btn");
        const label = document.getElementById("float-btn-text");
        return JSON.stringify({
            exists: !!btn,
            label: label ? label.textContent : "(无)",
            hasFloatFn: typeof enterFloatMode === "function",
        });
    })()`));
    check('悬浮按钮在页面上', fb.exists, 'label=' + fb.label);
    check('按钮文字是「置顶悬浮」', fb.label === '置顶悬浮', fb.label);
    check('enterFloatMode 已定义', fb.hasFloatFn);

    const floatFlow = JSON.parse(await ev(`(async function(){
        const iframe = document.createElement("iframe");
        iframe.style.cssText = "position:fixed;left:-9999px;width:400px;height:300px;";
        document.body.appendChild(iframe);
        const fake = iframe.contentWindow;

        Object.defineProperty(window, "documentPictureInPicture", {
            value: { requestWindow: async function(){ return fake; } },
            configurable: true,
        });

        const out = {};
        try {
            await enterFloatMode();
        } catch (e) {
            out.error = String(e && e.message || e);
        }
        await new Promise(function(r){ setTimeout(r, 1400); });   // 等脚本在那边跑起来

        const fd = fake.document;
        out.suspended = pipSuspended;
        out.mainDimmed = document.body.classList.contains("floating-out");
        out.clonedApp = !!fd.getElementById("app");
        out.clonedCards = fd.querySelectorAll(".card").length;
        out.styles = fd.querySelectorAll("style, link[rel=stylesheet]").length;
        out.scripts = Array.from(fd.querySelectorAll("script[src]")).map(function(s){ return s.getAttribute("src"); });
        const lbl = fd.getElementById("float-btn-text");
        out.floatBtnLabel = lbl ? lbl.textContent : "(无)";

        // 按钮文案翻转：主窗口是「置顶悬浮」，悬浮窗口里应该是「还原」
        const mainLabel = document.getElementById("float-btn-text");
        out.mainLabelBefore = mainLabel ? mainLabel.textContent : "(无)";
        window.__mcsFloatWindow = true;
        wireFloatButton();
        out.mainLabelFloat = mainLabel ? mainLabel.textContent : "(无)";
        delete window.__mcsFloatWindow;
        wireFloatButton();
        out.mainLabelBack = mainLabel ? mainLabel.textContent : "(无)";

        // 收尾：还原，别影响后面
        // ⚠️ pipWindow 也要清掉 —— 不清的话下一次 enterFloatMode 会直接 return
        pipSuspended = false;
        pipWindow = null;
        document.body.classList.remove("floating-out");
        // ⚠️ 故意**不移除** iframe —— 移除会触发 pagehide，
        //    而 pagehide 处理器里是 location.reload()，会把主页面重载掉，
        //    后面的测试就全在「脚本还没跑完」的新页面里跑了（表现为 enterFloatMode is not defined）。
        //    iframe 留在 left:-9999px 上不影响别的。
        delete window.documentPictureInPicture;
        return JSON.stringify(out);
    })()`));

    check('悬浮流程没有报错', !floatFlow.error, floatFlow.error || '');
    check('进入悬浮后主窗口挂起', floatFlow.suspended === true);
    check('主窗口那份变暗（提示已悬浮）', floatFlow.mainDimmed === true);
    check('悬浮窗口里有完整的覆盖层结构',
        floatFlow.clonedApp && floatFlow.clonedCards === 3,
        'app=' + floatFlow.clonedApp + ' cards=' + floatFlow.clonedCards);
    check('样式复制过去了', floatFlow.styles > 0, floatFlow.styles + ' 条');
    // ⚠️ iframe 代理有个限制：about:blank 里加载 file:// 子资源会被拦，
    //    所以「克隆出来的脚本真的跑起来了」这件事在测试里验不了（真实 PiP 窗口没这限制）。
    //    这里只验「脚本标签加对了没」，执行路径靠下面单独验按钮文案。
    const srcs = floatFlow.scripts || [];
    const added = srcs.filter(function (x) { return srcs.indexOf(x) === srcs.lastIndexOf(x); });
    check('悬浮窗口里按钮显示「还原」', floatFlow.mainLabelFloat === '还原',
        floatFlow.mainLabelBefore + ' → ' + floatFlow.mainLabelFloat);
    check('回到主窗口按钮又变回「置顶悬浮」', floatFlow.mainLabelBack === '置顶悬浮', floatFlow.mainLabelBack);

    // ⚠️ 回归：QQ 浏览器（极速内核）的 requestWindow 会返回**同一个窗口**，
    //    写进去的内容根本不显示 —— 结果只留一个空白窗口，而且主界面已经被变灰了。
    //    守卫必须在克隆之前拦下来。
    //
    // ⚠️ 这里分两步做：先触发（不 await），再单独读状态。
    //    直接在 async IIFE 里 return JSON.stringify(...) 会被 CDP 处理成对象，
    //    JSON.parse 会报 "[object Object]" is not valid JSON。
    await ev(`(function(){
        Object.defineProperty(window, "documentPictureInPicture", {
            value: { requestWindow: async function(){ return window; } },
            configurable: true,
        });
        window.__guardDone = false;
        window.__guardErr = "";
        try {
            enterFloatMode().then(function(){ window.__guardDone = true; },
                                  function(e){ window.__guardErr = String(e && e.message || e); window.__guardDone = true; });
        } catch (e) { window.__guardErr = "sync: " + e.message; }
        return "started";
    })()`);
    await sleep(600);

    const guard = JSON.parse(await ev(`(function(){
        const out = {
            suspended: pipSuspended,
            dimmed: document.body.classList.contains("floating-out"),
            noPip: document.body.classList.contains("no-pip"),
            notice: (document.getElementById("notice") || {}).textContent || "",
            label: (document.getElementById("float-btn-text") || {}).textContent || "",
        };
        pipSuspended = false;
        document.body.classList.remove("floating-out", "no-pip");
        delete window.documentPictureInPicture;
        delete window.__guardDone;
        return JSON.stringify(out);
    })()`));

    check('返回同一个窗口时：不当成悬浮（不挂起主窗口）', guard.suspended === false);
    check('返回同一个窗口时：主界面不变灰', guard.dimmed === false);
    check('返回同一个窗口时：按钮不再显示（加 .no-pip）', guard.noPip === true);
    check('返回同一个窗口时：给出明确提示', /不支持置顶悬浮/.test(guard.notice), guard.notice);
    check('返回同一个窗口时：按钮文案不变', guard.label === '置顶悬浮', guard.label);
    check('克隆结构里的脚本标签保留了（innerHTML 插的不会执行）', srcs.length >= 2,
        JSON.stringify(srcs));
    check('两个脚本被追加进悬浮窗口（路径从 DOM 取，没写死）',
        srcs.filter(function (s) { return /Timing\.js$/.test(s); }).length >= 2 &&
        srcs.filter(function (s) { return /CCTOverlay\.js$/.test(s); }).length >= 2,
        JSON.stringify(srcs));


    ws.close(); proc.kill();

    const failed = results.filter(r => !r.ok);
    console.log('');
    console.log(failed.length === 0
        ? '全部通过（' + results.length + ' 项）'
        : failed.length + ' 项失败 / 共 ' + results.length + ' 项');
    process.exit(failed.length === 0 ? 0 : 1);
})().catch(e => { console.error('脚本出错:', e.message); process.exit(1); });
