// server/index.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { dealHands } = require('./dealer');
const { resolveRound, checkHandEnd } = require('./gameLogic');
const { chooseBotCard, shouldCallTruco, botRespondTruco } = require('./bot');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

app.get('/', (_req, res) => res.send('Truco server running'));

// ─── Game State ────────────────────────────────────────────────────────────

/*
  Seat layout:
    0 = Human 1 (Team 0)
    1 = Human 2 (Team 1)
    2 = Bot 1   (Team 0)
    3 = Bot 2   (Team 1)
  Play order: 0 → 1 → 2 → 3
*/

function createInitialState() {
  return {
    seats: [
      { socketId: null, type: 'human', teamId: 0, seatIndex: 0, hand: [], playedCard: null },
      { socketId: null, type: 'human', teamId: 1, seatIndex: 1, hand: [], playedCard: null },
      { socketId: null, type: 'bot',   teamId: 0, seatIndex: 2, hand: [], playedCard: null },
      { socketId: null, type: 'bot',   teamId: 1, seatIndex: 3, hand: [], playedCard: null },
    ],
    vira: null,
    currentSeat: 0,
    roundCards: [],        // [{seatIndex, card, teamId}]
    roundResults: [],      // [{winnerTeam, isDraw}] — one per perna
    roundsWon: [0, 0],
    scores: [0, 0],
    trucoState: {
      active: false,
      calledByTeam: null,
      value: 1,            // 1=normal, 3=truco, 6=seis, 9=nove, 12=doze
      waitingResponse: false,
      respondingSeat: null,
    },
    phase: 'WAITING',
    firstRoundWinner: null,
  };
}

let gameState = createInitialState();

// ─── Helpers ───────────────────────────────────────────────────────────────

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

function nextSeat(current) {
  return (current + 1) % 4;
}

// ─── Game Flow ─────────────────────────────────────────────────────────────

function startGame() {
  const hands = dealHands();
  gameState.vira = hands.vira;
  gameState.seats[0].hand = hands.human1;
  gameState.seats[1].hand = hands.human2;
  gameState.seats[2].hand = hands.bot1;
  gameState.seats[3].hand = hands.bot2;
  gameState.currentSeat = 0;
  gameState.roundCards = [];
  gameState.roundResults = [];
  gameState.roundsWon = [0, 0];
  gameState.phase = 'PLAYING';
  gameState.trucoState = { active: false, calledByTeam: null, value: 1, waitingResponse: false, respondingSeat: null };

  // Send game_start to each human
  for (const seat of gameState.seats) {
    if (seat.type === 'human' && seat.socketId) {
      io.to(seat.socketId).emit('game_start', {
        hand: seat.hand,
        vira: gameState.vira,
        myTeam: seat.teamId,
        mySeat: seat.seatIndex,
        myTurn: gameState.currentSeat === seat.seatIndex,
        scores: gameState.scores,
      });
    }
  }

  console.log(`Game started. Vira: ${gameState.vira}`);

  // If first seat is a bot (shouldn't happen in our layout, but guard)
  if (gameState.seats[gameState.currentSeat].type === 'bot') {
    triggerBotPlay(gameState.currentSeat);
  }
}

function advanceTurn() {
  gameState.currentSeat = nextSeat(gameState.currentSeat);

  emitToHumans('turn_change', { currentSeat: gameState.currentSeat });

  if (gameState.seats[gameState.currentSeat].type === 'bot') {
    triggerBotPlay(gameState.currentSeat);
  }
}

function triggerBotPlay(seatIndex) {
  setTimeout(() => {
    if (gameState.phase !== 'PLAYING') return;
    if (gameState.currentSeat !== seatIndex) return;

    const seat = gameState.seats[seatIndex];
    if (seat.hand.length === 0) return;

    const card = chooseBotCard(
      seat.hand,
      gameState.roundCards,
      seat.teamId,
      gameState.roundsWon,
    );

    if (card) {
      playCard(seatIndex, card);
    }
  }, 1500);
}

function playCard(seatIndex, card) {
  const seat = gameState.seats[seatIndex];

  // Remove card from hand
  seat.hand = seat.hand.filter(c => c !== card);
  seat.playedCard = card;

  // Record in round
  gameState.roundCards.push({ seatIndex, card, teamId: seat.teamId });

  // Broadcast to all humans
  emitToHumans('card_played', {
    seatIndex,
    card,
    teamId: seat.teamId,
    remainingCards: gameState.seats.map(s => s.hand.length),
  });

  console.log(`Seat ${seatIndex} (team ${seat.teamId}) played ${card}`);

  // All 4 players played?
  if (gameState.roundCards.length === 4) {
    checkRoundEnd();
  } else {
    advanceTurn();
  }
}

