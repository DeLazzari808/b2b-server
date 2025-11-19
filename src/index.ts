import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { searchTracks } from './spotify';
import { searchYouTubeVideos } from './youtube';
import { searchSoundCloudTracks } from './soundcloud';
import dotenv from 'dotenv';
import path from 'path';

// Carrega o .env do diretório server
// Tenta múltiplos caminhos para funcionar tanto em desenvolvimento quanto após compilação
const envPaths = [
  path.resolve(__dirname, '../.env'), // Após compilação (dist/.env)
  path.resolve(__dirname, '../../.env'), // Alternativa
  path.resolve(process.cwd(), '.env'), // Diretório atual
];

let envLoaded = false;
for (const envPath of envPaths) {
  const result = dotenv.config({ path: envPath });
  if (!result.error) {
    envLoaded = true;
    console.log(`✅ Arquivo .env carregado de: ${envPath}`);
    break;
  }
}

if (!envLoaded) {
  console.warn('⚠️ Nenhum arquivo .env encontrado. Tentando carregar do diretório padrão...');
  dotenv.config(); // Tenta carregar do diretório padrão
}

// Debug: mostra quais variáveis estão configuradas (sem mostrar valores completos)
console.log('📋 Variáveis de ambiente carregadas:');
console.log('   - YOUTUBE_API_KEY:', process.env.YOUTUBE_API_KEY ? `✅ (${process.env.YOUTUBE_API_KEY.substring(0, 10)}...)` : '❌ Não configurada');
console.log('   - SOUNDCLOUD_CLIENT_ID:', process.env.SOUNDCLOUD_CLIENT_ID ? '✅ Configurada' : '❌ Não configurada');
console.log('   - SPOTIFY_CLIENT_ID:', process.env.SPOTIFY_CLIENT_ID ? '✅ Configurada' : '❌ Não configurada');

// --- Interfaces de Dados ---
type UserRole = 'dj' | 'spectator';

interface Track {
  id: string; // ID da música (Spotify ID, YouTube video ID, SoundCloud ID, etc)
  title: string;
  artist: string;
  uri: string; // URI da música (Spotify URI, YouTube URL, SoundCloud URL, etc)
  albumArt?: string;
  previewUrl?: string | null;
  source?: 'spotify' | 'youtube' | 'soundcloud'; // Fonte da música
  streamUrl?: string | null; // URL de stream (para SoundCloud)
  startTime?: number; // Timestamp quando a música começou a tocar (em ms)
  duration?: number | null; // Duração da música em segundos (para YouTube)
}

interface User {
  id: string; // socket.id
  name: string;
  role: UserRole;
}

interface Lobby {
  id: string;
  users: User[];
  queue: Track[];
}

// --- Armazenamento em Memória ---
const lobbies: Record<string, Lobby> = {};

// Timers de avanço automático por lobby
const lobbyAdvanceTimers = new Map<string, NodeJS.Timeout>();

// --- Configuração do Servidor ---
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const server = http.createServer(app);
const io = new Server(server, {
  cors: { 
    origin: '*', 
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['*'],
  },
  transports: ['polling', 'websocket'], // Suporta polling e websocket
  allowEIO3: true, // Compatibilidade com versões antigas
  pingTimeout: 60000,
  pingInterval: 25000,
});

// --- Rotas HTTP ---
app.get('/', (req, res) => res.send('Servidor B2B Matchmaking está rodando!'));
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    lobbies: Object.keys(lobbies).length 
  });
});

