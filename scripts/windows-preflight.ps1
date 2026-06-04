# windows-preflight.ps1
#
# Phase 0c deliverable from docs/plans/2026-04-26-001-feat-windows-build-hardening-plan.md.
#
# Tester runs this once on their Windows machine before round 1. Prints a
# JSON report covering: OS build, Smart App Control state, enterprise-managed
# status, AppLocker presence, AV vendor. Output goes into the round handoff memo.
#
# Usage (in PowerShell on the tester's machine):
#   irm https://raw.githubusercontent.com/inkykim/0studio/<branch>/scripts/windows-preflight.ps1 | iex
#
# Or manually:
#   powershell -ExecutionPolicy Bypass -File windows-preflight.ps1
#
# Required OS Build for SAC reversibility (KB5083769, April 2026 cumulative): >= 26100.8116.

$ErrorActionPreference = 'SilentlyContinue'

function Get-WindowsBuild {
    $os = Get-CimInstance Win32_OperatingSystem
    $cv = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
    @{
        caption       = $os.Caption
        version       = $os.Version
        buildNumber   = $os.BuildNumber
        ubr           = $cv.UBR
        fullBuild     = "$($os.BuildNumber).$($cv.UBR)"
        sacReversible = ($os.BuildNumber -ge 26100 -and $cv.UBR -ge 8116)
        displayVersion = $cv.DisplayVersion
        installType   = $cv.InstallationType
    }
}

function Get-SacState {
    $st = Get-MpComputerStatus
    @{
        smartAppControlState = $st.SmartAppControlState
        amRunningMode        = $st.AMRunningMode
        amProductVersion     = $st.AMProductVersion
    }
}

function Get-AppLockerState {
    $policy = Get-AppLockerPolicy -Effective -ErrorAction SilentlyContinue
    if (-not $policy) {
        return @{ enforced = $false; rules = 0 }
    }
    $xml = $policy.ToXml()
    @{
        enforced = $true
        rules    = ([xml]$xml).AppLockerPolicy.RuleCollection.Count
    }
}

function Get-EnterpriseEnrollment {
    $reg = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MDM' -ErrorAction SilentlyContinue
    $domainJoined = (Get-CimInstance Win32_ComputerSystem).PartOfDomain
    $azureAdJoined = $false
    try {
        $dsregcmd = (& dsregcmd /status 2>&1 | Out-String)
        if ($dsregcmd -match 'AzureAdJoined\s*:\s*YES') { $azureAdJoined = $true }
    } catch {}
    @{
        domainJoined  = $domainJoined
        azureAdJoined = $azureAdJoined
        mdmEnrolled   = ($null -ne $reg.AutoEnrollMDM)
    }
}

function Get-AntivirusVendor {
    try {
        $av = Get-CimInstance -Namespace 'root/SecurityCenter2' -Class AntiVirusProduct
        $av | ForEach-Object { @{ name = $_.displayName; state = $_.productState } }
    } catch {
        @()
    }
}

$report = [ordered]@{
    timestamp        = (Get-Date).ToString('o')
    hostname         = $env:COMPUTERNAME
    windows          = Get-WindowsBuild
    smartAppControl  = Get-SacState
    appLocker        = Get-AppLockerState
    enterprise       = Get-EnterpriseEnrollment
    antivirus        = (Get-AntivirusVendor)
}

# Decision summary
$decision = [ordered]@{
    canSafelyDisableSac = $report.windows.sacReversible
    blockedByAppLocker  = $report.appLocker.enforced
    blockedByEnterprise = ($report.enterprise.domainJoined -or $report.enterprise.mdmEnrolled)
    needsActionFromTester = ($report.smartAppControl.smartAppControlState -eq 'On' -or $report.appLocker.enforced)
    recommendedActions  = @()
}
if ($report.smartAppControl.smartAppControlState -eq 'On' -and $report.windows.sacReversible) {
    $decision.recommendedActions += 'Toggle SAC off: Settings → Privacy & Security → Windows Security → App & browser control → Smart App Control settings → Off'
}
if ($report.smartAppControl.smartAppControlState -eq 'On' -and -not $report.windows.sacReversible) {
    $decision.recommendedActions += 'Update Windows to OS Build >= 26100.8116 first; otherwise SAC turn-off requires Windows reset.'
}
if ($report.appLocker.enforced) {
    $decision.recommendedActions += 'AppLocker is enforced — defer this tester until code signing is in place; no override possible.'
}
if ($report.enterprise.domainJoined -or $report.enterprise.mdmEnrolled) {
    $decision.recommendedActions += 'Machine is enterprise-managed — verify with IT whether unsigned binaries are allowed.'
}

$out = [ordered]@{ report = $report; decision = $decision }
$out | ConvertTo-Json -Depth 5