function checkRoundEnd() {
  const result = resolveRound(gameState.roundCards);

  gameState.roundResults.push(result);
  if (!result.isDraw && result.winnerTeam !== null) {
    gameState.roundsWon[result.winnerTeam]++;
  }

  const roundNumber = gameState.roundResults.length;
  console.log(`Round ${roundNumber} ended. Result:`, result, 'Rounds won:', gameState.roundsWon);

  emitToHumans('round_end', {
    roundNumber,
    result,
    roundsWon: gameState.roundsWon,
    scores: gameState.scores,
    roundCards: gameState.roundCards,
  });

  // Check if hand is over
  const handResult = checkHandEnd(gameState.roundsWon, gameState.roundResults, roundNumber);

  if (handResult.ended) {
    setTimeout(() => resolveHand(handResult), 1200);
  } else {
    // Start next round — winner of last round goes first (or seat 0 if draw)
    setTimeout(() => startNextRound(result), 1200);
  }
}

function startNextRound(lastRoundResult) {
  // Clear played cards from seats
  for (const seat of gameState.seats) {
    seat.playedCard = null;
  }
  gameState.roundCards = [];

  // Winner of the round starts next; draw → keep same order (next seat after last starter)
  if (!lastRoundResult.isDraw && lastRoundResult.winnerTeam !== null) {
    // Find the first seat (lowest index) belonging to winning team
    const winningSeat = gameState.seats.find(s => s.teamId === lastRoundResult.winnerTeam);
    gameState.currentSeat = winningSeat.seatIndex;
  }
  // else: keep currentSeat as-is (advance from where we are — actually reset to next logical)

  emitToHumans('next_round', { currentSeat: gameState.currentSeat });

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

  console.log('Hand ended. Winner team:', winnerTeam, 'Points:', pointValue, 'Scores:', gameState.scores);

  emitToHumans('hand_end', {
    winnerTeam,
    isDraw,
    points: isDraw ? 0.5 : pointValue,
    scores: gameState.scores,
  });

  // Check game over
  if (gameState.scores[0] >= 12 || gameState.scores[1] >= 12) {
    const gameWinner = gameState.scores[0] >= 12 ? 0 : 1;
    gameState.phase = 'GAME_OVER';
    emitToHumans('game_over', { winnerTeam: gameWinner, scores: gameState.scores });
    console.log('Game over! Winner team:', gameWinner);
    return;
  }

  // Reset for next hand
  setTimeout(() => {
    for (const seat of gameState.seats) {
      seat.hand = [];
      seat.playedCard = null;
    }
    gameState.roundCards = [];
    gameState.roundResults = [];
    gameState.roundsWon = [0, 0];
    gameState.trucoState = { active: false, calledByTeam: null, value: 1, waitingResponse: false, respondingSeat: null };
    gameState.phase = 'PLAYING';
    startGame();
  }, 2000);
}

// ─── Truco Logic ───────────────────────────────────────────────────────────

const TRUCO_SEQUENCE = [3, 6, 9, 12];

function getNextTrucoValue(current) {
  const idx = TRUCO_SEQUENCE.indexOf(current);
  if (idx === -1 || idx === TRUCO_SEQUENCE.length - 1) return null;
  return TRUCO_SEQUENCE[idx + 1];
}

function handleTrucoCall(callerSeat) {
  if (gameState.phase !== 'PLAYING') return;

  const seat = gameState.seats[callerSeat];
  const currentValue = gameState.trucoState.value;
  const newValue = currentValue === 1 ? 3 : getNextTrucoValue(currentValue);

  if (newValue === null) return; // already at max

  // Can't call truco if your team already called and it's pending
  if (gameState.trucoState.waitingResponse && gameState.trucoState.calledByTeam === seat.teamId) return;

  gameState.phase = 'TRUCO_PENDING';
  gameState.trucoState.active = true;
  gameState.trucoState.calledByTeam = seat.teamId;
  gameState.trucoState.value = newValue;
  gameState.trucoState.waitingResponse = true;

  // The responding seat is the first enemy seat (lowest index on enemy team)
  const enemyTeam = seat.teamId === 0 ? 1 : 0;
  const respondingSeat = gameState.seats.find(s => s.teamId === enemyTeam);
  gameState.trucoState.respondingSeat = respondingSeat.seatIndex;

  emitToHumans('truco_called', {
    callerSeat,
    callerTeam: seat.teamId,
    newValue,
    respondingSeat: respondingSeat.seatIndex,
  });

  // If responder is bot, auto-respond after delay
  if (respondingSeat.type === 'bot') {
    setTimeout(() => {
      if (gameState.phase !== 'TRUCO_PENDING') return;
      const response = botRespondTruco(respondingSeat.hand, newValue);
      handleTrucoResponse(respondingSeat.seatIndex, response);
    }, 1500);
  }
}

