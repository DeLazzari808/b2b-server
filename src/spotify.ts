import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

let accessToken: string | null = null;
let tokenExpiryTime: number = 0;

/**
 * Obtém um token de acesso da API do Spotify usando Client Credentials Flow.
 * O token é armazenado em cache para reutilização.
 */
const getAccessToken = async (): Promise<string | null> => {
  if (accessToken && Date.now() < tokenExpiryTime) {
    return accessToken;
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('As credenciais do Spotify (SPOTIFY_CLIENT_ID e SPOTIFY_CLIENT_SECRET) não foram definidas no .env');
    return null;
  }

  try {
    const response = await axios.post('https://accounts.spotify.com/api/token', 'grant_type=client_credentials', {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64'),
      },
    });

    accessToken = response.data.access_token;
    // Define o tempo de expiração para 5 minutos antes do tempo real para segurança
    tokenExpiryTime = Date.now() + (response.data.expires_in - 300) * 1000;
    
    console.log('Novo token de acesso do Spotify obtido.');
    return accessToken;

  } catch (error) {
    console.error('Erro ao obter o token de acesso do Spotify:', error);
    return null;
  }
};

/**
 * Procura por faixas na API do Spotify.
 */
export const searchTracks = async (query: string): Promise<any[]> => {
  const token = await getAccessToken();
  if (!token) {
    return [];
  }

  try {
    const response = await axios.get('https://api.spotify.com/v1/search', {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      params: {
        q: query,
        type: 'track',
        limit: 10, // Limita a 10 resultados
      },
    });
    
    // Mapeia os resultados para um formato mais simples
    return response.data.tracks.items.map((track: any) => ({
      id: track.id,
      title: track.name,
      artist: track.artists.map((artist: any) => artist.name).join(', '),
      uri: track.uri,
      albumArt: track.album.images[2]?.url || track.album.images[1]?.url || track.album.images[0]?.url,
      previewUrl: track.preview_url
    }));

  } catch (error) {
    console.error('Erro ao buscar músicas no Spotify:', error);
    return [];
  }
};
