import { spawnSync } from 'node:child_process';

function escapeForPowerShell(value) {
  return value.replaceAll("'", "''");
}

export function cleanupWindowsDevProcesses({ workspaceDir, childPid, stdio = 'inherit' }) {
  const safeWorkspaceDir = escapeForPowerShell(workspaceDir);
  const safeChildPid = Number(childPid) || 0;
  const script = `
$workspace = '${safeWorkspaceDir}'
$childPid = ${safeChildPid}
$targets = Get-CimInstance Win32_Process | Where-Object {
  ($childPid -gt 0 -and $_.ProcessId -eq $childPid) -or
  ($_.Name -eq 'node.exe' -and $_.CommandLine -match 'run-tauri\\.mjs|tauri\\.js|tauri-watchdog\\.mjs') -or
  ($_.Name -eq 'node.exe' -and $_.CommandLine -like "*$workspace*" -and $_.CommandLine -match 'ensure-dev-server|vite') -or
  ($_.Name -eq 'qollect.exe' -and $_.CommandLine -match 'target\\\\debug\\\\qollect\\.exe') -or
  ($_.Name -eq 'cargo.exe' -and $_.CommandLine -match 'run --no-default-features --color always --') -or
  ($_.Name -eq 'rustup.exe' -and $_.CommandLine -match 'cargo" run --no-default-features --color always --')
}

foreach ($proc in ($targets | Sort-Object ProcessId -Unique)) {
  taskkill /PID $proc.ProcessId /T /F | Out-Null
}
`;

  spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
    stdio,
    windowsHide: true,
  });
}
