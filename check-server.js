// Script simples para verificar se o servidor está rodando
const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/health',
  method: 'GET',
  timeout: 2000
};

const req = http.request(options, (res) => {
  console.log(`✅ Servidor está rodando! Status: ${res.statusCode}`);
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      console.log('📊 Informações do servidor:', json);
    } catch (e) {
      console.log('📄 Resposta:', data);
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Servidor NÃO está rodando!');
  console.error('   Erro:', error.message);
  console.error('\n💡 Solução:');
  console.error('   1. Navegue até a pasta "server"');
  console.error('   2. Execute: npm run dev');
});

req.on('timeout', () => {
  console.error('❌ Timeout ao conectar ao servidor');
  req.destroy();
});

req.end();

