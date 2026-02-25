import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, SafeAreaView,
  StatusBar, Platform, Dimensions, Animated,
} from 'react-native';
import io from 'socket.io-client';

// ── Config ─────────────────────────────────────────────────────────────────
const SOCKET_URL = process.env.EXPO_PUBLIC_SERVER_URL || 'http://localhost:3000';
const PING_INTERVAL = 10 * 60 * 1000;

const { height: SCREEN_H } = Dimensions.get('window');
const IS_SMALL = SCREEN_H < 700;

const ANDROID_TOP    = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : 0;
const ANDROID_BOTTOM = Platform.OS === 'android' ? 80 : 16;

// ── Team colors ────────────────────────────────────────────────────────────
const TEAM = {
  0: { color: '#c62828', light: '#ef9a9a', bg: 'rgba(198,40,40,0.18)', name: 'Vermelho' },
  1: { color: '#1565c0', light: '#90caf9', bg: 'rgba(21,101,192,0.18)', name: 'Azul' },
};

// ── Card helpers ───────────────────────────────────────────────────────────
const SUIT_SYM   = { PAUS: '♣', ESPADAS: '♠', COPAS: '♥', OUROS: '♦' };
const SUIT_COLOR = { PAUS: '#111', ESPADAS: '#111', COPAS: '#cc0000', OUROS: '#cc0000' };
const MANILHA_LABEL = { '4_PAUS': 'ZAP', '7_COPAS': 'COPAS', 'A_ESPADAS': 'ESPADA', '7_OUROS': 'PICA' };
const MANILHAS = new Set(Object.keys(MANILHA_LABEL));

function parseCard(card) {
  if (!card) return { rank: '?', symbol: '?', color: '#111', isManilha: false, label: '' };
  const [rank, ...rest] = card.split('_');
  const suit = rest.join('_');
  return {
    rank,
    symbol:    SUIT_SYM[suit]   ?? '?',
    color:     SUIT_COLOR[suit] ?? '#111',
    isManilha: MANILHAS.has(card),
    label:     MANILHA_LABEL[card] ?? '',
  };
}

function CardFace({ card, width = 62, height = 82 }) {
  const { rank, symbol, color, isManilha, label } = parseCard(card);
  return (
    <View style={[CF.card, { width, height }, isManilha && CF.glow]}>
      <Text style={[CF.corner, { color }]}>{rank}{'\n'}{symbol}</Text>
      <Text style={[CF.center, { color }]}>{symbol}</Text>
      <Text style={[CF.cornerBR, { color }]}>{symbol}{'\n'}{rank}</Text>
      {isManilha && <Text style={CF.tag}>{label}</Text>}
    </View>
  );
}

function EmptySlot({ width = 62, height = 82 }) {
  return <View style={[CF.empty, { width, height }]} />;
}

const CF = StyleSheet.create({
  card:     { backgroundColor: '#fff', borderRadius: 7, borderWidth: 1, borderColor: '#ccc', justifyContent: 'center', alignItems: 'center', overflow: 'hidden', elevation: 3, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 3, shadowOffset: { width: 0, height: 2 } },
  glow:     { borderWidth: 2, borderColor: '#ffd600' },
  corner:   { position: 'absolute', top: 3, left: 4, fontSize: 10, fontWeight: 'bold', textAlign: 'center', lineHeight: 13 },
  center:   { fontSize: IS_SMALL ? 22 : 26, fontWeight: 'bold' },
  cornerBR: { position: 'absolute', bottom: 3, right: 4, fontSize: 10, fontWeight: 'bold', textAlign: 'center', lineHeight: 13, transform: [{ rotate: '180deg' }] },
  tag:      { position: 'absolute', bottom: 0, left: 0, right: 0, textAlign: 'center', fontSize: 7, color: '#ffd600', fontWeight: 'bold', backgroundColor: 'rgba(0,0,0,0.55)', paddingVertical: 1 },
  empty:    { backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 7, borderWidth: 1, borderColor: 'rgba(255,255,255,0.13)' },
});

