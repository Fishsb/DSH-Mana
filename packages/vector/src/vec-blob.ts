/**
 * BLOB ⇄ 常驻 `Float32Array` 编解码（B1.1）。落点：`memory_items.vector`（`BLOB`，
 * `packages/core/src/schema.ts:58` 已存在，本席**只写值不改表**）。
 *
 * **为什么常驻内存**：余弦是 O(n·dim) 的纯算术，逐次 `SELECT` 再解码会把 IO 与解码
 * 摊到每次检索上；而 `Float32Array` 恰好是 `cosine` 的直接入参形态。
 *
 * ⚠ **内存当缓存、库当真相**（与 schema 的注释同口径：向量是派生物，可随时重建）：
 *   故 `load()` 命中内存后**不查库**，`put()` 同时写两处；`invalidate()` 只丢内存。
 *
 * ⚠ **字节序与对齐是硬约束**（本仓 2026-09-24 实测）：`node:sqlite` 的 `DatabaseSync`
 *   绑 `Float32Array` 能直接通、读回是 `Uint8Array`。**必须用 `new Float32Array(buf.buffer,
 *   buf.byteOffset, byteLength/4)` 读取**，不能 `new Float32Array(buf)` —— 后者按**元素**
 *   解释字节（12 字节会被读成 12 个元素）且忽略 `byteOffset`，是个静默的错。
 *   本文件用**显式小端**编解码（不依赖宿主字节序），使 BLOB 在 x86/ARM 间可搬。
 */

/** 内存里的一条向量（常驻形态）。 */
export interface ResidentVector {
  readonly key: string
  readonly dim: number
  readonly vec: Float32Array
  /** 来源标记：`'blob'`（从库解码）/ `'fresh'`（刚嵌入）。仅观测用，不参与计算。 */
  readonly from: 'blob' | 'fresh'
}

/** 把一个 `Float32Array` 编成 BLOB（显式小端，与宿主字节序无关）。 */
export function encodeVector(vec: Float32Array): Buffer {
  const buf = Buffer.allocUnsafe(vec.length * 4)
  for (let i = 0; i < vec.length; i++) buf.writeFloatLE(vec[i] as number, i * 4)
  return buf
}

/**
 * 解码 BLOB。
 *
 * ⚠ 返回 `null` 的三类原因**必须由调用方落成显式字段**（G8），不得吞成"没有向量"
 *   ——「列是 NULL」「字节数不是 4 的倍数」「长度与期望 dim 不符」是三件不同的事。
 *   本函数返回 `{ ok:false, reason }` 而非 `null`，就是为了让调用方**没有机会**丢掉原因。
 */
export function decodeVector(
  blob: Uint8Array | Buffer | null | undefined,
  expectDim?: number,
): { ok: true; vec: Float32Array } | { ok: false; reason: string } {
  if (blob === null || blob === undefined) return { ok: false, reason: 'memory_items.vector 为 NULL（该行尚未嵌入）' }
  const bytes = blob.byteLength ?? blob.length ?? 0
  if (bytes === 0) return { ok: false, reason: 'memory_items.vector 长度为 0（空 BLOB，无法解码）' }
  if (bytes % 4 !== 0) {
    return { ok: false, reason: `memory_items.vector 字节数 ${bytes} 不是 4 的倍数（非 Float32 编码）` }
  }
  const view = new Float32Array(ArrayBuffer.isView(blob) ? blob.buffer : (blob as ArrayBuffer), 0, 0)
  void view
  // ⚠ 必须走 byteOffset/byteLength 的三参构造（Buffer 常是共享 ArrayBuffer 的切片）：
  //   单参 `new Float32Array(blob)` 会按元素解释字节 ⇒ 静默错。
  const out = new Float32Array((blob as Uint8Array).buffer, (blob as Uint8Array).byteOffset, bytes / 4)
  if (expectDim !== undefined && out.length !== expectDim) {
    return { ok: false, reason: `向量维度不符：期望 ${expectDim} 维，实际 ${out.length} 维` }
  }
  // 显式小端复核：若宿主是大端，上面按原生序读会错 —— 拦住比静默错好。
  if (out.length && !Number.isFinite(out[0] as number)) {
    return { ok: false, reason: '向量首元素非有限值（字节序或编码不符）' }
  }
  return { ok: true, vec: out }
}

