// server/bot.js
const { getCardStrength } = require('./gameLogic');

// ── 4 bot personalities ────────────────────────────────────────────────────
const BOT_PERSONALITIES = [
  {
    name: 'Zé do Bot',
    style: 'aggressive',
    description: 'Arrojado — joga forte, pede truco cedo',
  },
  {
    name: 'Bot Mané',
    style: 'cautious',
    description: 'Cauteloso — conserva as boas, raramente arrisca',
  },
  {
    name: 'Botinho do Truco',
    style: 'technical',
    description: 'Técnico — joga a mínima necessária para ganhar',
  },
  {
    name: 'Pequeno Bot',
    style: 'beginner',
    description: 'Iniciante — comete erros e joga aleatoriamente às vezes',
  },
];

// ── chooseBotCard ──────────────────────────────────────────────────────────
function chooseBotCard(personality, hand, roundCards, teamId, roundsWon) {
  if (!hand || hand.length === 0) return null;
  const { style } = personality;

  const enemyTeamId = teamId === 0 ? 1 : 0;
  const enemyCards = roundCards.filter(e => e.teamId === enemyTeamId);

  let bestEnemyStrength = -1;
  for (const entry of enemyCards) {
    const s = getCardStrength(entry.card);
    if (s > bestEnemyStrength) bestEnemyStrength = s;
  }

  const sorted = [...hand].sort((a, b) => getCardStrength(a) - getCardStrength(b));
  const winning = sorted.filter(c => getCardStrength(c) > bestEnemyStrength);

  // Beginner: 25% chance of a wrong/random play
  if (style === 'beginner' && Math.random() < 0.25) {
    return sorted[Math.floor(Math.random() * sorted.length)];
  }

  if (bestEnemyStrength > -1) {
    // There's an enemy card to beat
    if (winning.length > 0) {
      if (style === 'aggressive') return winning[winning.length - 1]; // overkill — burns strong cards
      return winning[0]; // technical/cautious: minimum card to win
    }
    // Can't win — discard weakest
    return sorted[0];
  }

  // Playing first in this round
  if (style === 'aggressive') {
    return sorted[sorted.length - 1]; // always play strongest
  }
  if (style === 'cautious') {
    // If already won a round, play strong to close; otherwise play weak
    return roundsWon[teamId] >= 1 ? sorted[sorted.length - 1] : sorted[0];
  }
  if (style === 'technical') {
    // Play middle non-manilha; save manilhas for later
    const nonManilhas = sorted.filter(c => getCardStrength(c) < 11);
    if (nonManilhas.length > 0) {
      const mid = Math.floor(nonManilhas.length / 2);
      return nonManilhas[mid];
    }
    return sorted[0]; // only manilhas left — play weakest
  }
  // beginner: random
  return sorted[Math.floor(Math.random() * sorted.length)];
}

// ── shouldCallTruco ────────────────────────────────────────────────────────
function shouldCallTruco(personality, hand, scores, teamId) {
  const { style } = personality;
  const totalStrength = hand.reduce((sum, c) => sum + getCardStrength(c), 0);
  const manilhas = hand.filter(c => getCardStrength(c) >= 11).length;
  const enemyScore = scores[teamId === 0 ? 1 : 0];

  if (style === 'aggressive') {
    if (enemyScore >= 11) return false;
    return manilhas >= 1 || totalStrength >= 18;
  }
  if (style === 'cautious') {
    if (enemyScore >= 9) return false;
    return manilhas >= 2 || totalStrength >= 28;
  }
  if (style === 'technical') {
    if (enemyScore >= 9) return false;
    return manilhas >= 1 && totalStrength >= 22;
  }
  // beginner: random, only if hand is decent
  if (totalStrength >= 20) return Math.random() < 0.3;
  return false;
}

// ── botRespondTruco ────────────────────────────────────────────────────────
function botRespondTruco(personality, hand, currentValue) {
  const { style } = personality;
  const totalStrength = hand.reduce((sum, c) => sum + getCardStrength(c), 0);
  const manilhas = hand.filter(c => getCardStrength(c) >= 11).length;

  if (style === 'aggressive') {
    if (currentValue >= 12) return totalStrength >= 16 ? 'accept' : 'fold';
    if (manilhas >= 1 || totalStrength >= 18) return 'raise';
    if (totalStrength >= 14) return 'accept';
    return 'fold';
  }
  if (style === 'cautious') {
    if (currentValue >= 9) return manilhas >= 2 ? 'accept' : 'fold';
    if (manilhas >= 2) return 'accept';
    return 'fold';
  }
  if (style === 'technical') {
    if (currentValue >= 12) return totalStrength >= 18 || manilhas >= 1 ? 'accept' : 'fold';
    if (manilhas >= 2 || totalStrength >= 26) return 'raise';
    if (manilhas >= 1 || totalStrength >= 20) return 'accept';
    return 'fold';
  }
  // beginner: random
  const r = Math.random();
  if (r < 0.3) return 'fold';
  if (r < 0.5 && currentValue < 12) return 'raise';
  return 'accept';
}

module.exports = { BOT_PERSONALITIES, chooseBotCard, shouldCallTruco, botRespondTruco };
