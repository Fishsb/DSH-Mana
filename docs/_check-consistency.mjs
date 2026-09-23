#!/usr/bin/env node
/**
 * mana-rollout-plan 一致性穷尽检查器
 * 目标：把「人工抽查」变成「确定性穷尽扫描」，可重复运行、全绿才算通过。
 * 只用 node 内置模块；不写任何文件（除 stdout）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// 路径解析：默认取脚本自身所在目录下的两册（Windows / WSL 通用），
// 可用 argv 覆盖：node _check-consistency.mjs [本册路径] [方案原件路径]
// ⚠ 旧版硬编码 'D:/Mana/docs/...'，在 WSL(/mnt/d) 下直接 ENOENT 崩；
//   改为相对脚本定位是「严格泛化」——Windows 下解析到的是同一对文件。
const HERE = fileURLToPath(new URL('.', import.meta.url));
const PLAN = process.argv[2] ?? HERE + 'mana-rollout-plan.md';
const SRC  = process.argv[3] ?? HERE + 'mana-v5-plan.md';
const plan = readFileSync(PLAN, 'utf8');
const src  = readFileSync(SRC, 'utf8');
const planLines = plan.split(/\r?\n/);
const srcLines  = src.split(/\r?\n/);

const fails = [];
const warns = [];
const passes = [];
const F = (id, msg) => fails.push(`[${id}] ${msg}`);
const W = (id, msg) => warns.push(`[${id}] ${msg}`);
const P = (id, msg) => passes.push(`[${id}] ${msg}`);

// ─────────────────────────────────────────────
// 公共：GFM 表格行切分（正确处理 \| 转义）
// ─────────────────────────────────────────────
function splitRow(row) {
  let s = row.trim().replace(/^\|/, '').replace(/\|$/, '');
  const out = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') { cur += '\\|'; i++; continue; }
    if (ch === '|') { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map(c => c.trim());
}

// ─────────────────────────────────────────────
// C1 判据行结构：ID 唯一、五列、四要素非空
// ─────────────────────────────────────────────
const critRows = [];
for (let i = 0; i < planLines.length; i++) {
  const m = planLines[i].match(/^\|\s*\*{0,2}(A(\d)-(\d+))\*{0,2}\s*\|/);
  if (!m) continue;
  const cells = splitRow(planLines[i]);
  critRows.push({ id: m[1], stage: +m[2], n: +m[3], line: i + 1, cells });
}
if (critRows.length === 0) F('C1', '未抽到任何判据行');
const ids = critRows.map(r => r.id);
const dupIds = ids.filter((v, i) => ids.indexOf(v) !== i);
if (dupIds.length) F('C1', `判据 ID 重复: ${[...new Set(dupIds)].join(',')}`);
P('C1', `判据 ${critRows.length} 条，ID 唯一`);

// 列数必须 5
const badCols = critRows.filter(r => r.cells.length !== 5);
if (badCols.length) F('C1', `列数≠5 的判据行: ${badCols.map(r => `${r.id}(L${r.line},${r.cells.length}列)`).join(', ')}`);

// 四要素：检查方式(3) / 阈值(4) / 退回动作(5) 非空且非「—」
const emptyCell = critRows.filter(r => {
  const chk = r.cells[2], thr = r.cells[3], ret = r.cells[4];
  return !chk || !thr || !ret || thr === '—' || ret === '—' || chk === '—';
});
if (emptyCell.length) F('C1', `四要素缺项（含「—」）: ${emptyCell.map(r => r.id).join(', ')}`);

// 编号连续
for (const s of [0,1,2,3,4,5,6]) {
  const nums = critRows.filter(r => r.stage === s).map(r => r.n).sort((a,b)=>a-b);
  if (!nums.length) { F('C1', `阶段 ${s} 无判据`); continue; }
  const expect = Array.from({length: nums.length}, (_,i)=>i+1);
  const miss = expect.filter(x => !nums.includes(x));
  if (miss.length) F('C1', `阶段 ${s} 编号跳号，缺: ${miss.join(',')}`);
}

// ─────────────────────────────────────────────
// C2 七阶段两节齐备 + 小节编号顺序
// ─────────────────────────────────────────────
const heads = planLines
  .map((l, i) => ({ l, i: i + 1 }))
  .filter(o => /^###\s+阶段\s+\d/.test(o.l) || /^####\s+\d\.\d/.test(o.l));
let stageSeq = [];
for (const h of heads) {
  const ms = h.l.match(/^###\s+阶段\s+(\d)/);
  if (ms) { stageSeq.push({ stage: +ms[1], subs: [], line: h.i }); continue; }
  const md = h.l.match(/^####\s+(\d)\.(\d)/);
  if (md && stageSeq.length) stageSeq[stageSeq.length-1].subs.push({ sec: md[1], sub: +md[2], line: h.i });
}
if (stageSeq.length !== 7) F('C2', `阶段节数量 = ${stageSeq.length}，应为 7`);
stageSeq.forEach((s, idx) => {
  if (s.stage !== idx) F('C2', `阶段序号不连续: 第 ${idx+1} 个是阶段 ${s.stage}`);
  const hasImpl = s.subs.some(x => x.sub === 1);
  const hasAcc  = s.subs.some(x => x.sub === 2);
  if (!hasImpl) F('C2', `阶段 ${s.stage} 缺「实施方案」节`);
  if (!hasAcc)  F('C2', `阶段 ${s.stage} 缺「验收方案」节`);
  // 小节必须升序
  const seq = s.subs.map(x => x.sub);
  const sorted = [...seq].sort((a,b)=>a-b);
  if (seq.join() !== sorted.join()) F('C2', `阶段 ${s.stage} 小节编号乱序: ${seq.join('→')}`);
  // 前缀必须与该阶段号一致
  s.subs.forEach(x => { if (x.sec !== String(s.stage)) F('C2', `阶段 ${s.stage} 下出现 ${x.sec}.${x.sub} 节（前缀不符）`); });
});
if (stageSeq.length === 7 && !fails.some(f => f.startsWith('[C2]'))) P('C2', '七阶段两节齐备、小节编号连续无乱序');

// 顶级章节号必须递增且唯一
const topSecs = planLines.map((l,i)=>({l,i:i+1})).filter(o=>/^##\s+\d+\./.test(o.l))
  .map(o=>({ n:+o.l.match(/^##\s+(\d+)\./)[1], line:o.i }));
const topNums = topSecs.map(t=>t.n);
if (topNums.join() !== [...topNums].sort((a,b)=>a-b).join()) F('C2', `顶级章节乱序: ${topNums.join('→')}`);
if (new Set(topNums).size !== topNums.length) F('C2', '顶级章节号重复');

// 二级节编号顺序（按出现顺序必须递增，允许子号）
const subSecs = planLines.map((l,i)=>({l,i:i+1})).filter(o=>/^###\s+\d+\.\d/.test(o.l))
  .map(o=>({ s:o.l.match(/^###\s+(\d+)\.(\d+)/).slice(1).join('.'), line:o.i }));
for (let i=1;i<subSecs.length;i++){
  const [pa, pb] = [subSecs[i-1].s.split('.').map(Number), subSecs[i].s.split('.').map(Number)];
  if (pb[0] < pa[0] || (pb[0]===pa[0] && pb[1] <= pa[1]))
    F('C2', `二级节乱序: ${subSecs[i-1].s}(L${subSecs[i-1].line}) → ${subSecs[i].s}(L${subSecs[i].line})`);
}

// ─────────────────────────────────────────────
// C3 判据 ID 引用完整性（双向）
// ─────────────────────────────────────────────
const definedIds = new Set(ids);
const refMatches = [...plan.matchAll(/\bA(\d)-(\d+)\b/g)].map(m=>m[0]);
const refSet = new Set(refMatches);
const undefinedRefs = [...refSet].filter(x=>!definedIds.has(x));
if (undefinedRefs.length) F('C3', `被引用但未定义: ${undefinedRefs.join(',')}`);
const neverUsed = [...definedIds].filter(x => refMatches.filter(y=>y===x).length <= 1);
if (neverUsed.length) W('C3', `仅定义处出现（无正文引用，属正常）: ${neverUsed.length} 条`);
if (!undefinedRefs.length) P('C3', `判据 ID 引用完整（定义 ${definedIds.size} / 被引用 ${refSet.size}）`);

// ─────────────────────────────────────────────
// C4 行号引用 → 回原方案核对章节归属
// ─────────────────────────────────────────────
const srcSecMap = [];
srcLines.forEach((l, i) => { const m = l.match(/^##\s+(\d+)\./); if (m) srcSecMap.push({ n:+m[1], line:i+1 }); });
const secAt = (ln) => { let cur=null; for (const s of srcSecMap) { if (s.line<=ln) cur=s; else break; } return cur; };
let lineRefs=0, lineBad=0;
for (const m of plan.matchAll(/行(\d{2,4})/g)) {
  const ln = +m[1];
  if (ln > srcLines.length) { F('C4', `行号 ${ln} 超出原方案总行数 ${srcLines.length}`); continue; }
  // 就近取前文最近的 §N（允许 §N.M）
  const before = plan.slice(Math.max(0, m.index-120), m.index);
  const sm = [...before.matchAll(/§(\d+)(?:\.\d+)*/g)];
  if (!sm.length) continue;                       // 无 § 即非方案引用（源码行号/grep 行号）
  // 只取紧邻的（间隔 <= 12 字符）那一个，避免跨单元格错配
  const nearest = sm[sm.length-1];
  const gap = before.length - (nearest.index + nearest[0].length);
  if (gap > 12) continue;                          // 距离过远，不当成本次引用的 §
  const claim = +nearest[1];
  const actual = secAt(ln);
  if (!actual) continue;
  lineRefs++;
  if (actual.n !== claim) { lineBad++; F('C4', `行${ln} 声称 §${claim} 实际 §${actual.n}`); }
}
P('C4', `行号引用就近核验 ${lineRefs} 处，不符 ${lineBad} 处`);

