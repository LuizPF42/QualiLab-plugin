@echo off
rem ---------------------------------------------------------------------------------------------
rem QualiLab - lancador de RESGATE para Windows. NAO e o caminho padrao: o padrao e `node` puro,
rem que e a convencao do ecossistema (nos ~100 plugins do marketplace oficial da Anthropic, ZERO
rem ramificam comando por plataforma - todos chamam npx/bun/uvx/php nu, resolvido pelo PATH).
rem
rem SEM ACENTO DE PROPOSITO: o cmd.exe le este arquivo na codepage OEM (850/437), nao em UTF-8. Um
rem "nao" acentuado aqui vira byte solto, o rem perde a linha e o console despeja dezenas de
rem "nao e reconhecido como um comando interno" antes do servidor subir. Medido em 2/ago/2026.
rem
rem Este arquivo existe para os DOIS casos em que `node` puro falha no Windows, e os dois sao
rem comuns o bastante para terem virado secao de README:
rem
rem   1. NODE INSTALADO E O CLIENTE NAO ACHA. Cada programa herda o PATH de quem o abriu, e o
rem      Windows nao avisa os ja em execucao de que o PATH mudou. Sintoma que engana: o plugin
rem      aparece instalado e o assistente diz que nao tem ferramenta. A cura oficial e reiniciar o
rem      computador; procurar nos diretorios de instalacao dispensa o reboot.
rem   2. QUEM TEM O APP DO CHATGPT JA TEM UM NODE. Desde 1/ago/2026 ele provisiona um runtime
rem      gerenciado (Node 24 + Python) em ~/.cache/codex-runtimes, FORA do AppData. Emprestar esse
rem      runtime e o que faz o plugin rodar sem instalar nada - e foi medido funcionando.
rem
rem PRECO, dito por inteiro: e um caminho INTERNO de outro produto. Se a OpenAI mudar o layout, a
rem cadeia cai no proximo item e nada quebra - por isso ele e o primeiro da lista, e nao o unico.
rem
rem Para usar, troque no mcp-claude.json (ou mcp-codex.json) do plugin instalado:
rem     "command": "cmd.exe",
rem     "args": ["/d", "/s", "/c", "${CLAUDE_PLUGIN_ROOT}\\server\\run-windows.cmd"]
rem ---------------------------------------------------------------------------------------------
setlocal EnableExtensions DisableDelayedExpansion

set "ql_node=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%ql_node%" set "ql_node=%LOCALAPPDATA%\nodejs\node.exe"
if not exist "%ql_node%" set "ql_node=%ProgramFiles%\nodejs\node.exe"
if not exist "%ql_node%" set "ql_node=%ProgramFiles(x86)%\nodejs\node.exe"
rem ultimo recurso: o PATH do processo que nos abriu, se nenhum diretorio conhecido tinha node
if not exist "%ql_node%" set "ql_node=node"

rem %~dp0 termina com barra, e as aspas protegem o "Documents and Settings" da vida
"%ql_node%" "%~dp0main.mjs" %*
exit /b %errorlevel%