app.get('/search', async (req, res) => {
  try {
  const query = req.query.q as string;
    const source = (req.query.source as string) || 'youtube'; // youtube, spotify, soundcloud, ou 'all'
    
  if (!query) return res.status(400).send('O parâmetro "q" é obrigatório.');
    
    console.log(`🔍 Busca solicitada: "${query}" na fonte: ${source}`);
    
    let results: any[] = [];
    const warnings: string[] = [];
    
    // Busca em múltiplas fontes
    if (source === 'youtube' || source === 'all') {
      const youtubeResults = await searchYouTubeVideos(query);
      if (youtubeResults.length === 0 && !process.env.YOUTUBE_API_KEY) {
        warnings.push('YouTube: API key não configurada. Configure YOUTUBE_API_KEY no .env');
      } else if (youtubeResults.length === 0 && process.env.YOUTUBE_API_KEY) {
        warnings.push('YouTube: Nenhum resultado encontrado. Verifique se a API key está válida e se a API está habilitada no Google Cloud Console.');
      }
      results = [...results, ...youtubeResults];
    }
    
    if (source === 'spotify' || source === 'all') {
      const spotifyResults = await searchTracks(query);
      // Adiciona source: 'spotify' aos resultados
      const spotifyWithSource = spotifyResults.map(track => ({ ...track, source: 'spotify' }));
      results = [...results, ...spotifyWithSource];
    }
    
    if (source === 'soundcloud' || source === 'all') {
      const soundcloudResults = await searchSoundCloudTracks(query);
      if (soundcloudResults.length === 0 && !process.env.SOUNDCLOUD_CLIENT_ID) {
        warnings.push('SoundCloud: Client ID não configurado. Configure SOUNDCLOUD_CLIENT_ID no .env');
      }
      results = [...results, ...soundcloudResults];
    }
    
    console.log(`✅ Total de resultados: ${results.length}`);
    
    // Retorna resultados com avisos se houver
    if (warnings.length > 0 && results.length === 0) {
      return res.json({ 
        results: [], 
        warnings,
        message: 'Nenhuma API configurada. Configure pelo menos uma API key no arquivo .env'
      });
    }
    
    res.json(results.length > 0 ? results : { results: [], warnings });
  } catch (error) {
    console.error('❌ Erro na rota /search:', error);
    res.status(500).json({ error: 'Erro ao buscar músicas' });
  }
});

// --- Rotas OAuth Spotify ---
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
// Spotify não aceita localhost como seguro, usa 127.0.0.1
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://127.0.0.1:5173/callback';

app.get('/auth/login', (req, res) => {
  const scopes = 'user-read-playback-state user-modify-playback-state user-read-currently-playing streaming';
  const state = uuidv4();
  
  const authUrl = `https://accounts.spotify.com/authorize?` +
    `response_type=code&` +
    `client_id=${SPOTIFY_CLIENT_ID}&` +
    `scope=${encodeURIComponent(scopes)}&` +
    `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
    `state=${state}`;
  
  res.redirect(authUrl);
});

app.get('/auth/callback', async (req, res) => {
  const code = req.query.code as string;
  const state = req.query.state as string;
  
  if (!code) {
    return res.status(400).send('Código de autorização não fornecido.');
  }
  
  try {
    const response = await axios.post('https://accounts.spotify.com/api/token', 
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: REDIRECT_URI,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'),
        },
      }
    );
    
    const { access_token, refresh_token, expires_in } = response.data;
    
    // Redireciona para o frontend com o token
    res.redirect(`http://127.0.0.1:5173/?access_token=${access_token}&refresh_token=${refresh_token}&expires_in=${expires_in}`);
  } catch (error: any) {
    console.error('❌ Erro ao trocar código por token:', error.response?.data || error.message);
    res.status(500).send('Erro ao autenticar com Spotify.');
  }
});

app.post('/auth/refresh', async (req, res) => {
  const { refresh_token } = req.body;
  
  if (!refresh_token) {
    return res.status(400).json({ error: 'Refresh token não fornecido.' });
  }
  
  try {
    const response = await axios.post('https://accounts.spotify.com/api/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refresh_token,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'),
        },
      }
    );
    
    res.json({
      access_token: response.data.access_token,
      expires_in: response.data.expires_in,
    });
  } catch (error: any) {
    console.error('❌ Erro ao renovar token:', error.response?.data || error.message);
    res.status(500).json({ error: 'Erro ao renovar token.' });
  }
});

