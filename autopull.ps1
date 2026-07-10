# Auto-pull: every 5 minutes, fetch origin/main and rebase local work on top
# when the remote has advanced. Read-only fetch is always safe; the pull only
# runs when behind. On conflict it aborts cleanly and logs a CONFLICT line so
# an agent can resolve it, rather than leaving the tree half-merged.
$ErrorActionPreference = 'Continue'
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
Set-Location "C:\Users\Quert\Documents\SandsOfApocalypseGame"

while ($true) {
    $ts = Get-Date -Format 'u'
    git fetch origin main 2>&1 | Out-Null
    $local = (git rev-parse HEAD 2>$null)
    $remote = (git rev-parse origin/main 2>$null)
    if ($local -and $remote -and ($local -ne $remote)) {
        git pull --rebase --autostash origin main 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            git rebase --abort 2>&1 | Out-Null
            "$ts CONFLICT: remote $remote could not auto-rebase; left local $local untouched." | Add-Content autopull.log
        } else {
            "$ts pulled $local -> $remote" | Add-Content autopull.log
        }
    } else {
        "$ts up-to-date" | Add-Content autopull.log
    }
    Start-Sleep -Seconds 300
}
