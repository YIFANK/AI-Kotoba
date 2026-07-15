// SM-2 间隔重复算法
// quality: 0-5（0=完全忘记，5=完美回忆）；quality < 3 重置进度，>= 3 增加间隔
const DAY = 24 * 60 * 60 * 1000;

export function applySM2(item, quality) {
  let { ease = 2.5, interval = 0, reps = 0 } = item;
  if (quality < 3) {
    reps = 0;
    interval = 1;
  } else {
    reps += 1;
    if (reps === 1) interval = 1;
    else if (reps === 2) interval = 6;
    else interval = Math.round(interval * ease);
    ease = Math.max(1.3, ease + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  }
  return Object.assign({}, item, {
    ease, interval, reps,
    nextReview: Date.now() + interval * DAY,
    lastReviewed: Date.now(),
  });
}

export function isDue(item) {
  return (item.nextReview ?? 0) <= Date.now();
}

export function formatDue(ts) {
  if (!ts || ts <= Date.now()) return '待复习';
  const days = Math.ceil((ts - Date.now()) / DAY);
  if (days <= 1) return '明天';
  if (days < 30) return `${days} 天后`;
  const months = Math.round(days / 30);
  return `${months} 个月后`;
}