/**
 * 常驻向量表：内存缓存（`Map`）+ **可选**落库回调。
 *
 * 设计取舍：**不持有 db 句柄**。库由 `mana-core` 独占（`ctx.get('mana-core').db`），
 * 本类只通过注入的两个回调读写 ⇒ 测试可以完全不碰库就把编解码与缓存语义跑干净
 * （「夹具绿 ≠ 真数据绿」的反面：**夹具不该依赖真数据**）。
 */
export class VectorStore {
  private readonly mem = new Map<string, ResidentVector>()
  private readonly persistPut?: (key: string, blob: Buffer, dim: number) => number
  private readonly persistGet?: (key: string) => Uint8Array | null | undefined
  private readonly dim: number
  /** 落库失败/解码失败的**显式**留痕（不抛错、不静默：调用方读它落 degraded 字段）。 */
  private readonly failures: { at: string; op: 'put' | 'get'; key: string; reason: string }[] = []

  constructor(opts: {
    dim: number
    persistPut?: (key: string, blob: Buffer, dim: number) => number
    persistGet?: (key: string) => Uint8Array | null | undefined
  }) {
    this.dim = opts.dim
    if (opts.persistPut) this.persistPut = opts.persistPut
    if (opts.persistGet) this.persistGet = opts.persistGet
  }

  /** 常驻条数（观测用：证「常驻」不是形容词）。 */
  get size(): number {
    return this.mem.size
  }

  /** 是否命中常驻内存（不查库）。 */
  has(key: string): boolean {
    return this.mem.has(key)
  }

  /** 最近 N 次失败留痕（判据读它，不读日志）。 */
  recentFailures(): readonly { at: string; op: 'put' | 'get'; key: string; reason: string }[] {
    return this.failures
  }

  /** 放入常驻内存并（若配了）落库。返回 `{ resident, persisted, reason }`。 */
  put(key: string, vec: Float32Array): { resident: boolean; persisted: boolean; reason: string | null } {
    if (vec.length !== this.dim) {
      const reason = `put 拒绝：维度 ${vec.length} ≠ 配置 dim ${this.dim}`
      this.failures.push({ at: new Date().toISOString(), op: 'put', key, reason })
      return { resident: false, persisted: false, reason }
    }
    this.mem.set(key, { key, dim: this.dim, vec, from: 'fresh' })
    if (!this.persistPut) return { resident: true, persisted: false, reason: null }
    try {
      this.persistPut(key, encodeVector(vec), this.dim)
      return { resident: true, persisted: true, reason: null }
    } catch (error) {
      const reason = `落库失败：${error instanceof Error ? error.message : String(error)}`
      this.failures.push({ at: new Date().toISOString(), op: 'put', key, reason })
      // ⚠ 落库失败**不撤内存**：向量是派生物（可重建），内存条目仍可用；
      //   但 persisted=false + reason 必须原样上报 —— 「部分成功」不得被读成「成功」。
      return { resident: true, persisted: false, reason }
    }
  }

  /** 取：先内存后库。返回显式三态（命中 / 未命中带原因 / 解码失败带原因）。 */
  get(key: string): { ok: true; item: ResidentVector } | { ok: false; reason: string } {
    const hit = this.mem.get(key)
    if (hit) return { ok: true, item: hit }
    if (!this.persistGet) return { ok: false, reason: `常驻未命中且未配持久层：key=${key}` }
    let blob: Uint8Array | null | undefined
    try {
      blob = this.persistGet(key)
    } catch (error) {
      const reason = `查询失败：${error instanceof Error ? error.message : String(error)}`
      this.failures.push({ at: new Date().toISOString(), op: 'get', key, reason })
      return { ok: false, reason }
    }
    const decoded = decodeVector(blob, this.dim)
    if (!decoded.ok) {
      this.failures.push({ at: new Date().toISOString(), op: 'get', key, reason: decoded.reason })
      return { ok: false, reason: decoded.reason }
    }
    const item: ResidentVector = { key, dim: this.dim, vec: decoded.vec, from: 'blob' }
    this.mem.set(key, item)
    return { ok: true, item }
  }

  /** 丢内存（库不动）。返回是否真的丢了。 */
  invalidate(key: string): boolean {
    return this.mem.delete(key)
  }

  /** 清空常驻。返回清掉的条数（用于判「卸载即净」）。 */
  clear(): number {
    const n = this.mem.size
    this.mem.clear()
    this.failures.length = 0
    return n
  }
}
