import React, { useState, useEffect, useRef } from 'react';
import { Sword, Shield, Zap, Users, Crown } from 'lucide-react';

// Firebase configuration - Replace with your Firebase project config
const firebaseConfig = {
  apiKey: "AIzaSyCvLSW4EvEFKlIamsL3lBV3GeDAtkvhhTo",
  authDomain: "tuffmangophonk-fb5bc.firebaseapp.com",
  projectId: "tuffmangophonk-fb5bc",
  storageBucket: "tuffmangophonk-fb5bc.firebasestorage.app",
  messagingSenderId: "199500063543",
  appId: "1:199500063543:web:0c91b7db5c4910b5a5b0b2",
};

const CARDS = [
  { id: 'knight', name: 'Knight', cost: 3, hp: 150, damage: 15, speed: 1, range: 1, icon: '🛡️' },
  { id: 'archer', name: 'Archer', cost: 3, hp: 50, damage: 10, speed: 1.5, range: 5, icon: '🏹' },
  { id: 'giant', name: 'Giant', cost: 5, hp: 300, damage: 20, speed: 0.5, range: 1, icon: '👹' },
  { id: 'wizard', name: 'Wizard', cost: 5, hp: 80, damage: 30, speed: 1, range: 5, icon: '🧙' },
];

export default function ClashRoyaleClone() {
  const [gameState, setGameState] = useState('menu'); // menu, matchmaking, playing, gameover
  const [playerId, setPlayerId] = useState(null);
  const [gameId, setGameId] = useState(null);
  const [playerSide, setPlayerSide] = useState(null); // 'bottom' or 'top'
  const [elixir, setElixir] = useState(5);
  const [selectedCard, setSelectedCard] = useState(null);
  const [troops, setTroops] = useState([]);
  const [towers, setTowers] = useState({
    bottom: { left: 250, center: 500, right: 250 },
    top: { left: 250, center: 500, right: 250 }
  });
  const [firestore, setFirestore] = useState(null);
  const [error, setError] = useState(null);
  const gameLoopRef = useRef(null);
  const unsubscribeRef = useRef(null);

  // Initialize Firebase
  useEffect(() => {
    const initFirebase = async () => {
      try {
        const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getFirestore, collection, addDoc, doc, updateDoc, onSnapshot, query, where, getDocs, deleteDoc } = 
          await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
        
        const app = initializeApp(firebaseConfig);
        const db = getFirestore(app);
        setFirestore({ db, collection, addDoc, doc, updateDoc, onSnapshot, query, where, getDocs, deleteDoc });
        setPlayerId(`player_${Math.random().toString(36).substr(2, 9)}`);
      } catch (err) {
        setError('Failed to initialize Firebase. Please check your config.');
        console.error(err);
      }
    };
    initFirebase();
  }, []);

  // Elixir generation
  useEffect(() => {
    if (gameState !== 'playing') return;
    const interval = setInterval(() => {
      setElixir(prev => Math.min(prev + 1, 10));
    }, 2000);
    return () => clearInterval(interval);
  }, [gameState]);

  // Game loop
  useEffect(() => {
    if (gameState !== 'playing') return;

    gameLoopRef.current = setInterval(() => {
      setTroops(prevTroops => {
        const newTroops = prevTroops.map(troop => {
          if (troop.hp <= 0) return troop;

          // Move troops
          const direction = troop.owner === playerSide ? -1 : 1;
          let newY = troop.y + (troop.speed * direction * 2);

          // Attack towers
          const targetSide = troop.owner === 'bottom' ? 'top' : 'bottom';
          
          return { ...troop, y: newY };
        }).filter(troop => troop.hp > 0 && troop.y >= 0 && troop.y <= 600);

        return newTroops;
      });

      // Check tower destruction and sync to Firestore
      setTowers(prevTowers => {
        const newTowers = { ...prevTowers };
        troops.forEach(troop => {
          const targetSide = troop.owner === 'bottom' ? 'top' : 'bottom';
          const targetY = targetSide === 'top' ? 50 : 550;
          
          if (Math.abs(troop.y - targetY) < 30) {
            if (troop.x < 200 && newTowers[targetSide].left > 0) {
              newTowers[targetSide].left = Math.max(0, newTowers[targetSide].left - troop.damage);
            } else if (troop.x > 400 && newTowers[targetSide].right > 0) {
              newTowers[targetSide].right = Math.max(0, newTowers[targetSide].right - troop.damage);
            } else if (newTowers[targetSide].center > 0) {
              newTowers[targetSide].center = Math.max(0, newTowers[targetSide].center - troop.damage);
            }
          }
        });

        // Sync towers to Firestore
        if (firestore && gameId) {
          const gameRef = firestore.doc(firestore.db, 'games', gameId);
          firestore.updateDoc(gameRef, {
            [`towers.${playerSide}`]: newTowers[playerSide]
          }).catch(err => console.error('Error updating towers:', err));
        }

        return newTowers;
      });
    }, 100);

    return () => {
      if (gameLoopRef.current) clearInterval(gameLoopRef.current);
    };
  }, [gameState, troops, firestore, gameId, playerSide]);

  // Listen for game updates
  useEffect(() => {
    if (!firestore || !gameId) return;

    const gameRef = firestore.doc(firestore.db, 'games', gameId);
    unsubscribeRef.current = firestore.onSnapshot(gameRef, (snapshot) => {
      const data = snapshot.data();
      if (!data) return;

      // Update troops from opponent
      const opponentSide = playerSide === 'bottom' ? 'top' : 'bottom';
      if (data.troops && data.troops[opponentSide]) {
        setTroops(prev => {
          const myTroops = prev.filter(t => t.owner === playerSide);
          return [...myTroops, ...data.troops[opponentSide]];
        });
      }

      // Update towers
      if (data.towers) {
        setTowers(data.towers);
      }

      // Check win condition
      if (data.towers.top.center <= 0) {
        setGameState('gameover');
        setError('Bottom player wins!');
      } else if (data.towers.bottom.center <= 0) {
        setGameState('gameover');
        setError('Top player wins!');
      }
    });

    return () => {
      if (unsubscribeRef.current) unsubscribeRef.current();
    };
  }, [firestore, gameId, playerSide]);

  const startMatchmaking = async () => {
    if (!firestore) return;
    setGameState('matchmaking');
    setError(null);

    try {
      // Look for available game
      const gamesRef = firestore.collection(firestore.db, 'games');
      const q = firestore.query(gamesRef, firestore.where('status', '==', 'waiting'));
      const snapshot = await firestore.getDocs(q);

      if (!snapshot.empty) {
        // Join existing game
        const gameDoc = snapshot.docs[0];
        const gameRef = firestore.doc(firestore.db, 'games', gameDoc.id);
        await firestore.updateDoc(gameRef, {
          player2: playerId,
          status: 'playing'
        });
        setGameId(gameDoc.id);
        setPlayerSide('top');
        setGameState('playing');
      } else {
        // Create new game
        const docRef = await firestore.addDoc(firestore.collection(firestore.db, 'games'), {
          player1: playerId,
          player2: null,
          status: 'waiting',
          towers: {
            bottom: { left: 250, center: 500, right: 250 },
            top: { left: 250, center: 500, right: 250 }
          },
          troops: { bottom: [], top: [] },
          createdAt: Date.now()
        });
        setGameId(docRef.id);
        setPlayerSide('bottom');

        // Wait for opponent
        const gameRef = firestore.doc(firestore.db, 'games', docRef.id);
        const unsubscribe = firestore.onSnapshot(gameRef, (snapshot) => {
          const data = snapshot.data();
          if (data && data.status === 'playing') {
            setGameState('playing');
            unsubscribe();
          }
        });
      }
    } catch (err) {
      setError('Matchmaking failed: ' + err.message);
      setGameState('menu');
    }
  };

  const deployTroop = async (x, y) => {
    if (!selectedCard || elixir < selectedCard.cost) return;
    if (playerSide === 'bottom' && y < 300) return;
    if (playerSide === 'top' && y > 300) return;

    const newTroop = {
      id: `${playerId}_${Date.now()}`,
      cardId: selectedCard.id,
      x,
      y,
      hp: selectedCard.hp,
      damage: selectedCard.damage,
      speed: selectedCard.speed,
      range: selectedCard.range,
      owner: playerSide,
      icon: selectedCard.icon
    };

    setTroops(prev => [...prev, newTroop]);
    setElixir(prev => prev - selectedCard.cost);
    setSelectedCard(null);

    // Sync to Firestore
    if (firestore && gameId) {
      const gameRef = firestore.doc(firestore.db, 'games', gameId);
      const currentTroops = troops.filter(t => t.owner === playerSide);
      await firestore.updateDoc(gameRef, {
        [`troops.${playerSide}`]: [...currentTroops, newTroop]
      });
    }
  };

  if (!firestore) {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-b from-blue-900 to-purple-900 text-white">
        <div className="text-center">
          <div className="text-xl mb-4">Loading Firebase...</div>
          {error && <div className="text-red-400">{error}</div>}
          <div className="mt-4 text-sm text-gray-400">
            Make sure to configure your Firebase project in the code
          </div>
        </div>
      </div>
    );
  }

  if (gameState === 'menu') {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-b from-blue-900 to-purple-900">
        <div className="text-center">
          <h1 className="text-6xl font-bold text-white mb-8 flex items-center justify-center gap-4">
            <Crown className="w-16 h-16 text-yellow-400" />
            Clash Royale Clone
          </h1>
          <button
            onClick={startMatchmaking}
            className="bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-bold text-2xl px-12 py-6 rounded-lg shadow-lg transition flex items-center gap-3 mx-auto"
          >
            <Users className="w-8 h-8" />
            Find Match (1v1)
          </button>
          <div className="mt-8 text-gray-300 text-sm">
            Click to find an opponent and start battling!
          </div>
        </div>
      </div>
    );
  }

  if (gameState === 'matchmaking') {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-b from-blue-900 to-purple-900 text-white">
        <div className="text-center">
          <div className="text-3xl mb-4 animate-pulse">Finding opponent...</div>
          <div className="text-xl">Please wait</div>
        </div>
      </div>
    );
  }

  if (gameState === 'gameover') {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-b from-blue-900 to-purple-900 text-white">
        <div className="text-center">
          <div className="text-4xl mb-8">{error}</div>
          <button
            onClick={() => {
              setGameState('menu');
              setGameId(null);
              setTroops([]);
              setElixir(5);
              setTowers({
                bottom: { left: 250, center: 500, right: 250 },
                top: { left: 250, center: 500, right: 250 }
              });
            }}
            className="bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-bold text-xl px-8 py-4 rounded-lg"
          >
            Return to Menu
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gradient-to-b from-blue-900 via-purple-800 to-blue-900 flex flex-col">
      {/* Top Player Area */}
      <div className="h-12 bg-red-900 flex items-center justify-around px-4">
        <div className="text-white font-bold">Opponent</div>
        <div className="flex gap-4">
          <div className="text-white">👑 {towers.top.center}</div>
          <div className="text-white">🏰 {towers.top.left}</div>
          <div className="text-white">🏰 {towers.top.right}</div>
        </div>
      </div>

      {/* Game Board */}
      <div 
        className="flex-1 relative bg-gradient-to-b from-green-800 to-green-600 overflow-hidden"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          deployTroop(x, y);
        }}
      >
        {/* River in middle */}
        <div className="absolute top-1/2 left-0 right-0 h-2 bg-blue-500 transform -translate-y-1/2" />

        {/* Top Towers */}
        <div className="absolute top-12 left-16 w-16 h-16 bg-red-600 rounded-lg flex items-center justify-center text-3xl">
          🏰
        </div>
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 w-20 h-20 bg-red-700 rounded-lg flex items-center justify-center text-4xl">
          👑
        </div>
        <div className="absolute top-12 right-16 w-16 h-16 bg-red-600 rounded-lg flex items-center justify-center text-3xl">
          🏰
        </div>

        {/* Bottom Towers */}
        <div className="absolute bottom-12 left-16 w-16 h-16 bg-blue-600 rounded-lg flex items-center justify-center text-3xl">
          🏰
        </div>
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 w-20 h-20 bg-blue-700 rounded-lg flex items-center justify-center text-4xl">
          👑
        </div>
        <div className="absolute bottom-12 right-16 w-16 h-16 bg-blue-600 rounded-lg flex items-center justify-center text-3xl">
          🏰
        </div>

        {/* Troops */}
        {troops.map(troop => (
          <div
            key={troop.id}
            className={`absolute w-10 h-10 rounded-full flex items-center justify-center text-2xl transform -translate-x-1/2 -translate-y-1/2 ${
              troop.owner === playerSide ? 'bg-blue-500' : 'bg-red-500'
            }`}
            style={{ left: troop.x, top: troop.y }}
          >
            {troop.icon}
          </div>
        ))}

        {/* Deploy indicator */}
        {selectedCard && (
          <div className="absolute inset-0 pointer-events-none">
            <div className={`absolute inset-0 ${playerSide === 'bottom' ? 'top-1/2' : 'bottom-1/2'} bg-blue-400 bg-opacity-20`} />
          </div>
        )}
      </div>

      {/* Bottom Player Area */}
      <div className="h-12 bg-blue-900 flex items-center justify-around px-4">
        <div className="text-white font-bold">You ({playerSide})</div>
        <div className="flex gap-4">
          <div className="text-white">👑 {towers.bottom.center}</div>
          <div className="text-white">🏰 {towers.bottom.left}</div>
          <div className="text-white">🏰 {towers.bottom.right}</div>
        </div>
      </div>

      {/* Card Deck */}
      <div className="h-32 bg-gray-900 flex items-center justify-center gap-4 px-4">
        <div className="text-purple-400 font-bold text-xl flex items-center gap-2">
          <Zap className="w-6 h-6" />
          {elixir}/10
        </div>
        {CARDS.map(card => (
          <button
            key={card.id}
            onClick={() => setSelectedCard(card)}
            disabled={elixir < card.cost}
            className={`w-20 h-24 rounded-lg flex flex-col items-center justify-center transition ${
              selectedCard?.id === card.id
                ? 'bg-yellow-500 scale-110'
                : elixir >= card.cost
                ? 'bg-purple-700 hover:bg-purple-600'
                : 'bg-gray-700 opacity-50'
            }`}
          >
            <div className="text-3xl mb-1">{card.icon}</div>
            <div className="text-white text-xs">{card.name}</div>
            <div className="text-purple-300 text-xs">{card.cost} ⚡</div>
          </button>
        ))}
      </div>
    </div>
  );
}
