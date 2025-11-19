# B2B Matchmaking - Server 🎧

Backend do sistema B2B Matchmaking - Sistema de lobbies colaborativos para DJs com sincronização em tempo real.

## 🚀 Tecnologias

- **Node.js** + **TypeScript**
- **Express** - Servidor HTTP
- **Socket.IO** - Comunicação em tempo real
- **YouTube Data API v3** - Busca de músicas
- **SoundCloud API** - Busca de músicas (opcional)

## 📋 Configuração

1. Instale as dependências:
```bash
npm install
```

2. Configure as variáveis de ambiente no arquivo `.env`:
```env
YOUTUBE_API_KEY=sua_api_key_aqui
SOUNDCLOUD_CLIENT_ID=seu_client_id_aqui (opcional)
PORT=3001
```

3. Inicie o servidor:
```bash
npm run dev    # Desenvolvimento
npm run build  # Build para produção
npm start      # Produção
```

## 🔧 Funcionalidades

- ✅ Criação e gerenciamento de lobbies
- ✅ Sistema de roles (DJ/Espectador)
- ✅ Busca de músicas no YouTube e SoundCloud
- ✅ Fila colaborativa sincronizada em tempo real
- ✅ Sincronização de reprodução entre todos os clientes
- ✅ Avanço automático de músicas

## 📡 Endpoints

- `GET /` - Health check
- `GET /health` - Status do servidor
- `GET /search?q={query}&source={youtube|soundcloud|all}` - Busca de músicas

## 🔌 Socket.IO Events

### Cliente → Servidor:
- `criar_lobby` - Cria um novo lobby
- `entrar_lobby` - Entra em um lobby existente
- `adicionar_faixa` - Adiciona música à fila
- `remover_faixa` - Remove música da fila
- `musica_terminou` - Notifica que música terminou

### Servidor → Cliente:
- `lobby_criado` - Confirma criação de lobby
- `lobby_entrou` - Confirma entrada no lobby
- `fila_atualizada` - Atualiza a fila de músicas
- `usuario_entrou` - Notifica entrada de usuário
- `usuario_saiu` - Notifica saída de usuário
- `erro_lobby` - Erro relacionado ao lobby

## 🔒 Segurança

- ✅ Arquivos `.env` não são commitados (`.gitignore`)
- ✅ CORS configurado
- ✅ Validação de roles (apenas DJs podem adicionar/remover músicas)

## 📝 Notas

- Lobbies são armazenados em memória (não persistem após reiniciar)
- Máximo de 2 DJs por lobby
- Lock por lobby para evitar processamento duplicado de eventos

