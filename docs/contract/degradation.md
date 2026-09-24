# 降级约定（I-8 的产物 · G8）

> **背景（既成事实的先例）**：本机 shoucang `lib/vec.js` 原文有 `catch { return null }`
> —— 把「provider 失败」与「正常空结果」**混为一谈**。后果：向量档**看起来跑通、实际全走词法**，
> 查不出、测不到。

## 硬约定（阶段 0 冻结，全员适用）

1. **禁止 `catch { return null }`** —— 降级**必须**落显式字段。
2. 领域模型里「不可用」与「零值」必须**可分辨**：
   - 概率不可用 ⇒ `null`，**不得用 `0` 冒充**（`ManaDecision.probability: number | null`）。
   - 判定失败 ⇒ `value: 'unknown'`，**不得默认成 `'no'`**。
3. 每次降级必须同时给出 **`degraded: true`** 与 **`reason`**（非空字符串）。
4. **`gate` 是枚举列**（5 类），由生产侧写死、**消费侧只读**：
   `injected` / `skip_no_candidate` / `skip_below_threshold` / `degraded_unavailable` / `reset`。
   不得留空、不得用 `undefined` 表状态 —— `undefined` 会被事件信封/JSON 序列化**静默丢键**
   ⇒「判不了」与「判不准」不可分辨。
5. **fail-closed 不得吞掉「未判」**（A1-14）：正确行为是**沉默地不注入，但必须留痕** ——
   注入块数 == 0 **并且** `inject_log` 仍新增 `gate='degraded_unavailable'` 行，**两条都要真**。

## 为什么单列一条约定

Injection Gate 的失败策略是 fail-closed（不注入、沉默优于噪音）。
其**正常态与故障态在表面上完全同形**（都是「没注入」）⇒ 这类缺陷**必须先被判据覆盖，否则永远查不出来**。