function handleTrucoResponse(responderSeat, action) {
  if (gameState.phase !== 'TRUCO_PENDING') return;

  const seat = gameState.seats[responderSeat];
  gameState.trucoState.waitingResponse = false;

  emitToHumans('truco_response', { responderSeat, action, value: gameState.trucoState.value });

  if (action === 'fold') {
    // Caller team wins with previous value
    const previousValue = TRUCO_SEQUENCE[TRUCO_SEQUENCE.indexOf(gameState.trucoState.value) - 1] ?? 1;
    const winnerTeam = gameState.trucoState.calledByTeam;
    gameState.scores[winnerTeam] += previousValue;
    gameState.phase = 'PLAYING';
    emitToHumans('hand_end', {
      winnerTeam,
      isDraw: false,
      points: previousValue,
      scores: gameState.scores,
      foldedByTeam: seat.teamId,
    });

    if (gameState.scores[0] >= 12 || gameState.scores[1] >= 12) {
      const gameWinner = gameState.scores[0] >= 12 ? 0 : 1;
      gameState.phase = 'GAME_OVER';
      emitToHumans('game_over', { winnerTeam: gameWinner, scores: gameState.scores });
      return;
    }

    setTimeout(() => startGame(), 2000);
    return;
  }

  if (action === 'raise') {
    // Swap roles: responder now calls, original caller must respond
    const nextValue = getNextTrucoValue(gameState.trucoState.value);
    if (nextValue === null) {
      // At max — treat as accept
      gameState.phase = 'PLAYING';
      return;
    }
    gameState.trucoState.calledByTeam = seat.teamId;
    gameState.trucoState.value = nextValue;
    gameState.trucoState.waitingResponse = true;

    const enemyTeam = seat.teamId === 0 ? 1 : 0;
    const newResponder = gameState.seats.find(s => s.teamId === enemyTeam);
    gameState.trucoState.respondingSeat = newResponder.seatIndex;

    emitToHumans('truco_called', {
      callerSeat: responderSeat,
      callerTeam: seat.teamId,
      newValue: nextValue,
      respondingSeat: newResponder.seatIndex,
    });

    if (newResponder.type === 'bot') {
      setTimeout(() => {
        if (gameState.phase !== 'TRUCO_PENDING') return;
        const response = botRespondTruco(newResponder.hand, nextValue);
        handleTrucoResponse(newResponder.seatIndex, response);
      }, 1500);
    }
    return;
  }

  // accept
  gameState.phase = 'PLAYING';
}

// ─── Socket.IO Handlers ────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Find first available human seat
  const availableSeat = gameState.seats.find(s => s.type === 'human' && s.socketId === null);

  if (!availableSeat) {
    socket.emit('table_full', { message: 'Mesa cheia. Tente mais tarde.' });
    socket.disconnect();
    return;
  }

  availableSeat.socketId = socket.id;
  const position = availableSeat.seatIndex;
  console.log(`Seat ${position} assigned to ${socket.id}`);

  socket.emit('waiting', {
    position,
    teamId: availableSeat.teamId,
    message: `Você é o Jogador ${position + 1}. Aguardando adversário...`,
  });

  // Check if both humans are connected
  const humanSeats = getHumanSeats();
  if (humanSeats.length === 2) {
    console.log('Both humans connected. Starting game...');
    startGame();
  }

  // ── play_card ──────────────────────────────────────────────────────────
  socket.on('play_card', ({ card }) => {
    if (gameState.phase !== 'PLAYING') return;

    const seat = getSeatBySockId(socket.id);
    if (!seat) return;
    if (gameState.currentSeat !== seat.seatIndex) {
      socket.emit('error', { message: 'Não é sua vez.' });
      return;
    }
    if (!seat.hand.includes(card)) {
      socket.emit('error', { message: 'Carta inválida.' });
      return;
    }

    playCard(seat.seatIndex, card);
  });

  // ── call_truco ─────────────────────────────────────────────────────────
  socket.on('call_truco', () => {
    const seat = getSeatBySockId(socket.id);
    if (!seat) return;
    handleTrucoCall(seat.seatIndex);
  });

  // ── respond_truco ──────────────────────────────────────────────────────
  socket.on('respond_truco', ({ action }) => {
    if (gameState.phase !== 'TRUCO_PENDING') return;
    if (!['accept', 'raise', 'fold'].includes(action)) return;

    const seat = getSeatBySockId(socket.id);
    if (!seat) return;

    // Only the designated responder can respond
    if (gameState.trucoState.respondingSeat !== seat.seatIndex) {
      // Allow teammate to respond too
      if (seat.teamId !== gameState.seats[gameState.trucoState.respondingSeat].teamId) return;
    }

    handleTrucoResponse(seat.seatIndex, action);
  });

  // ── ping (keep-alive for Render free tier) ─────────────────────────────
  socket.on('ping', () => socket.emit('pong'));

  // ── disconnect ─────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);

    const seat = getSeatBySockId(socket.id);
    if (!seat) return;

    seat.socketId = null;

    // Notify remaining human
    emitToHumans('opponent_disconnected', {
      seat: seat.seatIndex,
      message: 'Adversário desconectado. Aguardando reconexão...',
    });

    // Reset game state so new player can join
    if (gameState.phase !== 'WAITING') {
      gameState = createInitialState();
      // Keep scores? No — full reset for simplicity
    }
  });
});

// ─── Start Server ──────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor de Truco rodando na porta ${PORT}`);
});
