@echo off
setlocal
set "ContractorSystemStart=%LOCALAPPDATA%\ContractorSystem\start.cmd"
if not exist "%ContractorSystemStart%" set "ContractorSystemStart=%LOCALAPPDATA%\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\ContractorSystem\start.cmd"
if not exist "%ContractorSystemStart%" (
  echo ContractorSystem is not installed in this Windows account.
  pause
  exit /b 1
)
call "%ContractorSystemStart%"
exit /b %errorlevel%
