/**
 * SOAR 目标栈 + 三阶段循环 —— **纯函数/纯数据**，不依赖 cordis。
 *
 * 为什么要把算法与插件装配分开（本席取舍）：
 *   ① 判据要真有牙 ⇒ 算法必须能在**无插件、无库、无网络**的条件下被逐字断言（A 档）；
 *   ② 装配面（`index.ts`）只做「把算法接到 cordis 上」这一件事，失败面因此可分辨。
 *
 * ⚠ 三条**不得静默**的形态（对应本仓 G8/G11 的口径：失败必须可枚举）：
 *   - SOAR 分析阶段候选为空 ⇒ 记 `phase='impasse'`（SOAR 术语），**不得**返回 undefined 冒充"没发生"；
 *   - 目标栈查不到 id ⇒ 抛错（不得静默返回 false 让调用方以为成功）；
 *   - 栈序一律**显式排序**（priority 降序 → id 升序），不依赖 Map 插入序 —— 插入序在
 *     跨运行/跨实现下不稳定，拿它当锚点就是拿 B 档当 A 档用。
 */

/** 目标状态。与方案 §5.4 目标栈示例的 `status=active/done/running/paused` 对齐。 */
export type GoalStatus = 'active' | 'running' | 'paused' | 'done' | 'pending'

/** 目标节点。`depth` 由栈在插入时算出（0 = 根）。 */
export interface GoalNode {
  id: string
  parentId: string | null
  title: string
  priority: number
  status: GoalStatus
  depth: number
}

/** 入栈输入。 */
export interface GoalInput {
  id: string
  title: string
  priority?: number
  parentId?: string | null
  status?: GoalStatus
}

