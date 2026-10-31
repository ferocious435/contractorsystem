@echo off
if not exist "%LOCALAPPDATA%\ContractorSystem\start.cmd" (
  echo ContractorSystem is not installed in this Windows account.
  pause
  exit /b 1
)
call "%LOCALAPPDATA%\ContractorSystem\start.cmd"
