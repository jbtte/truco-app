// shared/constants.js
// CommonJS exports for Node.js server compatibility

// Deck reduzido: remove 4,5,6,7 do baralho geral, mantém só as manilhas desses naipes
// Cartas base: Q, J, K, A, 2, 3 × 4 naipes = 24
// Manilhas extras: 4_PAUS (Zap), 7_COPAS, 7_OUROS (A_ESPADAS já está no rank A)
// Total: 27 cartas

const CARD_STRENGTHS = {
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

const MANILHA_NAMES = {
  '4_PAUS': 'Zap',
  '7_COPAS': 'Copas',
  'A_ESPADAS': 'Espadilha',
  '7_OUROS': 'Pica-fumo',
};

const GAME_STATES = {
  WAITING: 'WAITING',
  PLAYING: 'PLAYING',
  TRUCO_PENDING: 'TRUCO_PENDING',
  HAND_END: 'HAND_END',
  GAME_OVER: 'GAME_OVER',
};

const SUITS = ['OUROS', 'ESPADAS', 'COPAS', 'PAUS'];
const RANKS = ['Q', 'J', 'K', 'A', '2', '3'];
// Manilhas dos naipes removidos que precisam ser adicionadas manualmente ao deck
const EXTRA_MANILHAS = ['4_PAUS', '7_COPAS', '7_OUROS'];

module.exports = { CARD_STRENGTHS, MANILHAS_FIXAS, MANILHA_NAMES, GAME_STATES, SUITS, RANKS, EXTRA_MANILHAS };
