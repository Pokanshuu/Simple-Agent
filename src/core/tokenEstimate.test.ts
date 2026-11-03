import { describe, expect, it } from 'vitest'

import { estimateTokens, estimateTokensOfAll, formatTokens } from './tokenEstimate'

/**
 * 估算器不追求精确，但**单调性与量级**必须成立 ——
 * 圆环和阈值提醒都建立在这上面：估偏一倍会让"该压缩了"的提示变得毫无意义。
 *
 * Ported 1:1 from Kotlin `TokenEstimateTest.kt`
 * (`TokenEstimate.of` → `estimateTokens`, `ofAll` → `estimateTokensOfAll`,
 * `format` → `formatTokens`).
 */
describe('TokenEstimate', () => {
  it('empty text costs nothing', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokensOfAll(['', ''])).toBe(0)
  })

  it('non empty text costs at least one token', () => {
    // "÷4 后取整"会把一个字符压成 0，而 0 token 在 UI 上等于"空"
    expect(estimateTokens('a')).toBe(1)
    expect(estimateTokens('的')).toBe(1)
  })

  it('cjk is counted denser than latin', () => {
    // 比的是**每个字符**的代价，不是等长字符串的总量 ——
    // 同样的字符数下，中文必须更贵
    const chinese = '这是一段中文文本内容' // 10 个 CJK
    const english = 'abcdefghij' // 10 个拉丁

    expect(
      estimateTokens(chinese),
      `单字中文应比单字英文贵：${estimateTokens(chinese)} vs ${estimateTokens(english)}`,
    ).toBeGreaterThan(estimateTokens(english))
  })

  it('scales linearly with repeated content', () => {
    const once = estimateTokens('你好世界')
    const tenTimes = estimateTokens('你好世界'.repeat(10))

    // 每次都会取整，放大十倍后误差也会放大 —— 断言比例而非绝对差
    const ratio = tenTimes / once
    expect(
      ratio >= 8.0 && ratio <= 12.0,
      `十倍内容应约等于十倍 token：${once} -> ${tenTimes}（比值 ${ratio}）`,
    ).toBe(true)
  })

  it('ofAll avoids per segment rounding', () => {
    // 若逐段取整，"a"×1 会被抬到 1，十段就是 10；合计应为 10/4 ≈ 3
    const joined = estimateTokensOfAll(Array.from({ length: 10 }, () => 'aaaa'))

    expect(joined >= 9 && joined <= 11, `十段 4 字符合计应约 10 token，实际 ${joined}`).toBe(
      true,
    )
  })

  it('format is compact enough for the ring label', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(980)).toBe('980')
    expect(formatTokens(1_000)).toBe('1k')
    // 一位小数只在 10k 以下保留；再往上位数更重要
    expect(formatTokens(9_940)).toBe('9.9k')
    expect(formatTokens(12_345)).toBe('12k')
    expect(formatTokens(123_456)).toBe('123k')
    expect(formatTokens(1_200_000)).toBe('1.2M')
  })

  it('format never exceeds five characters', () => {
    // 圆环旁只有 ~4~5 个字符的位置
    for (const value of [1, 999, 1_000, 9_999, 12_345, 123_456, 999_999]) {
      const text = formatTokens(value)
      expect(text.length, `format(${value}) = ${text} 太长了`).toBeLessThanOrEqual(5)
    }
  })
})
