import React, { useEffect, useState, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Platform,
  Dimensions,
} from 'react-native';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const IS_SMALL_SCREEN = SCREEN_HEIGHT < 700;
import io from 'socket.io-client';

const SOCKET_URL =
  process.env.EXPO_PUBLIC_SERVER_URL || 'http://localhost:3000';

// Keep-alive interval for Render free tier (ms)
const PING_INTERVAL = 10 * 60 * 1000;

// ── Seat layout label ──────────────────────────────────────────────────────
const SEAT_LABELS = ['Você', 'Adversário', 'Bot Aliado', 'Bot Inimigo'];

// ── Card helpers ───────────────────────────────────────────────────────────
const SUIT_SYMBOL = { PAUS: '♣', ESPADAS: '♠', COPAS: '♥', OUROS: '♦' };
const SUIT_COLOR  = { PAUS: '#111', ESPADAS: '#111', COPAS: '#cc0000', OUROS: '#cc0000' };
const MANILHA_NAMES = { '4_PAUS': 'ZAP', '7_COPAS': 'COPAS', 'A_ESPADAS': 'ESPADA', '7_OUROS': 'PICA' };
const MANILHA_CARDS = new Set(['4_PAUS', '7_COPAS', 'A_ESPADAS', '7_OUROS']);

function parseCard(card) {
  if (!card) return { rank: '?', suit: 'PAUS', symbol: '♣', color: '#111', isManilha: false, manilhaName: '' };
  const [rank, ...rest] = card.split('_');
  const suit = rest.join('_');
  return {
    rank,
    suit,
    symbol: SUIT_SYMBOL[suit] ?? '?',
    color: SUIT_COLOR[suit] ?? '#111',
    isManilha: MANILHA_CARDS.has(card),
    manilhaName: MANILHA_NAMES[card] ?? '',
  };
}

function CardFace({ card, width = 78, height = 100, faceDown = false }) {
  const { rank, symbol, color, isManilha, manilhaName } = parseCard(card);
  if (faceDown) {
    return (
      <View style={[cardFaceStyles.card, { width, height, backgroundColor: '#1565c0' }]}>
        <Text style={{ color: '#fff', fontSize: 20 }}>🂠</Text>
      </View>
    );
  }
  return (
    <View style={[cardFaceStyles.card, { width, height }, isManilha && cardFaceStyles.manilhaBorder]}>
      <Text style={[cardFaceStyles.corner, { color }]}>{rank}{symbol}</Text>
      <Text style={[cardFaceStyles.center, { color }]}>{symbol}</Text>
      <Text style={[cardFaceStyles.cornerBottom, { color }]}>{rank}{symbol}</Text>
      {isManilha && <Text style={cardFaceStyles.manilhaTag}>{manilhaName}</Text>}
    </View>
  );
}

