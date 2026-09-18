// 直接查询本机正在运行的 CCT，把 parseFormat 的占位符和原始数据一次性打出来。
// 用途：排查「覆盖层数字和 CCT 面板对不上」时，不用让用户手动操作。
//
// 用法（Git Bash）：node tools/cct-dump.js
// 前置：游戏（CCT 服务端 :32270）正在运行。

const http = require('http');
const HOST = '127.0.0.1';
const PORT = 32270;

function post(path, body) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const req = http.request({
            host: HOST, port: PORT, path, method: 'POST',
            headers: { 'Host': 'localhost:' + PORT, 'Accept': 'application/json', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
        }, r => {
            let d = '';
            r.on('data', c => d += c);
            r.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error(d.slice(0, 300))); } });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

function get(path) {
    return new Promise((resolve, reject) => {
        http.get({ host: HOST, port: PORT, path, headers: { 'Host': 'localhost:' + PORT, 'Accept': 'application/json' } }, r => {
            let d = '';
            r.on('data', c => d += c);
            r.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error(d.slice(0, 300))); } });
        }).on('error', reject);
    });
}

// 占位符表不再在这里抄一份 —— 从 CCTOverlay.js 的 CctClient 分区切片求值（单一来源）。
// CctClient 分区是「纯函数、零 DOM、零外部引用」的约定区，可以安全地在 Node 里求值。
const fs = require('fs');
const path = require('path');

function loadCctClient() {
    const src = fs.readFileSync(
        path.join(__dirname, '..', 'ExternalOverlay', 'CCTOverlay.js'), 'utf8');
    const begin = src.indexOf('// ==== CctClient BEGIN');
    const end = src.indexOf('// ==== CctClient END');
    if (begin < 0 || end < 0 || end < begin) {
        throw new Error('CCTOverlay.js 里找不到 CctClient BEGIN/END 切片标记');
    }
    const section = src.slice(begin, end);
    return new Function(section + '\nreturn CctClient;')();
}

let CctClient;
try {
    CctClient = loadCctClient();
} catch (e) {
    console.error('✗ ' + e.message);
    process.exit(1);
}

const FMTS = CctClient.PROBE_PLACEHOLDERS;

(async () => {
    console.log('===== parseFormat 逐项 =====');
    try {
        const r = await post('/cct/parseFormat', { formats: FMTS });
        if (r.errorCode !== 0) {
            console.log('  errorCode=' + r.errorCode + ' ' + r.errorMessage);
        } else {
            FMTS.forEach((f, i) => {
                console.log('  ' + f.padEnd(32) + ' => ' + JSON.stringify(r.formats[i]));
            });
        }
    } catch (e) {
        console.log('  parseFormat 失败: ' + e.message);
    }

    console.log('');
    console.log('===== /cct/state =====');
    try {
        const s = await get('/cct/state');
        const cr = s.currentRoom || {}, m = s.modState || {};
        console.log('  chapterName            : ' + s.chapterName);
        console.log('  debugRoomName          : ' + cr.debugRoomName);
        console.log('  previousAttempts 长度  : ' + (Array.isArray(cr.previousAttempts) ? cr.previousAttempts.length : '无'));
        if (Array.isArray(cr.previousAttempts)) {
            console.log('  previousAttempts 内容  : ' + cr.previousAttempts.map(v => v ? "1" : "0").join(""));
        }
        console.log('  goldenBerryDeaths      : ' + cr.goldenBerryDeaths + '  (session ' + cr.goldenBerryDeathsSession + ')');
        console.log('  deathsInCurrentRun     : ' + cr.deathsInCurrentRun);
        console.log('  successStreak          : ' + cr.successStreak + ' / best ' + cr.successStreakBest);
        console.log('  lastFive/Ten/Twenty    : ' + cr.lastFiveRate + ' / ' + cr.lastTenRate + ' / ' + cr.lastTwentyRate);
        console.log('  maxRate                : ' + cr.maxRate);
        console.log('  timeSpentInRoom        : ' + cr.timeSpentInRoom);
        console.log('  playerIsHoldingGolden  : ' + m.playerIsHoldingGolden);
        console.log('  deathTrackingPaused    : ' + m.deathTrackingPaused);
    } catch (e) {
        console.log('  失败: ' + e.message);
    }

    console.log('');
    console.log('===== /cct/currentChapterStats =====');
    try {
        const c = await get('/cct/currentChapterStats');
        const cs = c.chapterStats || {};
        console.log('  chapterName            : ' + cs.chapterName);
        console.log('  chapterSID             : ' + cs.chapterSID);
        console.log('  goldenType             : ' + cs.goldenType + '   (0=金 1=银)');
        console.log('  goldenCollectedCount   : ' + cs.goldenCollectedCount);
        console.log('  rooms 数量             : ' + Object.keys(cs.rooms || {}).length);
        console.log('  lastGoldenRuns         : ' + JSON.stringify(cs.lastGoldenRuns));
        // 把当前房间的完整字段打出来，方便核对
        const cur = cs.currentRoom || {};
        console.log('  --- currentRoom 全字段 ---');
        Object.keys(cur).forEach(k => {
            const v = cur[k];
            console.log('    ' + k.padEnd(30) + ' = ' + (Array.isArray(v) ? '[数组 ' + v.length + ' 项]' : JSON.stringify(v)));
        });
    } catch (e) {
        console.log('  失败: ' + e.message);
    }
})();
