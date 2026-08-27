/**
 * What a player has done across days.
 *
 * A daily with no memory is a puzzle you do once. The streak is the reason to
 * come back tomorrow, and the record of how you have done is the reason to care
 * how you do today.
 *
 * Everything lives in this browser. There is no account and no server, which
 * means a streak is a private thing rather than a leaderboard position — and
 * also that clearing site data ends it, which is worth being honest about
 * rather than pretending otherwise.
 */

/** Days kept. Enough for a history worth looking at, small enough to store. */
const KEEP = 90;

const toDay = (key) => new Date(`${key}T00:00:00Z`);
const dayString = (date) => date.toISOString().slice(0, 10);

/** The day before a given key, in UTC. */
export function previousDay(key) {
  const d = toDay(key);
  d.setUTCDate(d.getUTCDate() - 1);
  return dayString(d);
}

/**
 * Fold a new result into the stored history, dropping anything older than the
 * window. Results are keyed by day, so replaying a day cannot inflate anything.
 */
export function recordDay(history, day, result) {
  const next = { ...history, [day]: result };
  const cutoff = new Date(toDay(day));
  cutoff.setUTCDate(cutoff.getUTCDate() - KEEP);
  const oldest = dayString(cutoff);

  for (const key of Object.keys(next)) {
    if (key < oldest) delete next[key];
  }
  return next;
}

/**
 * The run of consecutive days ending today — or ending yesterday, if today has
 * not been played yet. A streak that vanished the moment you woke up, before
 * you had a chance to play, would be a punishment for sleeping.
 */
export function currentStreak(history, today) {
  let day = history[today] ? today : previousDay(today);
  if (!history[day]) return 0;

  let streak = 0;
  while (history[day]) {
    streak += 1;
    day = previousDay(day);
  }
  return streak;
}

/** The longest run of consecutive days anywhere in the history. */
export function bestStreak(history) {
  const days = Object.keys(history).sort();
  let best = 0;
  let run = 0;
  let previous = null;

  for (const day of days) {
    run = previous && previousDay(day) === previous ? run + 1 : 1;
    previous = day;
    if (run > best) best = run;
  }
  return best;
}

/**
 * How the played days are spread, by how much of each deal was beaten.
 *
 * Bucketed by percentile rather than by raw score, because raw scores are not
 * comparable between days: a 12% on a deal that allowed 13% is a better day's
 * work than a 30% on one that allowed 60%.
 */
export const BUCKETS = [
  { min: 0.9, label: 'Top 10%' },
  { min: 0.7, label: '70–90%' },
  { min: 0.4, label: '40–70%' },
  { min: 0.15, label: '15–40%' },
  { min: 0, label: 'Bottom 15%' },
];

export function distribution(history) {
  const counts = BUCKETS.map((b) => ({ ...b, count: 0 }));
  for (const result of Object.values(history)) {
    if (typeof result?.par !== 'number') continue;
    const bucket = counts.find((b) => result.par >= b.min) ?? counts[counts.length - 1];
    bucket.count += 1;
  }
  return counts;
}

export function summary(history, today) {
  const played = Object.keys(history).length;
  const pars = Object.values(history).map((r) => r?.par).filter((p) => typeof p === 'number');
  return {
    played,
    streak: currentStreak(history, today),
    best: bestStreak(history),
    bestPar: pars.length ? Math.max(...pars) : null,
    perfect: Object.values(history).filter((r) => r?.perfect).length,
    distribution: distribution(history),
  };
}
