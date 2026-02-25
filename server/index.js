// server/index.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { dealHands } = require('./dealer');
const { resolveRound, checkHandEnd, getCardStrength } = require('./gameLogic');
const { BOT_PERSONALITIES, chooseBotCard, shouldCallTruco, botRespondTruco } = require('./bot');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.get('/', (_req, res) => res.send('Truco server running'));

// ── Constants ──────────────────────────────────────────────────────────────
const ROUND_DELAY = 3000; // ms to show round result before next round
const HAND_DELAY  = 3000; // ms to show hand result before new hand
const BOT_DELAY   = 1500; // ms before bot plays

// ── Game State ─────────────────────────────────────────────────────────────
function createInitialState() {
  return {
    seats: [
      { socketId: null, type: 'human', teamId: 0, seatIndex: 0, name: 'Jogador 1', hand: [], playedCard: null, personality: null },
      { socketId: null, type: 'human', teamId: 1, seatIndex: 1, name: 'Jogador 2', hand: [], playedCard: null, personality: null },
      { socketId: null, type: 'bot',   teamId: 0, seatIndex: 2, name: 'Bot',       hand: [], playedCard: null, personality: null },
      { socketId: null, type: 'bot',   teamId: 1, seatIndex: 3, name: 'Bot',       hand: [], playedCard: null, personality: null },
    ],
    vira: null,
    currentSeat: 0,
    roundCards: [],
    roundResults: [],
    roundsWon: [0, 0],
    scores: [0, 0],
    trucoState: {
      active: false, calledByTeam: null, value: 1, waitingResponse: false, respondingSeat: null,
    },
    phase: 'WAITING',
  };
}

let gameState = createInitialState();

// ── Helpers ────────────────────────────────────────────────────────────────
function getHumanSeats() {
  return gameState.seats.filter(s => s.type === 'human' && s.socketId !== null);
}

function emitToHumans(event, data) {
  for (const seat of gameState.seats) {
    if (seat.type === 'human' && seat.socketId) {
      io.to(seat.socketId).emit(event, data);
    }
  }
}

function getSeatBySockId(socketId) {
  return gameState.seats.find(s => s.socketId === socketId);
}

function assignBots() {
  const shuffled = [...BOT_PERSONALITIES].sort(() => Math.random() - 0.5);
  gameState.seats[2].personality = shuffled[0];
  gameState.seats[2].name = shuffled[0].name;
  gameState.seats[3].personality = shuffled[1];
  gameState.seats[3].name = shuffled[1].name;
}

function seatNames() {
  return gameState.seats.map(s => s.name);
}

// ── Game Flow ──────────────────────────────────────────────────────────────
function startGame() {
  assignBots();

  const hands = dealHands();
  gameState.vira       = hands.vira;
  gameState.seats[0].hand = hands.human1;
  gameState.seats[1].hand = hands.human2;
  gameState.seats[2].hand = hands.bot1;
  gameState.seats[3].hand = hands.bot2;
  gameState.currentSeat   = 0;
  gameState.roundCards    = [];
  gameState.roundResults  = [];
  gameState.roundsWon     = [0, 0];
  gameState.phase         = 'PLAYING';
  gameState.trucoState    = { active: false, calledByTeam: null, value: 1, waitingResponse: false, respondingSeat: null };

  const names = seatNames();

  for (const seat of gameState.seats) {
    if (seat.type === 'human' && seat.socketId) {
      io.to(seat.socketId).emit('game_start', {
        hand:        seat.hand,
        vira:        gameState.vira,
        myTeam:      seat.teamId,
        mySeat:      seat.seatIndex,
        myTurn:      gameState.currentSeat === seat.seatIndex,
        currentSeat: gameState.currentSeat,
        scores:      gameState.scores,
        seatNames:   names,
      });
    }
  }

  console.log(`Game started. Bots: ${names[2]} (T0) vs ${names[3]} (T1). Vira: ${gameState.vira}`);

  if (gameState.seats[gameState.currentSeat].type === 'bot') {
    triggerBotPlay(gameState.currentSeat);
  }
}

function advanceTurn() {
  gameState.currentSeat = (gameState.currentSeat + 1) % 4;
  emitToHumans('turn_change', { currentSeat: gameState.currentSeat });
  if (gameState.seats[gameState.currentSeat].type === 'bot') {
    triggerBotPlay(gameState.currentSeat);
  }
}

