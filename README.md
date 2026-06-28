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

## 🚀 Como Usar

### Deploy do Web Portal (A partir do Windows)
Se você estiver utilizando Windows, pode realizar o deploy do portal no seu ambiente usando o PowerShell:
1. Abra o PowerShell na pasta `webportal`.
2. Execute o script de deploy:
   ```powershell
   .\deploy.ps1
   ```
3. Acesse a interface gerada via navegador.

## 📂 Estrutura de Pastas

- `Bios/`: Destinada aos arquivos de BIOS requeridos pelos emuladores do RetroArch.
- `docs/`: Documentações adicionais sobre o projeto ou anotações úteis.
- `scripts/`: Scripts auxiliares de histórico e organização.
- `webportal/`: Contém todo o código-fonte (Frontend e Backend) da interface web de gestão.

## 📝 Licença
Este projeto é de código aberto e pode ser modificado livremente conforme necessário. Ideal para uso pessoal ou adaptações em arcades/fliperamas caseiros baseados no Lakka.
