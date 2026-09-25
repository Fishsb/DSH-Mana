/**
 * profile-index.ts — 双画像句柄（**判据可达的薄门面** · L-04）。
 *
 * 为什么单独一层：判据要能直接拿它断言「两条通道走同一个写入口」，而不是
 * 去猜服务面的中间态（与 packages/user-model/src/precision.ts 拆出纯函数面同因）。
 * 本文件**零决策**：它只把「core 面 + 注入的退场判定」绑成一个句柄，
 * 并把每次调用转交给 `profile-pipeline.ts#applyProfileChange` ——
 * **双通道共用同一个函数**这条判据，在此处是**结构事实**（两个方法体都只有一行转发），
 * 不是"约定"。
 */
import type { ManaCoreService } from 'dsh-mana-core'
import {
  applyProfileChange,
  keyInjectionState,
  listProfileHistory,
  PROFILE_WRITE_VERSION,
  type ProfileChangeInput,
  type ProfileCoreFace,
  type ProfileHistoryLine,
  type ProfilePipelineDeps,
  type ProfileWriteResult,
} from './profile-pipeline.ts'
import { PROFILE_CHANNELS, type ProfileChannel, type ProfileDoc, type ProfileVerdictLike } from './profile.ts'

export type ProfileVerdictOf = (confidence: number, floor: number | null) => ProfileVerdictLike

/** 本插件装配时用到的 core 面（core 服务只需满足这个子集）。 */
export type ProfileHostFace = Pick<
  ManaCoreService,
  'updateUserModel' | 'listUserModelHistory' | 'writeTrace' | 'db'
>

/** 两个通道共用的写入入参（通道名由方法决定，调用方不得自传 —— 防"标了 A 通道走了 B 路径"）。 */
export type ProfileChangeDraft = Omit<ProfileChangeInput, 'channel'>

/** 句柄状态（供 `status()` 回报：双通道都在、写入口唯一、版本号）。 */
export interface ProfileIndexStatus {
  version: string
  channels: readonly ProfileChannel[]
  docs: readonly ProfileDoc[]
  /** 写入口的**唯一性**声明：两个通道映射到同一个函数名（判据按名字断言）。 */
  writeEntry: string
  /** 退场阈值的当前读数；`null` = A4-1 未拍板（随 core.config 传入，本包不设缺省）。 */
  confidenceFloor: number | null
}

/** 双画像/双通道句柄。 */
export interface ProfileIndex {
  status(): ProfileIndexStatus
  /** 通道①：蒸馏通道（**实时**，会话内触发）。 */
  changeViaDistill(draft: ProfileChangeDraft): ProfileWriteResult
  /** 通道②：深睡通道（**夜间批**）。 */
  changeViaDeepsleep(draft: ProfileChangeDraft): ProfileWriteResult
  /** 读侧：本包写的画像历史（含 writer/channel/decision 的还原）。 */
  history(doc?: ProfileDoc): ProfileHistoryLine[]
  /** 读侧：某偏好的注入态（`injectable === null` = 读不出，与 `false` 可分辨）。 */
  state(doc: ProfileDoc, key: string): ReturnType<typeof keyInjectionState>
}

/**
 * 构造句柄。
 *
 * @param core   core 服务（或其结构子集）。
 * @param verdictOf 退场判定实现（生产路径 = `ctx.get('mana-user-model').injectionVerdict`）。
 *   ⚠ **必填、无缺省**：本包不提供第二份判定实现 —— 少了两处实现会漂移的入口。
 * @param confidenceFloor A4-1 阈值读数；`null` = 未拍板。**不设缺省数字**：
 *   兜一个 0 会让所有偏好都 ≥ 阈值 ⇒ 退场永不触发而系统看起来正常。
 */
export function createProfileIndex(
  core: ProfileHostFace,
  verdictOf: ProfileVerdictOf,
  confidenceFloor: number | null = null,
): ProfileIndex {
  if (!core || typeof core.updateUserModel !== 'function') {
    throw new Error('createProfileIndex: 缺 core 写面（updateUserModel）—— 本包不另建写入路径')
  }
  if (typeof verdictOf !== 'function') {
    throw new Error('createProfileIndex: 缺 verdictOf —— 退场判定不在本包实现，必须由调用方注入')
  }
  const face = core as ProfileCoreFace
  const floor = confidenceFloor === undefined ? null : confidenceFloor
  // ⚠ floor 进 deps 是**唯一来源**：写侧（applyProfileChange）与读侧（keyInjectionState）
  //   都从它取。写侧若另传一个、读侧传 null，就会出现"判了退场、读出来却可注入"的错位。
  const deps: ProfilePipelineDeps = { core: face, verdictOf, confidenceFloor: floor }

  return {
    status: () => ({
      version: PROFILE_WRITE_VERSION,
      channels: PROFILE_CHANNELS,
      docs: ['AGENT.md', 'USER.md'],
      writeEntry: applyProfileChange.name,
      confidenceFloor: floor,
    }),
    // ⚠ 以下两个方法体必须**逐字相同**（只有通道标注不同）：它们转发到同一个函数。
    changeViaDistill: (draft) => applyProfileChange(deps, { ...draft, channel: 'distill', confidenceFloor: draft.confidenceFloor ?? floor }),
    changeViaDeepsleep: (draft) => applyProfileChange(deps, { ...draft, channel: 'deepsleep', confidenceFloor: draft.confidenceFloor ?? floor }),
    history: (doc) => listProfileHistory(deps, doc),
    state: (doc, key) => keyInjectionState(deps, doc, key),
  }
}

export { applyProfileChange }
export { PROFILE_CHANNELS }
