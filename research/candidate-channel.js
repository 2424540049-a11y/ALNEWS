'use strict';
/**
 * 铝双轨20（研究） — fixed MA20 ± 0.5 population standard deviation.
 * Close-confirmed signals; the current close is available before decision.
 * No date-specific rules, future bars, leverage, stop/target optimization, or exits
 * based on unavailable intrabar ordering. Initial state is flat; thereafter keep
 * the last direction until the opposite band is crossed. A touch is not a cross.
 * The application's ideal LOW/HIGH fills remain a hindsight simulation, distinct
 * from this causal signal rule. See REPORT.md for failed next-open validation.
 */
function computeChannel20Strategy(candles) {
  const period = 20;
  const multiplier = 0.5;
  const mid = [];
  const upper = [];
  const lower = [];
  const signals = [];
  let rollingSum = 0;
  let position = 0;

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    rollingSum += candle.close;
    if (index >= period) rollingSum -= candles[index - period].close;
    if (index < period - 1) {
      mid.push(null);
      upper.push(null);
      lower.push(null);
      continue;
    }
    const mean = rollingSum / period;
    let varianceSum = 0;
    for (let cursor = index - period + 1; cursor <= index; cursor += 1) {
      varianceSum += (candles[cursor].close - mean) ** 2;
    }
    const width = multiplier * Math.sqrt(varianceSum / period);
    const upperBand = mean + width;
    const lowerBand = mean - width;
    mid.push(mean);
    upper.push(upperBand);
    lower.push(lowerBand);
    const direction = candle.close > upperBand ? 1 : candle.close < lowerBand ? -1 : position;
    if (direction !== position && direction !== 0) {
      const buy = direction > 0;
      signals.push({
        index,
        label: buy ? '升高' : '降低',
        price: buy ? candle.low : candle.high,
        className: buy ? 'strategy-buy' : 'strategy-sell',
        dy: buy ? 16 : -8,
        type: buy ? 'buy' : 'sell'
      });
      position = direction;
    }
  }
  return {
    key: 'al_channel_20',
    label: '铝双轨20（研究）',
    description: 'MA20 ± 0.5σ；收盘突破上轨做多、跌破下轨做空，轨内保持方向。固定规则研究候选。',
    lines: [
      { name: 'up', label: '上轨', className: 'strategy-line-up', values: upper },
      { name: 'mid', label: '中轨', className: 'strategy-line-mid', values: mid },
      { name: 'low', label: '下轨', className: 'strategy-line-low', values: lower }
    ],
    signals
  };
}
if (typeof module !== 'undefined' && module.exports) module.exports = { computeChannel20Strategy };