/** 排序：priority 降序，同优先级按 id 升序（**确定性锚点**，见文件头）。 */
function byPriorityThenId(a: GoalNode, b: GoalNode): number {
  if (a.priority !== b.priority) return b.priority - a.priority
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** 目标栈。 */
export class GoalStack {
  private readonly nodes = new Map<string, GoalNode>()

  /** 当前栈深度（节点数）。 */
  get size(): number {
    return this.nodes.size
  }

  /** 入栈。父不存在或 id 重复 ⇒ **抛错**（不静默）。 */
  push(input: GoalInput): GoalNode {
    if (this.nodes.has(input.id)) throw new Error(`goal-stack: 目标 id 重复 ${input.id}`)
    const parentId = input.parentId ?? null
    let depth = 0
    if (parentId !== null) {
      const parent = this.nodes.get(parentId)
      if (!parent) throw new Error(`goal-stack: 父目标不存在 ${parentId}`)
      depth = parent.depth + 1
    }
    const node: GoalNode = {
      id: input.id,
      parentId,
      title: input.title,
      priority: input.priority ?? 0,
      status: input.status ?? 'active',
      depth,
    }
    this.nodes.set(node.id, node)
    return node
  }

  get(id: string): GoalNode {
    const node = this.nodes.get(id)
    if (!node) throw new Error(`goal-stack: 目标不存在 ${id}`)
    return node
  }

  has(id: string): boolean {
    return this.nodes.has(id)
  }

  /** 某目标的子节点，**已排序**。 */
  childrenOf(parentId: string | null): GoalNode[] {
    return [...this.nodes.values()].filter((n) => n.parentId === parentId).sort(byPriorityThenId)
  }

  /** 当前目标：depth 最大者优先；同 depth 按 priority/id。无活动目标 ⇒ 返回 null（**显式**）。 */
  top(): GoalNode | null {
    const live = [...this.nodes.values()]
      .filter((n) => n.status === 'active' || n.status === 'running' || n.status === 'pending')
      .sort((a, b) => (a.depth !== b.depth ? b.depth - a.depth : byPriorityThenId(a, b)))
    return live[0] ?? null
  }

  /** 改成新状态；返回被改的节点。 */
  setStatus(id: string, status: GoalStatus): GoalNode {
    const node = this.get(id)
    node.status = status
    return node
  }

  /** 完成一个目标（`done`）。 */
  complete(id: string): GoalNode {
    return this.setStatus(id, 'done')
  }

  /**
   * 出栈：删除以 `id` 为根的**整棵子树**，返回被删 id（**后序**：先子后父）。
   *
   * 后序是刻意的：chunking（阶段 3）要在父目标删除前看到子目标，否则子目标序列丢失。
   */
  pop(id: string): string[] {
    this.get(id) // 不存在即抛错
    const removed: string[] = []
    const walk = (cur: string): void => {
      for (const child of this.childrenOf(cur)) walk(child.id)
      removed.push(cur)
      this.nodes.delete(cur)
    }
    walk(id)
    return removed
  }

  /** 栈的确定性投影：DFS **先序**，子节点已排序 —— 判据用它逐字比对。 */
  toSerial(): GoalNode[] {
    const out: GoalNode[] = []
    const walk = (parentId: string | null): void => {
      for (const child of this.childrenOf(parentId)) {
        out.push({ ...child })
        walk(child.id)
      }
    }
    walk(null)
    return out
  }
}

// ── SOAR 三阶段 ──────────────────────────────────────────────────────────────

/** 产生式规则（方案 §3.3：算子 + 规则记忆）。 */
export interface Operator {
  id: string
  /** 前提：**全部**出现在当前事实集中才算匹配（合取语义）。 */
  conditions: string[]
  /** 效果：行动阶段并入事实集。 */
  effects: string[]
  utility: number
  successRate: number
  cost: number
}

/** 阶段名。`impasse`（僵局）是 SOAR 的一等状态，**不是错误路径的兜底**。 */
export type SoarPhase = 'analyze' | 'decide' | 'act' | 'impasse'

/** 一次循环的结果（全字段可枚举，无 undefined 表状态）。 */
export interface SoarCycle {
  cycle: number
  phase: SoarPhase
  /** 分析阶段匹配到的候选算子 id（**已排序**）。 */
  candidates: string[]
  /** 决策阶段选中的算子；impasse 时为 null。 */
  operatorId: string | null
  /** 行动前后事实集（**已排序**，故可直接逐字比对）。 */
  factsBefore: string[]
  factsAfter: string[]
}

/** 事实集归一：去重 + 排序 —— 排序是为了让"集合相等"成为可逐字比对的 A 档判据。 */
export function normalizeFacts(facts: readonly string[]): string[] {
  return [...new Set(facts)].sort()
}

/** 分析阶段：匹配候选算子（合取语义），结果按 id 升序。 */
export function analyze(facts: readonly string[], operators: readonly Operator[]): string[] {
  const set = new Set(facts)
  return operators
    .filter((op) => op.conditions.every((c) => set.has(c)))
    .map((op) => op.id)
    .sort()
}

/**
 * 决策阶段：按 `utility` 降序 → `successRate` 降序 → `cost` 升序 → id 升序取首个。
 * 全相等 ⇒ id 升序是**决定性**的：不许出现"看运气"的选法。
 */
export function decide(candidateIds: readonly string[], operators: readonly Operator[]): string | null {
  const byId = new Map(operators.map((op) => [op.id, op]))
  const ranked = candidateIds
    .map((id) => byId.get(id))
    .filter((op): op is Operator => Boolean(op))
    .sort((a, b) => {
      if (a.utility !== b.utility) return b.utility - a.utility
      if (a.successRate !== b.successRate) return b.successRate - a.successRate
      if (a.cost !== b.cost) return a.cost - b.cost
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
  return ranked[0]?.id ?? null
}

/** 行动阶段：把效果并入事实集（幂等）。 */
export function act(facts: readonly string[], op: Operator): string[] {
  return normalizeFacts([...facts, ...op.effects])
}

/**
 * 跑一次三阶段循环。
 *
 * ⚠ 候选为空 = **僵局（impasse）**：本函数显式返回 `phase='impasse'` 且 `operatorId=null`，
 *   而**不是**返回一个"什么也没发生"的普通结果 —— 二者在调用方眼里必须可分辨（G8）。
 */
export function runCycle(
  facts: readonly string[],
  operators: readonly Operator[],
  cycle: number,
): SoarCycle {
  const factsBefore = normalizeFacts(facts)
  const candidates = analyze(factsBefore, operators)
  const operatorId = decide(candidates, operators)
  if (operatorId === null) {
    return { cycle, phase: 'impasse', candidates, operatorId: null, factsBefore, factsAfter: factsBefore }
  }
  const op = operators.find((o) => o.id === operatorId)
  if (!op) throw new Error(`soar: 决策选出的算子不在算子集中 ${operatorId}`)
  return {
    cycle,
    phase: 'act',
    candidates,
    operatorId,
    factsBefore,
    factsAfter: act(factsBefore, op),
  }
}
