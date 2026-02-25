// server/bot.js
const { getCardStrength } = require('./gameLogic');

/**
 * Chooses which card the bot should play.
 *
 * @param {string[]} hand - Bot's current hand
 * @param {Array<{seatIndex, card, teamId}>} roundCards - Cards already played this round
 * @param {number} teamId - Bot's team (0 or 1)
 * @param {number[]} roundsWon - [winsTeam0, winsTeam1]
 * @returns {string} - The card to play
 */
function chooseBotCard(hand, roundCards, teamId, roundsWon) {
  if (hand.length === 0) return null;

  const enemyTeamId = teamId === 0 ? 1 : 0;
  const enemyCards = roundCards.filter(e => e.teamId === enemyTeamId);

  // Find the strongest enemy card played so far this round
  let bestEnemyCard = null;
  let bestEnemyStrength = -1;
  for (const entry of enemyCards) {
    const s = getCardStrength(entry.card);
    if (s > bestEnemyStrength) {
      bestEnemyStrength = s;
      bestEnemyCard = entry.card;
    }
  }

  const sorted = [...hand].sort((a, b) => getCardStrength(a) - getCardStrength(b));

  if (bestEnemyCard !== null) {
    // Try to beat the enemy with the weakest card that wins
    const winning = sorted.filter(c => getCardStrength(c) > bestEnemyStrength);
    if (winning.length > 0) {
      return winning[0]; // weakest winning card (economize manilhas)
    }
    // Can't win — discard weakest
    return sorted[0];
  }

  // Bot plays first in this round
  if (roundsWon[teamId] === 1) {
    // Already won a round — play strong to close the hand
    return sorted[sorted.length - 1];
  }

  // Play middle card (avoid burning manilha early)
  // If only manilhas, play weakest
  const nonManilhas = sorted.filter(c => getCardStrength(c) < 11);
  if (nonManilhas.length > 0) {
    const mid = Math.floor(nonManilhas.length / 2);
    return nonManilhas[mid];
  }
  return sorted[0]; // all manilhas — play weakest
}

/**
 * Decides if bot should call truco.
 *
 * @param {string[]} hand
 * @param {number[]} scores - [scoreTeam0, scoreTeam1]
 * @param {number} teamId
 * @returns {boolean}
 */
function shouldCallTruco(hand, scores, teamId) {
  const totalStrength = hand.reduce((sum, c) => sum + getCardStrength(c), 0);
  const manilhas = hand.filter(c => getCardStrength(c) >= 11);

  // Don't call if enemy is at 11+ (risky)
  const enemyScore = scores[teamId === 0 ? 1 : 0];
  if (enemyScore >= 9) return false;

  return manilhas.length >= 1 || totalStrength >= 22;
}

/**
 * Decides bot's response to a truco call.
 *
 * @param {string[]} hand
 * @param {number} currentValue - current truco stake (3, 6, 9, 12)
 * @returns {'accept'|'raise'|'fold'}
 */
function botRespondTruco(hand, currentValue) {
  const totalStrength = hand.reduce((sum, c) => sum + getCardStrength(c), 0);
  const manilhas = hand.filter(c => getCardStrength(c) >= 11);

  if (currentValue >= 12) {
    // Can't raise further — accept or fold
    return totalStrength >= 18 || manilhas.length >= 1 ? 'accept' : 'fold';
  }

  if (manilhas.length >= 2 || totalStrength >= 26) return 'raise';
  if (manilhas.length >= 1 || totalStrength >= 20) return 'accept';
  return 'fold';
}

module.exports = { chooseBotCard, shouldCallTruco, botRespondTruco };
