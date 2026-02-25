// server/dealer.js
const { SUITS, RANKS, EXTRA_MANILHAS } = require('../shared/constants');

function createDeck() {
  const deck = [];
  // 6 ranks × 4 suits = 24 cards
  for (const s of SUITS) {
    for (const r of RANKS) {
      deck.push(`${r}_${s}`);
    }
  }
  // Add the 3 manilhas from removed ranks (A_ESPADAS already included above)
  for (const m of EXTRA_MANILHAS) {
    deck.push(m);
  }
  return deck; // 27 cards total
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/**
 * Deals 3 cards to each of 4 players plus a vira card.
 * Seat order: 0=human1, 1=human2, 2=bot1, 3=bot2
 * Returns { human1, human2, bot1, bot2, vira }
 */
function dealHands() {
  const deck = shuffle(createDeck());
  return {
    human1: deck.slice(0, 3),   // seat 0
    human2: deck.slice(3, 6),   // seat 1
    bot1:   deck.slice(6, 9),   // seat 2
    bot2:   deck.slice(9, 12),  // seat 3
    vira:   deck[12],
  };
}

module.exports = { dealHands };