// ─────────────────────────────────────────────
// C5 数字分档纪律：B 档浮动值不得进阈值列
// ─────────────────────────────────────────────
const B_TIER = ['20.92','35.877','1037','77.2','0.784169','0.979985','0.336102','0.393894','8.40','11.17','55.46','5785'];
let leak=0;
for (const r of critRows) {
  const thr = r.cells[3] || '';
  for (const v of B_TIER) if (thr.includes(v)) { leak++; F('C5', `${r.id} 阈值列含 B 档浮动值 ${v}`); }
}
if (!leak) P('C5', 'B 档浮动值零泄漏进阈值列');

// ─────────────────────────────────────────────
// C6 不可判定表述
// ─────────────────────────────────────────────
const VAGUE = ['性能良好','响应及时','较大的提升','基本可用','尽量快'];
let vagueHit=0;
planLines.forEach((l,i)=>{
  // 跳过引用反例的行（含「性能良好」类表述的批判性引用）
  for (const v of VAGUE) {
    if (l.includes(v) && !/不得|禁止|反面|不算|这类|类表述|非「/.test(l)) { vagueHit++; F('C6', `L${i+1} 不可判定表述「${v}」`); }
  }
});
if (!vagueHit) P('C6', '无不可判定表述');

// ─────────────────────────────────────────────
// C7 表格完整性（全表列数一致）
//   注意：GFM 中表格分隔符解析先于行内解析，故 `\|` 是**正确转义**，
//   必须按「反斜杠转义后的竖线不算分隔符」来切分，否则误报。
// ─────────────────────────────────────────────
let curHeader = null, tblBad = 0;
for (let i = 0; i < planLines.length; i++) {
  const l = planLines[i];
  if (!/^\|/.test(l)) { curHeader = null; continue; }
  const cols = splitRow(l).length;
  if (/^\|\s*:?-{2,}/.test(l) || /^\|\s*-+/.test(l)) { curHeader = cols; continue; }
  if (curHeader !== null && cols !== curHeader) {
    tblBad++;
    if (/^\|\s*\*{0,2}A\d/.test(l)) F('C7', `L${i + 1} 判据行 ${cols} 列 ≠ 表头 ${curHeader} 列`);
    else W('C7', `L${i + 1} ${cols} 列 ≠ 表头 ${curHeader} 列`);
  }
}
if (!tblBad) P('C7', '全表列数一致（已按 GFM 转义规则切分）');