// --- Função para agendar avanço automático de música ---
function scheduleTrackAdvance(lobbyId: string, track: Track) {
  // Cancela timer anterior se existir
  const existingTimer = lobbyAdvanceTimers.get(lobbyId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    console.log('🔄 Cancelando timer anterior para lobby:', lobbyId);
    lobbyAdvanceTimers.delete(lobbyId);
  }
  
  // Garante que a música tem duração
  if (!track.duration || track.duration <= 0) {
    console.warn('⚠️ Música sem duração, usando estimativa de 4 minutos');
    track.duration = 240; // 4 minutos padrão
  }
  
  // Garante que a música tem startTime
  if (!track.startTime) {
    console.warn('⚠️ Música sem startTime, definindo agora');
    track.startTime = Date.now();
  }
  
  const durationMs = track.duration * 1000;
  const elapsed = Date.now() - track.startTime;
  const remaining = Math.max(0, durationMs - elapsed);
  
  console.log(`⏱️ Agendando avanço automático para lobby ${lobbyId}`);
  console.log(`   - Música: ${track.title}`);
  console.log(`   - Duração: ${track.duration}s`);
  console.log(`   - StartTime: ${new Date(track.startTime).toISOString()}`);
  console.log(`   - Tempo decorrido: ${Math.floor(elapsed/1000)}s`);
  console.log(`   - Tempo restante: ${Math.floor(remaining/1000)}s`);
  
  if (remaining <= 0) {
    console.warn('⚠️ Tempo restante é 0 ou negativo, avançando imediatamente');
    advanceToNextTrack(lobbyId);
    return;
  }
  
  const timer = setTimeout(() => {
    console.log(`⏹️ Timer automático: Música terminou no lobby ${lobbyId}`);
    console.log(`   - Música que terminou: ${track.title}`);
    advanceToNextTrack(lobbyId);
    lobbyAdvanceTimers.delete(lobbyId);
  }, remaining);
  
  lobbyAdvanceTimers.set(lobbyId, timer);
  console.log(`✅ Timer criado e armazenado para lobby ${lobbyId}`);
}

// --- Função para avançar para próxima música ---
function advanceToNextTrack(lobbyId: string) {
  const lobby = lobbies[lobbyId];
  if (!lobby) {
    console.warn('⚠️ Lobby não encontrado para avanço:', lobbyId);
    return;
  }
  
  // Verifica se já está processando (lock)
  if (lobbyProcessingLocks.get(lobbyId)) {
    console.log('⚠️ Já está processando avanço para este lobby, ignorando');
    return;
  }
  
  // Se não há músicas na fila, não faz nada
  if (lobby.queue.length === 0) {
    console.log('⚠️ Fila vazia, nada para avançar');
    return;
  }
  
  // Ativa o lock
  lobbyProcessingLocks.set(lobbyId, true);
  
  try {
    // Remove a primeira música da fila
    const trackRemovido = lobby.queue[0];
    lobby.queue = lobby.queue.slice(1);
    console.log('✅ Música terminou e foi removida:', trackRemovido.title);
    console.log('📊 Tamanho da fila agora:', lobby.queue.length);
    
    // Se ainda há músicas na fila, define startTime para a próxima e agenda timer
    if (lobby.queue.length > 0) {
      lobby.queue[0].startTime = Date.now();
      console.log('⏰ Próxima música iniciando com startTime:', lobby.queue[0].startTime);
      console.log('   - Próxima música:', lobby.queue[0].title);
      
      // Agenda avanço automático para a próxima música
      scheduleTrackAdvance(lobbyId, lobby.queue[0]);
    } else {
      console.log('📭 Fila vazia após remover música');
    }
    
    // Notifica todos no lobby sobre a atualização da fila
    io.to(lobbyId).emit('fila_atualizada', lobby.queue);
    console.log('📤 Enviado evento "fila_atualizada" para o lobby:', lobbyId);
  } finally {
    // Remove o lock após um delay
    setTimeout(() => {
      lobbyProcessingLocks.delete(lobbyId);
      console.log('🔓 Lock removido para lobby:', lobbyId);
    }, 1000);
  }
}

// --- Lógica do Socket.IO ---
// Lock por lobby para evitar processar múltiplos eventos de "música terminou" simultaneamente
const lobbyProcessingLocks = new Map<string, boolean>();