function triggerBotPlay(seatIndex) {
  // Check if bot should call truco before playing
  setTimeout(() => {
    if (gameState.phase !== 'PLAYING') return;
    if (gameState.currentSeat !== seatIndex) return;

    const seat = gameState.seats[seatIndex];
    if (!seat || seat.hand.length === 0) return;

    // Should bot call truco?
    if (shouldCallTruco(seat.personality, seat.hand, gameState.scores, seat.teamId)) {
      const canCall = gameState.trucoState.value < 12 &&
        !(gameState.trucoState.waitingResponse && gameState.trucoState.calledByTeam === seat.teamId);
      if (canCall) {
        handleTrucoCall(seatIndex);
        return; // wait for response before playing
      }
    }

    const card = chooseBotCard(seat.personality, seat.hand, gameState.roundCards, seat.teamId, gameState.roundsWon);
    if (card) playCard(seatIndex, card);
  }, BOT_DELAY);
}

function playCard(seatIndex, card) {
  const seat = gameState.seats[seatIndex];
  seat.hand = seat.hand.filter(c => c !== card);
  seat.playedCard = card;
  gameState.roundCards.push({ seatIndex, card, teamId: seat.teamId });

  emitToHumans('card_played', {
    seatIndex,
    card,
    teamId: seat.teamId,
    remainingCards: gameState.seats.map(s => s.hand.length),
  });

  console.log(`Seat ${seatIndex} (${seat.name}) played ${card}`);

  if (gameState.roundCards.length === 4) {
    checkRoundEnd();
  } else {
    advanceTurn();
  }
}

function checkRoundEnd() {
  const result = resolveRound(gameState.roundCards);

  // Find the seat that played the winning card
  let winnerSeat = null;
  if (!result.isDraw && result.winnerTeam !== null) {
    let bestStrength = -1;
    for (const entry of gameState.roundCards) {
      if (entry.teamId === result.winnerTeam) {
        const s = getCardStrength(entry.card);
        if (s > bestStrength) { bestStrength = s; winnerSeat = entry.seatIndex; }
      }
    }
    gameState.roundsWon[result.winnerTeam]++;
  }

  gameState.roundResults.push(result);
  const roundNumber = gameState.roundResults.length;

  console.log(`Round ${roundNumber} ended. Winner seat: ${winnerSeat}, Team: ${result.winnerTeam}`);

  emitToHumans('round_end', {
    roundNumber,
    result,
    winnerSeat,
    winnerName: winnerSeat !== null ? gameState.seats[winnerSeat].name : null,
    roundsWon: gameState.roundsWon,
    scores:    gameState.scores,
    roundCards: gameState.roundCards,
  });

  const handResult = checkHandEnd(gameState.roundsWon, gameState.roundResults, roundNumber);

  if (handResult.ended) {
    setTimeout(() => resolveHand(handResult), ROUND_DELAY);
  } else {
    setTimeout(() => startNextRound(result, winnerSeat), ROUND_DELAY);
  }
}

function startNextRound(lastRoundResult, lastWinnerSeat) {
  for (const seat of gameState.seats) seat.playedCard = null;
  gameState.roundCards = [];

  // Winner of last round leads; draw → keep current order
  if (!lastRoundResult.isDraw && lastWinnerSeat !== null) {
    gameState.currentSeat = lastWinnerSeat;
  }

  const roundNumber = gameState.roundResults.length + 1;
  emitToHumans('next_round', { currentSeat: gameState.currentSeat, roundNumber });

  if (gameState.seats[gameState.currentSeat].type === 'bot') {
    triggerBotPlay(gameState.currentSeat);
  }
}