// ─────────────────────────────────────────────
// C8 章节撞号引用必须有前缀
//   规则精确化：只有「方案独有的章节号」且「本册也定义了同号章节」时才要求前缀；
//   本册自有的 §0–§10 里的 §1–§10 属本册引用，不算撞号；
//   方案独有（§11–§19）无前缀才算高危。
// ─────────────────────────────────────────────
const SRC_ONLY_SECS = [11,12,13,14,15,16,17,18,19];   // 本册没有这些顶级章节 ⇒ 必指方案
// 语境区白名单：表格列头已声明「方案声称」「原方案节」，其表体内的 § 引用无需逐处加前缀
function inDeclaredContext(idx) {
  // 向上找最近的表头行；表头含「方案声称」或「原方案」即视为已声明语境
  for (let j = idx - 1; j >= 0 && j > idx - 60; j--) {
    const s = planLines[j];
    if (/^\|\s*:?-{2,}/.test(s) && j - 1 >= 0) {
      return /方案声称|原方案|§17 行号/.test(planLines[j - 1]);
    }
    if (/^##/.test(s)) return false;
  }
  return false;
}
let unqualified = 0;
planLines.forEach((l, i) => {
  const lineHasPlanCtx = /方案\s*§/.test(l);            // 同一行已出现「方案 §N」⇒ 该行语境已声明
  for (const m of l.matchAll(/§(\d+)(?:\.\d+)*/g)) {
    const top = +m[1];
    if (!SRC_ONLY_SECS.includes(top)) continue;
    const before = l.slice(Math.max(0, m.index - 10), m.index);
    if (/方案/.test(before)) continue;
    if (lineHasPlanCtx) continue;                      // 同行已有方案语境
    if (inDeclaredContext(i)) continue;                // 表头已声明语境
    unqualified++;
    W('C8', `L${i + 1} §${m[1]} 无「方案」前缀且不在已声明语境`);
  }
});
if (!unqualified) P('C8', '方案独有章节号引用均带前缀或处于已声明语境');

// ─────────────────────────────────────────────
// C9 G 清单归属完整性
// ─────────────────────────────────────────────
const gRows = planLines.filter(l=>/^\|\s*(?:G|W-\d|\*\*G)/.test(l) && /G\d+/.test(l));
const G_DEFINED = Array.from({length:15},(_,i)=>`G${i+1}`);
const gText = plan;
const missG = G_DEFINED.filter(g => !new RegExp(`\\|\\s*\\*{0,2}${g}\\*{0,2}\\s*\\|`).test(gText));
if (missG.length) F('C9', `G 清单缺条: ${missG.join(',')}`);
else P('C9', 'G1–G15 定义齐备');
// 归属表：每条必须标 ✅ 或 ⏳
const attrib = planLines.filter(l=>/^\|\s*G\d+\s*\|/.test(l));
const noStatus = attrib.filter(l => !/✅|⏳|❓/.test(l));
if (noStatus.length) F('C9', `G 归属表有条目未标状态: ${noStatus.length} 行`);
else P('C9', `G 归属表 ${attrib.length} 条均标状态`);

// ─────────────────────────────────────────────
// C10 边界：方案原件行数 / 章节数 引用是否一致
// ─────────────────────────────────────────────
const claimTotal = plan.match(/1241 行/g);
if (claimTotal && srcLines.length !== 1241 && srcLines.filter(x=>x!=='').length !== 1241) {
  W('C10', `本册称「1241 行」，实测 split 后 ${srcLines.length} 行（末尾空行差异）`);
}
P('C10', `原方案实际 ${srcLines.length} 行（含末空行）`);

// ─────────────────────────────────────────────
// C11 术语一致性：同一概念不得有多种写法
// ─────────────────────────────────────────────
const TERM_PAIRS = [
  ['fail-closed', 'fail closed'],
  ['allowExtension', 'allow extended'],
  ['agent/pre-step', 'agent/pré-step'],
  ['node:test', 'node test'],
  ['inject_log', 'injectlog'],
  ['mana_trace', 'manatrace'],
];
let termBad = 0;
for (const [good, bad] of TERM_PAIRS) {
  if (plan.includes(bad)) { termBad++; F('C11', `非规范写法「${bad}」（应用「${good}」）`); }
}
if (!termBad) P('C11', '术语无多重写法');

// ─────────────────────────────────────────────
// C12 裸行号：引用方案行号必须带 § 前缀（防跨文件歧义）
//     白名单：源码行号（panel-inject.js/mcl.js/vec.js 等）、grep 结果、本册行号
// ─────────────────────────────────────────────
let naked = 0;
planLines.forEach((l, i) => {
  const firstSecPos = l.search(/§/);                     // 本行首个 § 的位置（-1 = 无）
  for (const m of l.matchAll(/行(\d{2,4})/g)) {
    const before = l.slice(Math.max(0, m.index - 30), m.index);
    if (/§/.test(before)) continue;                       // 就近已有 §
    // 同行更早处已有「§N 行M」⇒ 本行号属该 § 的延续引用（如「§11.2 行809 … DDL 块（行789–864）」）
    if (firstSecPos >= 0 && firstSecPos < m.index) continue;
    if (/\.(js|ts|mjs)`?\s*行?$/.test(before)) continue;    // 源码文件行号
    if (/grep|命中|seq|L\d|行\d+\/\d+/.test(before)) continue;
    if (/^\s*\|?\s*(行|方案)/.test(before)) continue;
    naked++;
    W('C12', `L${i + 1} 裸行号「行${m[1]}」（前文无 §，若指方案原件须补 §）`);
  }
});
if (!naked) P('C12', '方案行号引用均带 § 前缀');

// ─────────────────────────────────────────────
// C13 引号/括号配对（Markdown 结构完整性）
//   排除：代码块围栏行（``` / ~~~）、表格行内的 \| 转义
// ─────────────────────────────────────────────
let unclosed = 0, inFence = false;
planLines.forEach((l, i) => {
  if (/^\s*(```|~~~)/.test(l)) { inFence = !inFence; return; }   // 围栏行本身跳过，并翻转状态
  if (inFence) return;                                            // 代码块内不检查
  const ticks = (l.match(/`/g) || []).length;
  if (ticks % 2 !== 0) { unclosed++; W('C13', `L${i + 1} 反引号数为奇数（${ticks}）`); }
  const bold = (l.match(/\*\*/g) || []).length;
  if (bold % 2 !== 0) { unclosed++; W('C13', `L${i + 1} 粗体标记数为奇数（${bold}）`); }
});
if (!unclosed) P('C13', '行内标记配对完整（已排除代码围栏）');

// ─────────────────────────────────────────────
// C14 判据阈值列：不得为空、不得含「待定」以外的模糊词
// ─────────────────────────────────────────────
let thrBad = 0;
for (const r of critRows) {
  const thr = r.cells[3] || '';
  if (!thr) { thrBad++; F('C14', `${r.id} 阈值列空`); continue; }
  if (/良好|及时|较快|适当|合理/.test(thr)) { thrBad++; F('C14', `${r.id} 阈值含不可判定词: ${thr.slice(0,40)}`); }
}
if (!thrBad) P('C14', '阈值列无空/无不可判定词');

// ─────────────────────────────────────────────
// C15 反证判据齐备（每阶段至少一段）
// ─────────────────────────────────────────────
const stageHeadIdx = [];
planLines.forEach((l, i) => { if (/^###\s+阶段\s+\d/.test(l)) stageHeadIdx.push(i); });
let noRebuttal = 0;
for (let k = 0; k < stageHeadIdx.length; k++) {
  const from = stageHeadIdx[k];
  const to = k + 1 < stageHeadIdx.length ? stageHeadIdx[k + 1] : planLines.length;
  const seg = planLines.slice(from, to).join('\n');
  if (!/反证判据/.test(seg)) { noRebuttal++; W('C15', `阶段段（L${from + 1}起）无反证判据`); }
}
if (!noRebuttal) P('C15', `${stageHeadIdx.length} 个阶段段均有反证判据`);

// ─────────────────────────────────────────────
// C16 本册内部 § 引用可解析（指向本册的小节必须真实存在）
// ─────────────────────────────────────────────
const ownTop = new Set(planLines.map(l => l.match(/^##\s+(\d+)\./)?.[1]).filter(Boolean));
const ownSub = new Set();
planLines.forEach(l => {
  const m2 = l.match(/^#{3,6}\s+(\d+(?:\.\d+)+)/);   // 任意层级：3.1 / 3.1.1 / 0.2 …
  if (m2) ownSub.add(m2[1]);
});
let ownBad = 0;
planLines.forEach((l, i) => {
  const planCtx = /方案\s*§/.test(l);              // 同行已有「方案 §」⇒ 本行 § 归方案
  for (const m of l.matchAll(/(?:见|读|跳|按|回|阅)\s*(?:本册\s*)?§(\d+(?:\.\d+)*)/g)) {
    const sec = m[1];
    const top = sec.split('.')[0];
    if (!ownTop.has(top)) continue;                 // 顶级号不属本册 ⇒ 方案引用，交 C8
    if (planCtx && sec.includes('.')) continue;     // 同行已声明方案语境且为子节号 ⇒ 归方案
    if (sec.split('.').length > 1) {
      if (!ownSub.has(sec)) { ownBad++; F('C16', `L${i + 1} 指向本册 §${sec}，但本册无此小节`); }
    } else if (!ownTop.has(sec)) { ownBad++; F('C16', `L${i + 1} 指向本册 §${sec}，但本册无此顶级节`); }
  }
});
if (!ownBad) P('C16', `本册内部 § 引用均可解析（已收录 ${ownSub.size} 个小节号）`);

// ─────────────────────────────────────────────
// C17 关键事实多处出现必数字一致（防止同一事实被写成两个值）
// ─────────────────────────────────────────────
const FACTS = [
  { key: '判据总数', re: /判据\s*\*{0,2}(\d+)\s*条/g },
  { key: '批次数',   re: /(\d+)\s*个批次/g },
  { key: 'vec0.dll', re: /289,?280/g },
  { key: 'typecheck', re: /exit\s*\*{0,2}(\d)\*{0,2}/g },
];
let factBad = 0;
for (const f of FACTS) {
  const vals = new Set();
  for (const m of plan.matchAll(f.re)) vals.add(m[1] ?? m[0]);
  // 判据总数以实际抽出的 criticRows 为准
  if (f.key === '判据总数') {
    const declared = [...vals].map(Number);
    const actual = critRows.length;
    // 「53 条」若与实测不符则报错；但「18 条孤儿」等非总数，故只比对含「判据」的
    if (declared.some(v => v > 20 && v !== actual)) {
      factBad++; F('C17', `判据总数声明 ${[...vals].join('/')} ≠ 实测 ${actual}`);
    }
  }
  if (f.key === '批次数') {
    const vs = [...vals].map(Number).filter(v => v >= 5);
    if (vs.length && !vs.every(v => v === 18) && !vs.includes(18)) {
      factBad++; W('C17', `批次数出现多个值: ${vs.join('/')}（应统一为 18）`);
    }
  }
}
if (!factBad) P('C17', '关键事实数字一致（判据总数/批次数）');

// ─────────────────────────────────────────────
// C18 编号体系完整性：C/G/W/B 定义齐备 + 引用无悬空
// ─────────────────────────────────────────────
const defC = [...plan.matchAll(/^\| \*\*(C\d+)\*\* \|/gm)].map(m => m[1]);
const defG = [...plan.matchAll(/^\| \*\*(G\d+)\*\* \|/gm)].map(m => m[1]);
const defW = [...plan.matchAll(/^\| (W-\d) \|/gm)].map(m => m[1]);
const defB = [...plan.matchAll(/\| \*\*(B\d+\.\d+)\*\* \|/g)].map(m => m[1]);
// 引用（§8 Cx / Gx / Bx.y）
const refC = [...new Set([...plan.matchAll(/§8 (C\d+)/g)].map(m => m[1]))];
const refG = [...new Set([...plan.matchAll(/\b(G\d+)\b/g)].map(m => m[1]))].filter(x => +x.slice(1) <= 15);
const refB = [...new Set([...plan.matchAll(/\b(B\d+\.\d+)\b/g)].map(m => m[1]))];
let sysBad = 0;
for (const r of refC) if (!defC.includes(r)) { sysBad++; F('C18', `引用 §8 ${r} 但未定义`); }
for (const r of refG) if (!defG.includes(r)) { sysBad++; F('C18', `引用 ${r} 但未定义`); }
for (const r of refB) if (!defB.includes(r)) { sysBad++; F('C18', `引用 ${r} 但未定义`); }
if (!sysBad) P('C18', `编号体系齐备：C${defC.length}/G${defG.length}/W${defW.length}/B${defB.length}`);

// ─────────────────────────────────────────────
// C19 概念必须有落点：W-x（vec0 语义）须在实施区被承接
//     （本轮人工才发现的缺口类型：定义了概念却没写进实施步骤）
// ─────────────────────────────────────────────
let landingBad = 0;
for (const w of defW) {
  // 定义表之外是否还有出现（即被承接）
  const all = [...plan.matchAll(new RegExp(w.replace('-', '\\-'), 'g'))].length;
  if (all <= 1) { landingBad++; W('C19', `${w} 定义后无落点（未在任何实施/判据被承接）`); }
}
if (!landingBad) P('C19', `${defW.length} 条 vec0 语义均有落点`);

// ─────────────────────────────────────────────
// 输出
// ─────────────────────────────────────────────
console.log('══════ 一致性穷尽检查 ══════');
console.log(`判据 ${critRows.length} 条 | 检查项 ${passes.length + fails.length} 组\n`);
for (const p of passes) console.log('  PASS  ' + p);
if (warns.length) { console.log(''); for (const w of warns) console.log('  WARN  ' + w); }
if (fails.length) {
  console.log('\n──── FAIL (' + fails.length + ') ────');
  for (const f of fails) console.log('  ✗ ' + f);
  process.exitCode = 1;
} else {
  console.log('\n✅ 全部检查项通过（无 FAIL）');
}