// ── Position helpers ───────────────────────────────────────────────────────
// Seat teams: [0]=T0, [1]=T1, [2]=T0, [3]=T1
const SEAT_TEAM = [0, 1, 0, 1];

function getPositions(mySeat) {
  if (mySeat === null) return { south: 0, north: 2, east: 1, west: 3 };
  const partner   = mySeat <= 1 ? mySeat + 2 : mySeat - 2;
  const opponents = [0, 1, 2, 3].filter(s => s !== mySeat && s !== partner);
  return { south: mySeat, north: partner, east: opponents[0], west: opponents[1] };
}

// ── PlayerSlot ─────────────────────────────────────────────────────────────
function PlayerSlot({ seatIndex, tableCard, name, isActive, pulseAnim, cardW, cardH, namePos = 'below' }) {
  const teamId = SEAT_TEAM[seatIndex];
  const tc     = TEAM[teamId];
  return (
    <View style={{ alignItems: 'center' }}>
      {namePos === 'above' && (
        <Text style={[S.slotName, { color: tc.light }]} numberOfLines={1}>{name}</Text>
      )}
      <View>
        {tableCard ? <CardFace card={tableCard} width={cardW} height={cardH} /> : <EmptySlot width={cardW} height={cardH} />}
        {isActive && (
          <Animated.View style={[S.activeRing, { width: cardW + 8, height: cardH + 8, borderColor: tc.color, opacity: pulseAnim }]} />
        )}
      </View>
      {namePos === 'below' && (
        <Text style={[S.slotName, { color: tc.light }]} numberOfLines={1}>{name}</Text>
      )}
    </View>
  );
}

