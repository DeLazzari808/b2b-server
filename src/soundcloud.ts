import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const SOUNDCLOUD_CLIENT_ID = process.env.SOUNDCLOUD_CLIENT_ID;

/**
 * Busca músicas no SoundCloud usando a API pública.
 * Nota: A API pública do SoundCloud tem limitações, mas funciona sem autenticação para buscas básicas.
 */
export const searchSoundCloudTracks = async (query: string): Promise<any[]> => {
  if (!SOUNDCLOUD_CLIENT_ID) {
    console.warn('⚠️ SOUNDCLOUD_CLIENT_ID não configurada. Busca no SoundCloud desabilitada.');
    console.warn('   💡 Para habilitar: Crie uma app em https://developers.soundcloud.com/');
    console.warn('   💡 Adicione SOUNDCLOUD_CLIENT_ID=seu_id no arquivo server/.env');
    return [];
  }

  try {
    // SoundCloud API v2 - busca pública
    const response = await axios.get('https://api-v2.soundcloud.com/search/tracks', {
      params: {
        q: query,
        client_id: SOUNDCLOUD_CLIENT_ID,
        limit: 10,
      },
    });

    return response.data.collection.map((track: any) => ({
      id: track.id.toString(),
      title: track.title,
      artist: track.user?.username || 'Artista Desconhecido',
      uri: track.permalink_url || track.uri,
      albumArt: track.artwork_url || track.user?.avatar_url,
      source: 'soundcloud',
      streamUrl: track.stream_url ? `${track.stream_url}?client_id=${SOUNDCLOUD_CLIENT_ID}` : null,
    }));
  } catch (error: any) {
    console.error('❌ Erro ao buscar no SoundCloud:', error.response?.data || error.message);
    return [];
  }
};

