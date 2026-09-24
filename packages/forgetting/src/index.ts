/**
 * `dsh-mana-forgetting` —— Mana 种子衰减：艾宾浩斯衰减 + 间隔重复 + 归档（P1 骨架）
 *
 * ⚠ **本轮（B2.2）只立骨架，不填实现**：`册:743` C12 的设计意图是
 *   「13 个空壳同批装配后面板上分不出哪几个真有行为」⇒ P1 分批建、骨架与实现分开交付。
 *
 * ⚠ **本骨架是"诚实的空壳"，且"没有行为"本身是机检事实**（R2 订正）：
 *   它**不写任何 `mana_trace` 行** ⇒ 「卸载后同一触发不再产生新行」这条反证判据在本包上
 *   **平凡通过**（成立的原因是"它从来没生效过"，G11）。故 `status()` **显式**回报
 *   `behavior: 'skeleton'`，并由 `tests/skeleton.test.mjs` **读运行时服务面**断言该值，
 *   且**并列断言"本包仍是空壳"**（判据⑦ effect 面恰好 3 条、判据⑧ 行为面 0 行）——
 *   一旦有人加进真行为而忘记改它，判据即变红（R2b 前这里只是注释承诺，零机检）。
 *
 *   ⚠ **反向不可机检，此处如实声明**（R2b 订正，删去原先的空承诺）：
 *     「填了真行为却把 `behavior` 留成 `'skeleton'` ⇒ 判据必红」**原句是空的** —— 实测
 *     （注入真行为、`behavior` 不动）六条全绿。真因是 **A 方案在此结构上不可行**：
 *     `behavior` 要"由实现事实推导"，就得先定"什么是本包的真行为"，而那是**阶段 2/3 的交付物**
 *     （写什么 `mana_trace` 行）⇒ 预写它即越界。
 *     现由 ⑦⑧ **间接**覆盖：**新增行为**（监听器/定时器/写行）必被 ⑦ 或 ⑧ 抓到；
 *     **残留盲区（如实记）**：若把行为换成"effect 数不变的同形实现"，⑦⑧ 抓不到。
 *
 * ⚠ **本包刻意不导出 `Config`**（R2 订正 · 删除一个假旋钮）：
 *   本轮一度导出 `enabled: boolean`，但它 `apply` 里零消费 —— `enabled=false` 与 `true`
 *   **完全同形**（监听器照注册、事件照透传），即"假旋钮"。两条修法（做真 vs 删掉）本席选**删掉**：
 *   ① `册:318` 要求骨架 `apply` **必须**注册 waterfall 监听器并调 `next()`（把 G9 钉成**结构约束**）。
 *      若让 `enabled` 去门控这条监听器 ⇒ G9 义务变成"可由配置关掉"，与结构约束的本意相悖；
 *      一枚配置就能静默取消 next() 纪律，正是本仓最要防的那类失败。
 *   ② 对一个零行为的空壳，可"关掉"的东西只剩服务提供面本身 ⇒ `enabled=false` 的形态与
 *      "插件根本没装/装失败"**同形**，等于新增一条静默通道。空壳本就够小，无需灰度旋钮。
 *
 * ⚠ 硬结构约束（G9 / `册:318`）：`apply` 必须注册一条 waterfall 监听器并调 `next()`，
 *   走 core 的 `registerPassThroughPreStep`（唯一写点）。漏调的后果**不报错**：
 *   本仓实测上游不调 `next()` ⇒ 下游哨兵 reached=0、返回 undefined、全程无异常。
 *
 * 阶段 3 的 B4.2 在此填实现。⚠ 归档留存上限必须与「物理删除永不发生」一起定，否则只监控不设限。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { registerPassThroughPreStep, type ManaCoreService } from 'dsh-mana-core'

export const name = 'mana-forgetting'

/** 依赖 core（方案 §9.1）。依赖仅 core（依赖方向订正见文件头）。 */
export const inject: string[] = ['mana-core']

export interface ManaSvc {
  readonly plugin: string
  /** 'skeleton' = 本包**尚无行为**（由 tests 读运行时服务面机检）；'active' = 已填实现。 */
  status(): { plugin: string; wired: boolean; behavior: 'skeleton' | 'active' }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    'mana-forgetting': ManaSvc
  }
}

export function apply(ctx: Context): void {
  const core: ManaCoreService | undefined = ctx.get('mana-core')
  if (!core) throw new Error('mana-forgetting: 缺少 mana-core 服务（inject 未满足）')

  const service: ManaSvc = {
    plugin: name,
    status: () => ({ plugin: name, wired: true, behavior: 'skeleton' }),
  }

  ctx.effect(() => {
    const dispose = ctx.provide('mana-forgetting', service)
    return () => dispose()
  }, 'dsh-mana-forgetting: service')

  // G9：waterfall 直通 + next()。**无条件注册**（不得由任何配置门控，见文件头）。
  registerPassThroughPreStep(ctx, name)
}
