// shared/constants.js
// CommonJS exports for Node.js server compatibility

const CARD_STRENGTHS = {
  '4': 1,
  '5': 2,
  '6': 3,
  '7': 4,
  'Q': 5,
  'J': 6,
  'K': 7,
  'A': 8,
  '2': 9,
  '3': 10,
};

const MANILHAS_FIXAS = {
  '4_PAUS': 14,    // Zap
  '7_COPAS': 13,   // Copas
  'A_ESPADAS': 12, // Espadilha
  '7_OUROS': 11,   // Pica-fumo
};

const GAME_STATES = {
  WAITING: 'WAITING',
  PLAYING: 'PLAYING',
  TRUCO_PENDING: 'TRUCO_PENDING',
  HAND_END: 'HAND_END',
  GAME_OVER: 'GAME_OVER',
};

const SUITS = ['OUROS', 'ESPADAS', 'COPAS', 'PAUS'];
const RANKS = ['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3'];

module.exports = { CARD_STRENGTHS, MANILHAS_FIXAS, GAME_STATES, SUITS, RANKS };
