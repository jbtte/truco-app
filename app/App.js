import React, { useEffect, useState, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Alert,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import io from 'socket.io-client';

const SOCKET_URL =
  process.env.EXPO_PUBLIC_SERVER_URL || 'http://localhost:3000';

// Keep-alive interval for Render free tier (ms)
const PING_INTERVAL = 10 * 60 * 1000;

// ── Seat layout label ──────────────────────────────────────────────────────
const SEAT_LABELS = ['Você', 'Adversário', 'Bot Aliado', 'Bot Inimigo'];

export default function App() {
  const [socket, setSocket] = useState(null);
  const [status, setStatus] = useState('Conectando...');
  const [phase, setPhase] = useState('WAITING');

  const [mySeat, setMySeat] = useState(null);
  const [myTeam, setMyTeam] = useState(null);
  const [myTurn, setMyTurn] = useState(false);
  const [currentSeat, setCurrentSeat] = useState(null);

  const [hand, setHand] = useState([]);
  const [vira, setVira] = useState(null);
  const [scores, setScores] = useState([0, 0]);
  const [roundsWon, setRoundsWon] = useState([0, 0]);

  // tableCards: { [seatIndex]: card }
  const [tableCards, setTableCards] = useState({});

  const [trucoState, setTrucoState] = useState({
    active: false,
    value: 1,
    waitingResponse: false,
    respondingSeat: null,
    callerTeam: null,
  });

  const [vencedor, setVencedor] = useState(null);

  // ── Socket setup ─────────────────────────────────────────────────────────
  useEffect(() => {
    const newSocket = io(SOCKET_URL, { transports: ['websocket'] });
    setSocket(newSocket);

    newSocket.on('connect', () => {
      setStatus('Conectado. Aguardando mesa...');
    });

    newSocket.on('connect_error', () => {
      setStatus('Erro de conexão. Verifique o servidor.');
    });

    newSocket.on('waiting', ({ position, teamId, message }) => {
      setMySeat(position);
      setMyTeam(teamId);
      setStatus(message);
    });

    newSocket.on('table_full', ({ message }) => {
      setStatus(message);
    });

    newSocket.on('game_start', ({ hand: newHand, vira: newVira, myTeam: team, mySeat: seat, myTurn: turn, scores: sc }) => {
      setHand(newHand);
      setVira(newVira);
      setMyTeam(team);
      setMySeat(seat);
      setMyTurn(turn);
      setScores(sc);
      setPhase('PLAYING');
      setTableCards({});
      setRoundsWon([0, 0]);
      setVencedor(null);
      setTrucoState({ active: false, value: 1, waitingResponse: false, respondingSeat: null, callerTeam: null });
      setStatus(turn ? 'Sua vez!' : 'Aguarde...');
      setCurrentSeat(turn ? seat : null);
    });

    newSocket.on('turn_change', ({ currentSeat: cs }) => {
      setCurrentSeat(cs);
      // myTurn is determined by comparing cs with mySeat
      // We use a ref-like approach via functional setState
      setMySeat(prev => {
        setMyTurn(cs === prev);
        setStatus(cs === prev ? 'Sua vez!' : 'Aguarde...');
        return prev;
      });
    });

    newSocket.on('card_played', ({ seatIndex, card }) => {
      setTableCards(prev => ({ ...prev, [seatIndex]: card }));
    });

    newSocket.on('round_end', ({ roundsWon: rw, scores: sc }) => {
      setRoundsWon(rw);
      setScores(sc);
    });

    newSocket.on('next_round', ({ currentSeat: cs }) => {
      setTableCards({});
      setCurrentSeat(cs);
      setMySeat(prev => {
        setMyTurn(cs === prev);
        setStatus(cs === prev ? 'Sua vez!' : 'Aguarde...');
        return prev;
      });
    });

    newSocket.on('hand_end', ({ winnerTeam, isDraw, points, scores: sc }) => {
      setScores(sc);
      setPhase('HAND_END');
      if (isDraw) {
        setStatus('Empate! Mão dividida.');
      } else {
        setMyTeam(prev => {
          const msg = winnerTeam === prev
            ? `Seu time ganhou +${points}pt!`
            : `Time inimigo ganhou +${points}pt.`;
          setStatus(msg);
          return prev;
        });
      }
    });

    newSocket.on('game_over', ({ winnerTeam, scores: sc }) => {
      setScores(sc);
      setPhase('GAME_OVER');
      setMyTeam(prev => {
        setVencedor(winnerTeam === prev ? 'Você venceu o jogo!' : 'Você perdeu o jogo!');
        return prev;
      });
    });

    newSocket.on('truco_called', ({ callerTeam, newValue, respondingSeat: rs }) => {
      setTrucoState({
        active: true,
        value: newValue,
        waitingResponse: true,
        respondingSeat: rs,
        callerTeam,
      });
      setPhase('TRUCO_PENDING');
      const labels = { 3: 'Truco!', 6: 'Seis!', 9: 'Nove!', 12: 'Doze!' };
      setStatus(`${labels[newValue] ?? 'Truco!'} — vale ${newValue} pontos`);
    });

    newSocket.on('truco_response', ({ action, value }) => {
      setTrucoState(prev => ({ ...prev, waitingResponse: false, active: action !== 'fold' }));
      if (action === 'fold') {
        setStatus('Adversário correu!');
      } else if (action === 'accept') {
        setPhase('PLAYING');
        setStatus(`Truco aceito! Vale ${value} pontos.`);
      } else if (action === 'raise') {
        setStatus(`Adversário aumentou para ${value}!`);
      }
    });

    newSocket.on('opponent_disconnected', ({ message }) => {
      setStatus(message);
      setPhase('WAITING');
    });

    // Keep-alive ping
    const pingTimer = setInterval(() => {
      newSocket.emit('ping');
    }, PING_INTERVAL);

    return () => {
      clearInterval(pingTimer);
      newSocket.close();
    };
  }, []);

  // ── Actions ───────────────────────────────────────────────────────────────

  const onCardPress = useCallback((card) => {
    if (!myTurn || phase !== 'PLAYING') return;
    socket?.emit('play_card', { card });
    setHand(prev => prev.filter(c => c !== card));
    setMyTurn(false);
    setStatus('Aguarde...');
  }, [myTurn, phase, socket]);

  const onCallTruco = useCallback(() => {
    if (phase !== 'PLAYING') return;
    socket?.emit('call_truco');
  }, [phase, socket]);

  const onRespondTruco = useCallback((action) => {
    socket?.emit('respond_truco', { action });
  }, [socket]);

  // ── Card display helpers ──────────────────────────────────────────────────

  const formatCard = (card) => card?.replace('_', ' ') ?? '?';

  const isManilha = (card) => {
    return ['4_PAUS', '7_COPAS', 'A_ESPADAS', '7_OUROS'].includes(card);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (vencedor) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.gameOverText}>{vencedor}</Text>
        <Text style={styles.scoreText}>Placar final: {scores[0]} × {scores[1]}</Text>
      </SafeAreaView>
    );
  }

  const amIResponding = trucoState.waitingResponse && trucoState.respondingSeat === mySeat;
  const canCallTruco = phase === 'PLAYING' && trucoState.value < 12;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Score bar */}
      <View style={styles.scoreBar}>
        <Text style={styles.scoreBarText}>
          Time 0: {scores[0]}  |  Time 1: {scores[1]}
        </Text>
        <Text style={styles.viraText}>Vira: {formatCard(vira)}</Text>
      </View>

      {/* Pernas indicator */}
      <View style={styles.pernaBar}>
        <Text style={styles.pernaText}>Pernas — T0: {roundsWon[0]}  T1: {roundsWon[1]}</Text>
      </View>

      {/* Status */}
      <View style={styles.statusBox}>
        <Text style={styles.statusText}>{status}</Text>
      </View>

      {/* Table — cards on the table */}
      <View style={styles.tableArea}>
        <Text style={styles.tableLabel}>Mesa</Text>
        <View style={styles.tableRow}>
          {[0, 1, 2, 3].map(seat => (
            <View key={seat} style={styles.tableSlot}>
              <Text style={styles.tableSeatLabel}>{SEAT_LABELS[seat]}</Text>
              {tableCards[seat] ? (
                <View style={[styles.tableCard, isManilha(tableCards[seat]) && styles.manilhaCard]}>
                  <Text style={styles.tableCardText}>{formatCard(tableCards[seat])}</Text>
                </View>
              ) : (
                <View style={styles.tableCardEmpty}>
                  <Text style={styles.tableCardEmptyText}>—</Text>
                </View>
              )}
            </View>
          ))}
        </View>
      </View>

      {/* Truco response buttons */}
      {amIResponding && (
        <View style={styles.trucoResponse}>
          <Text style={styles.trucoCallText}>
            Truco! Vale {trucoState.value} pts
          </Text>
          <View style={styles.trucoButtons}>
            <TouchableOpacity style={styles.btnAccept} onPress={() => onRespondTruco('accept')}>
              <Text style={styles.btnText}>Aceitar</Text>
            </TouchableOpacity>
            {trucoState.value < 12 && (
              <TouchableOpacity style={styles.btnRaise} onPress={() => onRespondTruco('raise')}>
                <Text style={styles.btnText}>Aumentar</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.btnFold} onPress={() => onRespondTruco('fold')}>
              <Text style={styles.btnText}>Correr</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Player hand */}
      <View style={styles.handArea}>
        <Text style={styles.handLabel}>Sua mão</Text>
        <View style={styles.handRow}>
          {hand.map((card, idx) => (
            <TouchableOpacity
              key={`${card}-${idx}`}
              style={[
                styles.card,
                myTurn && phase === 'PLAYING' ? styles.cardActive : styles.cardInactive,
                isManilha(card) && styles.cardManilha,
              ]}
              onPress={() => onCardPress(card)}
              disabled={!myTurn || phase !== 'PLAYING'}
            >
              <Text style={styles.cardText}>{formatCard(card)}</Text>
              {isManilha(card) && <Text style={styles.manilhaBadge}>★</Text>}
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Truco call button */}
      {canCallTruco && (
        <TouchableOpacity style={styles.trucoBtn} onPress={onCallTruco}>
          <Text style={styles.trucoBtnText}>
            {trucoState.value === 1 ? 'TRUCO!' : trucoState.value === 3 ? 'SEIS!' : trucoState.value === 6 ? 'NOVE!' : 'DOZE!'}
          </Text>
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

const GREEN = '#1b5e20';
const DARK_GREEN = '#145214';
const LIGHT_GREEN = '#2e7d32';
const GOLD = '#ffd600';
const RED = '#d32f2f';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GREEN,
  },
  gameOverText: {
    fontSize: 32,
    color: GOLD,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 80,
  },
  scoreText: {
    fontSize: 20,
    color: '#fff',
    textAlign: 'center',
    marginTop: 16,
  },

  // Score bar
  scoreBar: {
    backgroundColor: DARK_GREEN,
    padding: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  scoreBarText: { color: GOLD, fontWeight: 'bold', fontSize: 15 },
  viraText: { color: '#fff', fontSize: 14 },

  // Perna bar
  pernaBar: {
    backgroundColor: '#1a6b1f',
    paddingHorizontal: 12,
    paddingVertical: 4,
    alignItems: 'center',
  },
  pernaText: { color: '#ccc', fontSize: 13 },

  // Status
  statusBox: {
    paddingVertical: 6,
    alignItems: 'center',
  },
  statusText: { color: GOLD, fontSize: 15, fontWeight: '600' },

  // Table area
  tableArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  tableLabel: { color: '#aaa', fontSize: 12, marginBottom: 8 },
  tableRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
  },
  tableSlot: { alignItems: 'center', width: '23%' },
  tableSeatLabel: { color: '#bbb', fontSize: 10, marginBottom: 4 },
  tableCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 6,
    minWidth: 52,
    alignItems: 'center',
    elevation: 3,
  },
  manilhaCard: { borderWidth: 2, borderColor: GOLD },
  tableCardText: { fontSize: 12, fontWeight: 'bold', color: '#222' },
  tableCardEmpty: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
    padding: 6,
    minWidth: 52,
    alignItems: 'center',
  },
  tableCardEmptyText: { color: '#666', fontSize: 14 },

  // Truco response
  trucoResponse: {
    backgroundColor: '#b71c1c',
    padding: 12,
    marginHorizontal: 10,
    borderRadius: 12,
    marginBottom: 8,
    alignItems: 'center',
  },
  trucoCallText: { color: '#fff', fontWeight: 'bold', fontSize: 16, marginBottom: 8 },
  trucoButtons: { flexDirection: 'row', gap: 10 },
  btnAccept: { backgroundColor: '#2e7d32', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  btnRaise: { backgroundColor: '#e65100', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  btnFold: { backgroundColor: '#555', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  btnText: { color: '#fff', fontWeight: 'bold' },

  // Hand
  handArea: {
    paddingBottom: 16,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  handLabel: { color: '#aaa', fontSize: 12, marginBottom: 6 },
  handRow: { flexDirection: 'row', gap: 10, justifyContent: 'center' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    width: 80,
    height: 110,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  cardActive: { borderWidth: 2, borderColor: GOLD, transform: [{ translateY: -8 }] },
  cardInactive: { opacity: 0.75 },
  cardManilha: { borderWidth: 2, borderColor: GOLD },
  cardText: { fontSize: 13, fontWeight: 'bold', color: '#222', textAlign: 'center' },
  manilhaBadge: { fontSize: 12, color: GOLD, marginTop: 2 },

  // Truco call button
  trucoBtn: {
    backgroundColor: RED,
    margin: 10,
    marginTop: 0,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    elevation: 4,
  },
  trucoBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 18, letterSpacing: 2 },
});
