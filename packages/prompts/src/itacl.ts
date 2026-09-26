/**
 * §25.8 ITACL 专用 —— 2 条。
 *
 * ⚠⚠ **本文件的两条常量刻意不接线到宿主**（C16 已拍板 ITACL **不移植**）。
 *   「照抄常量定义」与「接线到宿主」是两件事：
 *     · 允许：把 v10 原文的常量文本落成可导出、可判据化的定义（本文件）；
 *     · 禁止：在 `apply` 里消费它们、把它们交给 LLM 层、或注册监听器去触发判定。
 *   这条边界由测试⑥机检（静态读本包源码 + 运行时读服务面），**不是注释承诺**。
 */
import type { JevQuestion } from '../../jev/lib/types/systemone.js'

/** §25.8 · 任务复杂度评估（choice）。**不接线**（见文件头）。 */
export const TASK_COMPLEXITY_PROMPT: JevQuestion = {
  type: 'choice',
  instructions: '评估任务复杂度。',
  criteria: {
    simple: '直接回答，无需检索',
    medium: '需要一次本地检索或工具调用',
    complex: '需要多轮检索、工具调用或网络搜索',
  },
}

/** §25.8 · 行动结果分类（choice）。**不接线**（见文件头）。 */
export const RESULT_CLASSIFICATION_PROMPT: JevQuestion = {
  type: 'choice',
  instructions: '分类当前行动的结果。',
  criteria: {
    success: '成功',
    failure: '失败',
    anomaly: '异常，需要诊断',
    uncertain: '不确定',
    partial: '部分成功',
  },
}