const cardFaceStyles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ccc',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
    overflow: 'hidden',
  },
  manilhaBorder: { borderWidth: 2, borderColor: '#ffd600' },
  corner: { position: 'absolute', top: 4, left: 5, fontSize: 11, fontWeight: 'bold' },
  center: { fontSize: 28, fontWeight: 'bold' },
  cornerBottom: { position: 'absolute', bottom: 4, right: 5, fontSize: 11, fontWeight: 'bold', transform: [{ rotate: '180deg' }] },
  manilhaTag: { position: 'absolute', bottom: 3, left: 0, right: 0, textAlign: 'center', fontSize: 8, color: '#ffd600', fontWeight: 'bold', backgroundColor: 'rgba(0,0,0,0.45)' },
});

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
  const [toast, setToast] = useState(null); // { message, sub }

  const showToast = useCallback((message, sub = '', duration = 2500) => {
    setToast({ message, sub });
    setTimeout(() => setToast(null), duration);
  }, []);

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

    newSocket.on('round_end', ({ roundsWon: rw, scores: sc, result }) => {
      setRoundsWon(rw);
      setScores(sc);
      if (result?.isDraw) {
        showToast('Perna empatada!', 'Ninguém pontuou');
      } else if (result?.winnerTeam !== undefined) {
        // will compare with myTeam via state ref workaround below
        setMyTeam(prev => {
          const msg = result.winnerTeam === prev ? 'Você ganhou a perna!' : 'Inimigo ganhou a perna!';
          showToast(msg, `Pernas: T0 ${rw[0]} × T1 ${rw[1]}`);
          return prev;
        });
      }
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

    newSocket.on('hand_end', ({ winnerTeam, isDraw, points, scores: sc, foldedByTeam }) => {
      setScores(sc);
      setPhase('HAND_END');
      if (isDraw) {
        showToast('Mão empatada!', 'Cada time recebe 0.5pt', 3000);
        setStatus('Empate!');
      } else {
        setMyTeam(prev => {
          const venceu = winnerTeam === prev;
          const razao = foldedByTeam !== undefined
            ? (foldedByTeam === prev ? 'Você correu!' : 'Inimigo correu!')
            : '';
          showToast(
            venceu ? `Sua equipe ganhou a mão! +${points}pt` : `Inimigo ganhou a mão! +${points}pt`,
            razao || `Placar: ${sc[0]} × ${sc[1]}`,
            3000,
          );
          setStatus(venceu ? `+${points}pt para o seu time!` : `+${points}pt para o inimigo.`);
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

  const onForfeit = useCallback(() => {
    socket?.emit('forfeit');
    socket?.disconnect();
  }, [socket]);

  const onRespondTruco = useCallback((action) => {
    socket?.emit('respond_truco', { action });
  }, [socket]);

  const formatCard = (card) => {
    const { rank, symbol } = parseCard(card);
    return `${rank} ${symbol}`;
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
      {/* Toast overlay */}
      {toast && (
        <View style={styles.toastOverlay} pointerEvents="none">
          <View style={styles.toastBox}>
            <Text style={styles.toastText}>{toast.message}</Text>
            {toast.sub ? <Text style={styles.toastSub}>{toast.sub}</Text> : null}
          </View>
        </View>
      )}
      <StatusBar
        barStyle="light-content"
        backgroundColor={DARK_GREEN}
        translucent={false}
      />

      {/* Score bar */}
      <View style={styles.scoreBar}>
        <Text style={styles.scoreBarText}>
          T0: {scores[0]}  |  T1: {scores[1]}
        </Text>
        <Text style={styles.viraText}>Vira: {vira ? formatCard(vira) : '?'}</Text>
        <View style={styles.headerBtns}>
          {phase === 'PLAYING' || phase === 'TRUCO_PENDING' ? (
            <TouchableOpacity onPress={onForfeit} style={styles.forfeitBtn}>
              <Text style={styles.exitBtnText}>Desistir</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity onPress={() => socket?.disconnect()} style={styles.exitBtn}>
            <Text style={styles.exitBtnText}>Sair</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Pernas + Status numa linha só */}
      <View style={styles.infoBar}>
        <Text style={styles.pernaText}>P: {roundsWon[0]}×{roundsWon[1]}</Text>
        <Text style={styles.statusText} numberOfLines={1}>{status}</Text>
      </View>

      {/* Table — cards on the table */}
      <View style={styles.tableArea}>
        <Text style={styles.tableLabel}>Mesa</Text>
        <View style={styles.tableRow}>
          {[0, 1, 2, 3].map(seat => (
            <View key={seat} style={styles.tableSlot}>
              <Text style={styles.tableSeatLabel}>{SEAT_LABELS[seat]}</Text>
              {tableCards[seat] ? (
                <CardFace card={tableCards[seat]} width={72} height={96} />
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

      {/* Player hand + Truco button — wrapped with Android bottom padding */}
      <View style={styles.bottomArea}>
        <Text style={styles.handLabel}>Sua mão</Text>
        <View style={styles.handRow}>
          {hand.map((card, idx) => {
            const active = myTurn && phase === 'PLAYING';
            return (
              <TouchableOpacity
                key={`${card}-${idx}`}
                style={[active ? styles.cardActive : styles.cardInactive]}
                onPress={() => onCardPress(card)}
                disabled={!active}
              >
                <CardFace
                  card={card}
                  width={IS_SMALL_SCREEN ? 72 : 80}
                  height={IS_SMALL_SCREEN ? 96 : 106}
                />
              </TouchableOpacity>
            );
          })}
        </View>

        {canCallTruco && (
          <TouchableOpacity style={styles.trucoBtn} onPress={onCallTruco}>
            <Text style={styles.trucoBtnText}>
              {trucoState.value === 1 ? 'TRUCO!' : trucoState.value === 3 ? 'SEIS!' : trucoState.value === 6 ? 'NOVE!' : 'DOZE!'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const GREEN = '#1b5e20';
const DARK_GREEN = '#145214';
const LIGHT_GREEN = '#2e7d32';
const GOLD = '#ffd600';
const RED = '#d32f2f';

const ANDROID_BOTTOM_PADDING = Platform.OS === 'android' ? 80 : 0;
const ANDROID_TOP_PADDING = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : 0;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GREEN,
    paddingTop: ANDROID_TOP_PADDING,
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
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  scoreBarText: { color: GOLD, fontWeight: 'bold', fontSize: 13 },
  viraText: { color: '#fff', fontSize: 13 },
  headerBtns: { flexDirection: 'row', gap: 6 },
  exitBtn: { backgroundColor: '#555', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  forfeitBtn: { backgroundColor: '#b71c1c', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  exitBtnText: { color: '#fff', fontSize: 12 },

  // Toast overlay
  toastOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 99,
  },
  toastBox: {
    backgroundColor: 'rgba(0,0,0,0.82)',
    paddingHorizontal: 28,
    paddingVertical: 20,
    borderRadius: 16,
    alignItems: 'center',
    minWidth: 220,
  },
  toastText: { color: GOLD, fontSize: 22, fontWeight: 'bold', textAlign: 'center' },
  toastSub: { color: '#ccc', fontSize: 14, marginTop: 6, textAlign: 'center' },

  // Pernas + status bar (combined)
  infoBar: {
    backgroundColor: '#1a6b1f',
    paddingHorizontal: 12,
    paddingVertical: 5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pernaText: { color: '#aaa', fontSize: 12 },
  statusText: { color: GOLD, fontSize: 13, fontWeight: '600', flexShrink: 1, textAlign: 'right' },

  // Table area
  tableArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  tableLabel: { color: '#aaa', fontSize: 12, marginBottom: 8 },
  tableRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
  },
  tableSlot: { alignItems: 'center', width: 76 },
  tableSeatLabel: { color: '#bbb', fontSize: 10, marginBottom: 4 },
  tableCardEmpty: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
    width: 72,
    height: 96,
    alignItems: 'center',
    justifyContent: 'center',
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

  // Hand + Truco button bottom area
  bottomArea: {
    paddingBottom: ANDROID_BOTTOM_PADDING,
    paddingHorizontal: 8,
    paddingTop: 4,
    alignItems: 'center',
    backgroundColor: DARK_GREEN,
  },
  handLabel: { color: '#aaa', fontSize: 11, marginBottom: 4 },
  handRow: { flexDirection: 'row', gap: 8, justifyContent: 'center', marginBottom: 8 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 8,
    width: IS_SMALL_SCREEN ? 70 : 78,
    height: IS_SMALL_SCREEN ? 90 : 100,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  cardActive: { transform: [{ translateY: -8 }], opacity: 1 },
  cardInactive: { opacity: 0.7 },

  // Truco call button
  trucoBtn: {
    backgroundColor: RED,
    width: '100%',
    paddingVertical: IS_SMALL_SCREEN ? 10 : 12,
    borderRadius: 10,
    alignItems: 'center',
    elevation: 4,
  },
  trucoBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16, letterSpacing: 2 },
});