function resolveHand(handResult) {
  const { winnerTeam, isDraw } = handResult;
  const pointValue = gameState.trucoState.value;

  if (isDraw) {
    gameState.scores[0] += 0.5;
    gameState.scores[1] += 0.5;
  } else if (winnerTeam !== null) {
    gameState.scores[winnerTeam] += pointValue;
  }

  const winnerName = winnerTeam !== null ? `Time ${winnerTeam === 0 ? 'Vermelho' : 'Azul'}` : null;
  console.log(`Hand ended. ${winnerName} +${pointValue}. Scores:`, gameState.scores);

  emitToHumans('hand_end', {
    winnerTeam,
    isDraw,
    points:    isDraw ? 0.5 : pointValue,
    scores:    gameState.scores,
    winnerName,
  });

  if (gameState.scores[0] >= 12 || gameState.scores[1] >= 12) {
    const gameWinner = gameState.scores[0] >= 12 ? 0 : 1;
    gameState.phase = 'GAME_OVER';
    setTimeout(() => {
      emitToHumans('game_over', { winnerTeam: gameWinner, scores: gameState.scores });
    }, HAND_DELAY);
    return;
  }

  setTimeout(() => {
    for (const seat of gameState.seats) { seat.hand = []; seat.playedCard = null; }
    gameState.roundCards  = [];
    gameState.roundResults = [];
    gameState.roundsWon   = [0, 0];
    gameState.trucoState  = { active: false, calledByTeam: null, value: 1, waitingResponse: false, respondingSeat: null };
    startGame();
  }, HAND_DELAY);
}

// ── Truco ──────────────────────────────────────────────────────────────────
const TRUCO_SEQUENCE = [3, 6, 9, 12];
function getNextTrucoValue(current) {
  const idx = TRUCO_SEQUENCE.indexOf(current);
  return idx === -1 || idx === TRUCO_SEQUENCE.length - 1 ? null : TRUCO_SEQUENCE[idx + 1];
}

function handleTrucoCall(callerSeat) {
  if (gameState.phase !== 'PLAYING') return;
  const seat = gameState.seats[callerSeat];
  const currentValue = gameState.trucoState.value;
  const newValue = currentValue === 1 ? 3 : getNextTrucoValue(currentValue);
  if (newValue === null) return;
  if (gameState.trucoState.waitingResponse && gameState.trucoState.calledByTeam === seat.teamId) return;

  gameState.phase = 'TRUCO_PENDING';
  gameState.trucoState.active         = true;
  gameState.trucoState.calledByTeam   = seat.teamId;
  gameState.trucoState.value          = newValue;
  gameState.trucoState.waitingResponse = true;

  const enemyTeam   = seat.teamId === 0 ? 1 : 0;
  const responder   = gameState.seats.find(s => s.teamId === enemyTeam);
  gameState.trucoState.respondingSeat = responder.seatIndex;

  emitToHumans('truco_called', {
    callerSeat,
    callerTeam:    seat.teamId,
    callerName:    seat.name,
    newValue,
    respondingSeat: responder.seatIndex,
  });

  if (responder.type === 'bot') {
    setTimeout(() => {
      if (gameState.phase !== 'TRUCO_PENDING') return;
      const response = botRespondTruco(responder.personality, responder.hand, newValue);
      handleTrucoResponse(responder.seatIndex, response);
    }, BOT_DELAY);
  }
}

