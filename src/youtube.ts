import axios from 'axios';
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
    break;
  }
}

if (!envLoaded) {
  dotenv.config(); // Tenta carregar do diretório padrão
}

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

/**
 * Converte duração do YouTube (PT1M30S) para segundos
 */
function parseYouTubeDuration(duration: string): number {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  
  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);
  
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Busca vídeos no YouTube usando a Data API v3.
 * Se não houver API key, retorna array vazio.
 */
export const searchYouTubeVideos = async (query: string): Promise<any[]> => {
  // Debug: verifica se a key está sendo lida
  if (!YOUTUBE_API_KEY) {
    console.warn('⚠️ YOUTUBE_API_KEY não configurada. Busca no YouTube desabilitada.');
    console.warn('   💡 Para habilitar: Obtenha uma API key em https://console.cloud.google.com/');
    console.warn('   💡 Adicione YOUTUBE_API_KEY=sua_key no arquivo server/.env');
    console.warn('   💡 Certifique-se de reiniciar o servidor após adicionar a key!');
    return [];
  }

  console.log('🔍 Buscando no YouTube:', query);
  console.log('🔑 API Key configurada:', YOUTUBE_API_KEY ? `${YOUTUBE_API_KEY.substring(0, 10)}...` : 'NÃO ENCONTRADA');

  try {
    const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: {
        part: 'snippet',
        q: query,
        type: 'video',
        maxResults: 10,
        key: YOUTUBE_API_KEY,
      },
    });

    const items = response.data.items || [];
    console.log(`✅ YouTube: ${items.length} resultados encontrados`);
    
    // Busca detalhes dos vídeos para obter duração
    const videoIds = items.map((item: any) => item.id.videoId).join(',');
    let videoDetails: any[] = [];
    
    try {
      const detailsResponse = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
        params: {
          part: 'contentDetails',
          id: videoIds,
          key: YOUTUBE_API_KEY,
        },
      });
      videoDetails = detailsResponse.data.items || [];
    } catch (error) {
      console.warn('⚠️ Não foi possível obter detalhes dos vídeos (duração)');
    }
    
    // Cria um mapa de IDs para duração
    const durationMap = new Map<string, number>();
    videoDetails.forEach((video: any) => {
      // YouTube retorna duração no formato PT1M30S (1 minuto e 30 segundos)
      const durationStr = video.contentDetails?.duration || '';
      const durationSeconds = parseYouTubeDuration(durationStr);
      if (durationSeconds > 0) {
        durationMap.set(video.id, durationSeconds);
      }
    });
    
    return items.map((item: any) => ({
      id: item.id.videoId,
      title: item.snippet.title,
      artist: item.snippet.channelTitle,
      uri: `https://www.youtube.com/watch?v=${item.id.videoId}`,
      albumArt: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url,
      source: 'youtube',
      duration: durationMap.get(item.id.videoId) || null, // Duração em segundos
    }));
  } catch (error: any) {
    console.error('❌ Erro ao buscar no YouTube:');
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Erro:', JSON.stringify(error.response.data, null, 2));
      
      // Mensagens de erro comuns
      if (error.response.data?.error?.errors) {
        const youtubeError = error.response.data.error.errors[0];
        if (youtubeError.reason === 'quotaExceeded') {
          console.error('   ⚠️ Cota da API do YouTube excedida!');
        } else if (youtubeError.reason === 'keyInvalid') {
          console.error('   ⚠️ API Key inválida! Verifique se está correta no .env');
        }
      }
    } else {
      console.error('   Erro:', error.message);
    }
    return [];
  }
};

