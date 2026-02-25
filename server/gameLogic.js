// server/gameLogic.js
const { CARD_STRENGTHS, MANILHAS_FIXAS } = require('../shared/constants');

/**
 * Returns the numeric strength of a card.
 * Manilhas fixas always override base strength.
 */
function getCardStrength(card) {
  if (MANILHAS_FIXAS[card] !== undefined) {
    return MANILHAS_FIXAS[card];
  }
  const rank = card.split('_')[0];
  return CARD_STRENGTHS[rank] ?? 0;
}

/**
 * Compares two cards.
 * Returns 1 if cardA wins, -1 if cardB wins, 0 if draw.
 */
function compareCards(cardA, cardB) {
  const sa = getCardStrength(cardA);
  const sb = getCardStrength(cardB);
  if (sa > sb) return 1;
  if (sa < sb) return -1;
  return 0;
}

/**
 * Resolves a round (perna) given all 4 played cards.
 * roundCards: [{ seatIndex, card, teamId }, ...]
 * Returns { winnerTeam: 0|1|null, isDraw: boolean }
 */
function resolveRound(roundCards) {
  let best = null;
  let winnerTeam = null;
  let isDraw = false;

  for (const entry of roundCards) {
    const strength = getCardStrength(entry.card);
    if (best === null || strength > best) {
      best = strength;
      winnerTeam = entry.teamId;
      isDraw = false;
    } else if (strength === best) {
      // Tie — check if same team or different teams
      if (entry.teamId !== winnerTeam) {
        isDraw = true;
        winnerTeam = null;
      }
      // Same team tie: still same winner team, not a true draw
    }
  }

  return { winnerTeam, isDraw };
}

/**
 * Checks if the hand (mão) has ended.
 * roundsWon: [winsTeam0, winsTeam1]
 * firstRoundWinner: 0|1|null (null means first round was a draw)
 *
 * Truco Paulista rules:
 * - Win 2 out of 3 rounds to win the hand
 * - If first round is a draw, winner of second round wins the hand
 * - If all 3 rounds are draws: hand split (0.5 pt each → we give 0 to both and caller's team gets 1)
 *   Actually: mão de 10 rules don't apply here; if all draw → time que pediu truco ganha
 *   Standard rule: if all rounds draw → both teams get half point; we simplify: return isDraw:true
 *
 * Returns { ended: bool, winnerTeam: 0|1|null, isDraw: bool }
 */
function checkHandEnd(roundsWon, roundResults, roundsPlayed) {
  const [w0, w1] = roundsWon;

  // Someone won 2 rounds
  if (w0 >= 2) return { ended: true, winnerTeam: 0, isDraw: false };
  if (w1 >= 2) return { ended: true, winnerTeam: 1, isDraw: false };

  // 3 rounds played — check draw cases
  if (roundsPlayed === 3) {
    // All three rounds drawn
    if (w0 === 0 && w1 === 0) {
      return { ended: true, winnerTeam: null, isDraw: true };
    }
    // Should not happen given w0<2 && w1<2 && rounds=3, but handle:
    // 1-1 after 3 rounds is impossible (3 rounds, each worth 1 win to a team or draw)
    // Actually 1 draw + 1 win each could result in 1-1 after 3 rounds
    if (w0 === 1 && w1 === 1) {
      // Find who won the first non-draw round
      const firstWinner = roundResults.find(r => !r.isDraw);
      if (firstWinner) {
        return { ended: true, winnerTeam: firstWinner.winnerTeam, isDraw: false };
      }
      return { ended: true, winnerTeam: null, isDraw: true };
    }
    // Safety fallback
    const winner = w0 > w1 ? 0 : 1;
    return { ended: true, winnerTeam: winner, isDraw: false };
  }

  // First round draw: second round winner takes all
  if (roundsPlayed === 2 && roundResults[0]?.isDraw) {
    const r2 = roundResults[1];
    if (r2 && !r2.isDraw) {
      return { ended: true, winnerTeam: r2.winnerTeam, isDraw: false };
    }
    // Both first two draws: continue to third round
  }

  return { ended: false, winnerTeam: null, isDraw: false };
}

module.exports = { getCardStrength, compareCards, resolveRound, checkHandEnd };