// ── CenterPanel ────────────────────────────────────────────────────────────
function CenterPanel({ content, onRespond, trucoValue }) {
  const { type, title, subtitle, team } = content;
  const tc = team != null ? TEAM[team] : null;

  const panelStyle = [S.centerPanel, tc && { borderColor: tc.color }];

  const titleColor = tc ? tc.light : '#fff';

  if (type === 'truco_respond') {
    const labels = { 3: 'TRUCO!', 6: 'SEIS!', 9: 'NOVE!', 12: 'DOZE!' };
    return (
      <View style={panelStyle}>
        <Text style={[S.cpTitle, { color: '#ff5252' }]}>{labels[trucoValue] ?? 'TRUCO!'}</Text>
        <Text style={S.cpSub}>Vale {trucoValue} pts</Text>
        <View style={S.trucoRow}>
          <TouchableOpacity style={[S.tBtn, { backgroundColor: '#2e7d32' }]} onPress={() => onRespond('accept')}>
            <Text style={S.tBtnTxt}>Aceitar</Text>
          </TouchableOpacity>
          {trucoValue < 12 && (
            <TouchableOpacity style={[S.tBtn, { backgroundColor: '#e65100' }]} onPress={() => onRespond('raise')}>
              <Text style={S.tBtnTxt}>Aumentar</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[S.tBtn, { backgroundColor: '#555' }]} onPress={() => onRespond('fold')}>
            <Text style={S.tBtnTxt}>Correr</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={panelStyle}>
      {title  ? <Text style={[S.cpTitle, { color: titleColor }]}>{title}</Text>  : null}
      {subtitle ? <Text style={S.cpSub}>{subtitle}</Text> : null}
    </View>
  );
}

// ── App ────────────────────────────────────────────────────────────────────
export default function App() {
  const [socket,      setSocket]      = useState(null);
  const [phase,       setPhase]       = useState('WAITING');
  const [mySeat,      setMySeat]      = useState(null);
  const [myTeam,      setMyTeam]      = useState(null);
  const [myTurn,      setMyTurn]      = useState(false);
  const [currentSeat, setCurrentSeat] = useState(null);
  const [hand,        setHand]        = useState([]);
  const [vira,        setVira]        = useState(null);
  const [scores,      setScores]      = useState([0, 0]);
  const [roundsWon,   setRoundsWon]   = useState([0, 0]);
  const [tableCards,  setTableCards]  = useState({});
  const [seatNames,   setSeatNames]   = useState(['Jogador 1', 'Jogador 2', 'Bot', 'Bot']);
  const [trucoValue,  setTrucoValue]  = useState(1);
  const [trucoResp,   setTrucoResp]   = useState(null); // seat index that must respond
  const [centerContent, setCenterContent] = useState({ type: 'waiting', title: 'Aguardando...', subtitle: '', team: null });

  const mySeatRef  = useRef(null);
  const myTeamRef  = useRef(null);
  const namesRef   = useRef(['Jogador 1', 'Jogador 2', 'Bot', 'Bot']);

  // Pulse animation
  const pulseAnim = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const anim = Animated.loop(Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1,   duration: 600, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 0.3, duration: 600, useNativeDriver: true }),
    ]));
    anim.start();
    return () => anim.stop();
  }, []);

  const positions = useMemo(() => getPositions(mySeat), [mySeat]);

  const displayName = useCallback((seatIdx) => {
    if (seatIdx === mySeatRef.current) return 'Você';
    if (seatIdx < 2) return 'Adversário';
    return namesRef.current[seatIdx] ?? 'Bot';
  }, []);

  const setCenterTurn = useCallback((cs, seat, names) => {
    if (cs === seat) {
      setCenterContent({ type: 'my_turn', title: 'Sua vez!', subtitle: 'Jogue uma carta', team: SEAT_TEAM[seat] });
    } else {
      const name = cs < 2 ? 'Adversário' : (names?.[cs] ?? 'Bot');
      setCenterContent({ type: 'other_turn', title: name, subtitle: 'está jogando...', team: SEAT_TEAM[cs] });
    }
  }, []);

  // ── Socket ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const sock = io(SOCKET_URL, { transports: ['websocket'] });
    setSocket(sock);

    sock.on('connect', () =>
      setCenterContent({ type: 'waiting', title: 'Conectado', subtitle: 'Aguardando mesa...', team: null }));

    sock.on('connect_error', () =>
      setCenterContent({ type: 'error', title: 'Sem conexão', subtitle: 'Verifique o servidor', team: null }));

    sock.on('waiting', ({ position, teamId }) => {
      setMySeat(position);  mySeatRef.current = position;
      setMyTeam(teamId);    myTeamRef.current = teamId;
      setCenterContent({
        type: 'waiting',
        title: `Jogador ${position + 1}`,
        subtitle: `Time ${TEAM[teamId].name}\nAguardando adversário...`,
        team: teamId,
      });
    });

    sock.on('game_start', ({ hand: h, vira: v, myTeam: team, mySeat: seat, myTurn: turn, currentSeat: cs, scores: sc, seatNames: names }) => {
      setHand(h);
      setVira(v);
      setMyTeam(team);      myTeamRef.current = team;
      setMySeat(seat);      mySeatRef.current = seat;
      setMyTurn(turn);
      setCurrentSeat(cs);
      setScores(sc);
      setSeatNames(names ?? ['Jogador 1', 'Jogador 2', 'Bot', 'Bot']);
      namesRef.current = names ?? ['Jogador 1', 'Jogador 2', 'Bot', 'Bot'];
      setPhase('PLAYING');
      setTableCards({});
      setRoundsWon([0, 0]);
      setTrucoValue(1);
      setTrucoResp(null);
      setCenterTurn(cs, seat, names);
    });

    sock.on('turn_change', ({ currentSeat: cs }) => {
      setCurrentSeat(cs);
      setMyTurn(cs === mySeatRef.current);
      setCenterTurn(cs, mySeatRef.current, namesRef.current);
    });

    sock.on('card_played', ({ seatIndex, card }) => {
      setTableCards(prev => ({ ...prev, [seatIndex]: card }));
    });

    sock.on('round_end', ({ roundNumber, result, winnerSeat, winnerName, roundsWon: rw }) => {
      setRoundsWon(rw);
      setMyTurn(false);
      if (result.isDraw) {
        setCenterContent({ type: 'round_result', title: `Perna ${roundNumber}`, subtitle: 'Empate!', team: null });
      } else {
        const isMyTeam = SEAT_TEAM[winnerSeat] === myTeamRef.current;
        setCenterContent({
          type: 'round_result',
          title: isMyTeam ? '✓ Perna sua!' : '✗ Perna deles',
          subtitle: `${winnerName ?? 'Alguém'} ganhou`,
          team: SEAT_TEAM[winnerSeat],
        });
      }
    });

    sock.on('next_round', ({ currentSeat: cs, roundNumber }) => {
      setTableCards({});
      setCurrentSeat(cs);
      setMyTurn(cs === mySeatRef.current);
      setTrucoResp(null);
      setPhase('PLAYING');
      setCenterTurn(cs, mySeatRef.current, namesRef.current);
    });

    sock.on('hand_end', ({ winnerTeam, isDraw, points, scores: sc, winnerName, foldedByTeam }) => {
      setScores(sc);
      setPhase('HAND_END');
      setTableCards({});
      if (isDraw) {
        setCenterContent({ type: 'hand_result', title: 'Mão empatada', subtitle: '+0.5pt cada time', team: null });
      } else {
        const isMyTeam = winnerTeam === myTeamRef.current;
        const reason   = foldedByTeam !== undefined ? (foldedByTeam === myTeamRef.current ? 'Você correu' : 'Inimigo correu') : '';
        setCenterContent({
          type: 'hand_result',
          title: isMyTeam ? `+${points}pt para seu time!` : `+${points}pt para o inimigo`,
          subtitle: reason || `Placar: ${sc[0]} × ${sc[1]}`,
          team: winnerTeam,
        });
      }
    });

    sock.on('game_over', ({ winnerTeam, scores: sc }) => {
      setScores(sc);
      setPhase('GAME_OVER');
      const isMyTeam = winnerTeam === myTeamRef.current;
      setCenterContent({
        type: 'game_over',
        title: isMyTeam ? '🏆 Seu time venceu!' : 'Seu time perdeu',
        subtitle: `Placar final: ${sc[0]} × ${sc[1]}`,
        team: winnerTeam,
      });
    });

    sock.on('truco_called', ({ callerTeam, callerName, newValue, respondingSeat: rs }) => {
      setTrucoValue(newValue);
      setTrucoResp(rs);
      setPhase('TRUCO_PENDING');
      if (rs === mySeatRef.current) {
        setCenterContent({ type: 'truco_respond', title: '', subtitle: '', team: callerTeam === 0 ? 1 : 0 });
      } else {
        const labels = { 3: 'TRUCO!', 6: 'SEIS!', 9: 'NOVE!', 12: 'DOZE!' };
        setCenterContent({
          type: 'truco_wait',
          title: labels[newValue] ?? 'TRUCO!',
          subtitle: `${callerName} pediu — ${newValue}pts`,
          team: callerTeam,
        });
      }
    });

    sock.on('truco_response', ({ action, value }) => {
      if (action === 'accept') {
        setPhase('PLAYING');
        setCenterContent({ type: 'other_turn', title: 'Truco aceito!', subtitle: `Vale ${value}pts`, team: null });
      } else if (action === 'fold') {
        setCenterContent({ type: 'other_turn', title: 'Correu!', subtitle: '', team: null });
      }
    });

    sock.on('opponent_disconnected', ({ message }) => {
      setPhase('WAITING');
      setCenterContent({ type: 'waiting', title: 'Desconectado', subtitle: message, team: null });
    });

    const ping = setInterval(() => sock.emit('ping'), PING_INTERVAL);
    return () => { clearInterval(ping); sock.close(); };
  }, []);

  // ── Actions ───────────────────────────────────────────────────────────────
  const onCardPress = useCallback((card) => {
    if (!myTurn || phase !== 'PLAYING') return;
    socket?.emit('play_card', { card });
    setHand(prev => prev.filter(c => c !== card));
    setMyTurn(false);
  }, [myTurn, phase, socket]);

  const onCallTruco = useCallback(() => {
    if (phase !== 'PLAYING') return;
    socket?.emit('call_truco');
  }, [phase, socket]);

  const onRespondTruco = useCallback((action) => {
    socket?.emit('respond_truco', { action });
  }, [socket]);

  const onForfeit = useCallback(() => {
    socket?.emit('forfeit');
    socket?.disconnect();
  }, [socket]);

  // ── Derived card sizes ───────────────────────────────────────────────────
  const sideW  = IS_SMALL ? 48 : 54;
  const sideH  = IS_SMALL ? 63 : 71;
  const mainW  = IS_SMALL ? 58 : 64;
  const mainH  = IS_SMALL ? 76 : 84;
  const handW  = IS_SMALL ? 70 : 78;
  const handH  = IS_SMALL ? 92 : 102;

  const canCallTruco = (phase === 'PLAYING' || phase === 'TRUCO_PENDING') && trucoValue < 12 && myTurn;

  const { north, south, east, west } = positions;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={[S.root, { paddingTop: ANDROID_TOP }]}>
      <StatusBar barStyle="light-content" backgroundColor="#145214" translucent={false} />

      {/* ── Score bar ─────────────────────────────────────────────── */}
      <View style={S.scoreBar}>
        <Text style={[S.scoreTeam, { color: TEAM[0].light }]}>
          Verm: {scores[0]}
        </Text>
        <Text style={S.viraText}>Vira: {vira ? (() => { const { rank, symbol } = parseCard(vira); return `${rank}${symbol}`; })() : '?'}</Text>
        <Text style={[S.scoreTeam, { color: TEAM[1].light }]}>
          Azul: {scores[1]}
        </Text>
        <View style={S.headerBtns}>
          {(phase === 'PLAYING' || phase === 'TRUCO_PENDING') && (
            <TouchableOpacity style={S.forfeitBtn} onPress={onForfeit}>
              <Text style={S.btnTxt}>Desistir</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={S.exitBtn} onPress={() => socket?.disconnect()}>
            <Text style={S.btnTxt}>Sair</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Table ─────────────────────────────────────────────────── */}
      <View style={S.table}>

        {/* North (partner) */}
        <View style={S.northSlot}>
          <PlayerSlot
            seatIndex={north}
            tableCard={tableCards[north]}
            name={displayName(north)}
            isActive={currentSeat === north}
            pulseAnim={pulseAnim}
            cardW={mainW} cardH={mainH}
            namePos="above"
          />
        </View>

        {/* Middle row */}
        <View style={S.middleRow}>

          {/* West */}
          <View style={S.sideSlot}>
            <PlayerSlot
              seatIndex={west}
              tableCard={tableCards[west]}
              name={displayName(west)}
              isActive={currentSeat === west}
              pulseAnim={pulseAnim}
              cardW={sideW} cardH={sideH}
              namePos="below"
            />
          </View>

          {/* Center panel */}
          <CenterPanel
            content={centerContent}
            onRespond={onRespondTruco}
            trucoValue={trucoValue}
          />

          {/* East */}
          <View style={S.sideSlot}>
            <PlayerSlot
              seatIndex={east}
              tableCard={tableCards[east]}
              name={displayName(east)}
              isActive={currentSeat === east}
              pulseAnim={pulseAnim}
              cardW={sideW} cardH={sideH}
              namePos="below"
            />
          </View>
        </View>

        {/* South (me — just played card) */}
        <View style={S.southSlot}>
          <PlayerSlot
            seatIndex={south}
            tableCard={tableCards[south]}
            name="Você"
            isActive={currentSeat === south}
            pulseAnim={pulseAnim}
            cardW={mainW} cardH={mainH}
            namePos="below"
          />
        </View>

      </View>

      {/* ── Hand ──────────────────────────────────────────────────── */}
      <View style={[S.bottomArea, { paddingBottom: ANDROID_BOTTOM }]}>
        <Text style={S.handLabel}>Sua mão • Perna {roundsWon[0] + roundsWon[1] + 1}</Text>
        <View style={S.handRow}>
          {hand.map((card, idx) => {
            const active = myTurn && phase === 'PLAYING';
            return (
              <TouchableOpacity
                key={`${card}-${idx}`}
                style={active ? S.cardActive : S.cardInactive}
                onPress={() => onCardPress(card)}
                disabled={!active}
              >
                <CardFace card={card} width={handW} height={handH} />
              </TouchableOpacity>
            );
          })}
        </View>

        {canCallTruco && (
          <TouchableOpacity style={S.trucoBtn} onPress={onCallTruco}>
            <Text style={S.trucoBtnTxt}>
              {trucoValue === 1 ? 'TRUCO!' : trucoValue === 3 ? 'SEIS!' : trucoValue === 6 ? 'NOVE!' : 'DOZE!'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────
const GREEN      = '#1b5e20';
const DARK_GREEN = '#145214';
const GOLD       = '#ffd600';
const RED        = '#c62828';

const S = StyleSheet.create({
  root:    { flex: 1, backgroundColor: GREEN },

  // Score bar
  scoreBar:   { flexDirection: 'row', alignItems: 'center', backgroundColor: DARK_GREEN, paddingHorizontal: 10, paddingVertical: 7, gap: 6 },
  scoreTeam:  { fontWeight: 'bold', fontSize: 13 },
  viraText:   { color: '#ccc', fontSize: 12, flex: 1, textAlign: 'center' },
  headerBtns: { flexDirection: 'row', gap: 5 },
  forfeitBtn: { backgroundColor: RED, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 5 },
  exitBtn:    { backgroundColor: '#555', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 5 },
  btnTxt:     { color: '#fff', fontSize: 11, fontWeight: '600' },

  // Table
  table:      { flex: 1, justifyContent: 'space-evenly', alignItems: 'center', paddingVertical: 8 },
  northSlot:  { alignItems: 'center' },
  middleRow:  { flexDirection: 'row', alignItems: 'center', width: '100%', justifyContent: 'space-evenly' },
  sideSlot:   { alignItems: 'center', width: 80 },
  southSlot:  { alignItems: 'center' },

  // Slot decorations
  slotName:   { fontSize: 10, fontWeight: '600', marginVertical: 3, maxWidth: 76, textAlign: 'center' },
  activeRing: { position: 'absolute', top: -4, left: -4, borderRadius: 10, borderWidth: 2, zIndex: 10 },

  // Center panel
  centerPanel: {
    flex: 1, marginHorizontal: 4, minHeight: IS_SMALL ? 90 : 110,
    backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center', alignItems: 'center', padding: 8,
  },
  cpTitle: { fontSize: IS_SMALL ? 14 : 16, fontWeight: 'bold', textAlign: 'center', color: '#fff' },
  cpSub:   { fontSize: 11, color: '#bbb', textAlign: 'center', marginTop: 3 },
  trucoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6, justifyContent: 'center' },
  tBtn:     { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7 },
  tBtnTxt:  { color: '#fff', fontWeight: 'bold', fontSize: 11 },

  // Hand
  bottomArea: { backgroundColor: DARK_GREEN, paddingTop: 6, paddingHorizontal: 8, alignItems: 'center' },
  handLabel:  { color: '#aaa', fontSize: 11, marginBottom: 5 },
  handRow:    { flexDirection: 'row', gap: 8, justifyContent: 'center', marginBottom: 8 },
  cardActive: { transform: [{ translateY: -8 }] },
  cardInactive: { opacity: 0.72 },

  // Truco button
  trucoBtn:    { width: '100%', backgroundColor: RED, paddingVertical: IS_SMALL ? 9 : 11, borderRadius: 10, alignItems: 'center', marginBottom: 4 },
  trucoBtnTxt: { color: '#fff', fontWeight: 'bold', fontSize: 15, letterSpacing: 2 },
});