function handleTrucoResponse(responderSeat, action) {
  if (gameState.phase !== 'TRUCO_PENDING') return;
  const seat = gameState.seats[responderSeat];
  gameState.trucoState.waitingResponse = false;

  emitToHumans('truco_response', { responderSeat, action, value: gameState.trucoState.value });

  if (action === 'fold') {
    const prevIdx = TRUCO_SEQUENCE.indexOf(gameState.trucoState.value) - 1;
    const prevValue = prevIdx >= 0 ? TRUCO_SEQUENCE[prevIdx] : 1;
    const winnerTeam = gameState.trucoState.calledByTeam;
    gameState.scores[winnerTeam] += prevValue;
    gameState.phase = 'PLAYING';
    emitToHumans('hand_end', {
      winnerTeam, isDraw: false, points: prevValue, scores: gameState.scores,
      winnerName: `Time ${winnerTeam === 0 ? 'Vermelho' : 'Azul'}`,
      foldedByTeam: seat.teamId,
    });
    if (gameState.scores[0] >= 12 || gameState.scores[1] >= 12) {
      const gameWinner = gameState.scores[0] >= 12 ? 0 : 1;
      gameState.phase = 'GAME_OVER';
      setTimeout(() => emitToHumans('game_over', { winnerTeam: gameWinner, scores: gameState.scores }), HAND_DELAY);
      return;
    }
    setTimeout(() => startGame(), HAND_DELAY);
    return;
  }

  if (action === 'raise') {
    const nextValue = getNextTrucoValue(gameState.trucoState.value);
    if (!nextValue) { gameState.phase = 'PLAYING'; return; }
    gameState.trucoState.calledByTeam   = seat.teamId;
    gameState.trucoState.value          = nextValue;
    gameState.trucoState.waitingResponse = true;
    const enemyTeam  = seat.teamId === 0 ? 1 : 0;
    const newResponder = gameState.seats.find(s => s.teamId === enemyTeam);
    gameState.trucoState.respondingSeat = newResponder.seatIndex;
    emitToHumans('truco_called', {
      callerSeat: responderSeat, callerTeam: seat.teamId, callerName: seat.name,
      newValue: nextValue, respondingSeat: newResponder.seatIndex,
    });
    if (newResponder.type === 'bot') {
      setTimeout(() => {
        if (gameState.phase !== 'TRUCO_PENDING') return;
        handleTrucoResponse(newResponder.seatIndex, botRespondTruco(newResponder.personality, newResponder.hand, nextValue));
      }, BOT_DELAY);
    }
    return;
  }

  // accept
  gameState.phase = 'PLAYING';
  // Resume bot play if it was bot's turn before truco was called
  if (gameState.seats[gameState.currentSeat].type === 'bot') {
    triggerBotPlay(gameState.currentSeat);
  }
}

// ── Socket.IO ──────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  const availableSeat = gameState.seats.find(s => s.type === 'human' && s.socketId === null);
  if (!availableSeat) {
    socket.emit('table_full', { message: 'Mesa cheia. Tente mais tarde.' });
    socket.disconnect();
    return;
  }

  availableSeat.socketId = socket.id;
  socket.emit('waiting', {
    position: availableSeat.seatIndex,
    teamId:   availableSeat.teamId,
    message:  `Você é o Jogador ${availableSeat.seatIndex + 1}. Aguardando adversário...`,
  });

  if (getHumanSeats().length === 2) startGame();

  socket.on('play_card', ({ card }) => {
    if (gameState.phase !== 'PLAYING') return;
    const seat = getSeatBySockId(socket.id);
    if (!seat || gameState.currentSeat !== seat.seatIndex) {
      socket.emit('error', { message: 'Não é sua vez.' }); return;
    }
    if (!seat.hand.includes(card)) {
      socket.emit('error', { message: 'Carta inválida.' }); return;
    }
    playCard(seat.seatIndex, card);
  });

  socket.on('call_truco', () => {
    const seat = getSeatBySockId(socket.id);
    if (seat) handleTrucoCall(seat.seatIndex);
  });

  socket.on('respond_truco', ({ action }) => {
    if (gameState.phase !== 'TRUCO_PENDING') return;
    if (!['accept', 'raise', 'fold'].includes(action)) return;
    const seat = getSeatBySockId(socket.id);
    if (!seat) return;
    const respSeat = gameState.trucoState.respondingSeat;
    if (seat.seatIndex !== respSeat && seat.teamId !== gameState.seats[respSeat]?.teamId) return;
    handleTrucoResponse(seat.seatIndex, action);
  });

  socket.on('forfeit', () => {
    const seat = getSeatBySockId(socket.id);
    if (!seat) return;
    const winnerTeam = seat.teamId === 0 ? 1 : 0;
    gameState.scores[winnerTeam] += gameState.trucoState.value;
    emitToHumans('hand_end', {
      winnerTeam, isDraw: false, points: gameState.trucoState.value,
      scores: gameState.scores, foldedByTeam: seat.teamId,
      winnerName: `Time ${winnerTeam === 0 ? 'Vermelho' : 'Azul'}`,
    });
    emitToHumans('opponent_disconnected', { message: 'Adversário desistiu.' });
    gameState = createInitialState();
  });

  socket.on('ping', () => socket.emit('pong'));

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    const seat = getSeatBySockId(socket.id);
    if (!seat) return;
    seat.socketId = null;
    emitToHumans('opponent_disconnected', { message: 'Adversário desconectou.' });
    gameState = createInitialState();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor de Truco rodando na porta ${PORT}`));
