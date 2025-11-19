# 🚀 Como Conectar ao GitHub

## Passo 1: Criar Repositório no GitHub

1. Acesse https://github.com/new
2. Nome do repositório: `b2b-server` (ou `b2b-matchmaking-server`)
3. Descrição: "Backend do B2B Matchmaking - Sistema de lobbies colaborativos para DJs"
4. **NÃO** marque "Initialize with README" (já temos um)
5. Clique em "Create repository"

## Passo 2: Conectar o Repositório Local

Execute os seguintes comandos no terminal (dentro da pasta `server`):

```bash
# Adiciona o repositório remoto (substitua SEU_USUARIO pelo seu username do GitHub)
git remote add origin https://github.com/SEU_USUARIO/b2b-server.git

# Renomeia a branch para main (se necessário)
git branch -M main

# Envia os commits para o GitHub
git push -u origin main
```

## Passo 3: Verificar

Acesse seu repositório no GitHub e verifique se todos os arquivos foram enviados.

## ✅ Checklist de Segurança

Antes de fazer push, certifique-se de que:

- [ ] Arquivo `.env` **NÃO** está no repositório
- [ ] `node_modules/` **NÃO** está no repositório
- [ ] Arquivos de build (`dist/`) **NÃO** estão no repositório
- [ ] `.gitignore` está configurado corretamente

## 🔒 Variáveis de Ambiente no Deploy

Quando fizer deploy (Railway, Render, etc), configure as variáveis de ambiente:

- `YOUTUBE_API_KEY`
- `SOUNDCLOUD_CLIENT_ID` (opcional)
- `PORT` (opcional, padrão: 3001)
- `NODE_ENV=production`

**NUNCA** commite o arquivo `.env` com valores reais!

