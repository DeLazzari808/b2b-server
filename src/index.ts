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

// --- Configuração do Servidor ---
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
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
    
    // Se é a primeira música da fila, adiciona timestamp de início
    if (lobby.queue.length === 0) {
      track.startTime = Date.now();
      console.log('⏰ Primeira música da fila, definindo startTime:', track.startTime);
    }
    
    lobby.queue.push(track);
    console.log('✅ Música adicionada:', track.title);
    console.log('📊 Tamanho da fila agora:', lobby.queue.length);
    
    io.to(lobby.id).emit('fila_atualizada', lobby.queue);
    console.log('📤 Enviado evento "fila_atualizada" para o lobby:', lobby.id);
  });
  
  // Evento para quando uma música termina - servidor gerencia o avanço automático
  socket.on('musica_terminou', () => {
    console.log('📤 Recebido evento "musica_terminou" de:', socket.id);
    
    const context = findLobbyAndUser(socket.id);
    
    if (!context) {
      console.error('❌ Usuário não encontrado em nenhum lobby');
      return;
    }
    
    const { lobby } = context;
    
    // Verifica se já está processando um evento para este lobby (lock)
    if (lobbyProcessingLocks.get(lobby.id)) {
      console.log('⚠️ Já está processando avanço de música para este lobby, ignorando evento duplicado');
      return;
    }
    
    // Se não há músicas na fila, não faz nada
    if (lobby.queue.length === 0) {
      console.log('⚠️ Fila vazia, nada para avançar');
      return;
    }
    
    // Ativa o lock para este lobby
    lobbyProcessingLocks.set(lobby.id, true);
    
    try {
      // Verifica novamente se há músicas (pode ter sido removida por outro evento)
      if (lobby.queue.length === 0) {
        console.log('⚠️ Fila já estava vazia ao processar evento');
        return;
      }
      
      // Remove a primeira música da fila
      const trackRemovido = lobby.queue[0];
      const trackIdRemovido = trackRemovido.id;
      lobby.queue = lobby.queue.slice(1);
      console.log('✅ Música terminou e foi removida:', trackRemovido.title, `(ID: ${trackIdRemovido})`);
      console.log('📊 Tamanho da fila agora:', lobby.queue.length);
      
      // Se ainda há músicas na fila, define startTime para a próxima
      if (lobby.queue.length > 0) {
        // Sempre atualiza o startTime para garantir sincronização
        lobby.queue[0].startTime = Date.now();
        console.log('⏰ Próxima música iniciando com startTime:', lobby.queue[0].startTime);
        console.log('   - Próxima música:', lobby.queue[0].title);
      } else {
        console.log('📭 Fila vazia após remover música');
      }
      
      // Notifica todos no lobby sobre a atualização da fila
      io.to(lobby.id).emit('fila_atualizada', lobby.queue);
      console.log('📤 Enviado evento "fila_atualizada" para o lobby:', lobby.id);
    } finally {
      // Remove o lock após um pequeno delay para evitar processar eventos muito próximos
      setTimeout(() => {
        lobbyProcessingLocks.delete(lobby.id);
        console.log('🔓 Lock removido para lobby:', lobby.id);
      }, 1000); // 1 segundo de debounce para garantir que não processe eventos duplicados
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
    if (wasFirstTrack && lobby.queue.length > 0 && !lobby.queue[0].startTime) {
      lobby.queue[0].startTime = Date.now();
      console.log('⏰ Nova primeira música, definindo startTime:', lobby.queue[0].startTime);
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