io.on('connection', (socket: Socket) => {
  console.log('✅ Usuário conectado:', socket.id);
  console.log('📊 Total de lobbies ativos:', Object.keys(lobbies).length);

  const findLobbyAndUser = (socketId: string): { lobby: Lobby; user: User } | null => {
    for (const lobbyId in lobbies) {
      const user = lobbies[lobbyId].users.find(u => u.id === socketId);
      if (user) return { lobby: lobbies[lobbyId], user };
    }
    return null;
  };

  socket.on('criar_lobby', (userName: string) => {
    console.log('📤 Recebido evento "criar_lobby" de:', socket.id, 'com nome:', userName);
    
    if (!userName || !userName.trim()) {
      console.error('❌ Nome de usuário inválido');
      socket.emit('erro_lobby', 'Nome de usuário inválido.');
      return;
    }

    const lobbyId = uuidv4();
    const newUser: User = { id: socket.id, name: userName.trim(), role: 'dj' };
    lobbies[lobbyId] = { id: lobbyId, users: [newUser], queue: [] };
    socket.join(lobbyId);
    
    console.log(`✅ DJ ${userName} (${socket.id}) criou o lobby ${lobbyId}`);
    console.log('📊 Total de lobbies agora:', Object.keys(lobbies).length);
    
    socket.emit('lobby_criado', lobbies[lobbyId]);
    console.log('📤 Enviado evento "lobby_criado" para:', socket.id);
  });

  socket.on('entrar_lobby', (lobbyId: string, userName: string) => {
    console.log('📤 Recebido evento "entrar_lobby" de:', socket.id);
    console.log('   - Lobby ID:', lobbyId);
    console.log('   - Nome:', userName);
    console.log('   - Lobbies disponíveis:', Object.keys(lobbies));
    
    if (!lobbyId || !lobbyId.trim()) {
      console.error('❌ ID do lobby inválido');
      socket.emit('erro_lobby', 'ID do lobby inválido.');
      return;
    }

    if (!userName || !userName.trim()) {
      console.error('❌ Nome de usuário inválido');
      socket.emit('erro_lobby', 'Nome de usuário inválido.');
      return;
    }

    const lobby = lobbies[lobbyId.trim()];
    if (lobby) {
      const djCount = lobby.users.filter(u => u.role === 'dj').length;
      const role: UserRole = djCount < 2 ? 'dj' : 'spectator';
      
      const newUser: User = { id: socket.id, name: userName.trim(), role };
      lobby.users.push(newUser);
      
      socket.join(lobbyId);
      console.log(`✅ Usuário ${userName} (${socket.id}) entrou no lobby ${lobbyId} como ${role}`);
      console.log('📊 Usuários no lobby:', lobby.users.length);
      
      socket.to(lobbyId).emit('usuario_entrou', newUser);
      socket.emit('lobby_entrou', lobby);
      console.log('📤 Enviado evento "lobby_entrou" para:', socket.id);
    } else {
      console.error('❌ Lobby não encontrado:', lobbyId);
      socket.emit('erro_lobby', 'O lobby não foi encontrado.');
    }
  });

  socket.on('adicionar_faixa', (track: Track) => {
    console.log('📤 Recebido evento "adicionar_faixa" de:', socket.id);
    console.log('   - Track:', track);
    
    const context = findLobbyAndUser(socket.id);
    
    if (!context) {
      console.error('❌ Usuário não encontrado em nenhum lobby');
      socket.emit('erro_lobby', 'Você não está em nenhum lobby.');
      return;
    }
    
    console.log('   - Usuário encontrado:', context.user.name, 'Role:', context.user.role);
    console.log('   - Lobby:', context.lobby.id);
    
    if (context.user.role !== 'dj') {
      console.error('❌ Usuário não é DJ. Role:', context.user.role);
      socket.emit('erro_lobby', 'Apenas DJs podem adicionar músicas.');
      return;
    }
    
      const { lobby } = context;
    
    if (lobby.queue.some(t => t.id === track.id)) {
      console.log('⚠️ Música já está na fila:', track.title);
      socket.emit('erro_lobby', 'Esta música já está na fila.');
      return;
    }
    
    // Adiciona a música à fila primeiro
    lobby.queue.push(track);
    
    // Se é a primeira música da fila, adiciona timestamp de início e inicia timer
    if (lobby.queue.length === 1) {
      track.startTime = Date.now();
      console.log('⏰ Primeira música da fila, definindo startTime:', track.startTime);
      console.log('   - Duração da música:', track.duration || 'não definida');
      
      // Inicia timer automático no servidor para avançar quando a música terminar
      scheduleTrackAdvance(lobby.id, track);
    }
    console.log('✅ Música adicionada:', track.title);
    console.log('📊 Tamanho da fila agora:', lobby.queue.length);
    
    io.to(lobby.id).emit('fila_atualizada', lobby.queue);
    console.log('📤 Enviado evento "fila_atualizada" para o lobby:', lobby.id);
  });
  
  // Evento para quando uma música termina - servidor já gerencia automaticamente via timer
  // Este evento é apenas um fallback caso o timer falhe
  socket.on('musica_terminou', () => {
    console.log('📤 Recebido evento "musica_terminou" de:', socket.id, '(fallback)');
    
    const context = findLobbyAndUser(socket.id);
    
    if (!context) {
      console.log('⚠️ Usuário não encontrado no lobby (pode ter desconectado), mas servidor gerencia avanço automaticamente');
      return;
    }
    
    const { lobby } = context;
    
    // Se o servidor já está gerenciando via timer, ignora eventos dos clientes
    // Mas se não há timer ativo, processa manualmente como fallback
    if (!lobbyAdvanceTimers.has(lobby.id)) {
      console.log('⚠️ Nenhum timer ativo, processando avanço manualmente (fallback)');
      advanceToNextTrack(lobby.id);
    } else {
      console.log('✅ Timer do servidor já está gerenciando o avanço, ignorando evento do cliente');
    }
  });

  socket.on('remover_faixa', (trackId: string) => {
    console.log('📤 Recebido evento "remover_faixa" de:', socket.id);
    console.log('   - Track ID:', trackId);
    
    const context = findLobbyAndUser(socket.id);
    
    if (!context) {
      console.error('❌ Usuário não encontrado em nenhum lobby');
      return;
    }
    
    if (context.user.role !== 'dj') {
      console.error('❌ Usuário não é DJ. Role:', context.user.role);
      return;
    }
    
    const { lobby } = context;
    const trackRemovido = lobby.queue.find(t => t.id === trackId);
    const wasFirstTrack = lobby.queue[0]?.id === trackId;
    
    lobby.queue = lobby.queue.filter(track => track.id !== trackId);
    console.log('✅ Música removida:', trackRemovido?.title || trackId);
    console.log('📊 Tamanho da fila agora:', lobby.queue.length);
    
    // Se removeu a primeira música e ainda há músicas na fila, adiciona startTime à próxima
    if (wasFirstTrack && lobby.queue.length > 0) {
      lobby.queue[0].startTime = Date.now();
      console.log('⏰ Nova primeira música, definindo startTime:', lobby.queue[0].startTime);
      
      // Cancela timer anterior e agenda novo
      const existingTimer = lobbyAdvanceTimers.get(lobby.id);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }
      scheduleTrackAdvance(lobby.id, lobby.queue[0]);
    }
    
    io.to(lobby.id).emit('fila_atualizada', lobby.queue);
    console.log('📤 Enviado evento "fila_atualizada" para o lobby:', lobby.id);
  });

  socket.on('disconnect', () => {
    console.log('❌ Usuário desconectado:', socket.id);
    const context = findLobbyAndUser(socket.id);
    if (context) {
      const { lobby, user } = context;
      lobby.users = lobby.users.filter(u => u.id !== user.id);
      
      console.log(`👤 Usuário ${user.name} removido do lobby ${lobby.id}`);
      socket.to(lobby.id).emit('usuario_saiu', user);

      // Limpa timer se o lobby ficou vazio
      const timer = lobbyAdvanceTimers.get(lobby.id);
      if (timer) {
        clearTimeout(timer);
        lobbyAdvanceTimers.delete(lobby.id);
        console.log('🔄 Timer cancelado - lobby vazio');
      }
      
      if (lobby.users.length === 0) {
        delete lobbies[lobby.id];
        console.log(`🗑️ Lobby ${lobby.id} removido por estar vazio.`);
        console.log('📊 Total de lobbies agora:', Object.keys(lobbies).length);
      }
    }
  });
});

// --- Tratamento de Erros Globais ---
process.on('uncaughtException', (error) => {
  console.error('❌ Erro não capturado:', error);
  console.error('Stack:', error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promise rejeitada não tratada:', reason);
  console.error('Promise:', promise);
});

// --- Inicialização do Servidor ---
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log('🚀 Servidor B2B Matchmaking iniciado!');
  console.log(`📡 Servidor ouvindo na porta ${PORT}`);
  console.log(`🌐 Socket.IO habilitado com CORS para todas as origens`);
  console.log(`✅ Acesse http://localhost:${PORT} para verificar se está funcionando`);
}).on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Erro: A porta ${PORT} já está em uso!`);
    console.error('   Tente fechar outros processos ou altere a porta no arquivo .env');
  } else {
    console.error('❌ Erro ao iniciar o servidor:', error);
  }
  process.exit(1);
});
