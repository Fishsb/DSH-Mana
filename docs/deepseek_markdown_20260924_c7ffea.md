# Mana v6.3：LLM 与 JEV 接入点细化方案

> 版本：v6.3（Prompt模板 + DSH实现 + 批量调用细化版）
> 核心原则：JEV 做判断，LLM 做生成，插件做控制
> 新增内容：完整 Prompt 模板库、DSH 插件实现代码、JEV 批量调用设计、置信度阈值校准

---

## 一、JEV 批量调用设计

### 1.1 并行问题评估

JEV 在一次请求中并行评估所有问题。发送 50 个问题和发送 1 个问题耗时相近。

| 场景 | 批量方式 | 问题数 |
|---|---|---|
| Write Gate | worth_keeping + supersedes | 2 |
| Recall Gate | rel_<id> 对 Top-50 | 50 |
| 注意力门控 | relevant_<id> | N |
| 遗忘扫描 | decay_priority_<id> | N |
| 工具路由 | tool_choice + urgency + safety | 3 |

### 1.2 批量调用实现

```typescript
async function batchJudge(ctx, state, questions) {
  const response = await fetch('https://openrouter.ai/api/v1/systemone', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ctx.credentials.get('openrouter')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'typesafe/jev-1.13', state, questions }),
  })
  return (await response.json()).answers
}
```

---

## 二、完整 Prompt 模板库

### 2.1 编码链条

| Prompt | 类型 | 内容 |
|---|---|---|
| Write Gate | Noul | 这条信息是否值得长期保存？ |
| Supersedes | Choice | 新记忆是否应该替换某条旧记忆？ |
| 情绪效价 | Score | 从非常负面到非常正面 |
| 情绪唤醒 | Score | 从非常平静到非常激动 |

### 2.2 巩固链条

| Prompt | 类型 | 内容 |
|---|---|---|
| 巩固触发 | Noul | 当前会话是否值得巩固？ |
| Chunking 效用 | Score | 产生式规则的预期效用？ |
| 深度睡眠归纳 | LLM | 提炼可复用的原则和任务路径 |

### 2.3 检索链条

| Prompt | 类型 | 内容 |
|---|---|---|
| 意图识别 | LLM | 问答/任务/提醒/闲聊 |
| Recall Gate | Noul | 记忆是否有助于回答当前问题？ |
| Injection Gate | Noul | 是否应该注入到当前上下文？ |

### 2.4 再巩固链条

| Prompt | 类型 | 内容 |
|---|---|---|
| 更新判断 | Noul | 新信息是否应该更新此记忆？ |

### 2.5 遗忘链条

| Prompt | 类型 | 内容 |
|---|---|---|
| 活性分级 | Choice | 热/温/冷 |
| 压缩摘要 | LLM | 将记忆压缩为统计摘要 |

### 2.6 学习链条

| Prompt | 类型 | 内容 |
|---|---|---|
| 原则提炼 | LLM | 从经验中提炼跨任务原则 |
| 路径归纳 | LLM | 归纳可复用任务路径 |
| 原则有效性 | Noul | 原则是否值得写入画像？ |
| FSRS 难度 | Score | 记忆难度评估 |

### 2.7 调度链条

| Prompt | 类型 | 内容 |
|---|---|---|
| 不熟悉检测 | Noul | 这是一条熟悉的任务吗？ |
| 工具路由 | Choice | 调用哪个工具？ |
| 安全守门 | Noul | 操作是否安全？ |

---

## 三、DSH 插件实现

### 3.1 JEV 统一适配插件

```typescript
// dsh-mana-jev/src/index.ts
export const name = 'mana-jev'
export const inject = ['mana-core']

export function apply(ctx: Context, config: Config) {
  const cache = new DecisionCache(config.cacheTTL)

  ctx.on('mana/jev/judge', async (req, next) => {
    const cached = cache.get(req)
    if (cached) return cached

    try {
      const result = await batchJudge(ctx, req.state, req.questions)
      cache.set(req, result)
      return result
    } catch (err) {
      if (config.fallbackEnabled) return localFallback(req)
      throw err
    }
  })
}
```

### 3.2 LLM 适配器插件

```typescript
// dsh-mana-llm/src/index.ts
class ManaAdapter extends LlmAdapter {
  async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    // 调用 LLM API，转换为 StreamChunk
  }
}

export function apply(ctx: Context, config: Config) {
  ctx.llm.registerAdapter(['mana'], new ManaAdapter(config))
}
```

### 3.3 编码插件

```typescript
// dsh-mana-perception/src/index.ts
ctx.on('mana/observation', async (obs) => {
  const summary = await generateSummary(ctx, obs.content)
  const gateResult = await ctx.emit('mana/jev/write-gate', {
    id: `write-${obs.id}`,
    content: obs.content,
    summary,
  })
  if (gateResult.answers.worth_keeping?.noul >= 0.6) {
    await writeMemory(ctx, { content: obs.content, summary })
  }
})
```

---

## 四、置信度阈值校准

### 4.1 校准原则

1. 在数据的一半上选阈值，在另一半上验证
2. 低置信度意味着概率分布分散，应升级处理
3. 保守策略：要求 95% 置信下界通过

### 4.2 Mana 各场景阈值

| 场景 | 阈值 | 失败策略 |
|---|---|---|
| Write Gate | 0.6 | Fail-open |
| Recall Gate | 0.5 | Fail-degraded |
| Injection Gate | 0.6 | Fail-closed |
| 注意力门控 | 0.7 | 回退本地规则 |
| 安全守门 | 0.8 | Fail-closed |
| 遗忘优先级 | 0.3 | 按激活值排序 |
| 再巩固更新 | 0.6 | 不更新 |
| 原则有效性 | 0.6 | 不写入 |

### 4.3 动态校准

```typescript
async function calibrateThreshold(ctx, scene) {
  const logs = await ctx.db.query('SELECT * FROM jev_log WHERE source = ?', [scene])
  const [calibrationSet, validationSet] = splitHalf(logs)
  // 在 calibrationSet 上找最佳阈值，在 validationSet 上验证
  return { scene, threshold, precision, recall }
}
```

---

## 五、JEV 通道选择

| 通道 | 方式 | 适用场景 |
|---|---|---|
| OpenRouter | POST /api/v1/systemone | 首选 |
| TypeSafe API | POST /v1/systemone | 有 TypeSafe 账号 |
| AI Gateway | POST /v1/evaluate | Vercel 用户 |
| LitJev | Qwen 本地推理 | 隐私敏感 |

---

## 六、降级链路

| 组件 | 正常路径 | 降级路径 | 最终兜底 |
|---|---|---|---|
| JEV 判断 | JEV API | 缓存 → 本地规则 | 向量相似度 |
| LLM 生成 | ctx.llm | 小模型降级 | 模板回复 |

---

> Mana（末那识）：JEV 做判断，LLM 做生成，插件做控制——完整接入点细化。