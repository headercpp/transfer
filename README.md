# Transfer

Transfira arquivos e textos entre seu celular e seu PC sem cabos, sem nuvem, sem WhatsApp apertando qualidade. Funciona na sua rede Wi-Fi ou, se o roteador bloquear, por um túnel seguro pela internet (automático).

![Transfer](build/icon.png)

## O que tem dentro

**Arquivos nos dois sentidos**
- **Celular → PC:** escolhe os arquivos no celular, aparecem na pasta `Downloads/Transfer` no PC. Tocando no histórico do PC você também pode salvar uma cópia em outra pasta.
- **PC → Celular:** arrasta na janela do Transfer (ou clica em "Escolher arquivos"), o celular baixa quando quiser.

**Texto e links**
Manda senha, código SMS, URL ou qualquer texto do PC pro celular e vice-versa. No PC, cada texto recebido tem botão pra copiar pra área de transferência ou salvar como `.txt` em qualquer pasta.

**Dois modos de conexão**
- **Internet (padrão):** o app sobe um túnel seguro pela Cloudflare automaticamente. Funciona em qualquer rede, até se o celular estiver em dados móveis em outra cidade. Primeira abertura baixa o `cloudflared.exe` (~20MB), depois é instantâneo.
- **Rede local:** mais rápido, direto pelo seu Wi-Fi. Exige que o roteador não tenha isolamento de clientes habilitado.

**Dispositivos conectados ao vivo**
Lista no card de conectar mostra qual celular está conectado agora (iPhone, Android, etc.) e o IP.

**Estatísticas**
No topo: quantos arquivos enviados/recebidos, quantos textos, tamanho total, quantos na fila.

**Histórico**
Tudo que passou pelo app fica no histórico com data/hora, tamanho e ações rápidas por item.

**Som sutil ao receber**
Toque discreto quando chega arquivo ou texto no PC.

## Como funciona

Abre o Transfer no PC, escaneia o QR code com a câmera do celular, pronto. Não precisa instalar nada no celular — a interface do celular é uma página web (PWA) servida pelo próprio PC. Funciona em Android e iPhone.

## Baixar

Vai em [Releases](../../releases/latest) e pega o `Transfer-0.1.0-setup.exe`.

Instalação em um clique: sem wizard, sem senha de admin, sem perguntar onde instalar. Cria atalho na área de trabalho e no Menu Iniciar, abre o app e pronto.

## Rodar em desenvolvimento

```powershell
npm install
npm run dev
```

Em outro terminal:

```powershell
npm run electron
```

## Gerar ícones (opcional)

Se mexer no `build/icon.svg`, regera os PNGs e o ICO:

```powershell
npm run icons
```

## Build do instalador

```powershell
npm run build
```

Sai em `release\Transfer-0.1.0-setup.exe`.

## Stack

Electron 30, React 18, TypeScript, Vite, Framer Motion no front. O servidor HTTP que serve a PWA do celular e recebe/envia arquivos é o `http` nativo do Node, sem dependências. PWA do celular é HTML + CSS + JS puro, uma página só. O túnel pela internet usa `cloudflared` (quick tunnel da Cloudflare, grátis e sem cadastro) baixado automaticamente na primeira abertura.

## Privacidade

- No modo **Rede local** os arquivos nunca saem da sua rede.
- No modo **Internet** os arquivos passam pelos servidores da Cloudflare criptografados em HTTPS, mas nada é armazenado lá.
- Nada é enviado pro desenvolvedor do app, para analytics, nem pra lugar nenhum.

## Licença

MIT. Pode usar, modificar e distribuir à vontade.
