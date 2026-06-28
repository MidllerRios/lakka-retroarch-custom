# Lakka Retroarch Custom

Este repositório contém scripts, configurações e uma interface web voltada para a gestão e customização do **Lakka** (uma distribuição Linux leve focada no RetroArch). O objetivo é facilitar o dia-a-dia de quem utiliza o Lakka como central multijogos, permitindo ações rápidas de gestão.

## 🌟 Funcionalidades Principais

### 1. Web Portal de Gestão
Uma página web leve (HTML/CSS/JS) acoplada a um pequeno servidor Python para controlar e gerenciar o Lakka diretamente pelo navegador:
- **`webportal/server.py`**: Um servidor web minimalista em Python.
- **`webportal/deploy.ps1`**: Script PowerShell para realizar o deploy automático do portal web e suas dependências.
- **`webportal/index.html`**: A interface visual para interagir com o sistema remotamente.

### 2. Automações e Scripts
- **`transfer_local.py`**: Utilitário em Python para ajudar na transferência local de ROMs de maneira simplificada, automatizando cópias ou movimentações para dentro da estrutura correta.
- **`scripts/`**: Pasta destinada a scripts utilitários diversos.

## 🚀 Como Usar e Instalar o Portal Web

O portal é instalado remotamente no seu Lakka a partir de um computador com Windows.

### 0. Habilitando o SSH no Lakka
Como o deploy usa comunicação segura via rede, você precisa primeiro habilitar o SSH no seu Lakka:
1. No menu principal do Lakka, vá em **Configurações (Settings)** > **Serviços (Services)**.
2. Ative a opção **SSH**.

### 1. Configurando o seu IP
Antes de instalar, você precisa informar o IP do seu Lakka:
1. Abra o arquivo **`webportal/deploy.ps1`** com qualquer editor de texto (como o Bloco de Notas).
2. Na primeira linha, altere a variável `$LHost` para o IP do seu Lakka (ex: `192.168.1.100`).
3. Salve o arquivo.

### 2. Fazendo o Deploy
1. Abra o **PowerShell** no Windows e navegue até a pasta `webportal` do repositório.
2. Execute o script de instalação:
   ```powershell
   .\deploy.ps1
   ```
   *Obs: O script usa o `plink` e o `pscp` (ferramentas SSH do PuTTY) para enviar e iniciar os serviços no Lakka automaticamente.*

### 3. Acessando o Painel
Após o deploy concluir com sucesso, basta abrir o seu navegador e acessar o endereço do seu Lakka na porta 8081:
👉 **`http://<IP_DO_LAKKA>:8081`**
## 📂 Estrutura de Pastas

- `Bios/`: Destinada aos arquivos de BIOS requeridos pelos emuladores do RetroArch.
- `docs/`: Documentações adicionais sobre o projeto ou anotações úteis.
- `scripts/`: Scripts auxiliares de histórico e organização.
- `webportal/`: Contém todo o código-fonte (Frontend e Backend) da interface web de gestão.

## 📝 Licença
Este projeto é de código aberto e pode ser modificado livremente conforme necessário. Ideal para uso pessoal ou adaptações em arcades/fliperamas caseiros baseados no Lakka.
